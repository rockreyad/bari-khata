import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const status = JSON.parse(
  execFileSync("./node_modules/.bin/supabase", ["status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);
const api = status.API_URL,
  anon = status.ANON_KEY,
  admin = status.SERVICE_ROLE_KEY;
assert.match(
  api,
  /^http:\/\/(127\.0\.0\.1|localhost):55431$/,
  "Only the isolated local backend may be tested.",
);
async function request(path, payload, token = anon, method = "POST") {
  const response = await fetch(`${api}${path}`, {
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
    throw new Error(
      `HTTP${response.status}:${body.code ?? body.error_code ?? "request_failed"}`,
    );
  return body;
}
let userId;
try {
  const email = `v3-check-${randomUUID()}@example.com`,
    password = `${randomUUID()}Aa9!`;
  const user = await request(
    "/auth/v1/admin/users",
    { email, password, email_confirm: true },
    admin,
  );
  userId = user.id;
  const session = await request("/auth/v1/token?grant_type=password", {
    email,
    password,
  });
  const token = session.access_token;
  const call = (name, payload) =>
    request(`/rest/v1/rpc/${name}`, payload ?? {}, token);
  const original = {
    schemaVersion: 1,
    isDemo: false,
    project: { id: "test", name: "Test", currency: "BDT" },
    works: [
      {
        id: "work",
        name: "Tiles",
        description: "",
        color: "blue",
        icon: "tiles",
        status: "planned",
        startedOn: null,
        completedOn: null,
        quickActions: null,
        activity: [],
      },
    ],
    people: [
      {
        id: "worker",
        name: "Worker",
        phone: "",
        role: "",
        kind: "worker",
        quickActions: ["payment"],
      },
    ],
    materialGroups: [],
    items: [],
    contracts: [],
    entries: [],
  };
  const save = (document, revision, requestId = randomUUID()) =>
    call("save_ledger_snapshot", {
      p_request_id: requestId,
      p_expected_revision: revision,
      p_document: document,
    });
  assert.equal((await save(original, 0)).revision, 1);
  const snapshot = (work) =>
    Object.fromEntries(
      Object.entries(work).filter(([key]) => !["id", "activity"].includes(key)),
    );
  const started = structuredClone(original);
  started.works[0].status = "ongoing";
  started.works[0].startedOn = "2026-11-01";
  started.works[0].activity = [
    {
      id: randomUUID(),
      at: "2026-11-01T10:00:00.000Z",
      before: snapshot(original.works[0]),
      after: snapshot(started.works[0]),
    },
  ];
  const requestId = randomUUID();
  assert.equal((await save(started, 1, requestId)).revision, 2);
  assert.equal((await save(started, 1, requestId)).revision, 2);
  const invalid = [];
  const oldClient = structuredClone(started);
  for (const key of ["activity", "startedOn", "completedOn", "quickActions"])
    delete oldClient.works[0][key];
  delete oldClient.people[0].kind;
  delete oldClient.people[0].quickActions;
  invalid.push(oldClient);
  const truncated = structuredClone(started);
  truncated.works[0].activity = [];
  invalid.push(truncated);
  const changed = structuredClone(started);
  changed.works[0].activity[0].after.name = "tampered";
  invalid.push(changed);
  const missingKind = structuredClone(started);
  delete missingKind.people[0].kind;
  invalid.push(missingKind);
  const deletedWork = structuredClone(started);
  deletedWork.works = [];
  invalid.push(deletedWork);
  const badDate = structuredClone(started);
  badDate.works[0].startedOn = "2026-02-30";
  invalid.push(badDate);
  const reversed = structuredClone(started);
  reversed.works[0].completedOn = "2026-10-01";
  invalid.push(reversed);
  const badPreset = structuredClone(started);
  badPreset.people[0].quickActions = ["not-an-action"];
  invalid.push(badPreset);
  for (const document of invalid) await assert.rejects(save(document, 2));
  assert.equal((await call("load_ledger_snapshot")).revision, 2);
  const ended = structuredClone(started);
  ended.works[0].status = "done";
  ended.works[0].completedOn = "2026-11-03";
  ended.works[0].quickActions = [];
  ended.works[0].activity.push({
    id: randomUUID(),
    at: "2026-11-03T10:00:00.000Z",
    before: snapshot(started.works[0]),
    after: snapshot(ended.works[0]),
  });
  assert.equal((await save(ended, 2)).revision, 3);
  await assert.rejects(save(original, 3));
  const after = await call("load_ledger_snapshot");
  assert.equal(after.revision, 3);
  assert.equal(after.document.works[0].activity.length, 2);
  assert.equal(after.document.people[0].kind, "worker");
  console.log(
    "Verified local role/preset validation, real work dates, append-only work history, old-client field-loss denial, backup truncation denial, idempotent retry and unchanged data after rejection.",
  );
} finally {
  if (userId)
    await request(`/auth/v1/admin/users/${userId}`, undefined, admin, "DELETE");
}
