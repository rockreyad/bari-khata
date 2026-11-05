import { expect, it } from "vitest";
import { EntrySchema, LedgerSchema } from "./model";
import { planHousePayment, recordHousePayment } from "./housePayments";
import { partyLedger } from "./partyLedger";
import { summarize } from "./ledger";

const fixture = () =>
  LedgerSchema.parse({
    architectureVersion: 2,
    paymentAllocations: [],
    milestones: [],
    works: [{ id: "roof", name: "নমুনা ছাদ" }],
    people: [
      {
        id: "worker",
        name: "নমুনা শাহ আলম",
        kind: "worker",
        contactType: "craftsperson",
        roles: ["craftsperson"],
      },
    ],
  });
const input = {
  id: "ordinary",
  personId: "worker",
  amount: 10000,
  intent: "payment" as const,
  date: "2026-11-05",
  method: "cash" as const,
};
const bill = (
  id: string,
  amount: number,
  account: "materials" | "labour" = "labour",
) =>
  EntrySchema.parse({
    id,
    kind: "expense",
    personId: "worker",
    account,
    lines: [
      {
        id: `${id}-line`,
        workId: "roof",
        amount,
        costType: account === "labour" ? "labour" : "material",
      },
    ],
  });

it("records a plain worker payment without a bill, advance label or arbitrary work assignment", () => {
  const original = fixture();
  const plan = planHousePayment(original, input);
  expect(plan.issues).toEqual([]);
  expect(plan.newWork).toMatchObject({ name: "সাধারণ খরচ" });
  expect(plan.groups).toMatchObject([
    {
      account: "labour",
      context: "settlement",
      contractId: null,
      amount: 10000,
      allocations: [],
    },
  ]);
  expect(plan.groups[0].works[0].workId).not.toBe("roof");
  const saved = recordHousePayment(original, input, plan);
  expect(saved.works).toHaveLength(2);
  expect(
    saved.works.find((work) => work.id === plan.newWork!.id)!.activity,
  ).toHaveLength(1);
  expect(saved.entries).toMatchObject([
    {
      kind: "payment",
      account: "labour",
      personId: "worker",
      paymentContext: "settlement",
      lines: [],
      paymentParts: [{ amount: 10000 }],
    },
  ]);
  expect(saved.paymentAllocations).toEqual([]);
  expect(partyLedger(saved, "worker")).toMatchObject({
    payable: 0,
    explicitAdvance: 0,
    receivable: 0,
    ordinaryUnallocatedCash: 10000,
    legacyUnclassifiedCredit: 0,
  });
  expect(summarize(saved)).toMatchObject({ cost: 0, paid: 10000 });
  expect(original.entries).toEqual([]);
  expect(original.works).toHaveLength(1);
});

it("uses an explicitly linked or uniquely associated work, and reuses only an active general work otherwise", () => {
  const initial = fixture();
  expect(
    planHousePayment(initial, { ...input, workId: "roof" }).newWork,
  ).toBeUndefined();
  initial.people[0].workIds = ["roof"];
  expect(planHousePayment(initial, input).groups[0].works).toEqual([
    { workId: "roof", amount: 10000 },
  ]);
  initial.people[0].workIds = [];
  const general = LedgerSchema.parse({
    ...initial,
    works: [...initial.works, { id: "known-general", name: "সাধারণ খরচ" }],
  });
  expect(planHousePayment(general, input)).toMatchObject({
    newWork: undefined,
    groups: [{ works: [{ workId: "known-general", amount: 10000 }] }],
  });
});

it("automatically links known earned bills and leaves all extra money as ordinary payment rather than advance", () => {
  const initial = LedgerSchema.parse({
    ...fixture(),
    entries: [bill("earned", 6000)],
  });
  const plan = planHousePayment(initial, input);
  expect(plan).toMatchObject({
    remainder: 4000,
    requiresCashReview: false,
  });
  expect(plan.newWork).toBeUndefined();
  const saved = recordHousePayment(initial, input, plan);
  expect(saved.entries).toHaveLength(2);
  expect(saved.entries[1]).toMatchObject({
    kind: "payment",
    paymentContext: "settlement",
    paymentParts: [{ amount: 10000 }],
  });
  expect(saved.paymentAllocations).toMatchObject([
    { paymentId: "ordinary", billId: "earned", amount: 6000 },
  ]);
  expect(partyLedger(saved, "worker")).toMatchObject({
    billOutstanding: 0,
    explicitAdvance: 0,
    ordinaryUnallocatedCash: 4000,
    payable: 0,
  });
  expect(summarize(saved)).toMatchObject({ cost: 6000, paid: 10000 });
});

