import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { LedgerSchema } from "../src/domain/model";

const status = JSON.parse(
  execFileSync("./node_modules/.bin/supabase", ["status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);
const api = status.API_URL as string;
const mail = (status.MAILPIT_URL ?? status.INBUCKET_URL) as string;
assert.match(api, /^http:\/\/(127\.0\.0\.1|localhost):55431$/);
assert.match(mail, /^http:\/\/(127\.0\.0\.1|localhost):55434$/);
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};
const admin = createClient(api, status.SERVICE_ROLE_KEY, options);
const publicClient = () => createClient(api, status.ANON_KEY, options);
const users = new Set<string>();
const messages = new Set<string>();
let receiptPath = "";
let firstToken = "";
async function rpc(name: string, body: unknown, token = status.ANON_KEY) {
  const result = await fetch(`${api}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: status.ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const value = await result.json();
  return { ok: result.ok, status: result.status, value };
}
async function messageFor(email: string) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const search = await fetch(
      `${mail}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    ).then((r) => r.json());
    const found = search.messages?.[0];
    if (found) {
      messages.add(found.ID);
      return fetch(`${mail}/api/v1/message/${found.ID}`).then((r) => r.json());
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Local confirmation email did not arrive.");
}
function confirmation(message: { HTML: string }) {
  const href = message.HTML.match(
    /href="([^"]*#token_hash=[^"]+)"/,
  )?.[1]?.replaceAll("&amp;", "&");
  assert.ok(href, "Confirmation template must use a fragment token.");
  const url = new URL(href);
  const params = new URLSearchParams(url.hash.slice(1));
  assert.equal(params.get("type"), "email");
  assert.match(params.get("token_hash") ?? "", /^[a-f0-9]{40,128}$/);
  assert.equal(url.search, "");
  return { url, token_hash: params.get("token_hash")! };
}
async function signupAndConfirm() {
  const email = `registration-check-${randomUUID()}@example.com`,
    password = `${randomUUID()}Aa9!`;
  const client = publicClient();
  const signup = await client.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: "http://127.0.0.1:5186/auth/confirm" },
  });
  assert.equal(signup.error, null);
  assert.ok(signup.data.user?.id);
  users.add(signup.data.user.id);
  assert.equal(
    signup.data.session,
    null,
    "Unconfirmed registration must not grant access.",
  );
  const rejected = await client.auth.signInWithPassword({ email, password });
  assert.equal(rejected.error?.code, "email_not_confirmed");
  const link = confirmation(await messageFor(email));
  assert.equal(link.url.origin, "http://127.0.0.1:5186");
  assert.equal(link.url.pathname, "/auth/confirm");
  const invalid = await publicClient().auth.verifyOtp({
    token_hash: "0".repeat(64),
    type: "email",
  });
  assert.ok(invalid.error);
  const verified = await publicClient().auth.verifyOtp({
    token_hash: link.token_hash,
    type: "email",
  });
  assert.equal(verified.error, null);
  assert.ok(verified.data.session);
  const replay = await publicClient().auth.verifyOtp({
    token_hash: link.token_hash,
    type: "email",
  });
  assert.ok(replay.error, "Confirmation links must be single-use.");
  const signedIn = await client.auth.signInWithPassword({ email, password });
  assert.equal(signedIn.error, null);
  assert.equal(signedIn.data.user?.id, signup.data.user.id);
  assert.ok(signedIn.data.session?.access_token);
  return {
    email,
    password,
    id: signup.data.user.id,
    token: signedIn.data.session.access_token,
  };
}
try {
  const weak = await publicClient().auth.signUp({
    email: `weak-${randomUUID()}@example.com`,
    password: "1234567",
  });
  assert.ok(
    weak.error,
    "The server must reject passwords shorter than eight characters.",
  );
  const invalid = await publicClient().auth.signUp({
    email: "invalid email",
    password: `${randomUUID()}Aa9!`,
  });
  assert.ok(invalid.error);
  const a = await signupAndConfirm();
  firstToken = a.token;
  const b = await signupAndConfirm();
  const duplicate = await publicClient().auth.signUp({
    email: a.email,
    password: a.password,
  });
  assert.equal(duplicate.data.session, null);
  assert.ok(
    !duplicate.error ||
      ["user_already_exists", "over_email_send_rate_limit"].includes(
        duplicate.error.code ?? "",
      ),
  );
  const first = await rpc("load_ledger_snapshot", {}, a.token);
  assert.equal(first.ok, true);
  assert.equal(first.value.revision, 0);
  assert.equal(first.value.document, null);
  const ledger = LedgerSchema.parse({
    project: { name: "Registration isolation fixture" },
  });
  const saved = await rpc(
    "save_ledger_snapshot",
    { p_request_id: randomUUID(), p_expected_revision: 0, p_document: ledger },
    a.token,
  );
  assert.equal(saved.ok, true);
  assert.equal(saved.value.status, "saved");
  const other = await rpc("load_ledger_snapshot", {}, b.token);
  assert.equal(other.value.revision, 0);
  assert.equal(other.value.document, null);
  const hidden = await fetch(
    `${api}/rest/v1/ledger_documents?owner_id=eq.${a.id}&select=owner_id`,
    {
      headers: { apikey: status.ANON_KEY, Authorization: `Bearer ${b.token}` },
    },
  ).then((r) => r.json());
  assert.deepEqual(hidden, []);
  assert.equal((await rpc("load_ledger_snapshot", {})).ok, false);
  receiptPath = `${a.id}/${randomUUID()}`;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZkAAAAASUVORK5CYII=",
    "base64",
  );
  const upload = await fetch(
    `${api}/storage/v1/object/bari-receipts/${receiptPath}`,
    {
      method: "POST",
      headers: {
        apikey: status.ANON_KEY,
        Authorization: `Bearer ${a.token}`,
        "Content-Type": "image/png",
      },
      body: png,
    },
  );
  assert.equal(upload.ok, true);
  const denied = await fetch(
    `${api}/storage/v1/object/authenticated/bari-receipts/${receiptPath}`,
    {
      headers: { apikey: status.ANON_KEY, Authorization: `Bearer ${b.token}` },
    },
  );
  assert.equal(denied.ok, false);
  const rogueEmail = `redirect-check-${randomUUID()}@example.com`;
  const rogue = await publicClient().auth.signUp({
    email: rogueEmail,
    password: `${randomUUID()}Aa9!`,
    options: { emailRedirectTo: "https://attacker.invalid/auth/confirm" },
  });
  assert.equal(rogue.error, null);
  assert.ok(rogue.data.user?.id);
  users.add(rogue.data.user.id);
  const fallback = confirmation(await messageFor(rogueEmail));
  assert.equal(
    fallback.url.origin,
    "http://127.0.0.1:4180",
    "Unapproved redirect must not receive a confirmation token.",
  );
  console.log(
    "Verified self-service registration: server password validation, confirmation mail template/allowlisted callback, unconfirmed login denial, single-use confirmation, password sign-in, duplicate handling, fresh isolated accounts, private vouchers and anonymous denial.",
  );
} finally {
  if (receiptPath && firstToken)
    await fetch(`${api}/storage/v1/object/bari-receipts`, {
      method: "DELETE",
      headers: {
        apikey: status.ANON_KEY,
        Authorization: `Bearer ${firstToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefixes: [receiptPath] }),
    }).catch(() => {});
  for (const id of users) await admin.auth.admin.deleteUser(id);
  for (const id of messages)
    await fetch(`${mail}/api/v1/messages`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ IDs: [id] }),
    }).catch(() => {});
}
