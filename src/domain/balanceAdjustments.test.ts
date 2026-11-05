import { describe, expect, it } from "vitest";
import { EntryCoreSchema, LedgerSchema, type Ledger } from "./model";
import type {
  BalanceAdjustmentInput,
  BalanceAdjustmentScope,
} from "./balanceAdjustments";
import {
  appendBalanceAdjustment as appendTyped,
  readBalanceAdjustmentScope as readTyped,
} from "./balanceAdjustments";
import {
  contractSummary,
  entryTotal,
  entryWorkAmount,
  entryWorkIds,
  personSummary,
  replaceEntry,
  setEntryVoided,
  summarize,
} from "./ledger";
import { contactAccountSummary } from "./contacts";
import { cashSummary } from "./cashSummary";
import { workBalances } from "../features/works/workBalances";
import { jobBalances } from "../features/jobs/jobView";
import { setEntityRemoved } from "./entityDeletion";

const appendBalanceAdjustment = (
  ledger: Ledger,
  input: Omit<BalanceAdjustmentInput, "target" | "basis"> &
    Partial<Pick<BalanceAdjustmentInput, "target" | "basis">>,
  at?: string,
) => appendTyped(ledger, { target: "person", basis: "balance", ...input }, at);
const readBalanceAdjustmentScope = (
  ledger: Ledger,
  input: Omit<BalanceAdjustmentScope, "target" | "basis"> &
    Partial<Pick<BalanceAdjustmentScope, "target" | "basis">>,
) => readTyped(ledger, { target: "person", basis: "balance", ...input });
const at = "2026-11-03T20:30:00.000Z";
const scope = { personId: "shop", account: "materials" as const };
const bill = (
  id = "bill",
  amount = 10000,
  personId = "shop",
  account = "materials",
  workId = "one",
  contractId: string | null = null,
) => ({
  id,
  kind: "expense",
  personId,
  account,
  contractId,
  lines: [
    {
      id: `${id}-line`,
      workId,
      label: "মাল",
      costType: account === "labour" ? "labour" : "material",
      amount,
    },
  ],
});
const payment = (
  id = "paid",
  amount = 4000,
  personId = "shop",
  account = "materials",
  workId = "one",
  contractId: string | null = null,
) => ({
  id,
  kind: "payment",
  personId,
  account,
  contractId,
  allocations: [{ workId, amount }],
  paymentParts: [{ method: "cash", amount }],
});
const fixture = (entries: unknown[] = [bill(), payment()]) =>
  LedgerSchema.parse({
    works: [
      { id: "one", name: "দরজা" },
      { id: "two", name: "ছাদ" },
    ],
    people: [
      { id: "shop", name: "দোকান", kind: "shop" },
      { id: "other", name: "অন্য দোকান", kind: "shop" },
      { id: "worker", name: "মিস্ত্রি", kind: "worker" },
      { id: "driver", name: "গাড়িচালক", kind: "driver" },
    ],
    contracts: [
      { id: "job", personId: "worker", workId: "one", total: 10000 },
      { id: "second-job", personId: "worker", workId: "two", total: 5000 },
      {
        id: "house",
        personId: "worker",
        scope: "house",
        workId: null,
        total: 20000,
      },
    ],
    entries,
  });
const save = (ledger = fixture(), after = 3000, extra = {}) =>
  appendBalanceAdjustment(
    ledger,
    {
      ...scope,
      expectedBefore: 6000,
      after,
      reason: "দোকানের সঙ্গে মিলিয়ে বাকি ঠিক করা হলো",
      ...extra,
    },
    at,
  );
const adjustment = () => ({
  id: "adjustment",
  kind: "adjustment",
  personId: "shop",
  account: "materials",
  note: "হিসাব মিলিয়েছি",
  adjustment: {
    target: "person",
    basis: "balance",
    account: "materials",
    delta: -3000,
    before: 6000,
    after: 3000,
    workId: null,
  },
});

