import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, chmod } from "node:fs/promises";

let status;
try {
  status = JSON.parse(
    execFileSync("./node_modules/.bin/supabase", ["status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
} catch {
  throw new Error(
    "Local Supabase is unavailable. Install dependencies and run npm run db:start first.",
  );
}
const api = status.API_URL;
const anon = status.ANON_KEY;
const admin = status.SERVICE_ROLE_KEY;
if (
  !/^http:\/\/(127\.0\.0\.1|localhost):55431$/.test(api ?? "") ||
  !anon ||
  !admin
) {
  throw new Error(
    "This check only runs against the local bari-khata project on port 55431.",
  );
}

async function request(path, options = {}, token = anon, label = "request") {
  const response = await fetch(`${api}${path}`, {
    ...options,
    headers: {
      apikey: anon,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!response.ok)
    throw new Error(
      `${label}: HTTP ${response.status} (${typeof data === "object" ? (data?.error_code ?? data?.code ?? "request_failed") : "request_failed"})`,
    );
  return data;
}

const users = [];
let receiptPath;
let firstToken;
let secondToken;
try {
  for (let index = 0; index < 2; index++) {
    const email = `bari-check-${randomUUID()}@example.com`;
    const password = `${randomUUID()}Aa9!`;
    const user = await request(
      "/auth/v1/admin/users",
      {
        method: "POST",
        headers: { apikey: admin },
        body: JSON.stringify({ email, password, email_confirm: true }),
      },
      admin,
      "create disposable user",
    );
    users.push(user.id);
    const session = await request(
      "/auth/v1/token?grant_type=password",
      {
        method: "POST",
        body: JSON.stringify({ email, password }),
      },
      anon,
      "sign in disposable user",
    );
    user.token = session.access_token;
    if (index === 0) firstToken = user.token;
    else secondToken = user.token;
  }
  const call = (name, payload, token = firstToken) =>
    request(
      `/rest/v1/rpc/${name}`,
      {
        method: "POST",
        body: JSON.stringify(payload ?? {}),
      },
      token,
      name,
    );
  const initial = await call("load_ledger_snapshot");
  assert.equal(initial.revision, 0);
  assert.equal(initial.document, null);
  const ledger = {
    schemaVersion: 1,
    isDemo: false,
    project: { id: "my-home", name: "Integration check", currency: "BDT" },
    works: [],
    people: [],
    items: [],
    contracts: [],
    entries: [],
  };
  const operationId = randomUUID();
  const payload = {
    p_request_id: operationId,
    p_expected_revision: 0,
    p_document: ledger,
  };
  const first = await call("save_ledger_snapshot", payload);
  assert.equal(first.status, "saved");
  assert.equal(first.revision, 1);
  const retry = await call("save_ledger_snapshot", payload);
  assert.equal(retry.revision, 1);
  const conflict = await call("save_ledger_snapshot", {
    ...payload,
    p_request_id: randomUUID(),
  });
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.revision, 1);
  assert.equal(conflict.document.project.name, ledger.project.name);
  await assert.rejects(
    call("save_ledger_snapshot", { ...payload, p_expected_revision: null }),
    /HTTP/,
  );
  await assert.rejects(
    call("save_ledger_snapshot", {
      p_request_id: randomUUID(),
      p_expected_revision: 1,
      p_document: {},
    }),
    /HTTP/,
  );
  await assert.rejects(
    call("save_ledger_snapshot", {
      ...payload,
      p_document: {
        ...ledger,
        project: { ...ledger.project, name: "changed" },
      },
    }),
    /HTTP/,
  );
  const richLedger = {
    ...ledger,
    materialGroups: [{ id: "adhesive-group", name: "আঠা", aliases: [] }],
    works: [{ id: "tiles", name: "টাইলসের কাজ" }],
    people: [{ id: "worker", name: "পরীক্ষার মিস্ত্রি" }],
    items: [
      {
        id: "adhesive",
        name: "টাইলসের আঠা",
        materialGroupId: "adhesive-group",
        brand: "",
        usage: "tiles",
      },
    ],
    entries: [
      {
        id: "voucher",
        kind: "expense",
        account: "materials",
        personId: "worker",
        lines: [
          {
            id: "line",
            workId: "tiles",
            itemId: "adhesive",
            materialGroupId: "adhesive-group",
            usage: "tiles",
            costType: "material",
            amount: 150000,
          },
        ],
        paymentParts: [],
        allocations: [],
        receipts: [],
      },
      {
        id: "reimbursement",
        kind: "payment",
        account: "materials",
        personId: "worker",
        lines: [],
        allocations: [{ workId: "tiles", amount: 170000 }],
        paymentParts: [{ method: "bkash", amount: 170000 }],
        receipts: [],
      },
    ],
  };
  const richSaved = await call("save_ledger_snapshot", {
    p_request_id: randomUUID(),
    p_expected_revision: 1,
    p_document: richLedger,
  });
  assert.equal(richSaved.revision, 2);
  const badLedger = structuredClone(richLedger);
  badLedger.entries[0].lines[0].amount = -1;
  await assert.rejects(
    call("save_ledger_snapshot", {
      p_request_id: randomUUID(),
      p_expected_revision: 2,
      p_document: badLedger,
    }),
    /HTTP/,
  );
  const wrongContract = structuredClone(richLedger);
  wrongContract.contracts = [
    { id: "contract", workId: "tiles", personId: "worker", total: 12540000 },
  ];
  wrongContract.entries[0].contractId = "contract";
  await assert.rejects(
    call("save_ledger_snapshot", {
      p_request_id: randomUUID(),
      p_expected_revision: 2,
      p_document: wrongContract,
    }),
    /HTTP/,
  );
  const wrongSettlement = structuredClone(richLedger);
  wrongSettlement.entries[1].relatedEntryId = "reimbursement";
  await assert.rejects(
    call("save_ledger_snapshot", {
      p_request_id: randomUUID(),
      p_expected_revision: 2,
      p_document: wrongSettlement,
    }),
    /HTTP/,
  );
  for (const corrupt of [
    (value) => {
      value.items[0].materialGroupId = "missing-group";
    },
    (value) => {
      value.entries[0].lines[0].materialGroupId = "missing-group";
    },
    (value) => {
      value.entries[0].balanceImpact = "imaginary";
    },
    (value) => {
      value.entries[0].reviewStatus = "guessed";
    },
    (value) => {
      value.entries[0].source = {
        file: "private.xlsx",
        cell: "A1",
        checksum: null,
      };
    },
  ]) {
    const invalidDetails = structuredClone(richLedger);
    corrupt(invalidDetails);
    await assert.rejects(
      call("save_ledger_snapshot", {
        p_request_id: randomUUID(),
        p_expected_revision: 2,
        p_document: invalidDetails,
      }),
      /HTTP/,
    );
  }
  const afterInvalid = await call("load_ledger_snapshot");
  assert.equal(afterInvalid.revision, 2);
  assert.equal(afterInvalid.document.entries[0].lines[0].amount, 150000);
  const otherLedger = await call("load_ledger_snapshot", {}, secondToken);
  assert.equal(otherLedger.revision, 0);
  await assert.rejects(
    request("/rest/v1/rpc/load_ledger_snapshot", {
      method: "POST",
      body: "{}",
    }),
    /HTTP/,
  );
  const registration = await request("/auth/v1/signup", {
    method: "POST",
    body: JSON.stringify({
      email: `bari-check-${randomUUID()}@example.com`,
      password: `${randomUUID()}Aa9!`,
    }),
  });
  const registrationId = registration.id ?? registration.user?.id;
  assert.match(registrationId ?? "", /^[a-f0-9-]{36}$/);
  users.push(registrationId);
  assert.ok(!registration.access_token);
  assert.ok(!registration.email_confirmed_at);

  const hidden = await request(
    `/rest/v1/ledger_documents?owner_id=eq.${users[0]}&select=owner_id`,
    {},
    secondToken,
  );
  assert.deepEqual(hidden, []);
  await assert.rejects(
    request(
      "/rest/v1/ledger_documents",
      {
        method: "POST",
        body: JSON.stringify({
          owner_id: users[0],
          revision: 100,
          document: ledger,
        }),
      },
      secondToken,
    ),
    /HTTP/,
  );

  receiptPath = `${users[0]}/${randomUUID()}`;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZkAAAAASUVORK5CYII=",
    "base64",
  );
  const uploaded = await fetch(
    `${api}/storage/v1/object/bari-receipts/${receiptPath}`,
    {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${firstToken}`,
        "Content-Type": "image/png",
      },
      body: png,
    },
  );
  assert.equal(
    uploaded.ok,
    true,
    `private receipt upload: HTTP ${uploaded.status}`,
  );
  const ownerRead = await fetch(
    `${api}/storage/v1/object/bari-receipts/${receiptPath}`,
    {
      headers: { apikey: anon, Authorization: `Bearer ${firstToken}` },
    },
  );
  assert.equal(ownerRead.ok, true);
  assert.deepEqual(Buffer.from(await ownerRead.arrayBuffer()), png);
  const otherRead = await fetch(
    `${api}/storage/v1/object/bari-receipts/${receiptPath}`,
    {
      headers: { apikey: anon, Authorization: `Bearer ${secondToken}` },
    },
  );
  assert.equal(otherRead.ok, false);
  const publicRead = await fetch(
    `${api}/storage/v1/object/public/bari-receipts/${receiptPath}`,
  );
  assert.equal(publicRead.ok, false);
  const forbiddenUpload = await fetch(
    `${api}/storage/v1/object/bari-receipts/${users[0]}/${randomUUID()}`,
    {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${secondToken}`,
        "Content-Type": "image/png",
      },
      body: png,
    },
  );
  assert.equal(forbiddenUpload.ok, false);
  let localEnv = "";
  try {
    localEnv = await readFile(".env.local", "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const [name, value] of Object.entries({
    VITE_SUPABASE_URL: api,
    VITE_SUPABASE_ANON_KEY: anon,
  })) {
    const line = `${name}=${JSON.stringify(value)}`;
    const pattern = new RegExp(`^${name}=.*$`, "m");
    localEnv = pattern.test(localEnv)
      ? localEnv.replace(pattern, () => line)
      : `${localEnv.trimEnd()}\n${line}\n`;
  }
  await writeFile(".env.local", localEnv, { mode: 0o600 });
  await chmod(".env.local", 0o600);
  console.log(
    "Verified: email-confirmed registration, local auth, owner-only ledger access, atomic snapshot save, idempotent retry, revision conflicts, invalid revision and taxonomy/provenance rejection, private voucher upload/download and cross-account denial.",
  );
  console.log(
    "Frontend local public configuration saved to ignored .env.local. Disposable accounts will be removed.",
  );
} finally {
  if (receiptPath && firstToken) {
    await request(
      "/storage/v1/object/bari-receipts",
      { method: "DELETE", body: JSON.stringify({ prefixes: [receiptPath] }) },
      firstToken,
      "cleanup receipt",
    ).catch(() => {});
  }
  for (const id of users)
    await request(
      `/auth/v1/admin/users/${id}`,
      {
        method: "DELETE",
        headers: { apikey: admin },
      },
      admin,
      "cleanup disposable user",
    ).catch(() => {});
}
