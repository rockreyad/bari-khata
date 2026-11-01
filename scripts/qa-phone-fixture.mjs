import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";

const path = "private/qa-phone.json";
const action = process.argv[2];
assert.ok(
  ["prepare", "cleanup"].includes(action),
  "Choose prepare or cleanup.",
);
const env = parseEnv(await readFile(".env.local", "utf8"));
assert.match(
  env.VITE_SUPABASE_URL ?? "",
  /^http:\/\/(127\.0\.0\.1|localhost):55431\/?$/,
);
assert.ok(
  env.BARI_DEV_SUPABASE_SERVICE_ROLE_KEY,
  "Local administrative key is required.",
);
const admin = createClient(
  env.VITE_SUPABASE_URL,
  env.BARI_DEV_SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
);
async function users() {
  const result = [];
  for (let page = 1; page <= 100; page++) {
    const response = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (response.error)
      throw new Error("Cannot inspect local test identities.");
    result.push(...response.data.users);
    if (response.data.users.length < 100) return result;
  }
  throw new Error("Too many local identities to inspect safely.");
}
if (action === "prepare") {
  assert.equal(env.BARI_PHONE_AUTH_MODE, "mock");
  await mkdir("private", { recursive: true, mode: 0o700 });
  try {
    await readFile(path);
    throw new Error("An existing test phone fixture must be cleaned first.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const existing = new Set((await users()).map((user) => user.phone));
  let phone;
  do {
    phone = `+88019${String(randomBytes(4).readUInt32BE() % 100000000).padStart(8, "0")}`;
  } while (existing.has(phone.slice(1)));
  await writeFile(
    path,
    JSON.stringify({
      phone,
      createdAt: new Date().toISOString(),
      disposable: "bari-phone-ui-v1",
    }),
    { mode: 0o600 },
  );
  console.log(
    "Disposable phone details prepared privately; no account or SMS was created.",
  );
} else {
  const fixture = JSON.parse(await readFile(path, "utf8"));
  assert.equal(fixture.disposable, "bari-phone-ui-v1");
  assert.match(fixture.phone, /^\+88019\d{8}$/);
  assert.ok(Number.isFinite(Date.parse(fixture.createdAt)));
  const found = (await users()).find(
    (user) => user.phone === fixture.phone.slice(1),
  );
  if (found) {
    assert.equal(
      found.app_metadata.bari_dev_phone_auth,
      true,
      "Refusing to remove a non-test identity.",
    );
    assert.ok(
      Date.parse(found.created_at) >= Date.parse(fixture.createdAt) - 2000,
      "Refusing to remove an older phone identity.",
    );
    const deleted = await admin.auth.admin.deleteUser(found.id);
    if (deleted.error) throw new Error("Disposable phone cleanup failed.");
  }
  await unlink(path);
  console.log("Disposable phone identity and private fixture removed.");
}