describe("explicit non-cash balance adjustments", () => {
  it("records a lower agreed outstanding without changing the bill, paid cash or refunds", () => {
    const original = fixture(),
      before = structuredClone(original),
      next = save(original);
    expect(next.entries.at(-1)).toMatchObject({
      kind: "adjustment",
      personId: "shop",
      adjustment: { before: 6000, after: 3000, delta: -3000, workId: null },
      note: "দোকানের সঙ্গে মিলিয়ে বাকি ঠিক করা হলো",
      date: "2026-11-04",
      createdAt: at,
      lines: [],
      allocations: [],
      paymentParts: [],
      receipts: [],
    });
    expect(readBalanceAdjustmentScope(next, scope)).toMatchObject({
      balance: 3000,
      cost: 10000,
      paid: 4000,
      refunds: 0,
      netPaid: 4000,
      adjustment: -3000,
    });
    expect(personSummary(next, "shop")).toMatchObject({
      cost: 10000,
      paid: 4000,
      refunds: 0,
      payable: 6000,
      reconciledPayable: 3000,
      advance: 0,
      owedCorrection: -3000,
    });
    expect(summarize(next)).toMatchObject({
      cost: 10000,
      paid: 4000,
      refunds: 0,
      payable: 6000,
      reconciledPayable: 3000,
      adjustment: -3000,
    });
    expect(cashSummary(next)).toEqual(cashSummary(original));
    expect(next.entries.slice(0, 2)).toEqual(original.entries);
    expect(original).toEqual(before);
  });
  it("supports an explicit opening balance or credit without inventing a purchase or payment", () => {
    let ledger = save(fixture([]), 8000, {
      expectedBefore: 0,
      reason: "আগের খাতার বাকি",
    });
    expect(summarize(ledger)).toMatchObject({
      cost: 0,
      paid: 0,
      refunds: 0,
      payable: 0,
      reconciledPayable: 8000,
      advance: 0,
    });
    ledger = save(ledger, -2000, {
      expectedBefore: 8000,
      reason: "দোকানের হিসাবে আমার জমা আছে",
    });
    expect(readBalanceAdjustmentScope(ledger, scope).balance).toBe(-2000);
    expect(contactAccountSummary(ledger, ledger.people[0])).toMatchObject({
      cost: 0,
      paid: 0,
      refunds: 0,
      payable: 0,
      advance: 0,
      reconciledPayable: 0,
      reconciledAdvance: 2000,
    });
  });
  it("keeps unallocated changes out of notebook totals", () => {
    const next = save();
    const row = next.entries.at(-1)!;
    expect(entryTotal(row)).toBe(3000);
    expect(entryWorkIds(row)).toEqual([]);
    expect(entryWorkAmount(row, "one")).toBe(0);
    expect(summarize(next, "one")).toMatchObject({
      payable: 6000,
      adjustment: 0,
    });
    expect(workBalances(next, "one")).toMatchObject({ billPayable: 6000 });
  });
  it("applies an exact-work adjustment to that notebook once and also to the person's total", () => {
    const ledger = fixture([
      bill(),
      payment(),
      bill("roof", 5000, "shop", "materials", "two"),
    ]);
    const next = save(ledger, 2000, { workId: "one" });
    expect(
      readBalanceAdjustmentScope(next, { ...scope, workId: "one" }).balance,
    ).toBe(2000);
    expect(
      readBalanceAdjustmentScope(next, { ...scope, workId: "two" }).balance,
    ).toBe(5000);
    expect(readBalanceAdjustmentScope(next, scope).balance).toBe(7000);
    expect(summarize(next, "one")).toMatchObject({
      payable: 6000,
      reconciledPayable: 2000,
      cost: 10000,
      paid: 4000,
    });
    expect(workBalances(next, "one")).toMatchObject({
      billPayable: 6000,
      reconciledPayable: 2000,
      netPaid: 4000,
    });
    expect(entryWorkIds(next.entries.at(-1)!)).toEqual(["one"]);
  });
  it("never offsets another person, account or job", () => {
    const ledger = fixture([
      bill(),
      payment(),
      bill("other", 5000, "other"),
      bill("wage", 7000, "shop", "labour"),
    ]);
    const next = save(ledger, -2000);
    expect(personSummary(next, "shop")).toMatchObject({
      payable: 13000,
      advance: 0,
      reconciledPayable: 7000,
      reconciledAdvance: 2000,
    });
    expect(personSummary(next, "other")).toMatchObject({
      payable: 5000,
      advance: 0,
    });
    expect(
      readBalanceAdjustmentScope(next, {
        personId: "worker",
        account: "labour",
        contractId: "job",
      }).balance,
    ).toBe(0);
  });
  it("rejects a stale balance and leaves both the original and concurrently updated ledger intact", () => {
    const original = fixture(),
      next = save(original),
      snapshot = structuredClone(next);
    expect(() => save(next, 1000)).toThrow("balance_adjustment_stale");
    expect(next).toEqual(snapshot);
    expect(original.entries).toHaveLength(2);
  });
  it("rejects a concurrently archived person even when the expected amount is still current", () => {
    const original = fixture();
    const input = {
      target: "person" as const,
      basis: "balance" as const,
      ...scope,
      expectedBefore: 6000,
      after: 3000,
      reason: "মোট মিলিয়েছি",
    };
    const archived = setEntityRemoved(original, "person", "shop", true);
    expect(readTyped(archived, input).value).toBe(input.expectedBefore);
    expect(() => appendTyped(archived, input, at)).toThrow(
      "balance_adjustment_archived",
    );
    expect(archived.entries).toEqual(original.entries);
    const restored = setEntityRemoved(archived, "person", "shop", false);
    expect(appendTyped(restored, input, at).entries).toHaveLength(
      original.entries.length + 1,
    );
  });
  it("rejects a concurrently archived notebook without changing its unchanged paid total", () => {
    const original = fixture();
    const input = {
      target: "work" as const,
      basis: "paid" as const,
      personId: null,
      account: null,
      workId: "one",
      expectedBefore: 4000,
      after: 5000,
      reason: "খাতার মোট মিলিয়েছি",
    };
    const archived = setEntityRemoved(original, "work", "one", true);
    expect(readTyped(archived, input).value).toBe(input.expectedBefore);
    expect(() => appendTyped(archived, input, at)).toThrow(
      "balance_adjustment_archived",
    );
    expect(archived.entries).toEqual(original.entries);
  });
  it("guards an explicitly selected archived job or scoped notebook but preserves historical adjustments", () => {
    const original = fixture([
      bill("earned", 10000, "worker", "labour", "one", "job"),
    ]);
    const input = {
      target: "person" as const,
      basis: "balance" as const,
      personId: "worker",
      account: "labour" as const,
      contractId: "job",
      expectedBefore: 10000,
      after: 8000,
      reason: "কাজের মোট মিলিয়েছি",
    };
    for (const archived of [
      setEntityRemoved(original, "contract", "job", true),
      setEntityRemoved(original, "work", "one", true),
    ]) {
      expect(readTyped(archived, input).value).toBe(input.expectedBefore);
      expect(() => appendTyped(archived, input, at)).toThrow(
        "balance_adjustment_archived",
      );
    }
    const saved = appendTyped(original, input, at);
    const archived = setEntityRemoved(
      setEntityRemoved(saved, "contract", "job", true),
      "person",
      "worker",
      true,
    );
    expect(LedgerSchema.safeParse(archived).success).toBe(true);
    expect(readTyped(archived, input).value).toBe(8000);
    expect(
      setEntryVoided(archived, saved.entries.at(-1)!.id, true).entries.at(-1)
        ?.voided,
    ).toBe(true);
  });
  it("requires a nonempty reason and a real change", () => {
    expect(() => save(fixture(), 3000, { reason: "   " })).toThrow(
      "balance_adjustment_reason_required",
    );
    expect(() => save(fixture(), 6000)).toThrow("balance_adjustment_no_change");
  });
  it("allows audit-backed cancel and restore but rejects generic editing or retyping", () => {
    const saved = save(),
      row = saved.entries.at(-1)!;
    expect(() => replaceEntry(saved, { ...row, note: "অন্য কারণ" })).toThrow(
      "immutable",
    );
    expect(() =>
      replaceEntry(saved, { ...saved.entries[0], ...row, id: "bill" }),
    ).toThrow("immutable");
    const cancelled = setEntryVoided(saved, row.id, true);
    expect(readBalanceAdjustmentScope(cancelled, scope).balance).toBe(6000);
    const restored = setEntryVoided(cancelled, row.id, false);
    expect(readBalanceAdjustmentScope(restored, scope).balance).toBe(3000);
    expect(
      restored.entries
        .at(-1)
        ?.revisions.map((event) => event.before.adjustment),
    ).toEqual([row.adjustment, row.adjustment]);
  });
  it("adjusts one job's obligation without changing agreed total or cash and without cross-job netting", () => {
    const ledger = fixture([
      bill("earned", 6000, "worker", "labour", "one", "job"),
      payment("job-paid", 4500, "worker", "labour", "one", "job"),
    ]);
    const jobScope = {
      personId: "worker",
      account: "labour" as const,
      contractId: "job",
    };
    const next = appendBalanceAdjustment(
      ledger,
      {
        ...jobScope,
        expectedBefore: 1500,
        after: 500,
        reason: "বাকি মজুরি মিলিয়েছি",
      },
      at,
    );
    expect(next.entries.at(-1)?.adjustment?.workId).toBe("one");
    expect(readBalanceAdjustmentScope(next, jobScope)).toMatchObject({
      balance: 500,
      agreed: 10000,
      paid: 4500,
      cost: 6000,
      adjustment: -1000,
    });
    expect(contractSummary(next, "job")).toMatchObject({
      remaining: 500,
      remainingCommitment: 4500,
      agreed: 10000,
      netPaid: 4500,
      adjustment: -1000,
    });
    expect(jobBalances(next).get("job")).toMatchObject({
      remaining: 500,
      netPaid: 4500,
      state: "due",
    });
    expect(jobBalances(next).get("second-job")).toMatchObject({
      remaining: 0,
      remainingCommitment: 5000,
    });
    expect(workBalances(next, "one")).toMatchObject({
      billPayable: 500,
      scopedOutstanding: 4500,
      workCommitmentOutstanding: 4500,
    });
    expect(next.contracts).toEqual(ledger.contracts);
    expect(cashSummary(next)).toEqual(cashSummary(ledger));
  });
  it("adjusts a higher actual bill once rather than discounting both bill and agreement", () => {
    const ledger = fixture([
      bill("earned", 14000, "worker", "labour", "one", "job"),
      payment("job-paid", 4000, "worker", "labour", "one", "job"),
    ]);
    const next = appendBalanceAdjustment(
      ledger,
      {
        personId: "worker",
        account: "labour",
        contractId: "job",
        expectedBefore: 10000,
        after: 7000,
        reason: "ঠিক করা ছাড়",
      },
      at,
    );
    expect(workBalances(next, "one")).toMatchObject({
      billPayable: 7000,
      scopedOutstanding: 7000,
      workCommitmentOutstanding: 7000,
      additionalCommitment: 0,
    });
    expect(jobBalances(next).get("job")).toMatchObject({ remaining: 7000 });
  });
  it("keeps whole-house adjustments global and never allocates them to notebooks", () => {
    const next = appendBalanceAdjustment(
      fixture([
        bill("house-earned", 20000, "worker", "labour", "one", "house"),
      ]),
      {
        personId: "worker",
        account: "labour",
        contractId: "house",
        expectedBefore: 20000,
        after: 15000,
        reason: "পুরো বাড়ির কাজের বাকি",
      },
      at,
    );
    expect(next.entries.at(-1)?.adjustment?.workId).toBeNull();
    for (const workId of ["one", "two"])
      expect(workBalances(next, workId)).toMatchObject({
        sharedOutstanding: 15000,
      });
    expect(
      readBalanceAdjustmentScope(next, {
        personId: "worker",
        account: "labour",
        contractId: "house",
      }).balance,
    ).toBe(15000);
    expect(() =>
      appendBalanceAdjustment(
        fixture([]),
        {
          personId: "worker",
          account: "labour",
          contractId: "house",
          workId: "one",
          expectedBefore: 20000,
          after: 15000,
          reason: "কারণ",
        },
        at,
      ),
    ).toThrow("invalid_scope");
  });
  it("preserves driver other-account adjustments alongside legacy transport rows", () => {
    const ledger = fixture([
      {
        ...bill("fare", 10000, "driver"),
        lines: [
          {
            id: "fare-line",
            workId: "one",
            costType: "transport",
            amount: 10000,
          },
        ],
      },
    ]);
    const next = appendBalanceAdjustment(
      ledger,
      {
        personId: "driver",
        account: "other",
        expectedBefore: 10000,
        after: 8000,
        reason: "ভাড়া মিলিয়েছি",
      },
      at,
    );
    expect(
      contactAccountSummary(
        next,
        next.people.find((person) => person.id === "driver")!,
      ),
    ).toMatchObject({
      cost: 10000,
      payable: 10000,
      reconciledPayable: 8000,
      owedCorrection: -2000,
    });
  });
  it("keeps a safe final balance exact even when intermediate contract arithmetic exceeds the safe range", () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const ledger = LedgerSchema.parse({
      ...fixture([
        bill("earned", maximum - 4, "worker", "labour", "one", "job"),
        payment("tiny", 2, "worker", "labour", "one", "job"),
      ]),
      contracts: [
        { id: "job", personId: "worker", workId: "one", total: maximum },
      ],
    });
    const next = appendBalanceAdjustment(
      ledger,
      {
        personId: "worker",
        account: "labour",
        contractId: "job",
        expectedBefore: maximum - 6,
        after: maximum - 4,
        reason: "দুই পয়সা মিলিয়েছি",
      },
      at,
    );
    expect(
      readBalanceAdjustmentScope(next, {
        personId: "worker",
        account: "labour",
        contractId: "job",
      }).balance,
    ).toBe(maximum - 4);
    expect(contractSummary(next, "job").remaining).toBe(maximum - 4);
    expect(contractSummary(next, "job").remainingCommitment).toBe(maximum);
    expect(jobBalances(next).get("job")).toMatchObject({
      valid: true,
      remaining: maximum - 4,
    });
    expect(() =>
      save(fixture([]), maximum, { expectedBefore: -maximum }),
    ).toThrow();
  });
});

