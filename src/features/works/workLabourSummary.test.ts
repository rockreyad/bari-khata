import { describe, expect, it } from "vitest";
import { LedgerSchema } from "../../domain/model";
import { appendBalanceAdjustment } from "../../domain/balanceAdjustments";
import { setEntryVoided } from "../../domain/ledger";
import { workLabourSummary } from "./workLabourSummary";

const cash = (
  id: string,
  amount: number,
  workId = "one",
  account = "labour",
  extra = {},
) => ({
  id,
  kind: "payment",
  personId: "worker",
  account,
  paymentParts: [{ method: "cash", amount }],
  allocations: [{ workId, amount }],
  ...extra,
});
const bill = (
  id: string,
  amount: number,
  workId = "one",
  account = "labour",
  extra = {},
) => ({
  id,
  kind: "expense",
  personId: "worker",
  account,
  lines: [
    {
      id: `${id}-line`,
      workId,
      amount,
      costType: account === "labour" ? "labour" : "material",
    },
  ],
  ...extra,
});
const fixture = (entries: unknown[] = [], contracts: unknown[] = []) =>
  LedgerSchema.parse({
    works: [
      { id: "one", name: "দরজা" },
      { id: "two", name: "ছাদ" },
    ],
    people: [
      {
        id: "worker",
        name: "পরীক্ষার মিস্ত্রি",
        kind: "worker",
        workIds: ["one", "two"],
      },
    ],
    entries,
    contracts,
  });
const at = "2026-11-03T12:00:00.000Z";

