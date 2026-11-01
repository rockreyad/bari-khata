import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { validateLedger } from "../src/domain/model.ts";

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
    "Local Supabase is unavailable. No credentials were printed.",
  );
}
const { API_URL: api, ANON_KEY: anon, SERVICE_ROLE_KEY: admin } = status;
if (
  !/^http:\/\/(127\.0\.0\.1|localhost):55431$/.test(api ?? "") ||
  !anon ||
  !admin
)
  throw new Error(
    "Only the local bari-khata project on port 55431 is permitted.",
  );
async function request(
  path: string,
  body: unknown,
  token = anon,
  method = "POST",
) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      apikey: token === admin ? admin : anon,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(`Local backend request failed: HTTP ${response.status}`);
  return data;
}
const AccessSchema = z.object({
  version: z.literal(1),
  ownerId: z.uuid(),
  email: z.email(),
  password: z.string().min(24),
});
const accessPath = "private/LOCAL_ACCESS.json";
await mkdir("private", { recursive: true, mode: 0o700 });
let access: z.infer<typeof AccessSchema>;
try {
  access = AccessSchema.parse(JSON.parse(await readFile(accessPath, "utf8")));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT")
    throw new Error(
      "Existing local credentials could not be validated. They were not replaced.",
    );
  const email = `owner-${randomBytes(6).toString("hex")}@bari.local`;
  const password = `${randomBytes(32).toString("base64url")}Aa9!`;
  const user = await request(
    "/auth/v1/admin/users",
    { email, password, email_confirm: true },
    admin,
  );
  access = AccessSchema.parse({
    version: 1,
    ownerId: user.id,
    email,
    password,
  });
  await writeFile(accessPath, `${JSON.stringify(access, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
}
await chmod(accessPath, 0o600);
await writeFile(
  "private/LOCAL_ACCESS.txt",
  `বাড়ির খাতা — স্থানীয় পরীক্ষার লগইন\n\nঠিকানা: http://localhost:5180/login\nইমেইল: ${access.email}\nপাসওয়ার্ড: ${access.password}\n\nএটি কেবল এই মেশিনের স্থানীয় Supabase অ্যাকাউন্ট। Production অ্যাকাউন্ট নয়।\nফাইলটি ব্যক্তিগত রাখুন; চ্যাট, Git বা frontend bundle-এ দেবেন না।\nনতুন বিশ্বস্ত ব্যবহারকারীর জন্য scripts/backend-create-user.mjs দিয়ে আলাদা অ্যাকাউন্ট তৈরি করা যায়।\nফোন OTP এখন বন্ধ; SMS provider, CAPTCHA এবং rate limit প্রস্তুত হলে চালু করতে হবে।\n`,
  { mode: 0o600 },
);
await chmod("private/LOCAL_ACCESS.txt", 0o600);
const session = await request("/auth/v1/token?grant_type=password", {
  email: access.email,
  password: access.password,
});
assert.equal(session.user.id, access.ownerId);
const call = (
  name: string,
  payload: unknown = {},
  token = session.access_token,
) => request(`/rest/v1/rpc/${name}`, payload, token);
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};
const checksum = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const seedPath = process.argv[2];
let report: Record<string, unknown> = {
  accountProvisioned: true,
  ownerId: access.ownerId,
};
if (seedPath) {
  const ledger = validateLedger(
    JSON.parse(await readFile(resolve(seedPath), "utf8")),
  );
  if (ledger.isDemo)
    throw new Error(
      "A sample ledger cannot be imported into the owner account.",
    );
  const before = await call("load_ledger_snapshot");
  const expectedChecksum = checksum(ledger);
  let refresh = false;
  if (
    before.document !== null &&
    checksum(validateLedger(before.document)) !== expectedChecksum
  ) {
    if (!process.argv.includes("--refresh-import"))
      throw new Error(
        "The owner already has a different ledger. Refusing to overwrite it.",
      );
    const previousReport = JSON.parse(
      await readFile("private/LOCAL_ACCESS_STATUS.json", "utf8"),
    );
    const existing = validateLedger(before.document);
    const sourceKeys = (entries: typeof ledger.entries) =>
      entries
        .map((entry) => `${entry.id}:${entry.source?.checksum ?? ""}`)
        .sort();
    if (
      previousReport.ownerId !== access.ownerId ||
      previousReport.checksum !== checksum(existing) ||
      existing.entries.some(
        (entry) => entry.balanceImpact !== "historical" || !entry.source,
      ) ||
      ledger.entries.some(
        (entry) => entry.balanceImpact !== "historical" || !entry.source,
      )
    )
      throw new Error(
        "The saved ledger changed after verified import. Refusing to overwrite it.",
      );
    assert.deepEqual(
      sourceKeys(existing.entries),
      sourceKeys(ledger.entries),
      "Refresh must preserve the exact original imported rows.",
    );
    refresh = true;
  }
  if (before.document === null || refresh) {
    const saved = await call("save_ledger_snapshot", {
      p_request_id: randomUUID(),
      p_expected_revision: before.revision,
      p_document: ledger,
    });
    assert.equal(saved.status, "saved");
  }
  const after = await call("load_ledger_snapshot");
  const actual = validateLedger(after.document);
  assert.equal(
    checksum(actual),
    expectedChecksum,
    "Authenticated read-back checksum must match the source ledger.",
  );
  report = {
    ...report,
    imported: true,
    checksum: expectedChecksum,
    revision: after.revision,
    entries: actual.entries.length,
    works: actual.works.length,
    materialGroups: actual.materialGroups.length,
  };
}
let friendId: string | undefined;
try {
  const friendEmail = `friend-check-${randomUUID()}@example.com`;
  const friendPassword = `${randomBytes(32).toString("base64url")}Aa9!`;
  const friend = await request(
    "/auth/v1/admin/users",
    { email: friendEmail, password: friendPassword, email_confirm: true },
    admin,
  );
  friendId = friend.id;
  const friendSession = await request("/auth/v1/token?grant_type=password", {
    email: friendEmail,
    password: friendPassword,
  });
  const own = await call(
    "load_ledger_snapshot",
    {},
    friendSession.access_token,
  );
  assert.equal(own.document, null);
  const hidden = await request(
    `/rest/v1/ledger_documents?owner_id=eq.${access.ownerId}&select=owner_id`,
    undefined,
    friendSession.access_token,
    "GET",
  );
  assert.deepEqual(hidden, []);
  const anonymous = await fetch(`${api}/rest/v1/rpc/load_ledger_snapshot`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.ok(!anonymous.ok);
  report.friendIsolationVerified = true;
  report.anonymousAccessDenied = true;
} finally {
  if (friendId)
    await request(
      `/auth/v1/admin/users/${friendId}`,
      undefined,
      admin,
      "DELETE",
    );
}
await writeFile(
  "private/LOCAL_ACCESS_STATUS.json",
  `${JSON.stringify(report, null, 2)}\n`,
  { mode: 0o600 },
);
await chmod("private/LOCAL_ACCESS_STATUS.json", 0o600);
console.log(
  "Local owner login is ready. Credentials are in private/LOCAL_ACCESS.txt (0600). Authenticated import/read-back and account isolation checks passed.",
);
