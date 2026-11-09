import { describe, expect, it } from "vitest";
import { appendBalanceAdjustment } from "../../domain/balanceAdjustments";
import { personSummary } from "../../domain/ledger";
import {
  EntrySchema,
  LedgerSchema,
  type Entry,
  type Ledger,
} from "../../domain/model";
import { personLedgerSummary } from "./personLedgerTotals";
import {
  buildLedgerSearchIndex,
  selectLedgerSearch,
  type LedgerSearchFilters,
} from "./searchAnalytics";

const personId = "sample-worker";
const at = "2026-10-20T12:00:00.000Z";
const cash = (id: string, amount: number, extra: Partial<Entry> = {}) =>
  EntrySchema.parse({
    id,
    kind: "payment",
    personId,
    account: "labour",
    paymentContext: "settlement",
    date: "2026-10-10",
    note: "নমুনা লেনদেন",
    allocations: [{ workId: "one", amount }],
    paymentParts: [{ method: "cash", amount }],
    ...extra,
  });
const bill = (id: string, amount: number, extra: Partial<Entry> = {}) =>
  EntrySchema.parse({
    id,
    kind: "expense",
    personId,
    account: "labour",
    date: "2026-10-10",
    lines: [
      {
        id: `${id}-line`,
        workId: "one",
        label: "নমুনা কাজ",
        costType: "labour",
        amount,
      },
    ],
    ...extra,
  });
const fixture = (entries: Entry[] = []) =>
  LedgerSchema.parse({
    works: [
      { id: "one", name: "নমুনা ভিত্তি" },
      { id: "two", name: "নমুনা ছাদ" },
    ],
    people: [
      { id: personId, name: "নমুনা কর্মী", kind: "worker" },
      { id: "sample-other", name: "অন্য নমুনা কর্মী", kind: "worker" },
    ],
    entries,
  });
function read(ledger: Ledger, filters: LedgerSearchFilters = {}) {
  const selected = selectLedgerSearch(buildLedgerSearchIndex(ledger), {
    personId,
    ...filters,
  });
  return personLedgerSummary(ledger, selected.entries, {
    personId,
    workId: filters.workId,
  });
}
function correct(
  ledger: Ledger,
  basis: "paid" | "cost" | "balance",
  before: number,
  after: number,
  workId?: string,
) {
  return appendBalanceAdjustment(
    ledger,
    {
      target: "person",
      basis,
      personId,
      account: "labour",
      ...(workId ? { workId } : {}),
      expectedBefore: before,
      after,
      reason: "নমুনা মোট মিলিয়েছি",
    },
    at,
  );
}