describe("notebook labour paid total", () => {
  it("returns valid zero totals for an empty notebook", () => {
    expect(workLabourSummary(fixture(), "one")).toEqual({
      valid: true,
      actualRefunds: 0,
      actualNetPaid: 0,
      paidCorrection: 0,
      reconciledNetPaid: 0,
    });
  });
  it("retains paid-only wages and never substitutes a small bill for the paid total", () => {
    const ledger = fixture([
      cash("paid-one", 100000),
      cash("paid-two", 100000, "two"),
      bill("earned-two", 30000, "two"),
    ]);
    const before = structuredClone(ledger);
    expect(workLabourSummary(ledger, "one")).toMatchObject({
      valid: true,
      actualNetPaid: 100000,
      reconciledNetPaid: 100000,
    });
    expect(workLabourSummary(ledger, "two")).toMatchObject({
      valid: true,
      actualNetPaid: 100000,
      reconciledNetPaid: 100000,
    });
    expect(ledger).toEqual(before);
  });
  it("keeps an unpaid labour bill separate from zero paid cash", () => {
    expect(
      workLabourSummary(fixture([bill("bill", 30000)]), "one"),
    ).toMatchObject({
      valid: true,
      actualNetPaid: 0,
      reconciledNetPaid: 0,
    });
  });
  it("sums the complete notebook instead of its recent preview rows", () => {
    expect(
      workLabourSummary(
        fixture(
          Array.from({ length: 25 }, (_, index) => cash(`p${index}`, 100)),
        ),
        "one",
      ),
    ).toMatchObject({
      valid: true,
      actualNetPaid: 2500,
      reconciledNetPaid: 2500,
    });
  });
  it("uses exact work allocations and subtracts only the current notebook's refund", () => {
    const ledger = fixture([
      {
        ...cash("split", 10000),
        allocations: [
          { workId: "one", amount: 6000 },
          { workId: "two", amount: 4000 },
        ],
      },
      cash("refund", 2000, "one", "labour", { kind: "refund" }),
    ]);
    expect(workLabourSummary(ledger, "one")).toMatchObject({
      valid: true,
      actualRefunds: 2000,
      actualNetPaid: 4000,
    });
    expect(workLabourSummary(ledger, "two")).toMatchObject({
      valid: true,
      actualRefunds: 0,
      actualNetPaid: 4000,
    });
  });
  it("preserves a negative net refund instead of clamping it into zero or a new bill", () => {
    const ledger = fixture([
      cash("paid", 1000),
      cash("refund", 1500, "one", "labour", { kind: "refund" }),
    ]);
    expect(workLabourSummary(ledger, "one")).toMatchObject({
      valid: true,
      actualRefunds: 1500,
      actualNetPaid: -500,
      reconciledNetPaid: -500,
    });
  });
  it("excludes historical spending and cash, cancelled cash and bill credits from paid totals", () => {
    const ledger = fixture([
      bill("old", 10000, "one", "labour", { balanceImpact: "historical" }),
      bill("earned", 3000),
      bill("credit", 500, "one", "labour", { kind: "expense_credit" }),
      bill("void-bill", 1000, "one", "labour", { voided: true }),
      cash("paid", 2000, "one", "labour", { reviewStatus: "needs_review" }),
      cash("old-paid", 9000, "one", "labour", { balanceImpact: "historical" }),
      cash("old-refund", 1000, "one", "labour", {
        kind: "refund",
        balanceImpact: "historical",
      }),
      cash("void-paid", 8000, "one", "labour", { voided: true }),
      cash("void-refund", 500, "one", "labour", {
        kind: "refund",
        voided: true,
      }),
    ]);
    expect(workLabourSummary(ledger, "one")).toMatchObject({
      valid: true,
      actualRefunds: 0,
      actualNetPaid: 2000,
    });
  });
  it("retains active paid cash and refunds when their original wage bill is cancelled", () => {
    const ledger = fixture([
      bill("bill", 10000),
      cash("paid", 6000, "one", "labour", { relatedEntryId: "bill" }),
      cash("refund", 1000, "one", "labour", {
        kind: "refund",
        relatedEntryId: "bill",
      }),
    ]);
    const cancelled = setEntryVoided(ledger, "bill", true);
    expect(workLabourSummary(cancelled, "one")).toMatchObject({
      valid: true,
      actualRefunds: 1000,
      actualNetPaid: 5000,
    });
  });
  it("never treats materials purchased or settled by a worker as wages", () => {
    const ledger = fixture([
      bill("materials", 100000, "one", "materials"),
      cash("materials-paid", 70000, "one", "materials"),
      cash("other-paid", 10000, "one", "other"),
      cash("wages-paid", 2000),
    ]);
    expect(workLabourSummary(ledger, "one")).toMatchObject({
      valid: true,
      actualNetPaid: 2000,
    });
  });
  it("does not copy house-contract cash or a person's notebook links into every notebook", () => {
    const ledger = fixture(
      [cash("house-paid", 10000, "two", "labour", { contractId: "house" })],
      [
        {
          id: "house",
          personId: "worker",
          scope: "house",
          workId: "one",
          total: 50000,
        },
      ],
    );
    expect(workLabourSummary(ledger, "one")).toMatchObject({
      valid: true,
      reconciledNetPaid: 0,
    });
    expect(workLabourSummary(ledger, "two")).toMatchObject({
      valid: true,
      reconciledNetPaid: 10000,
    });
  });
  it("does not allocate all-account notebook corrections to the labour total", () => {
    const ledger = fixture([
      cash("wages", 1000),
      cash("materials", 2000, "one", "materials"),
    ]);
    let next = appendBalanceAdjustment(
      ledger,
      {
        target: "work",
        basis: "paid",
        personId: null,
        account: null,
        workId: "one",
        expectedBefore: 3000,
        after: 5000,
        reason: "খাতার দেওয়া মোট",
      },
      at,
    );
    next = appendBalanceAdjustment(
      next,
      {
        target: "work",
        basis: "cost",
        personId: null,
        account: null,
        workId: "one",
        expectedBefore: 0,
        after: 500,
        reason: "খাতার খরচের মোট",
      },
      at,
    );
    expect(workLabourSummary(next, "one")).toMatchObject({
      valid: true,
      actualNetPaid: 1000,
      paidCorrection: 0,
      reconciledNetPaid: 1000,
    });
  });
  it("keeps a person's all-notebook correction unallocated to particular notebook wages", () => {
    const ledger = fixture([
      cash("one-paid", 1000),
      cash("two-paid", 2000, "two"),
    ]);
    const next = appendBalanceAdjustment(
      ledger,
      {
        target: "person",
        basis: "paid",
        personId: "worker",
        account: "labour",
        workId: null,
        expectedBefore: 3000,
        after: 4000,
        reason: "সব খাতা মিলিয়ে দেওয়া মোট",
      },
      at,
    );
    expect(workLabourSummary(next, "one")).toMatchObject({
      actualNetPaid: 1000,
      paidCorrection: 0,
      reconciledNetPaid: 1000,
    });
    expect(workLabourSummary(next, "two")).toMatchObject({
      actualNetPaid: 2000,
      paidCorrection: 0,
      reconciledNetPaid: 2000,
    });
  });
  it("includes a legitimate explicitly scoped labour correction without changing actual cash", () => {
    const ledger = fixture([
      cash("one-paid", 1000),
      cash("two-paid", 2000, "two"),
    ]);
    let next = appendBalanceAdjustment(
      ledger,
      {
        target: "person",
        basis: "paid",
        personId: "worker",
        account: "labour",
        workId: "one",
        expectedBefore: 1000,
        after: 1500,
        reason: "এই কাজের দেওয়া মোট",
      },
      at,
    );
    next = appendBalanceAdjustment(
      next,
      {
        target: "person",
        basis: "cost",
        personId: "worker",
        account: "labour",
        workId: "one",
        expectedBefore: 0,
        after: 300,
        reason: "এই কাজের খরচের মোট",
      },
      at,
    );
    expect(workLabourSummary(next, "one")).toMatchObject({
      valid: true,
      actualNetPaid: 1000,
      paidCorrection: 500,
      reconciledNetPaid: 1500,
    });
    expect(workLabourSummary(next, "two")).toMatchObject({
      actualNetPaid: 2000,
      paidCorrection: 0,
      reconciledNetPaid: 2000,
    });
    expect(next.entries.filter((entry) => entry.kind === "payment")).toEqual(
      ledger.entries,
    );
    const correction = next.entries.find(
      (entry) => entry.adjustment?.basis === "paid",
    )!;
    const cancelled = setEntryVoided(next, correction.id, true);
    expect(workLabourSummary(cancelled, "one")).toMatchObject({
      actualNetPaid: 1000,
      paidCorrection: 0,
      reconciledNetPaid: 1000,
    });
  });
  it("does not turn a balance-only correction into paid money", () => {
    const ledger = fixture([bill("earned", 3000), cash("paid", 1000)]);
    const next = appendBalanceAdjustment(
      ledger,
      {
        target: "person",
        basis: "balance",
        personId: "worker",
        account: "labour",
        workId: "one",
        expectedBefore: 2000,
        after: 1500,
        reason: "এই কাজের বাকি",
      },
      at,
    );
    expect(workLabourSummary(next, "one")).toMatchObject({
      actualNetPaid: 1000,
      reconciledNetPaid: 1000,
    });
  });
  it("does not present an unknown notebook as financial zero", () => {
    expect(workLabourSummary(fixture(), "missing")).toMatchObject({
      valid: false,
      actualNetPaid: null,
      reconciledNetPaid: null,
    });
  });
  it("keeps a safe boundary exact and rejects an overflowing input instead of rounding money", () => {
    const ledger = fixture([cash("maximum", Number.MAX_SAFE_INTEGER)]);
    expect(workLabourSummary(ledger, "one")).toMatchObject({
      valid: true,
      actualNetPaid: Number.MAX_SAFE_INTEGER,
      reconciledNetPaid: Number.MAX_SAFE_INTEGER,
    });
    const unsafe = {
      ...ledger,
      entries: [
        ...ledger.entries,
        {
          ...ledger.entries[0],
          id: "extra",
          paymentParts: [{ method: "cash" as const, amount: 1 }],
          allocations: [{ workId: "one", amount: 1 }],
        },
      ],
    };
    expect(LedgerSchema.safeParse(unsafe).success).toBe(false);
    expect(workLabourSummary(unsafe, "one")).toEqual({
      valid: false,
      actualRefunds: null,
      actualNetPaid: null,
      paidCorrection: null,
      reconciledNetPaid: null,
    });
  });
});
