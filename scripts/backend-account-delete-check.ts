import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "vite";
import { z } from "zod";
import { LedgerSchema } from "../src/domain/model";
import { createAccountDeleteHandler } from "../server/accountDelete";

const container = "supabase_db_bari-khata";
const dockerHost = JSON.parse(
  execFileSync("docker", ["context", "inspect"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
)[0].Endpoints.docker.Host;
assert.match(
  process.env.DOCKER_HOST ?? dockerHost,
  /^unix:\/\//,
  "Only a local Docker socket may be used.",
);
assert.match(
  execFileSync(
    "docker",
    ["inspect", container, "--format", "{{.Config.Image}}"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim(),
  /supabase\/postgres:/,
  "Only the local bari-khata Supabase database may be used.",
);
let status: Record<string, string>;
try {
  status = JSON.parse(
    execFileSync("./node_modules/.bin/supabase", ["status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
} catch {
  throw new Error(
    "Start the local bari-khata Supabase backend before running this check.",
  );
}
const endpoint = status.API_URL;
assert.match(
  endpoint ?? "",
  /^http:\/\/(?:127\.0\.0\.1|localhost):55431$/,
  "This check only uses loopback Supabase on port 55431.",
);
const env = { ...loadEnv("development", process.cwd(), ""), ...process.env };
if (env.VITE_SUPABASE_URL) {
  const configured = new URL(env.VITE_SUPABASE_URL);
  assert.ok(
    configured.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(configured.hostname) &&
      configured.port === "55431",
    "The local app must point to local Supabase; production configuration is not accepted.",
  );
}
assert.ok(
  status.ANON_KEY && status.SERVICE_ROLE_KEY,
  "Local Supabase keys are required.",
);
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};
const admin = createClient(endpoint, status.SERVICE_ROLE_KEY, options);
const run = randomUUID();
const fixtures: {
  id: string;
  email: string;
  client: SupabaseClient;
  token: string;
  receipts: string[];
  shareToken: string;
}[] = [];
function success<R extends { data: unknown; error: unknown }>(
  result: R,
  label: string,
): R["data"] {
  if (result.error) throw new Error(`${label} failed.`);
  return result.data;
}
async function fixture(index: number) {
  const email = `bari-delete-check-${run}-${index}@example.invalid`;
  const password = `${randomBytes(32).toString("base64url")}Aa9!`;
  const created = success(
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { bari_disposable_delete_check: run },
    }),
    "Creating disposable account",
  ).user;
  if (
    !created ||
    !z.uuid().safeParse(created.id).success ||
    created.email !== email ||
    created.app_metadata.bari_disposable_delete_check !== run
  )
    throw new Error("The created disposable identity did not match.");
  const client = createClient(endpoint, status.ANON_KEY, options);
  const own = {
    id: created.id,
    email,
    client,
    token: "",
    receipts: [] as string[],
    shareToken: "",
  };
  fixtures.push(own);
  const login = success(
    await client.auth.signInWithPassword({ email, password }),
    "Signing in disposable account",
  );
  if (login.user?.id !== own.id || !login.session)
    throw new Error("Disposable sign-in returned another identity.");
  own.token = login.session.access_token;
  const document = LedgerSchema.parse({
    project: {
      id: `delete-check-${index}`,
      name: "Disposable account deletion check",
    },
    works: [{ id: "fixture-work", name: "Disposable notebook" }],
    people: [
      { id: "fixture-person", name: "Disposable contact", kind: "shop" },
    ],
  });
  const saved = success(
    await client.rpc("save_ledger_snapshot", {
      p_request_id: randomUUID(),
      p_expected_revision: 0,
      p_document: document,
    }),
    "Saving disposable ledger",
  );
  assert.equal(saved.status, "saved");
  for (const file of ["fixture-entry/receipt.pdf", "direct.pdf"]) {
    const path = `${own.id}/${file}`;
    own.receipts.push(path);
    success(
      await client.storage
        .from("bari-receipts")
        .upload(
          path,
          new TextEncoder().encode(
            `%PDF-1.1\nDisposable ${run} ${index}\n%%EOF`,
          ),
          { contentType: "application/pdf" },
        ),
      "Uploading disposable receipt",
    );
  }
  const shared = success(
    await client.rpc("create_contact_share", {
      p_person_id: "fixture-person",
      p_account: "materials",
      p_work_id: null,
    }),
    "Creating disposable share",
  );
  if (!shared || typeof shared.token !== "string")
    throw new Error("Disposable share was not returned.");
  own.shareToken = shared.token;
  return own;
}
async function rows(table: string, id: string) {
  const result = success(
    await admin.from(table).select("*").eq("owner_id", id),
    `Reading disposable ${table}`,
  );
  assert.ok(result !== null, "Disposable table rows were not returned.");
  return result;
}

async function absent(id: string) {
  const result = await admin.auth.admin.getUserById(id);
  assert.equal(result.data.user ?? null, null);
  assert.ok(
    result.error?.status === 404 || result.error?.code === "user_not_found",
    "Auth must confirm the disposable identity is not found.",
  );
}
async function receiptAbsent(path: string) {
  const result = await admin.storage.from("bari-receipts").download(path);
  const error = result.error as {
    statusCode?: string | number;
    message?: string;
  } | null;
  assert.ok(
    error && ["400", "404"].includes(String(error.statusCode)),
    "Storage must confirm a missing disposable receipt.",
  );
  assert.match(
    error.message ?? "",
    /not found|does not exist/i,
    "A receipt lookup failed without confirming absence.",
  );
}
const handler = createAccountDeleteHandler({
  url: endpoint,
  serviceKey: status.SERVICE_ROLE_KEY,
  origin: "http://localhost:5180",
  vercel: false,
  local: true,
});
function deletion(
  token: string,
  confirmation = "DELETE",
  extra: Record<string, string> = {},
) {
  return handler(
    new Request("http://localhost:5180/api/account-delete", {
      method: "POST",
      headers: {
        Origin: "http://localhost:5180",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ confirmation, ...extra }),
    }),
  );
}
try {
  const own = await fixture(0),
    guard = await fixture(1);
  const guardLedger = await rows("ledger_documents", guard.id);
  const guardOperations = await rows("ledger_operations", guard.id);
  const guardLinks = await rows("contact_share_links", guard.id);
  assert.equal((await rows("ledger_documents", own.id)).length, 1);
  assert.equal((await rows("contact_share_links", own.id)).length, 1);
  assert.equal((await deletion(own.token, "delete")).status, 400);
  assert.equal(
    (await deletion(own.token, "DELETE", { ownerId: guard.id })).status,
    400,
  );
  assert.equal((await rows("ledger_documents", own.id)).length, 1);
  const response = await deletion(own.token);
  assert.equal(
    response.status,
    200,
    "Authenticated disposable deletion did not finish.",
  );
  assert.deepEqual(await response.json(), { deleted: true });
  await absent(own.id);
  for (const table of [
    "ledger_documents",
    "ledger_operations",
    "contact_share_links",
  ])
    assert.equal((await rows(table, own.id)).length, 0);
  for (const path of own.receipts) await receiptAbsent(path);
  assert.equal(
    (await deletion(own.token)).status,
    401,
    "A deleted account token was still accepted.",
  );
  const share = success(
    await admin.rpc("read_contact_share", { p_token: own.shareToken }),
    "Checking removed share",
  );
  assert.equal(share, null);
  const guardUser = success(
    await admin.auth.admin.getUserById(guard.id),
    "Checking guard account",
  ).user;
  assert.equal(guardUser?.id, guard.id);
  assert.equal(guardUser?.email, guard.email);
  assert.deepEqual(await rows("ledger_documents", guard.id), guardLedger);
  assert.deepEqual(await rows("ledger_operations", guard.id), guardOperations);
  assert.deepEqual(await rows("contact_share_links", guard.id), guardLinks);
  for (const path of guard.receipts)
    success(
      await guard.client.storage.from("bari-receipts").download(path),
      "Checking unrelated guard receipt",
    );
  console.log(
    "Local account deletion: verified bearer identity, exact DELETE, scoped nested receipts, Auth/ledger/share deletion, rejected old token and untouched guard account verified.",
  );
} finally {
  let cleanupFailed = false;
  for (const own of fixtures) {
    try {
      const result = await admin.auth.admin.getUserById(own.id);
      if (result.data.user) {
        if (
          result.data.user.email !== own.email ||
          result.data.user.app_metadata.bari_disposable_delete_check !== run
        )
          throw new Error("Cleanup refused an unexpected account.");
        if (own.receipts.length)
          success(
            await admin.storage.from("bari-receipts").remove(own.receipts),
            "Cleaning disposable receipts",
          );
        success(
          await admin.auth.admin.deleteUser(own.id),
          "Cleaning disposable account",
        );
      }
      await own.client.auth.signOut({ scope: "local" }).catch(() => {});
      await absent(own.id);
      for (const table of [
        "ledger_documents",
        "ledger_operations",
        "contact_share_links",
      ])
        assert.equal((await rows(table, own.id)).length, 0);
      for (const path of own.receipts) await receiptAbsent(path);
    } catch {
      cleanupFailed = true;
    }
  }
  if (cleanupFailed)
    throw new Error(
      "Disposable fixture cleanup did not finish; inspect only the fresh fixtures created by this script.",
    );
  console.log(
    "Both newly created disposable accounts, receipt files, ledgers, operations and share links were cleaned up. No existing account was modified.",
  );
}