describe("person ledger selected totals", () => {
  it("separates cash from linked bills and returns and agrees with the profile's paid total", () => {
    let ledger = fixture([
      bill("bill", 12000),
      cash("paid", 18000, { relatedEntryId: "bill" }),
      bill("return", 2000, { kind: "expense_credit", relatedEntryId: "bill" }),
      cash("refund", 1500, { kind: "refund" }),
    ]);
    ledger = correct(ledger, "paid", 16500, 16000);
    ledger = correct(ledger, "cost", 10000, 10800);
    ledger = correct(ledger, "balance", -5200, -5000);
    const before = JSON.stringify(ledger);
    const totals = read(ledger);
    expect(totals).toMatchObject({
      paid: 18000,
      refunds: 1500,
      paidCorrection: -500,
      netPaid: 16000,
      cashEntryCount: 2,
      paymentEntryCount: 1,
      refundEntryCount: 1,
      adjustmentEntryCount: 3,
      adjustmentCounts: { paid: 1, cost: 1, balance: 1 },
      adjustmentAmounts: { paid: -500, cost: 800, balance: 200 },
      unresolvedAdjustmentCount: 0,
    });
    expect(totals.netPaid).toBe(
      personSummary(ledger, personId).reconciledNetPaid,
    );
    expect(JSON.stringify(ledger)).toBe(before);
  });

  it("uses selected entries for search, kind, date and month rather than lifetime totals", () => {
    let ledger = fixture([
      cash("october", 6000),
      cash("november", 9000, { date: "2026-11-10", note: "নমুনা বিশেষ টাকা" }),
      cash("undated", 500, { date: null }),
      cash("other", 30000, { personId: "sample-other" }),
    ]);
    ledger = correct(ledger, "paid", 15500, 15000);
    expect(read(ledger, { month: "2026-10" })).toMatchObject({
      paid: 6000,
      paidCorrection: -500,
      netPaid: 5500,
    });
    expect(read(ledger, { month: "2026-11" })).toMatchObject({
      paid: 9000,
      paidCorrection: 0,
      netPaid: 9000,
    });
    expect(read(ledger, { month: "undated" })).toMatchObject({
      paid: 500,
      netPaid: 500,
    });
    expect(read(ledger, { query: "বিশেষ" })).toMatchObject({
      paid: 9000,
      cashEntryCount: 1,
      paidCorrection: 0,
    });
    expect(read(ledger, { kind: "adjustment" })).toMatchObject({
      paid: 0,
      paidCorrection: -500,
      netPaid: -500,
      adjustmentEntryCount: 1,
    });
    expect(read(ledger, { from: "2026-11-01" })).toMatchObject({
      paid: 9000,
      paidCorrection: 0,
    });
  });

  it("uses the selected work's allocations and never distributes workless person corrections", () => {
    let ledger = fixture([
      cash("split", 12000, {
        allocations: [
          { workId: "one", amount: 4000 },
          { workId: "two", amount: 8000 },
        ],
      }),
      cash("refund", 3000, {
        kind: "refund",
        allocations: [
          { workId: "one", amount: 1000 },
          { workId: "two", amount: 2000 },
        ],
      }),
    ]);
    ledger = correct(ledger, "paid", 9000, 8500);
    ledger = correct(ledger, "paid", 3000, 3200, "one");
    const result = read(ledger, { workId: "one" });
    expect(result).toMatchObject({
      paid: 4000,
      refunds: 1000,
      paidCorrection: 200,
      netPaid: 3200,
      cashEntryCount: 2,
      adjustmentEntryCount: 1,
    });
    expect(result.netPaid).toBe(
      personSummary(ledger, personId, "one").reconciledNetPaid,
    );
    expect(
      personLedgerSummary(ledger, ledger.entries, { personId, workId: "one" }),
    ).toEqual(result);
    expect(read(ledger, { workId: "two" })).toMatchObject({
      paid: 8000,
      refunds: 2000,
      paidCorrection: 0,
      netPaid: 6000,
    });
  });

  it("excludes voided and historical cash while retaining selected historical counts", () => {
    let ledger = fixture([
      cash("paid", 4000),
      cash("old-paid", 2000, { balanceImpact: "historical" }),
      cash("old-refund", 1000, { kind: "refund", balanceImpact: "historical" }),
      cash("void-paid", 5000, { voided: true }),
      cash("void-refund", 3000, { kind: "refund", voided: true }),
    ]);
    ledger = correct(ledger, "paid", 4000, 4500);
    ledger = LedgerSchema.parse({
      ...ledger,
      entries: ledger.entries.map((entry) =>
        entry.kind === "adjustment" ? { ...entry, voided: true } : entry,
      ),
    });
    expect(read(ledger, { includeVoided: true })).toMatchObject({
      paid: 4000,
      refunds: 0,
      netPaid: 4000,
      cashEntryCount: 1,
      historicalCashEntryCount: 2,
      adjustmentEntryCount: 0,
    });
    expect(
      read(ledger, { workId: "two", includeVoided: true })
        .historicalCashEntryCount,
    ).toBe(0);
  });

  it("keeps unresolved contract-balance corrections separate from known cash and paid corrections", () => {
    const ledger = LedgerSchema.parse({
      ...fixture(),
      contracts: [{ id: "sample-job", personId, workId: "one", total: 10000 }],
      entries: [
        cash("paid", 2000, { contractId: "sample-job" }),
        EntrySchema.parse({
          id: "old-correction",
          kind: "adjustment",
          personId,
          account: "labour",
          contractId: "sample-job",
          date: "2026-10-10",
          note: "নমুনা পুরোনো সমন্বয়",
          adjustment: {
            target: "person",
            basis: "balance",
            account: "labour",
            workId: "one",
            before: 8000,
            after: 7000,
            delta: -1000,
          },
        }),
      ],
    });
    const totals = read(ledger);
    expect(totals).toMatchObject({
      paid: 2000,
      paidCorrection: 0,
      netPaid: 2000,
      adjustmentCounts: { paid: 0, cost: 0, balance: 1 },
      adjustmentAmounts: { paid: 0, cost: 0, balance: null },
      unresolvedAdjustmentCount: 1,
    });
    expect(totals.netPaid).toBe(
      personSummary(ledger, personId).reconciledNetPaid,
    );
  });

  it("counts a matched entry once and reads values from the original ledger", () => {
    const ledger = fixture([
      cash("paid", 4000),
      cash("other", 9000, { personId: "sample-other" }),
    ]);
    const altered = {
      ...ledger.entries[0],
      allocations: [{ workId: "one", amount: 123 }],
    };
    expect(
      personLedgerSummary(ledger, [altered, altered, ledger.entries[1]], {
        personId,
      }),
    ).toMatchObject({ paid: 4000, cashEntryCount: 1 });
  });

  it("does not count empty, bill-only, material-only or cost-type selections as cash", () => {
    const ledger = fixture([bill("bill", 6000), cash("paid", 4000)]);
    expect(personLedgerSummary(ledger, [], { personId })).toMatchObject({
      paid: 0,
      refunds: 0,
      netPaid: 0,
      cashEntryCount: 0,
    });
    for (const filters of [
      { kind: "expense" },
      { costType: "labour" },
      { material: "missing" },
    ])
      expect(read(ledger, filters)).toMatchObject({
        paid: 0,
        paidCorrection: 0,
        netPaid: 0,
        cashEntryCount: 0,
      });
  });

  it("keeps refund-only totals signed and does not label them as a payment", () => {
    expect(
      read(fixture([cash("refund", 700, { kind: "refund" })])),
    ).toMatchObject({
      paid: 0,
      refunds: 700,
      netPaid: -700,
      cashEntryCount: 1,
      paymentEntryCount: 0,
      refundEntryCount: 1,
    });
  });

  it("sums correction deltas rather than their before and after snapshots", () => {
    let ledger = fixture([cash("paid", 5000)]);
    ledger = correct(ledger, "paid", 5000, 6000);
    ledger = correct(ledger, "paid", 6000, 5500);
    expect(read(ledger)).toMatchObject({
      paid: 5000,
      paidCorrection: 500,
      netPaid: 5500,
      adjustmentCounts: { paid: 2, cost: 0, balance: 0 },
    });
  });

  it("supports the exact integer boundary and rejects unsafe inputs and overflow", () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const base = fixture([cash("paid", 1)]);
    const boundary = { ...base, entries: [cash("paid", maximum)] };
    expect(
      personLedgerSummary(boundary, boundary.entries, { personId }).paid,
    ).toBe(maximum);
    for (const amount of [
      maximum + 1,
      0.5,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      const ledger = {
        ...base,
        entries: [
          { ...base.entries[0], allocations: [{ workId: "one", amount }] },
        ],
      };
      expect(() =>
        personLedgerSummary(ledger, ledger.entries, { personId }),
      ).toThrow("person_ledger_amount_out_of_range");
    }
    const overflow = {
      ...base,
      entries: [cash("large", maximum), cash("small", 1)],
    };
    expect(() =>
      personLedgerSummary(overflow, overflow.entries, { personId }),
    ).toThrow("person_ledger_amount_out_of_range");
    const corrected = correct(base, "paid", 1, 2);
    const netOverflow = {
      ...corrected,
      entries: [cash("paid", maximum), corrected.entries[1]],
    };
    expect(() =>
      personLedgerSummary(netOverflow, netOverflow.entries, { personId }),
    ).toThrow("person_ledger_amount_out_of_range");
  });
});
