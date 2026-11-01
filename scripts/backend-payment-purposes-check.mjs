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
  const save = (document, revision) =>
    call("save_ledger_snapshot", {
      p_request_id: randomUUID(),
      p_expected_revision: revision,
      p_document: document,
    });
  original.paymentPurposes = [
    { id: "purpose", name: "Weekly wage", account: "labour" },
  ];
  original.entries = [
    {
      id: "payment",
      kind: "payment",
      account: "labour",
      personId: "worker",
      paymentPurposeId: "purpose",
      contractId: null,
      relatedEntryId: null,
      date: "2026-11-01",
      note: "",
      allocations: [{ workId: "work", amount: 10000 }],
      paymentParts: [{ method: "cash", amount: 10000 }],
      lines: [],
      receipts: [],
      revisions: [],
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
      voided: false,
    },
  ];
  assert.equal((await save(original, 0)).revision, 1);
  for (const invalid of [
    { ...structuredClone(original), paymentPurposes: [] },
    {
      ...structuredClone(original),
      paymentPurposes: [
        { id: "purpose", name: "Wrong account", account: "materials" },
      ],
    },
    {
      ...structuredClone(original),
      paymentPurposes: [
        { id: "purpose", name: "Bad account", account: "invalid" },
      ],
    },
    {
      ...structuredClone(original),
      paymentPurposes: [
        ...original.paymentPurposes,
        ...original.paymentPurposes,
      ],
    },
    {
      ...structuredClone(original),
      paymentPurposes: [{ id: "purpose", name: "", account: "labour" }],
    },
  ])
    await assert.rejects(() => save(invalid, 1));
  const oldClient = structuredClone(original);
  delete oldClient.entries[0].paymentPurposeId;
  await assert.rejects(() => save(oldClient, 1));
  const changed = structuredClone(original);
  changed.entries[0].paymentParts[0].amount = 12000;
  changed.entries[0].allocations[0].amount = 12000;
  changed.entries[0].revisions = [
    {
      at: "2026-11-01T01:00:00.000Z",
      before: Object.fromEntries(
        Object.entries(original.entries[0]).filter(
          ([key]) => key !== "revisions",
        ),
      ),
    },
  ];
  assert.equal((await save(changed, 1)).revision, 2);
  console.log(
    "Payment purposes: valid save, unchanged-reason edit, invalid taxonomy, cross-account and old-client loss guards passed.",
  );
} finally {
  if (userId)
    await request(`/auth/v1/admin/users/${userId}`, undefined, admin, "DELETE");
}
