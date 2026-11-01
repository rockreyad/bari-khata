import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink, chmod } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const path = "private/qa-registration.json";
const action = process.argv[2];
const prefix = "bari-registration-ui-";
if (action === "prepare") {
  await mkdir("private", { recursive: true, mode: 0o700 });
  try {
    await readFile(path);
    throw new Error(
      "A disposable registration fixture already exists. Clean it up first.",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeFile(
    path,
    JSON.stringify({
      email: `${prefix}${randomUUID()}@example.com`,
      password: `${randomUUID()}Aa9!`,
    }),
    { mode: 0o600 },
  );
  console.log(
    "Disposable registration details prepared privately. No account has been created yet.",
  );
} else if (action === "mail" || action === "cleanup") {
  const fixture = JSON.parse(await readFile(path, "utf8"));
  assert.match(
    fixture.email,
    /^bari-registration-ui-[a-f0-9-]{36}@example\.com$/,
  );
  const status = JSON.parse(
    execFileSync("./node_modules/.bin/supabase", ["status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  assert.match(status.API_URL, /^http:\/\/(127\.0\.0\.1|localhost):55431$/);
  const mail = status.MAILPIT_URL ?? status.INBUCKET_URL;
  assert.match(mail, /^http:\/\/(127\.0\.0\.1|localhost):55434$/);
  const search = async () => {
    const response = await fetch(
      `${mail}/api/v1/search?query=${encodeURIComponent(`to:${fixture.email}`)}`,
    );
    assert.equal(response.ok, true);
    return (await response.json()).messages ?? [];
  };
  if (action === "mail") {
    let found;
    for (let attempt = 0; attempt < 30; attempt++) {
      found = (await search())[0];
      if (found) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.ok(
      found,
      "No local confirmation email arrived for the disposable UI account.",
    );
    const message = await fetch(`${mail}/api/v1/message/${found.ID}`).then(
      (r) => r.json(),
    );
    const href = message.HTML.match(
      /href="([^"]*#token_hash=[^"]+)"/,
    )?.[1]?.replaceAll("&amp;", "&");
    assert.ok(href, "Confirmation email has no fragment-token link.");
    const url = new URL(href);
    assert.ok(
      [
        "http://127.0.0.1:5186",
        "http://localhost:5186",
        "http://127.0.0.1:4180",
        "http://localhost:4180",
      ].includes(url.origin),
    );
    assert.equal(url.pathname, "/auth/confirm");
    assert.equal(url.search, "");
    const params = new URLSearchParams(url.hash.slice(1));
    assert.equal(params.get("type"), "email");
    assert.match(params.get("token_hash") ?? "", /^[a-f0-9]{40,128}$/);
    await writeFile(
      path,
      JSON.stringify({ ...fixture, confirmationUrl: url.href }),
      { mode: 0o600 },
    );
    await chmod(path, 0o600);
    console.log(
      "The disposable UI confirmation link is saved privately for browser verification.",
    );
  } else {
    const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    let userId;
    for (let page = 1; page <= 100; page++) {
      const result = await admin.auth.admin.listUsers({ page, perPage: 100 });
      if (result.error)
        throw new Error("Cannot inspect local disposable user for cleanup.");
      const found = result.data.users.find(
        (user) => user.email === fixture.email,
      );
      if (found) {
        userId = found.id;
        break;
      }
      if (result.data.users.length < 100) break;
    }
    if (userId) {
      const result = await admin.auth.admin.deleteUser(userId);
      if (result.error)
        throw new Error("Cannot remove disposable local UI account.");
    }
    const ids = (await search()).map((message) => message.ID);
    if (ids.length) {
      const response = await fetch(`${mail}/api/v1/messages`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IDs: ids }),
      });
      assert.equal(response.ok, true);
    }
    await unlink(path);
    console.log(
      "Disposable UI registration account, confirmation emails and private fixture removed.",
    );
  }
} else throw new Error("Use prepare, mail or cleanup.");
