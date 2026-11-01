import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { LedgerSchema } from "../src/domain/model";
import { SharedStatementSchema } from "../src/features/sharing/shareModel";
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
async function request(
  path: string,
  payload: unknown = undefined,
  token = anon,
  method = "POST",
): Promise<any> {
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
      `HTTP${response.status}:${body.message ?? body.code ?? body.error_code ?? "request_failed"}`,
    );
  return body;
}
const ids: string[] = [];
async function user() {
  const email = `share-check-${randomUUID()}@example.com`,
    password = `${randomUUID()}Aa9!`;
  const user = await request(
    "/auth/v1/admin/users",
    { email, password, email_confirm: true },
    admin,
  );
  ids.push(user.id);
  return {
    id: user.id,
    token: (
      await request("/auth/v1/token?grant_type=password", { email, password })
    ).access_token,
  };
}
const rpc = (name: string, payload: unknown, token = anon) =>
  request(`/rest/v1/rpc/${name}`, payload, token);
const cost = (
  id: string,
  personId: string,
  account: string,
  workId: string,
  amount: number,
  costType = "labour",
  date = "2026-11-01",
) => ({
  id,
  kind: "expense",
  personId,
  account,
  date,
  lines: [{ id: `${id}-line`, workId, label: `${id}-label`, amount, costType }],
});
const payment = (
  id: string,
  personId: string,
  account: string,
  allocations: { workId: string; amount: number }[],
) => ({
  id,
  kind: "payment",
  personId,
  account,
  date: "2026-11-02",
  allocations,
  paymentParts: [
    { amount: allocations.reduce((sum, part) => sum + part.amount, 0) },
  ],
});
try {
  const a = await user(),
    b = await user();
  let ledger = LedgerSchema.parse({
    project: { name: "Test home" },
    works: [
      { id: "tiles", name: "Tiles" },
      { id: "doors", name: "Doors" },
      { id: "secret-work", name: "SECRET_WORK" },
    ],
    people: [
      { id: "worker", name: "Worker", kind: "worker", phone: "PRIVATE_PHONE" },
      { id: "shop", name: "SECRET_SHOP", kind: "shop" },
      { id: "driver", name: "Driver", kind: "driver" },
    ],
    entries: [
      cost("wage", "worker", "labour", "tiles", 600000),
      payment("cash", "worker", "labour", [
        { workId: "tiles", amount: 100000 },
        { workId: "doors", amount: 200000 },
      ]),
      {
        ...cost("historical", "worker", "labour", "tiles", 90000),
        balanceImpact: "historical",
        source: {
          file: "PRIVATE_SOURCE",
          cell: "PRIVATE_CELL",
          checksum: "PRIVATE_CHECKSUM",
        },
        note: "PRIVATE_NOTE",
      },
      cost(
        "SECRET_MATERIAL",
        "worker",
        "materials",
        "doors",
        500000,
        "material",
      ),
      cost(
        "SECRET_OTHER_PERSON",
        "shop",
        "materials",
        "secret-work",
        100000,
        "material",
      ),
      cost("transport", "driver", "materials", "tiles", 10000, "transport"),
      payment("transport-cash", "driver", "materials", [
        { workId: "tiles", amount: 15000 },
      ]),
    ],
  });
  const save = async () =>
    rpc(
      "save_ledger_snapshot",
      {
        p_request_id: randomUUID(),
        p_expected_revision: revision,
        p_document: ledger,
      },
      a.token,
    );
  let revision = 0;
  revision = (await save()).revision;
  const scope = { p_person_id: "worker", p_account: "labour", p_work_id: null };
  await assert.rejects(rpc("create_contact_share", scope));
  await assert.rejects(rpc("contact_share_status", scope));
  await assert.rejects(rpc("revoke_contact_share", { p_id: randomUUID() }));
  await assert.rejects(
    rpc("create_contact_share", { ...scope, p_person_id: "not-mine" }, b.token),
  );
  await assert.rejects(
    rpc("create_contact_share", { ...scope, p_account: "invalid" }, a.token),
  );
  const link = await rpc("create_contact_share", scope, a.token);
  assert.match(link.token, /^[a-f0-9]{64}$/);
  assert.equal(await rpc("contact_share_status", scope, b.token), null);
  assert.equal(
    await rpc("revoke_contact_share", { p_id: link.id }, b.token),
    false,
  );
  assert.equal((await rpc("contact_share_status", scope, a.token)).id, link.id);
  const read = (
    token = link.token,
    offset = 0,
    limit = 40,
    expected: number | null = null,
  ) =>
    rpc("read_contact_share", {
      p_token: token,
      p_offset: offset,
      p_limit: limit,
      p_revision: expected,
    });
  assert.equal(await read("bad"), null);
  assert.equal(await read("f".repeat(64)), null);
  const first = SharedStatementSchema.parse(await read());
  assert.equal(first.rows.length, 3);
  assert.deepEqual(first.totals, {
    cost: 690000,
    paid: 300000,
    payable: 500000,
    advance: 200000,
    historicalCost: 90000,
  });
  const serialized = JSON.stringify(first);
  for (const secret of [
    "PRIVATE_PHONE",
    "PRIVATE_SOURCE",
    "PRIVATE_CELL",
    "PRIVATE_CHECKSUM",
    "PRIVATE_NOTE",
    "SECRET_MATERIAL",
    "SECRET_OTHER_PERSON",
    "SECRET_SHOP",
    "SECRET_WORK",
    "source",
    "receipts",
    "revisions",
    "owner_id",
    "token_hash",
  ])
    assert.ok(!serialized.includes(secret), `Public response leaked ${secret}`);
  await assert.rejects(
    request("/rest/v1/contact_share_links?select=*", undefined, anon, "GET"),
  );
  await assert.rejects(
    request("/rest/v1/contact_share_links?select=*", undefined, a.token, "GET"),
  );
  const stored = await request(
    `/rest/v1/contact_share_links?id=eq.${link.id}&select=token_hash`,
    undefined,
    admin,
    "GET",
  );
  assert.equal(
    stored[0].token_hash,
    createHash("sha256").update(link.token).digest("hex"),
  );
  assert.notEqual(stored[0].token_hash, link.token);
  const workLink = await rpc(
    "create_contact_share",
    { ...scope, p_work_id: "tiles" },
    a.token,
  );
  const work = SharedStatementSchema.parse(await read(workLink.token));
  assert.equal(work.totals.paid, 100000);
  assert.equal(work.totals.advance, 0);
  assert.ok(!JSON.stringify(work).includes("Doors"));
  const driverLink = await rpc(
    "create_contact_share",
    { p_person_id: "driver", p_account: "other", p_work_id: null },
    a.token,
  );
  const driver = SharedStatementSchema.parse(await read(driverLink.token));
  assert.equal(driver.rows.length, 2);
  assert.equal(driver.totals.cost, 10000);
  assert.equal(driver.totals.advance, 5000);
  ledger = LedgerSchema.parse({
    ...ledger,
    entries: [
      ...ledger.entries,
      ...Array.from({ length: 61 }, (_, i) =>
        cost(
          `extra-${String(i).padStart(3, "0")}`,
          "worker",
          "labour",
          "tiles",
          1000,
          "labour",
          "2026-11-03",
        ),
      ),
    ],
  });
  revision = (await save()).revision;
  await assert.rejects(
    read(link.token, 0, 40, first.revision),
    /share_changed/,
  );
  const page1 = SharedStatementSchema.parse(await read());
  assert.equal(page1.total, 64);
  assert.equal(page1.rows.length, 40);
  assert.equal(page1.nextOffset, 40);
  const page2 = SharedStatementSchema.parse(
    await read(link.token, 40, 40, page1.revision),
  );
  assert.equal(page2.rows.length, 24);
  assert.equal(page2.nextOffset, null);
  assert.equal(
    new Set([...page1.rows, ...page2.rows].map((row) => row.key)).size,
    64,
  );
  await assert.rejects(read(link.token, 0, 61));
  await assert.rejects(read(link.token, -1));
  const rotated = await rpc("create_contact_share", scope, a.token);
  assert.notEqual(rotated.token, link.token);
  assert.equal(await read(), null);
  assert.notEqual(await read(rotated.token), null);
  assert.equal(
    await rpc("revoke_contact_share", { p_id: rotated.id }, a.token),
    true,
  );
  assert.equal(await read(rotated.token), null);
  assert.notEqual(
    await read(workLink.token),
    null,
    "Revoking a full-contact share must not revoke a separate work-scoped link",
  );
  console.log(
    "Verified live contact shares: anonymous read-only projection, exact contact/account/work scope, independent owner isolation, hashed 256-bit tokens, no private fields, historical balance rules, transport parity, bounded consistent pagination, updates, rotation and revocation.",
  );
} finally {
  for (const id of ids)
    await request(`/auth/v1/admin/users/${id}`, undefined, admin, "DELETE");
}
