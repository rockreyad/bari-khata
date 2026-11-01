import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv } from "node:util";

const output = process.argv[2] ?? "dist";
assert.ok(
  (await stat(output)).isDirectory(),
  "Build the production app before auditing it.",
);
const access = JSON.parse(await readFile("private/LOCAL_ACCESS.json", "utf8"));
const ledger = JSON.parse(
  await readFile("private/migration/ledger.json", "utf8"),
);
let localEnv = {};
try {
  localEnv = parseEnv(await readFile(".env.local", "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const privateValues = [
  localEnv.BARI_DEV_PHONE_AUTH_SECRET,
  localEnv.BARI_DEV_SUPABASE_SERVICE_ROLE_KEY,
  access.ownerId,
  access.email,
  access.password,
  ...ledger.entries.map((entry) => entry.id),
  ...new Set(
    ledger.entries.map((entry) => entry.source?.checksum).filter(Boolean),
  ),
].filter((value) => typeof value === "string" && value.length > 12);
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else result.push(path);
  }
  return result;
}
const assets = await files(output);
for (const path of assets) {
  assert.ok(
    !/(?:^|\/)(?:private|LOCAL_ACCESS[^/]*|ledger\.json|source-grid\.json|raw-transactions\.json|reconciliation\.json)(?:\/|$)/i.test(
      path,
    ),
    "Private files must not be present in the production output.",
  );
  const contents = await readFile(path);
  for (const value of privateValues)
    assert.ok(
      !contents.includes(Buffer.from(value)),
      "A private account value or source ledger row was found in production output.",
    );
  const text = contents.toString("utf8");
  assert.ok(
    !/sb_secret_[A-Za-z0-9_-]{20,}/.test(text),
    "A secret Supabase key was found in production output.",
  );
  for (const token of text.matchAll(
    /eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g,
  )) {
    let claims;
    try {
      claims = JSON.parse(Buffer.from(token[1], "base64url").toString("utf8"));
    } catch {
      continue;
    }
    assert.notEqual(
      claims.role,
      "service_role",
      "A service-role token was found in production output.",
    );
  }
}
console.log(
  `Verified ${assets.length} production assets: no private account credentials, original ledger IDs/checksums, private files or service-role keys.`,
);