describe("untrusted adjustment records", () => {
  it("validates signed exact differences without changing the schema of old entries", () => {
    expect(EntryCoreSchema.parse(adjustment()).adjustment?.delta).toBe(-3000);
    expect(EntryCoreSchema.parse(bill()).adjustment).toBeUndefined();
    expect(
      EntryCoreSchema.safeParse({
        ...bill(),
        adjustment: adjustment().adjustment,
      }).success,
    ).toBe(false);
  });
  it.each([
    { adjustment: null },
    { personId: null },
    { note: "  " },
    { balanceImpact: "historical" },
    { reviewStatus: "needs_review" },
    { relatedEntryId: "bill" },
    { paymentPurposeId: "purpose" },
    { lines: [{ id: "line", workId: "one", amount: 1 }] },
    { allocations: [{ workId: "one", amount: 1 }] },
    { paymentParts: [{ method: "cash", amount: 1 }] },
    {
      receipts: [
        { id: "receipt", name: "receipt", size: 1, mime: "image/png" },
      ],
    },
  ])("rejects mixed cash/cost or unauditable metadata %j", (invalid) => {
    expect(
      EntryCoreSchema.safeParse({ ...adjustment(), ...invalid }).success,
    ).toBe(false);
  });
  it.each([
    { delta: 0, before: 1, after: 1 },
    { delta: 1, before: 0, after: 2 },
    { delta: 1.5, before: 0, after: 1.5 },
    {
      delta: 1,
      before: Number.MAX_SAFE_INTEGER + 1,
      after: Number.MAX_SAFE_INTEGER + 2,
    },
    {
      delta: 1,
      before: -Number.MAX_SAFE_INTEGER,
      after: Number.MAX_SAFE_INTEGER,
    },
  ])("rejects unsafe or contradictory differences %j", (invalid) => {
    expect(
      EntryCoreSchema.safeParse({
        ...adjustment(),
        adjustment: { ...adjustment().adjustment, ...invalid, workId: null },
      }).success,
    ).toBe(false);
  });
  it("rejects missing references, mismatched job identity and partial house scope", () => {
    for (const invalid of [
      { personId: "missing" },
      { adjustment: { ...adjustment().adjustment, workId: "missing" } },
      { contractId: "job" },
      {
        personId: "worker",
        account: "labour",
        contractId: "job",
        adjustment: { ...adjustment().adjustment, workId: "two" },
      },
      {
        personId: "worker",
        account: "labour",
        contractId: "house",
        adjustment: { ...adjustment().adjustment, workId: "one" },
      },
    ])
      expect(
        LedgerSchema.safeParse({
          ...fixture(),
          entries: [...fixture().entries, { ...adjustment(), ...invalid }],
        }).success,
      ).toBe(false);
  });
});