it("keeps later bills independent while the canonical same-account balance reflects the earlier cash", () => {
  const paid = recordHousePayment(fixture(), input);
  const later = LedgerSchema.parse({
    ...paid,
    entries: [...paid.entries, bill("later", 15000)],
  });
  expect(partyLedger(later, "worker")).toMatchObject({
    payable: 5000,
    billOutstanding: 15000,
    ordinaryUnallocatedCash: 10000,
    explicitAdvance: 0,
  });
  expect(later.paymentAllocations).toEqual([]);
  const otherAccount = LedgerSchema.parse({
    ...paid,
    entries: [...paid.entries, bill("material", 15000, "materials")],
  });
  expect(partyLedger(otherAccount, "worker")).toMatchObject({
    payable: 15000,
    ordinaryUnallocatedCash: 10000,
    explicitAdvance: 0,
  });
});

it("records a new plain cash fact without classifying old unlinked cash or requiring an advance decision", () => {
  const initial = LedgerSchema.parse({
    ...fixture(),
    entries: [
      bill("earned", 10000),
      {
        id: "old",
        personId: "worker",
        kind: "payment",
        account: "labour",
        allocations: [{ workId: "roof", amount: 1000 }],
        paymentParts: [{ amount: 1000 }],
      },
    ],
  });
  const plan = planHousePayment(initial, input);
  expect(plan.issues).toEqual([]);
  expect(plan.requiresCashReview).toBe(false);
  const saved = recordHousePayment(initial, input, plan);
  expect(saved.entries[1]).toEqual(initial.entries[1]);
  expect(
    saved.paymentAllocations!.every((row) => row.paymentId === "ordinary"),
  ).toBe(true);
  expect(partyLedger(saved, "worker")).toMatchObject({
    legacyUnclassifiedCredit: 1000,
    explicitAdvance: 0,
  });
});

it("rejects stale, invalid and disabled payments without creating partial general-work metadata", () => {
  const initial = fixture();
  const plan = planHousePayment(initial, input);
  const changed = LedgerSchema.parse({
    ...initial,
    works: [...initial.works, { id: "other-general", name: "সাধারণ খরচ" }],
  });
  expect(() => recordHousePayment(changed, input, plan)).toThrow("changed");
  expect(() =>
    recordHousePayment(initial, { ...input, workId: "missing" }),
  ).toThrow("invalid_work");
  expect(() => recordHousePayment(initial, { ...input, amount: 1.5 })).toThrow(
    "invalid_amount",
  );
  expect(() =>
    recordHousePayment(initial, { ...input, date: "bad-date" }),
  ).toThrow();
  const disabled = LedgerSchema.parse({
    ...initial,
    people: [{ ...initial.people[0], quickActions: [] }],
  });
  expect(() => recordHousePayment(disabled, input)).toThrow("contact_rules");
  expect(initial.entries).toEqual([]);
  expect(initial.works).toHaveLength(1);
});

it("records factual cash while leaving bills with an unresolved old contract correction unallocated", () => {
  const initial = LedgerSchema.parse({
    ...fixture(),
    contracts: [
      {
        id: "job",
        personId: "worker",
        scope: "work",
        workId: "roof",
        total: 100000,
      },
    ],
    entries: [
      { ...bill("earned", 30000), contractId: "job" },
      {
        id: "old-discount",
        kind: "adjustment",
        personId: "worker",
        account: "labour",
        contractId: "job",
        note: "নমুনা পুরোনো ছাড়",
        adjustment: {
          target: "person",
          basis: "balance",
          account: "labour",
          workId: "roof",
          before: 100000,
          after: 90000,
          delta: -10000,
        },
      },
    ],
  });
  const plan = planHousePayment(initial, input);
  expect(plan.issues).toEqual([]);
  expect(plan.allocations).toEqual([]);
  const saved = recordHousePayment(initial, input, plan);
  expect(saved.entries.at(-1)).toMatchObject({
    kind: "payment",
    paymentContext: "settlement",
    paymentParts: [{ amount: 10000 }],
  });
  expect(saved.paymentAllocations).toEqual([]);
  expect(partyLedger(saved, "worker").earnedPayable).toBeNull();
});
