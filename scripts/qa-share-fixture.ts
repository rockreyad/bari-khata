import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { LedgerSchema } from "../src/domain/model";
const status = JSON.parse(
  execFileSync("./node_modules/.bin/supabase", ["status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);
const api = status.API_URL,
  anon = status.ANON_KEY,
  admin = status.SERVICE_ROLE_KEY;
assert.match(api, /^http:\/\/(127\.0\.0\.1|localhost):55431$/);
const path = "private/qa-share.json";
async function request(
  route: string,
  payload: unknown,
  token = anon,
  method = "POST",
): Promise<any> {
  const response = await fetch(`${api}${route}`, {
    method,
    headers: {
      apikey: anon,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(`HTTP${response.status}:${body.code ?? "request_failed"}`);
  return body;
}
const rpc = (name: string, payload: unknown, token = anon) =>
  request(`/rest/v1/rpc/${name}`, payload, token);
const mode = process.argv[2];
if (mode === "create") {
  try {
    await readFile(path);
    throw new Error("qa_fixture_exists");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  const email = `qa-share-${randomUUID()}@example.com`,
    password = `${randomUUID()}Aa9!`;
  const user = await request(
    "/auth/v1/admin/users",
    { email, password, email_confirm: true },
    admin,
  );
  try {
    const session = await request("/auth/v1/token?grant_type=password", {
      email,
      password,
    });
    const ledger = LedgerSchema.parse({
      project: { name: "নমুনা বাড়ি · QA" },
      works: [{ id: "qa-tiles", name: "টাইলসের কাজ" }],
      people: [
        {
          id: "qa-worker",
          name: "রহিম মিস্ত্রি · নমুনা",
          kind: "worker",
          role: "টাইলসের মিস্ত্রি",
        },
      ],
      entries: [
        {
          id: "qa-bill",
          kind: "expense",
          account: "labour",
          personId: "qa-worker",
          date: "2026-11-01",
          lines: [
            {
              id: "qa-line",
              workId: "qa-tiles",
              label: "টাইলস বসানোর মজুরি",
              costType: "labour",
              amount: 12540000,
            },
          ],
        },
        {
          id: "qa-payment",
          kind: "payment",
          account: "labour",
          personId: "qa-worker",
          date: "2026-11-02",
          allocations: [{ workId: "qa-tiles", amount: 3000000 }],
          paymentParts: [{ amount: 3000000 }],
        },
      ],
    });
    await rpc(
      "save_ledger_snapshot",
      {
        p_request_id: randomUUID(),
        p_expected_revision: 0,
        p_document: ledger,
      },
      session.access_token,
    );
    const share = await rpc(
      "create_contact_share",
      { p_person_id: "qa-worker", p_account: "labour", p_work_id: null },
      session.access_token,
    );
    await mkdir("private", { recursive: true, mode: 0o700 });
    await writeFile(
      path,
      JSON.stringify({
        ownerId: user.id,
        accessToken: session.access_token,
        shareId: share.id,
        shareToken: share.token,
      }),
      { mode: 0o600 },
    );
    console.log(
      "Disposable QA share fixture created in private/qa-share.json; no owner data used.",
    );
  } catch (error) {
    await request(
      `/auth/v1/admin/users/${user.id}`,
      undefined,
      admin,
      "DELETE",
    );
    throw error;
  }
} else {
  const fixture = JSON.parse(await readFile(path, "utf8"));
  if (mode === "append") {
    const snapshot = await rpc("load_ledger_snapshot", {}, fixture.accessToken);
    const ledger = LedgerSchema.parse(snapshot.document);
    const key = `qa-extra-${randomUUID()}`;
    ledger.entries.push(
      ...LedgerSchema.parse({
        ...ledger,
        entries: [
          {
            id: key,
            kind: "payment",
            account: "labour",
            personId: "qa-worker",
            date: "2026-11-03",
            allocations: [{ workId: "qa-tiles", amount: 1000000 }],
            paymentParts: [{ amount: 1000000 }],
          },
        ],
      }).entries,
    );
    await rpc(
      "save_ledger_snapshot",
      {
        p_request_id: randomUUID(),
        p_expected_revision: snapshot.revision,
        p_document: ledger,
      },
      fixture.accessToken,
    );
    console.log(
      "Added a QA payment to the disposable statement. Existing saved link now serves the update.",
    );
  } else if (mode === "revoke") {
    await rpc(
      "revoke_contact_share",
      { p_id: fixture.shareId },
      fixture.accessToken,
    );
    console.log("Disposable QA link revoked.");
  } else if (mode === "cleanup") {
    await request(
      `/auth/v1/admin/users/${fixture.ownerId}`,
      undefined,
      admin,
      "DELETE",
    );
    await rm(path);
    console.log(
      "Disposable QA account, ledger, link and local capability file removed.",
    );
  } else throw new Error("Use create, append, revoke or cleanup");
}