describe("targeted total correction bases", () => {
  const person = {
    target: "person" as const,
    personId: "shop",
    account: "materials" as const,
  };
  const work = {
    target: "work" as const,
    personId: null,
    account: null,
    workId: "one",
  };
  it("keeps paid, cost and owed corrections coherent while preserving actual cash and bill amounts", () => {
    const original = fixture();
    let next = appendTyped(
      original,
      {
        ...person,
        basis: "paid",
        expectedBefore: 4000,
        after: 6000,
        reason: "দেওয়া টাকার মোট মিলিয়েছি",
      },
      at,
    );
    expect(readTyped(next, { ...person, basis: "paid" })).toMatchObject({
      value: 6000,
      actualNetPaid: 4000,
      paidCorrection: 2000,
      owedCorrection: -2000,
      reconciledPayable: 4000,
    });
    next = appendTyped(
      next,
      {
        ...person,
        basis: "cost",
        expectedBefore: 10000,
        after: 12000,
        reason: "খরচের মোট মিলিয়েছি",
      },
      at,
    );
    expect(readTyped(next, { ...person, basis: "balance" })).toMatchObject({
      value: 6000,
      reconciledCost: 12000,
      reconciledNetPaid: 6000,
      costCorrection: 2000,
      paidCorrection: 2000,
      owedCorrection: 0,
    });
    next = appendTyped(
      next,
      {
        ...person,
        basis: "balance",
        expectedBefore: 6000,
        after: 5000,
        reason: "ছাড়ের পর বাকি",
      },
      at,
    );
    expect(readTyped(next, { ...person, basis: "balance" })).toMatchObject({
      value: 5000,
      actualCost: 10000,
      actualNetPaid: 4000,
      reconciledCost: 12000,
      reconciledNetPaid: 6000,
      balanceCorrection: -1000,
      owedCorrection: -1000,
    });
    expect(personSummary(next, "shop").accounts.materials).toMatchObject({
      cost: 10000,
      netPaid: 4000,
      payable: 6000,
      reconciledCost: 12000,
      reconciledNetPaid: 6000,
      reconciledPayable: 5000,
    });
    expect(cashSummary(next)).toEqual(cashSummary(original));
    expect(next.entries.slice(0, 2)).toEqual(original.entries);
  });
  it("applies a notebook-wide paid correction without allocating it to any person, account or job", () => {
    const original = fixture();
    const next = appendTyped(
      original,
      {
        ...work,
        basis: "paid",
        expectedBefore: 4000,
        after: 6000,
        reason: "এই খাতার দেওয়া টাকার মোট",
      },
      at,
    );
    expect(next.entries.at(-1)).toMatchObject({
      personId: null,
      account: "other",
      contractId: null,
      adjustment: {
        target: "work",
        account: null,
        basis: "paid",
        delta: 2000,
        workId: "one",
      },
    });
    expect(workBalances(next, "one")).toMatchObject({
      valid: true,
      netPaid: 4000,
      reconciledNetPaid: 6000,
      paidCorrection: 2000,
      owedCorrection: -2000,
      reconciledPayable: 6000,
      unallocatedWorkOwedCorrection: -2000,
    });
    expect(readTyped(next, { ...work, basis: "paid" }).value).toBe(6000);
    expect(personSummary(next, "shop")).toEqual(
      personSummary(original, "shop"),
    );
    expect(jobBalances(next)).toEqual(jobBalances(original));
    expect(workBalances(next, "two")).toEqual(workBalances(original, "two"));
    expect(cashSummary(next)).toEqual(cashSummary(original));
  });
  it("corrects a notebook's total cost without creating another expense or cash event", () => {
    const original = fixture();
    const next = appendTyped(
      original,
      {
        ...work,
        basis: "cost",
        expectedBefore: 10000,
        after: 13000,
        reason: "খাতার খরচ মিলিয়েছি",
      },
      at,
    );
    expect(readTyped(next, { ...work, basis: "cost" })).toMatchObject({
      value: 13000,
      actualCost: 10000,
      actualNetPaid: 4000,
      costCorrection: 3000,
      owedCorrection: 3000,
      reconciledPayable: 6000,
      unallocatedWorkOwedCorrection: 3000,
    });
    expect(summarize(next)).toMatchObject({
      cost: 10000,
      paid: 4000,
      reconciledCost: 13000,
      costCorrection: 3000,
    });
    expect(next.entries.filter((entry) => entry.kind === "expense")).toEqual(
      original.entries.filter((entry) => entry.kind === "expense"),
    );
  });
  it("aggregates a person's selected account across jobs but leaves every individual agreement unchanged", () => {
    const original = fixture([
      bill("earned", 6000, "worker", "labour", "one", "job"),
      payment("job-paid", 4500, "worker", "labour", "one", "job"),
    ]);
    const target = {
      target: "person" as const,
      personId: "worker",
      account: "labour" as const,
      basis: "paid" as const,
    };
    const next = appendTyped(
      original,
      {
        ...target,
        expectedBefore: 4500,
        after: 5500,
        reason: "সব কাজ মিলিয়ে দেওয়া টাকা",
      },
      at,
    );
    expect(readTyped(next, target)).toMatchObject({
      value: 5500,
      grossPayable: 1500,
      reconciledPayable: 500,
    });
    expect(jobBalances(next)).toEqual(jobBalances(original));
    expect(next.contracts).toEqual(original.contracts);
    expect(workBalances(next, "one")).toEqual(workBalances(original, "one"));
    expect(personSummary(next, "worker")).toMatchObject({
      netPaid: 4500,
      reconciledNetPaid: 5500,
      reconciledPayable: 500,
      advance: 0,
    });
  });
  it("does not turn a job discount into a false advance when the agreement is still owed", () => {
    const next = appendTyped(
      fixture([bill("earned", 10000, "worker", "labour", "one", "job")]),
      {
        target: "person",
        basis: "balance",
        personId: "worker",
        account: "labour",
        contractId: "job",
        expectedBefore: 10000,
        after: 8000,
        reason: "কাজের বাকি ঠিক করেছি",
      },
      at,
    );
    expect(contractSummary(next, "job")).toMatchObject({
      agreed: 10000,
      remaining: 8000,
      netPaid: 0,
      advance: 0,
    });
    expect(personSummary(next, "worker")).toMatchObject({
      cost: 10000,
      netPaid: 0,
      advance: 0,
      reconciledPayable: 8000,
      reconciledAdvance: 0,
    });
  });
  it("reduces the selected person's existing advance before creating any new debt", () => {
    const original = LedgerSchema.parse({
      ...fixture([payment("advance", 3000)]),
      contracts: [],
    });
    expect(readTyped(original, { ...person, basis: "balance" })).toMatchObject({
      value: -3000,
      grossPayable: 0,
      grossAdvance: 3000,
    });
    const next = appendTyped(
      original,
      {
        ...person,
        basis: "paid",
        expectedBefore: 3000,
        after: 1000,
        reason: "দেওয়া টাকার মোট কম ছিল",
      },
      at,
    );
    expect(readTyped(next, { ...person, basis: "paid" })).toMatchObject({
      value: 1000,
      actualNetPaid: 3000,
      paidCorrection: -2000,
      reconciledPayable: 0,
      reconciledAdvance: 1000,
      reconciledBalance: -1000,
    });
    expect(contactAccountSummary(next, next.people[0])).toMatchObject({
      netPaid: 3000,
      reconciledNetPaid: 1000,
      reconciledPayable: 0,
      reconciledAdvance: 1000,
    });
    expect(summarize(next)).toMatchObject({
      reconciledPayable: 0,
      reconciledAdvance: 1000,
    });
    expect(cashSummary(next).netPaid).toBe(3000);
  });
  it("keeps another person's advance separate from notebook gross due", () => {
    const original = LedgerSchema.parse({
      ...fixture([bill(), payment("other-advance", 15000, "other")]),
      contracts: [],
    });
    expect(readTyped(original, { ...work, basis: "balance" })).toMatchObject({
      value: 10000,
      grossPayable: 10000,
      grossAdvance: 15000,
      reconciledAdvance: 15000,
    });
    const next = appendTyped(
      original,
      {
        ...work,
        basis: "balance",
        expectedBefore: 10000,
        after: 8000,
        reason: "এই খাতার মোট বাকি",
      },
      at,
    );
    expect(readTyped(next, { ...work, basis: "balance" })).toMatchObject({
      value: 8000,
      reconciledAdvance: 15000,
    });
    expect(personSummary(next, "shop")).toEqual(
      personSummary(original, "shop"),
    );
    expect(personSummary(next, "other")).toEqual(
      personSummary(original, "other"),
    );
    expect(summarize(next)).toMatchObject({
      reconciledPayable: 10000,
      unallocatedWorkBalanceCorrection: -2000,
    });
  });
  it("does not invent notebook debt when correcting an unallocated paid total above an existing advance", () => {
    const original = LedgerSchema.parse({
      ...fixture([payment("advance", 3000)]),
      contracts: [],
    });
    const next = appendTyped(
      original,
      {
        ...work,
        basis: "paid",
        expectedBefore: 3000,
        after: 1000,
        reason: "খাতার দেওয়া টাকার মোট কম ছিল",
      },
      at,
    );
    expect(readTyped(next, { ...work, basis: "paid" })).toMatchObject({
      value: 1000,
      actualNetPaid: 3000,
      reconciledPayable: 0,
      reconciledAdvance: 3000,
      unallocatedWorkOwedCorrection: 2000,
    });
    expect(workBalances(next, "one")).toMatchObject({
      netPaid: 3000,
      reconciledNetPaid: 1000,
      reconciledPayable: 0,
      reconciledAdvance: 3000,
    });
    expect(personSummary(next, "shop")).toEqual(
      personSummary(original, "shop"),
    );
    const costCorrected = appendTyped(
      next,
      {
        ...work,
        basis: "cost",
        expectedBefore: 0,
        after: 1000,
        reason: "খরচের মোট মিলিয়েছি",
      },
      at,
    );
    expect(readTyped(costCorrected, { ...work, basis: "cost" })).toMatchObject({
      value: 1000,
      actualCost: 0,
      actualNetPaid: 3000,
      reconciledPayable: 0,
      reconciledAdvance: 3000,
      unallocatedWorkOwedCorrection: 3000,
    });
    expect(personSummary(costCorrected, "shop")).toEqual(
      personSummary(original, "shop"),
    );
  });
  it("does not let an oversized correction to one person erase a different person's debt", () => {
    const original = LedgerSchema.parse({
      ...fixture([bill(), bill("other-bill", 8000, "other")]),
      contracts: [],
    });
    const next = appendTyped(
      original,
      {
        ...person,
        basis: "paid",
        expectedBefore: 0,
        after: 20000,
        reason: "দোকানের দেওয়া টাকার মোট",
      },
      at,
    );
    expect(summarize(next)).toMatchObject({
      reconciledPayable: 8000,
      reconciledAdvance: 10000,
    });
    expect(personSummary(next, "other")).toMatchObject({
      reconciledPayable: 8000,
    });
  });
  it("keeps an exact-notebook person's increased credit separate from another person's due through void and restore", () => {
    const original = LedgerSchema.parse({
      ...fixture([payment("advance", 1000), bill("other-bill", 1000, "other")]),
      contracts: [],
    });
    const before = structuredClone(original);
    const next = appendTyped(
      original,
      {
        ...person,
        basis: "paid",
        workId: "one",
        expectedBefore: 1000,
        after: 1500,
        reason: "এই খাতায় দেওয়া মোট মিলিয়েছি",
      },
      at,
    );
    const expectBalances = (ledger: Ledger, credit: number) => {
      expect(workBalances(ledger, "one")).toMatchObject({
        reconciledNetPaid: credit,
        reconciledPayable: 1000,
        reconciledAdvance: credit,
      });
      expect(summarize(ledger)).toMatchObject({
        reconciledPayable: 1000,
        reconciledAdvance: credit,
      });
      expect(readTyped(ledger, { ...person, basis: "balance" })).toMatchObject({
        value: -credit,
        reconciledPayable: 0,
        reconciledAdvance: credit,
      });
      expect(personSummary(ledger, "other")).toMatchObject({
        reconciledPayable: 1000,
        reconciledAdvance: 0,
      });
    };
    expectBalances(next, 1500);
    const row = next.entries.at(-1)!;
    const cancelled = setEntryVoided(next, row.id, true);
    expectBalances(cancelled, 1000);
    expectBalances(setEntryVoided(cancelled, row.id, false), 1500);
    expect(cashSummary(next)).toEqual(cashSummary(original));
    expect(original).toEqual(before);
  });
  it.each([
    { basis: "paid" as const, before: 1500, after: 2000, credit: 1500 },
    { basis: "paid" as const, before: 1500, after: 1000, credit: 500 },
    { basis: "cost" as const, before: 500, after: 0, credit: 1500 },
    { basis: "cost" as const, before: 500, after: 1000, credit: 500 },
    { basis: "balance" as const, before: -1000, after: -1500, credit: 1500 },
    { basis: "balance" as const, before: -1000, after: -500, credit: 500 },
  ])(
    "isolates scoped $basis correction $before→$after from other people and notebooks",
    ({ basis, before, after, credit }) => {
      const original = LedgerSchema.parse({
        ...fixture([
          bill("own-bill", 500),
          payment("advance", 1500),
          bill("other-bill", 1000, "other"),
          bill("other-book", 2500, "other", "materials", "two"),
        ]),
        contracts: [],
      });
      const next = appendTyped(
        original,
        {
          ...person,
          workId: "one",
          basis,
          expectedBefore: before,
          after,
          reason: "নির্দিষ্ট খাতায় এই দোকানের হিসাব মিলিয়েছি",
        },
        at,
      );
      expect(readTyped(next, { ...person, workId: "one", basis }).value).toBe(
        after,
      );
      expect(workBalances(next, "one")).toMatchObject({
        reconciledPayable: 1000,
        reconciledAdvance: credit,
      });
      expect(summarize(next)).toMatchObject({
        reconciledPayable: 3500,
        reconciledAdvance: credit,
      });
      expect(personSummary(next, "shop")).toMatchObject({
        reconciledPayable: 0,
        reconciledAdvance: credit,
      });
      expect(personSummary(next, "other")).toEqual(
        personSummary(original, "other"),
      );
      expect(workBalances(next, "two")).toEqual(workBalances(original, "two"));
      expect(cashSummary(next)).toEqual(cashSummary(original));
      expect(next.entries.slice(0, original.entries.length)).toEqual(
        original.entries,
      );
    },
  );
  it("reads earned debt independently of optional unearned agreements", () => {
    const original = fixture([bill("loose-wages", 6000, "worker", "labour")]);
    expect(readTyped(original, { ...work, basis: "balance" }).value).toBe(6000);
    expect(readTyped(original, { ...work, basis: "cost" }).value).toBe(6000);
    const next = appendTyped(
      original,
      {
        ...work,
        basis: "paid",
        expectedBefore: 0,
        after: 1000,
        reason: "দেওয়া টাকার মোট",
      },
      at,
    );
    expect(workBalances(next, "one")).toMatchObject({
      valid: true,
      reconciledNetPaid: 1000,
      reconciledPayable: 6000,
    });
  });
  it("validates target/account metadata instead of inventing a contact for work totals", () => {
    const good = appendTyped(
      fixture(),
      {
        ...work,
        basis: "paid",
        expectedBefore: 4000,
        after: 5000,
        reason: "মোট মিলিয়েছি",
      },
      at,
    ).entries.at(-1)!;
    expect(EntryCoreSchema.safeParse(good).success).toBe(true);
    for (const row of [
      { ...good, personId: "shop" },
      { ...good, account: "materials" },
      { ...good, adjustment: { ...good.adjustment, account: "other" } },
      { ...good, adjustment: { ...good.adjustment, workId: null } },
    ])
      expect(EntryCoreSchema.safeParse(row).success).toBe(false);
  });
  it("rejects unsafe aggregate corrections when loading untrusted data", () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const base = LedgerSchema.parse({
      ...fixture([bill("earned", maximum, "worker", "labour", "one", "house")]),
      contracts: [
        {
          id: "house",
          personId: "worker",
          scope: "house",
          workId: null,
          total: maximum,
        },
      ],
    });
    const malicious = {
      ...adjustment(),
      personId: "worker",
      account: "labour",
      contractId: "house",
      adjustment: {
        target: "person",
        basis: "balance",
        account: "labour",
        workId: null,
        before: 0,
        after: 1,
        delta: 1,
      },
    };
    expect(
      LedgerSchema.safeParse({ ...base, entries: [...base.entries, malicious] })
        .success,
    ).toBe(false);
  });
  it("rejects an unsafe notebook pool even when another notebook's correction cancels its global delta", () => {
    const base = LedgerSchema.parse({
      ...fixture([
        bill(
          "earned",
          Number.MAX_SAFE_INTEGER,
          "worker",
          "labour",
          "one",
          "job",
        ),
      ]),
      contracts: [
        {
          id: "job",
          personId: "worker",
          workId: "one",
          total: Number.MAX_SAFE_INTEGER,
        },
      ],
    });
    const record = (id: string, workId: string, delta: number) => ({
      id,
      kind: "adjustment",
      personId: null,
      account: "other",
      note: "খাতার বাকি",
      adjustment: {
        target: "work",
        basis: "balance",
        account: null,
        workId,
        before: 0,
        after: delta,
        delta,
      },
    });
    expect(
      LedgerSchema.safeParse({
        ...base,
        entries: [
          ...base.entries,
          record("large", "one", 1),
          record("offset", "two", -1),
        ],
      }).success,
    ).toBe(false);
  });
  it("keeps historical before/after facts valid after a later legitimate bill correction", () => {
    const saved = save();
    const next = replaceEntry(saved, {
      ...saved.entries[0],
      lines: saved.entries[0].lines.map((line) => ({ ...line, amount: 12000 })),
    });
    expect(next.entries.at(-1)?.adjustment).toMatchObject({
      before: 6000,
      after: 3000,
      delta: -3000,
    });
    expect(readTyped(next, { ...person, basis: "balance" }).value).toBe(5000);
    expect(LedgerSchema.safeParse(next).success).toBe(true);
  });
});
