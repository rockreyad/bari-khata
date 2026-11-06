import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { summarize, contractSummary } from "../../domain/ledger";
import { partyLedger } from "../../domain/partyLedger";
import {
  planHousePayment,
  recordHousePayment,
  planHouseBillAdvance,
  applyHouseBillAdvance,
} from "../../domain/housePayments";
import { LedgerDatabase } from "../../data/database";
import { LedgerRepository } from "../../data/repository";
import { QuickDraftSchema } from "../entries/quickEntry";
import { recordHouseCost } from "./houseCost";

const databases: LedgerDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});
const fixture = () =>
  LedgerSchema.parse({
    architectureVersion: 2,
    paymentAllocations: [],
    works: [{ id: "roof", name: "ছাদ" }],
    people: [
      { id: "shop", name: "নমুনা দোকান", kind: "shop", roles: ["supplier"] },
      {
        id: "worker",
        name: "নমুনা মিস্ত্রি",
        kind: "worker",
        roles: ["custom"],
      },
    ],
  });
const draft = (change: Record<string, unknown> = {}) =>
  QuickDraftSchema.parse({
    id: crypto.randomUUID(),
    paymentId: crypto.randomUUID(),
    refundId: crypto.randomUUID(),
    personNewId: crypto.randomUUID(),
    date: "2026-11-05",
    workId: "roof",
    personId: "shop",
    payment: "due",
    rows: [{ id: crypto.randomUUID(), label: "সিমেন্ট", amount: "1000" }],
    ...change,
  });
function cost(current: Ledger, change: Record<string, unknown> = {}) {
  return recordHouseCost(current, draft(change), [], "সাধারণ খরচ");
}
function repo() {
  const db = new LedgerDatabase(`house-flow-${crypto.randomUUID()}`);
  databases.push(db);
  return new LedgerRepository(db);
}

it("keeps financial confirmation independent of material classification and supports anonymous fully paid purchases", () => {
  const ledger = cost(fixture(), { personId: "", workId: "", payment: "full" });
  expect(ledger.entries.find((row) => row.kind === "expense")).toMatchObject({
    reviewStatus: "confirmed",
    personId: null,
  });
  expect(summarize(ledger)).toMatchObject({
    cost: 100000,
    paid: 100000,
    payable: 0,
  });
});

it("records a worker's own materials as a reimbursement due without wages", () => {
  const ledger = cost(fixture(), { personId: "worker", payment: "worker" });
  expect(ledger.entries).toHaveLength(1);
  expect(ledger.entries[0]).toMatchObject({
    account: "materials",
    personId: "worker",
    kind: "expense",
  });
  expect(partyLedger(ledger, "worker")).toMatchObject({ payable: 100000 });
  expect(
    ledger.entries
      .flatMap((row) => row.lines)
      .every((line) => line.costType === "material"),
  ).toBe(true);
});

it("keeps an explicitly entered unclassified brand and quantity through normalized storage and backup restore", async () => {
  const first = repo();
  const initial = cost(fixture(), {
    payment: "partial",
    paid: "40",
    rows: [
      {
        id: "branded",
        label: "নমুনা সিমেন্ট",
        amount: "200",
        brand: "নমুনা ব্র্যান্ড",
        quantity: "2.5",
        unit: "বস্তা",
      },
    ],
  });
  await first.ensure("real", initial);
  first.database.close();
  await first.database.open();
  const saved = (await first.read())!.ledger;
  const bill = saved.entries.find((entry) => entry.kind === "expense")!;
  expect(bill.lines[0]).toMatchObject({
    quantity: "2.5",
    unit: "বস্তা",
    materialGroupId: null,
    amount: 20000,
  });
  expect(
    saved.items.find((item) => item.id === bill.lines[0].itemId),
  ).toMatchObject({ brand: "নমুনা ব্র্যান্ড", materialGroupId: null });
  const restored = repo();
  await restored.ensure("real", fixture());
  await restored.importBackup(await first.exportBackup(), { replace: true });
  expect((await restored.read())!.ledger).toEqual(saved);
  expect(summarize((await restored.read())!.ledger)).toMatchObject({
    cost: 20000,
    netPaid: 4000,
    payable: 16000,
  });
});

