import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "vite";
import { cleanupMcpHttpFixture } from "./mcp-http-fixture.js";
import { LedgerSchema } from "../src/domain/model.js";
import { replaceEntry } from "../src/domain/ledger.js";
import {
  MCP_SCOPES,
  MCP_DAILY_SCOPES,
  challenge,
  sha256,
} from "../server/mcp/common.js";

const env = { ...loadEnv("development", process.cwd(), ""), ...process.env };
const backend = env.VITE_SUPABASE_URL ?? "";
assert.match(backend, /^http:\/\/(?:localhost|127\.0\.0\.1):55431$/);
const admin = createClient(
  backend,
  env.BARI_SUPABASE_SERVICE_ROLE_KEY ||
    env.BARI_DEV_SUPABASE_SERVICE_ROLE_KEY ||
    "",
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const origin = "http://localhost:5180";
async function removeOwnerFiles(ownerId: string) {
  for (const bucket of ["bari-receipts", "bari-mcp-staging"]) {
    const paths: string[] = [];
    async function visit(prefix: string, depth: number) {
      if (depth > 4) return;
      const { data, error } = await admin.storage
        .from(bucket)
        .list(prefix, { limit: 1000 });
      assert.ifError(error);
      for (const item of data ?? []) {
        const path = `${prefix}/${item.name}`;
        if (item.id) paths.push(path);
        else await visit(path, depth + 1);
      }
    }
    await visit(ownerId, 0);
    if (paths.length) {
      const removed = await admin.storage.from(bucket).remove(paths);
      assert.ifError(removed.error);
    }
  }
}
if (process.argv.includes("--cleanup")) {
  const path = process.argv.at(-1)!;
  assert.match(path, /^\/private\/tmp\/bari-mcp-ui-[\w-]+\.json$/);
  await cleanupMcpHttpFixture(await readFile(path, "utf8"), {
    async getUser(ownerId) {
      const result = await admin.auth.admin.getUserById(ownerId);
      assert.ifError(result.error);
      return result.data.user;
    },
    removeFiles: removeOwnerFiles,
    async deleteUser(ownerId) {
      const deleted = await admin.auth.admin.deleteUser(ownerId);
      assert.ifError(deleted.error);
    },
  });
  await unlink(path);
  process.stdout.write("MCP-এর অস্থায়ী browser account সরানো হয়েছে।\n");
  process.exit(0);
}
const users: string[] = [],
  storagePaths: string[] = [],
  stagingPaths: string[] = [];
let retained: string | null = null;
const checks: string[] = [];
async function identity() {
  const email = `mcp-http-${randomUUID()}@example.invalid`,
    password = `${randomUUID()}Aa9!`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.ifError(created.error);
  const ownerId = created.data.user!.id;
  users.push(ownerId);
  const client = createClient(backend, env.VITE_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await client.auth.signInWithPassword({ email, password });
  assert.ifError(signed.error);
  return {
    email,
    password,
    ownerId,
    client,
    access: signed.data.session!.access_token,
  };
}
async function management(
  access: string,
  body?: Record<string, unknown>,
  resource = "connections",
) {
  const response = await fetch(
    `${origin}/api/mcp-admin${body ? "" : `?resource=${resource}`}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${access}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  const value = await response.json();
  assert.equal(
    response.ok,
    true,
    `management ${body?.action ?? resource}: ${JSON.stringify(value)}`,
  );
  return value;
}
async function rpc(
  token: string,
  method: string,
  params: Record<string, unknown> = {},
) {
  const response = await fetch(`${origin}/api/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params }),
  });
  const text = await response.text();
  const value = response.headers
    .get("content-type")
    ?.includes("text/event-stream")
    ? JSON.parse(
        text
          .split("\n")
          .find((line) => line.startsWith("data: "))!
          .slice(6),
      )
    : JSON.parse(text);
  assert.equal(
    response.ok,
    true,
    `RPC HTTP ${response.status}: ${JSON.stringify(value)}`,
  );
  assert.equal(
    value.error,
    undefined,
    `RPC protocol error: ${JSON.stringify(value.error)}`,
  );
  return value.result;
}
const tool = async (
  token: string,
  name: string,
  args: Record<string, unknown>,
) => {
  const value = await rpc(token, "tools/call", { name, arguments: args });
  return { ...value.structuredContent, isError: value.isError ?? false };
};
try {
  const challengeResponse = await fetch(`${origin}/api/mcp`);
  assert.equal(challengeResponse.status, 401);
  assert.match(
    challengeResponse.headers.get("www-authenticate")!,
    /oauth-protected-resource/,
  );
  const metadata = await fetch(
    `${origin}/.well-known/oauth-protected-resource/api/mcp`,
  ).then((response) => response.json());
  assert.equal(metadata.resource, `${origin}/api/mcp`);
  checks.push("HTTP discovery ও পরিচয় যাচাই");
  const first = await identity(),
    second = await identity();
  const initial = LedgerSchema.parse({
    project: {
      id: "synthetic-mcp",
      name: "MCP পরীক্ষার খাতা",
      currency: "BDT",
    },
    works: [{ id: "test-roof", name: "পরীক্ষার ছাদ" }],
    people: [
      { id: "test-shop", name: "পরীক্ষার দোকান", kind: "shop" },
      { id: "test-worker", name: "পরীক্ষার মিস্ত্রি", kind: "worker" },
    ],
  });
  const seeded = await first.client.rpc("save_ledger_snapshot", {
    p_request_id: randomUUID(),
    p_expected_revision: 0,
    p_document: initial,
  });
  assert.ifError(seeded.error);
  const connection = await management(first.access, {
    action: "create_connection",
    name: "পরীক্ষার ব্যক্তিগত সহকারী",
    scopes: MCP_SCOPES,
    policy: {},
  });
  const other = await management(second.access, {
    action: "create_connection",
    name: "অন্য পরীক্ষার সহকারী",
    scopes: MCP_SCOPES,
    policy: {},
  });
  const token = connection.token as string;
  assert.match(token, /^bkm_p_/);
  assert.equal(
    JSON.stringify(await management(first.access)).includes(token),
    false,
  );
  const listed = await rpc(token, "tools/list");
  assert.ok(listed.tools.length >= 20);
  checks.push("Settings থেকে সংযোগ ও secret আড়াল");
  const purchase = {
    type: "create_purchase",
    date: "2026-11-02",
    person_id: "test-shop",
    work_id: "test-roof",
    lines: [
      {
        label: "পরীক্ষার সিমেন্ট",
        cost_type: "material",
        amount_paisa: 6000000,
      },
    ],
    payment_state: "partial",
    payment: { amount_paisa: 2000000, method: "cash" },
    provenance: { origin: "image", source_event_id: "synthetic-invoice-1" },
  };
  const request = {
    expected_revision: 1,
    idempotency_key: "synthetic-purchase-1",
    command: purchase,
  };
  const saved = await tool(token, "apply_change", request);
  assert.equal(saved.status, "committed", JSON.stringify(saved));
  assert.equal(saved.revision, 2);
  assert.equal(saved.after.cost_paisa, 6000000);
  assert.equal(saved.after.paid_paisa, 2000000);
  assert.equal(saved.after.payable_paisa, 4000000);
  const replay = await tool(token, "apply_change", request);
  assert.equal(replay.operation_id, saved.operation_id);
  assert.equal(replay.revision, 2);
  const duplicate = await tool(token, "apply_change", {
    ...request,
    expected_revision: 2,
    idempotency_key: "synthetic-lost-key",
  });
  assert.equal(
    duplicate.error,
    "possible_duplicate",
    JSON.stringify(duplicate),
  );
  checks.push("ছবির বিল, আলাদা পরিশোধ, retry এবং উৎসভিত্তিক duplicate");
  const bill = saved.entries.find(
    (entry: { kind: string }) => entry.kind === "expense",
  );
  const foreign = await tool(other.token, "get_entry", { entry_id: bill.id });
  assert.equal(foreign.error, "not_found");
  const payment = await tool(token, "apply_change", {
    expected_revision: 2,
    idempotency_key: "synthetic-voice-payment",
    command: {
      type: "record_payment",
      date: "2026-11-02",
      person_id: "test-shop",
      work_id: "test-roof",
      account: "materials",
      amount_paisa: 1000000,
      method: "cash",
      provenance: { origin: "voice", source_event_id: "synthetic-voice-1" },
    },
  });
  assert.equal(payment.status, "committed", JSON.stringify(payment));
  assert.equal(payment.after.cost_paisa, 6000000);
  assert.equal(payment.after.paid_paisa, 3000000);
  checks.push("ভয়েসের পুরোনো বাকি মেটানো ও দুই মালিক আলাদা");
  const stale = await tool(token, "apply_change", {
    ...request,
    expected_revision: 1,
    idempotency_key: "synthetic-stale",
  });
  assert.equal(stale.error, "revision_conflict");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNuoAAAAASUVORK5CYII=",
    "base64",
  );
  const uploadArgs = {
    idempotency_key: "synthetic-receipt-1",
    name: "পরীক্ষার ভাউচার.png",
    mime: "image/png",
    size: png.length,
    sha256: sha256(png),
  };
  const session = await tool(token, "create_receipt_upload", uploadArgs);
  assert.equal(session.isError, false, JSON.stringify(session));
  const uploadId = session.upload_id as string;
  storagePaths.push(`${first.ownerId}/${uploadId}`);
  stagingPaths.push(`${first.ownerId}/.mcp-chunks/${uploadId}/000`);
  const sameUpload = await tool(token, "create_receipt_upload", uploadArgs);
  assert.equal(sameUpload.upload_id, uploadId);
  const uploaded = await tool(token, "upload_receipt_chunk", {
    upload_id: uploadId,
    index: 0,
    data: png.toString("base64"),
  });
  assert.equal(uploaded.isError, false, JSON.stringify(uploaded));
  const finalized = await tool(token, "finalize_receipt_upload", {
    upload_id: uploadId,
  });
  assert.equal(finalized.status, "ready", JSON.stringify(finalized));
  const entry = await tool(token, "get_entry", { entry_id: bill.id });
  const attached = await tool(token, "apply_change", {
    expected_revision: 3,
    idempotency_key: "synthetic-attach-1",
    command: {
      type: "attach_receipt",
      entry_id: bill.id,
      expected_updated_at: entry.entry.updated_at,
      reason: "পরীক্ষার ভাউচার জুড়েছি",
      receipt_id: uploadId,
    },
  });
  assert.equal(attached.status, "committed", JSON.stringify(attached));
  const bytes = await fetch(`${origin}/api/mcp-file?receipt=${uploadId}`, {
    headers: { Authorization: `Bearer ${token}`, Origin: origin },
  });
  assert.equal(bytes.status, 200);
  assert.equal(sha256(new Uint8Array(await bytes.arrayBuffer())), sha256(png));
  assert.equal(bytes.headers.get("access-control-allow-origin"), origin);
  const immutable = await first.client.storage
    .from("bari-receipts")
    .update(`${first.ownerId}/${uploadId}`, png, { contentType: "image/png" });
  assert.ok(
    immutable.error,
    "immutable receipt cannot be overwritten by ordinary app client",
  );
  checks.push(
    "আসল private storage-এ chunk upload, অপরিবর্তনীয় ভাউচার ও download",
  );
  const approval = await management(first.access, {
    action: "create_connection",
    name: "অনুমোদনের পরীক্ষার সহকারী",
    scopes: MCP_SCOPES,
    policy: { confirmationRequired: true },
  });
  const prepared = await tool(approval.token, "apply_change", {
    expected_revision: 4,
    idempotency_key: "synthetic-approval",
    command: {
      type: "record_payment",
      date: "2026-11-02",
      person_id: "test-shop",
      work_id: "test-roof",
      account: "materials",
      amount_paisa: 10000,
      method: "bank",
    },
  });
  assert.equal(prepared.status, "awaiting_approval", JSON.stringify(prepared));
  assert.ok(prepared.change_id);
  await management(first.access, {
    action: "approve_proposal",
    id: prepared.change_id,
    approve: true,
  });
  const committed = await tool(approval.token, "commit_change", {
    change_id: prepared.change_id,
    idempotency_key: "synthetic-approval",
  });
  assert.equal(committed.status, "committed", JSON.stringify(committed));
  assert.equal(committed.revision, 5);
  checks.push("মালিকের অনুমোদনসহ frozen প্রস্তাব");
  const registration = await fetch(`${origin}/api/mcp-auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Synthetic OAuth assistant",
      redirect_uris: ["http://127.0.0.1:19999/callback"],
      token_endpoint_auth_method: "none",
    }),
  }).then((response) => response.json());
  const verifier = "a".repeat(64),
    authorize = new URL(`${origin}/api/mcp-auth/authorize`);
  Object.entries({
    client_id: registration.client_id,
    redirect_uri: "http://127.0.0.1:19999/callback",
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: challenge(verifier),
    resource: `${origin}/api/mcp`,
    scope: MCP_DAILY_SCOPES.join(" "),
    state: "synthetic-state",
  }).forEach(([key, value]) => authorize.searchParams.set(key, value));
  const redirected = await fetch(authorize, { redirect: "manual" });
  assert.equal(redirected.status, 302);
  const requestId = new URL(
    redirected.headers.get("location")!,
  ).searchParams.get("request");
  const allowed = await management(first.access, {
    action: "approve_authorization",
    requestId,
    approve: true,
    name: "OAuth পরীক্ষার সহকারী",
    scopes: MCP_DAILY_SCOPES,
    policy: {},
  });
  const code = new URL(allowed.redirectUrl).searchParams.get("code")!;
  const form = new URLSearchParams({
    client_id: registration.client_id,
    grant_type: "authorization_code",
    code,
    redirect_uri: "http://127.0.0.1:19999/callback",
    code_verifier: verifier,
    resource: `${origin}/api/mcp`,
  });
  const exchanged = await fetch(`${origin}/api/mcp-auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  }).then((response) => response.json());
  assert.match(exchanged.access_token, /^bkm_a_/);
  const context = await tool(exchanged.access_token, "get_capabilities", {});
  assert.deepEqual([...context.scopes].sort(), [...MCP_DAILY_SCOPES].sort());
  const oauthWrite = await tool(exchanged.access_token, "apply_change", {
    expected_revision: 5,
    idempotency_key: "synthetic-oauth-write",
    command: {
      type: "record_payment",
      date: "2026-11-02",
      person_id: "test-shop",
      work_id: "test-roof",
      account: "materials",
      amount_paisa: 5000,
      method: "cash",
    },
  });
  assert.equal(oauthWrite.status, "committed", JSON.stringify(oauthWrite));
  assert.equal(oauthWrite.revision, 6);
  const rotate = new URLSearchParams({
    client_id: registration.client_id,
    grant_type: "refresh_token",
    refresh_token: exchanged.refresh_token,
    resource: `${origin}/api/mcp`,
  });
  const rotated = await fetch(`${origin}/api/mcp-auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: rotate,
  }).then((response) => response.json());
  assert.match(rotated.access_token, /^bkm_a_/);
  checks.push("আসল OAuth registration, PKCE, consent, token ও refresh");
  const raceCommand = {
    type: "record_payment",
    date: "2026-11-02",
    person_id: "test-shop",
    work_id: "test-roof",
    account: "materials",
    amount_paisa: 1000,
    method: "cash",
    provenance: {
      origin: "voice",
      source_event_id: "synthetic-concurrent-event",
    },
  };
  const races = await Promise.all(
    ["race-a", "race-b"].map((idempotency_key) =>
      tool(token, "apply_change", {
        expected_revision: 6,
        idempotency_key,
        command: raceCommand,
      }),
    ),
  );
  assert.equal(
    races.filter((value) => value.status === "committed").length,
    1,
    JSON.stringify(races),
  );
  assert.ok(
    races.some((value) =>
      ["possible_duplicate", "revision_conflict"].includes(value.error),
    ),
    JSON.stringify(races),
  );
  checks.push("একই উৎসের দুই সমান্তরাল HTTP লেখা একবারই সংরক্ষিত");
  const legacyId = randomUUID();
  storagePaths.push(`${first.ownerId}/${legacyId}`);
  const legacyUpload = await first.client.storage
    .from("bari-receipts")
    .upload(`${first.ownerId}/${legacyId}`, png, {
      contentType: "image/png",
      upsert: false,
    });
  assert.ifError(legacyUpload.error);
  const beforeLegacy = await first.client.rpc("load_ledger_snapshot");
  assert.ifError(beforeLegacy.error);
  const oldBill = LedgerSchema.parse(beforeLegacy.data.document).entries.find(
    (value) => value.id === bill.id,
  )!;
  const withLegacy = replaceEntry(
    LedgerSchema.parse(beforeLegacy.data.document),
    {
      ...oldBill,
      receipts: [
        ...oldBill.receipts,
        {
          id: legacyId,
          name: "অ্যাপের পুরোনো ভাউচার.png",
          mime: "image/png",
          size: png.length,
        },
      ],
    },
  );
  const legacySaved = await first.client.rpc("save_ledger_snapshot", {
    p_request_id: randomUUID(),
    p_expected_revision: 7,
    p_document: withLegacy,
  });
  assert.ifError(legacySaved.error);
  const legacy = await tool(token, "get_receipt", { receipt_id: legacyId });
  assert.equal(legacy.receipt.immutable, false, JSON.stringify(legacy));
  const legacyBytes = await tool(token, "read_receipt_chunk", {
    receipt_id: legacyId,
    offset: 0,
  });
  assert.equal(legacyBytes.sha256, sha256(png));
  checks.push("সাধারণ অ্যাপের আগের ভাউচারও MCP থেকে পড়া যায়");
  const snapshot = await first.client.rpc("load_ledger_snapshot");
  assert.ifError(snapshot.error);
  assert.equal(snapshot.data.revision, 8);
  assert.ok(snapshot.data.document.entries[0].provenance);
  await management(first.access, {
    action: "revoke_connection",
    connectionId: connection.connection.id,
  });
  assert.equal(
    (
      await fetch(`${origin}/api/mcp`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).status,
    401,
  );
  checks.push("অ্যাপের snapshot-এ ফল এবং অনুমতি বাতিল");
  if (process.argv.includes("--keep-fixture")) {
    const path = `/private/tmp/bari-mcp-ui-${randomUUID()}.json`;
    await writeFile(
      path,
      JSON.stringify({
        ownerId: first.ownerId,
        email: first.email,
        password: first.password,
      }),
      { mode: 0o600 },
    );
    retained = first.ownerId;
    process.stdout.write(`Browser পরীক্ষার অস্থায়ী access file: ${path}\n`);
    storagePaths.length = 0;
  }
  process.stdout.write(JSON.stringify({ passed: checks }, null, 2) + "\n");
} finally {
  if (storagePaths.length)
    await admin.storage.from("bari-receipts").remove(storagePaths);
  if (stagingPaths.length)
    await admin.storage.from("bari-mcp-staging").remove(stagingPaths);
  for (const id of users)
    if (id !== retained) {
      const deleted = await admin.auth.admin.deleteUser(id);
      assert.ifError(deleted.error);
    }
}
