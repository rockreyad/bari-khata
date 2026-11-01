import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import {
  createPhoneOtpMiddleware,
  phoneGatewayConfig,
} from "../server/phoneOtp.ts";
import { LedgerSchema } from "../src/domain/model";

const config = phoneGatewayConfig(
  parseEnv(await readFile(".env.local", "utf8")),
);
assert.equal(config.mode, "mock");
assert.match(config.url, /^http:\/\/(127\.0\.0\.1|localhost):55431\/?$/);
const opts = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};
const admin = createClient(config.url, config.serviceKey, opts);
const users = new Set<string>();
const servers: Server[] = [];
let time = Date.now();
async function gateway(otp = config.otp) {
  const middleware = createPhoneOtpMiddleware(
    { ...config, otp },
    { now: () => time },
  );
  const server = createServer(
    (req, res) =>
      void middleware(req, res, () => {
        res.statusCode = 404;
        res.end();
      }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  return async (path: string, body: unknown) => {
    const response = await fetch(`${origin}/api/dev-phone-otp/${path}`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
}
const phone = () =>
  `+88019${String(randomBytes(4).readUInt32BE() % 100000000).padStart(8, "0")}`;
const one = phone(),
  two = phone(),
  real = phone();
async function rpc(name: string, body: unknown, token: string) {
  const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  assert.equal(response.ok, true);
  return response.json();
}
try {
  const post = await gateway();
  assert.equal(
    (
      await post("verify", {
        phone: one,
        code: config.otp,
        challengeId: "missing",
      })
    ).body.error,
    "otp_expired",
  );
  const request = await post("request", { phone: one });
  assert.equal(request.status, 200);
  assert.equal((await post("request", { phone: one })).status, 429);
  assert.equal(
    (
      await post("verify", {
        phone: two,
        code: config.otp,
        challengeId: request.body.challengeId,
      })
    ).body.error,
    "invalid_otp",
  );
  const wrong = config.otp === "0000" ? "9999" : "0000";
  assert.equal(
    (
      await post("verify", {
        phone: one,
        code: wrong,
        challengeId: request.body.challengeId,
      })
    ).body.error,
    "invalid_otp",
  );
  const verified = await post("verify", {
    phone: one,
    code: config.otp,
    challengeId: request.body.challengeId,
  });
  assert.equal(
    verified.status,
    200,
    "Correct configured OTP must create a real phone session.",
  );
  const first = createClient(config.url, config.anonKey, opts);
  const signed = await first.auth.setSession(verified.body);
  assert.equal(signed.error, null);
  const firstId = signed.data.user!.id;
  users.add(firstId);
  assert.equal(signed.data.user!.phone, one.slice(1));
  assert.equal(signed.data.user!.app_metadata.bari_dev_phone_auth, true);
  assert.equal(
    (
      await post("verify", {
        phone: one,
        code: config.otp,
        challengeId: request.body.challengeId,
      })
    ).body.error,
    "otp_expired",
  );
  const empty = await rpc(
    "load_ledger_snapshot",
    {},
    verified.body.access_token,
  );
  assert.equal(empty.document, null);
  const document = LedgerSchema.parse({
    project: { name: "নমুনা ফোন খাতা" },
    works: [{ id: "qa-work", name: "ফোন পরীক্ষার কাজ" }],
  });
  await rpc(
    "save_ledger_snapshot",
    {
      p_document: document,
      p_expected_revision: 0,
      p_request_id: randomUUID(),
    },
    verified.body.access_token,
  );
  time += 61000;
  const again = await post("request", { phone: one });
  const repeated = await post("verify", {
    phone: one,
    code: config.otp,
    challengeId: again.body.challengeId,
  });
  const repeatUser = await first.auth.getUser(repeated.body.access_token);
  assert.equal(repeatUser.data.user!.id, firstId);
  const retained = await rpc(
    "load_ledger_snapshot",
    {},
    repeated.body.access_token,
  );
  assert.equal(retained.document.project.name, document.project.name);
  const secondRequest = await post("request", { phone: two });
  const secondSession = await post("verify", {
    phone: two,
    code: config.otp,
    challengeId: secondRequest.body.challengeId,
  });
  assert.equal(secondSession.status, 200);
  const second = createClient(config.url, config.anonKey, opts);
  const secondUser = await second.auth.setSession(secondSession.body);
  users.add(secondUser.data.user!.id);
  assert.notEqual(secondUser.data.user!.id, firstId);
  const hidden = await second
    .from("ledger_documents")
    .select("owner_id")
    .eq("owner_id", firstId);
  assert.equal(hidden.error, null);
  assert.deepEqual(hidden.data, []);
  assert.equal(
    (await rpc("load_ledger_snapshot", {}, secondSession.body.access_token))
      .document,
    null,
  );
  const newCode = config.otp === "2468" ? "1357" : "2468";
  const changed = await gateway(newCode);
  const changeRequest = await changed("request", { phone: one });
  assert.equal(
    (
      await changed("verify", {
        phone: one,
        code: config.otp,
        challengeId: changeRequest.body.challengeId,
      })
    ).body.error,
    "invalid_otp",
  );
  const changedSession = await changed("verify", {
    phone: one,
    code: newCode,
    challengeId: changeRequest.body.challengeId,
  });
  assert.equal(changedSession.status, 200);
  assert.equal(
    (await first.auth.getUser(changedSession.body.access_token)).data.user!.id,
    firstId,
  );
  const realPassword = randomUUID() + "Aa9!";
  const existing = await admin.auth.admin.createUser({
    phone: real,
    phone_confirm: true,
    password: realPassword,
  });
  assert.equal(existing.error, null);
  users.add(existing.data.user!.id);
  const protectedRequest = await post("request", { phone: real });
  const protectedResult = await post("verify", {
    phone: real,
    code: config.otp,
    challengeId: protectedRequest.body.challengeId,
  });
  assert.equal(protectedResult.body.error, "phone_requires_sms");
  const originalLogin = createClient(config.url, config.anonKey, opts);
  assert.equal(
    (
      await originalLogin.auth.signInWithPassword({
        phone: real,
        password: realPassword,
      })
    ).error,
    null,
  );
  assert.equal(
    (await admin.auth.admin.getUserById(existing.data.user!.id)).data.user!
      .app_metadata.bari_dev_phone_auth,
    undefined,
  );
  const expired = await post("request", { phone: phone() });
  time += 300001;
  assert.equal(
    (
      await post("verify", {
        phone: one,
        code: config.otp,
        challengeId: expired.body.challengeId,
      })
    ).body.error,
    "otp_expired",
  );
  console.log(
    "Verified local phone OTP: request binding, wrong-code denial, cooldown, real Supabase sessions, single use, expiry, stable phone identity after code changes, independent ledgers and protection of existing real phone credentials.",
  );
} finally {
  for (const id of users) await admin.auth.admin.deleteUser(id);
  for (const server of servers)
    await new Promise<void>((resolve) => server.close(() => resolve()));
}