it("matches the paid part of a new bill in the same save so it cannot be offered for payment twice", () => {
  const ledger = cost(fixture(), { payment: "partial", paid: "400" });
  const summary = partyLedger(ledger, "shop");
  expect(summary).toMatchObject({
    billOutstanding: 60000,
    unallocatedCash: 0,
    payable: 60000,
  });
  const plan = planHousePayment(ledger, {
    personId: "shop",
    intent: "settlement",
    amount: 60000,
  });
  expect(plan.issues).toEqual([]);
  expect(plan.requiresCashReview).toBe(false);
  expect(plan.allocations.map((row) => row.amount)).toEqual([60000]);
});

it("writes one earned work bill and partial cash payment under an optional agreement", () => {
  const initial = LedgerSchema.parse({
    ...fixture(),
    contracts: [
      {
        id: "job",
        personId: "worker",
        scope: "work",
        workId: "roof",
        basis: "fixed",
        total: 60000000,
      },
    ],
  });
  const ledger = cost(initial, {
    personId: "worker",
    costType: "labour",
    account: "labour",
    contractId: "job",
    payment: "partial",
    paid: "80000",
    rows: [{ id: "earned", label: "শেষ হওয়া কাজ", amount: "200000" }],
  });
  expect(summarize(ledger)).toMatchObject({
    cost: 20000000,
    paid: 8000000,
    payable: 12000000,
  });
  expect(contractSummary(ledger, "job")).toMatchObject({ remaining: 12000000 });
});

it("consumes only confirmed advance without a second cash movement", () => {
  let ledger = recordHousePayment(fixture(), {
    id: "advance",
    personId: "shop",
    amount: 5000000,
    intent: "advance",
    account: "materials",
    workId: "roof",
    date: "2026-11-04",
    method: "cash",
  });
  const input = draft({
    rows: [{ id: "material", label: "আগাম দেওয়া মালের বিল", amount: "30000" }],
  });
  const proposal = planHouseBillAdvance(ledger, {
    personId: "shop",
    account: "materials",
    workId: "roof",
    amount: 3000000,
  });
  ledger = applyHouseBillAdvance(
    recordHouseCost(ledger, input, [], "সাধারণ খরচ"),
    input.id,
    proposal,
  );
  expect(ledger.entries.filter((row) => row.kind === "payment")).toHaveLength(
    1,
  );
  expect(summarize(ledger)).toMatchObject({
    cost: 3000000,
    paid: 5000000,
    payable: 0,
  });
  expect(partyLedger(ledger, "shop")).toMatchObject({
    advance: 2000000,
    billOutstanding: 0,
  });
});

it("saves a combined payment atomically, reopens normalized records, and restores a complete backup", async () => {
  const repository = repo();
  const initial = cost(
    cost(fixture(), {
      date: "2026-11-03",
      rows: [{ id: "a", label: "প্রথম বিল", amount: "10000" }],
    }),
    {
      date: "2026-11-04",
      rows: [{ id: "b", label: "দ্বিতীয় বিল", amount: "15000" }],
    },
  );
  await repository.ensure("real", initial);
  const request = {
    personId: "shop",
    amount: 1800000,
    intent: "settlement" as const,
  };
  const preview = planHousePayment(initial, request);
  expect(
    preview.allocations.map((row) => row.amount).sort((a, b) => a - b),
  ).toEqual([800000, 1000000]);
  await repository.save((current) =>
    recordHousePayment(
      current,
      { ...request, id: "payment", date: "2026-11-05", method: "cash" },
      preview,
    ),
  );
  repository.database.close();
  await repository.database.open();
  const saved = (await repository.read())!.ledger;
  expect(summarize(saved)).toMatchObject({
    cost: 2500000,
    paid: 1800000,
    payable: 700000,
  });
  expect(partyLedger(saved, "shop").billOutstanding).toBe(700000);
  expect(
    (await repository.database.workspaces.get("real"))?.ledger,
  ).toBeUndefined();
  const restored = repo();
  await restored.ensure("real", fixture());
  await restored.importBackup(await repository.exportBackup(), {
    replace: true,
  });
  expect((await restored.read())!.ledger).toEqual(saved);
  await expect(
    repository.save((current) =>
      recordHousePayment(
        current,
        { ...request, id: "second-device", date: "2026-11-05", method: "cash" },
        preview,
      ),
    ),
  ).rejects.toThrow();
  expect((await repository.read())!.ledger).toEqual(saved);
});
