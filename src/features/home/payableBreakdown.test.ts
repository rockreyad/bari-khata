import { describe, expect, it } from "vitest";
import {
  reconciledPayableGroups,
  reconciledTotals,
  type FinancialScope,
} from "../../domain/adjustmentMath";
import { appendBalanceAdjustment } from "../../domain/balanceAdjustments";
import { setEntityRemoved } from "../../domain/entityDeletion";
import { summarize } from "../../domain/ledger";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { payableBreakdown } from "./payableBreakdown";

const bill = (
  id: string,
  personId: string | null,
  amount: number,
  workId = "one",
) => ({
  id,
  kind: "expense",
  personId,
  lines: [{ id: `${id}-line`, workId, label: "মাল", amount }],
});

describe("scoped payable breakdown", () => {
  function readScoped(
    ledger: Ledger,
    scope: FinancialScope = { workId: "one" },
  ) {
    const before = structuredClone(ledger);
    const result = payableBreakdown(ledger, scope);
    expect(result.total).toBe(
      reconciledTotals(ledger, scope).reconciledPayable,
    );
    const rowTotal = result.rows.reduce(
      (sum, row) => sum + BigInt(row.amount),
      0n,
    );
    expect(rowTotal + BigInt(result.workBalanceCorrection ?? 0)).toBe(
      BigInt(result.total),
    );
    expect(
      result.rows.every(
        (row) => Number.isSafeInteger(row.amount) && row.amount > 0,
      ),
    ).toBe(true);
    expect(ledger).toEqual(before);
    return result;
  }

  it("identifies the creditor for 4400 taka without offsetting another notebook's advance", () => {
    const ledger = LedgerSchema.parse({
      ...base,
      entries: [
        bill("bill", "shop", 600000),
        payment("paid", "shop", 160000),
        payment("other-notebook-advance", "shop", 700000, "two"),
      ],
    });
    expect(payableBreakdown(ledger).total).toBe(0);
    expect(readScoped(ledger)).toEqual({
      total: 440000,
      rows: [
        {
          id: "shop",
          personId: "shop",
          entryId: null,
          amount: 440000,
          workIds: ["one"],
          wholeHouse: false,
        },
      ],
      workBalanceCorrection: 0,
    });
  });

  it("keeps anonymous settlements, goods returns and cash refunds attached to their original bill", () => {
    const ledger = LedgerSchema.parse({
      ...base,
      entries: [
        bill("unnamed", null, 600000),
        { ...payment("paid", null, 120000), relatedEntryId: "unnamed" },
        {
          ...bill("goods-return", null, 50000),
          kind: "expense_credit",
          relatedEntryId: "unnamed",
        },
        {
          ...payment("cash-refund", null, 10000),
          kind: "refund",
          relatedEntryId: "unnamed",
        },
        bill("other-notebook", null, 1000000, "two"),
        payment("unrelated-advance", null, 1000000),
      ],
    });
    expect(readScoped(ledger).rows).toEqual([
      {
        id: "anonymous:unnamed",
        personId: null,
        entryId: "unnamed",
        amount: 440000,
        workIds: ["one"],
        wholeHouse: false,
      },
    ]);
  });

  it("includes completed earned work without a bill and excludes ongoing promises", () => {
    const ledger = LedgerSchema.parse({
      ...base,
      contracts: [
        {
          id: "finished",
          personId: "worker",
          workId: "one",
          total: 600000,
          status: "done",
        },
        {
          id: "ongoing",
          personId: "house-worker",
          workId: "one",
          total: 1000000,
        },
      ],
      entries: [
        {
          ...payment("paid", "worker", 160000),
          account: "labour",
          contractId: "finished",
        },
      ],
    });
    expect(readScoped(ledger).rows).toEqual([
      {
        id: "worker",
        personId: "worker",
        entryId: null,
        amount: 440000,
        workIds: ["one"],
        wholeHouse: false,
      },
    ]);
    expect(readScoped(ledger, { workId: "two" }).total).toBe(0);
  });

  it("preserves separate contracts' advances and supports a signed person/account scope", () => {
    const ledger = advanceFixture();
    const secondBill = ledger.entries.find(
      (entry) => entry.id === "earned-second",
    )!;
    secondBill.lines[0].workId = "one";
    ledger.contracts.find((contract) => contract.id === "second")!.workId =
      "one";
    expect(readScoped(ledger).rows[0].amount).toBe(1000);
    expect(
      readScoped(ledger, {
        workId: "one",
        personId: "worker",
        account: "labour",
      }),
    ).toMatchObject({
      total: 500,
      rows: [{ personId: "worker", amount: 500 }],
      workBalanceCorrection: 0,
    });
    expect(
      reconciledPayableGroups(ledger, { workId: "one", contractId: "second" }),
    ).toEqual({
      total: 1000,
      groups: [{ party: "worker", account: "labour", amount: 1000 }],
    });
  });

  it("includes only the allocated bill portion of a house-wide job", () => {
    const ledger = LedgerSchema.parse({
      ...base,
      contracts: [
        {
          id: "house",
          personId: "worker",
          scope: "house",
          workId: null,
          total: 10000000,
        },
      ],
      entries: [
        {
          ...bill("house-bill", "worker", 600000),
          account: "labour",
          contractId: "house",
          lines: [
            {
              id: "one-line",
              workId: "one",
              amount: 600000,
              costType: "labour",
            },
            {
              id: "two-line",
              workId: "two",
              amount: 1000000,
              costType: "labour",
            },
          ],
        },
        {
          ...payment("paid", "worker", 160000),
          account: "labour",
          contractId: "house",
        },
      ],
    });
    expect(readScoped(ledger)).toMatchObject({
      total: 440000,
      rows: [
        {
          personId: "worker",
          amount: 440000,
          workIds: ["one"],
          wholeHouse: true,
        },
      ],
    });
  });

  it.each([
    [760000, 160000],
    [440000, -160000],
    [-100000, -600000],
  ])(
    "keeps an unassigned notebook balance of %s separate from every creditor",
    (after, applied) => {
      const original = LedgerSchema.parse({
        ...base,
        entries: [bill("bill", "shop", 600000)],
      });
      const ledger = appendBalanceAdjustment(original, {
        target: "work",
        basis: "balance",
        workId: "one",
        account: null,
        expectedBefore: 600000,
        after,
        reason: "খাতার মোট মিলিয়েছি",
      });
      expect(readScoped(ledger)).toMatchObject({
        total: Math.max(after, 0),
        rows: [{ personId: "shop", amount: 600000 }],
        workBalanceCorrection: applied,
      });
      expect(payableBreakdown(ledger)).toEqual(payableBreakdown(original));
    },
  );

  it("does not turn work-only paid/cost corrections into a person's debt", () => {
    let ledger = LedgerSchema.parse({
      ...base,
      entries: [bill("bill", "shop", 600000), payment("paid", "shop", 160000)],
    });
    ledger = appendBalanceAdjustment(ledger, {
      target: "work",
      basis: "cost",
      workId: "one",
      account: null,
      expectedBefore: 600000,
      after: 700000,
      reason: "খরচের মোট মিলিয়েছি",
    });
    ledger = appendBalanceAdjustment(ledger, {
      target: "work",
      basis: "paid",
      workId: "one",
      account: null,
      expectedBefore: 160000,
      after: 200000,
      reason: "দেওয়া টাকার মোট মিলিয়েছি",
    });
    expect(readScoped(ledger)).toMatchObject({
      total: 440000,
      rows: [{ personId: "shop", amount: 440000 }],
      workBalanceCorrection: 0,
    });
  });

  it("attributes a correction-only opening due to its named person and account", () => {
    const ledger = appendBalanceAdjustment(LedgerSchema.parse(base), {
      target: "person",
      basis: "balance",
      personId: "shop",
      account: "materials",
      workId: "one",
      expectedBefore: 0,
      after: 440000,
      reason: "নামের সঙ্গে আগের বাকি লিখেছি",
    });
    const scope = {
      personId: "shop",
      account: "materials" as const,
      workId: "one",
    };
    expect(reconciledPayableGroups(ledger, scope)).toEqual({
      total: 440000,
      groups: [{ party: "shop", account: "materials", amount: 440000 }],
    });
    expect(readScoped(ledger, scope)).toMatchObject({
      total: 440000,
      rows: [{ personId: "shop", amount: 440000 }],
      workBalanceCorrection: 0,
    });
  });

  it("retains archived creditors and omits voided/historical entries from both totals and context", () => {
    let ledger = LedgerSchema.parse({
      ...base,
      entries: [
        bill("current", "shop", 440000),
        { ...bill("cancelled", "shop", 500000, "two"), voided: true },
        { ...bill("old", "shop", 600000, "two"), balanceImpact: "historical" },
      ],
    });
    ledger = setEntityRemoved(ledger, "person", "shop", true);
    expect(readScoped(ledger).rows).toEqual([
      {
        id: "shop",
        personId: "shop",
        entryId: null,
        amount: 440000,
        workIds: ["one"],
        wholeHouse: false,
      },
    ]);
  });

  it("keeps an exact maximum-safe scoped sum and rejects overflowing aggregates", () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const ledger = LedgerSchema.parse({
      ...base,
      entries: [bill("large", "shop", maximum - 1), bill("small", null, 1)],
    });
    expect(readScoped(ledger).total).toBe(maximum);
    const overflowing = {
      ...ledger,
      entries: [
        ...ledger.entries,
        { ...ledger.entries[1], id: "extra", personId: "worker" },
      ],
    };
    expect(LedgerSchema.safeParse(overflowing).success).toBe(false);
    expect(() => payableBreakdown(overflowing, { workId: "one" })).toThrow(
      "balance_adjustment_out_of_range",
    );
  });
});
const payment = (
  id: string,
  personId: string | null,
  amount: number,
  workId = "one",
) => ({
  id,
  kind: "payment",
  personId,
  allocations: [{ workId, amount }],
  paymentParts: [{ amount }],
});
const base = {
  works: [
    { id: "one", name: "দরজা" },
    { id: "two", name: "ছাদ" },
  ],
  people: [
    { id: "shop", name: "দোকান", kind: "shop" },
    { id: "worker", name: "মিস্ত্রি", kind: "worker" },
    { id: "house-worker", name: "রাজমিস্ত্রি", kind: "worker" },
  ],
};
function read(ledger: Ledger) {
  const before = JSON.stringify(ledger);
  const result = payableBreakdown(ledger);
  expect(result.total).toBe(summarize(ledger).reconciledPayable);
  expect(result.rows.reduce((sum, row) => sum + BigInt(row.amount), 0n)).toBe(
    BigInt(result.total),
  );
  expect(result.rows.every((row) => row.amount > 0)).toBe(true);
  expect(JSON.stringify(ledger)).toBe(before);
  return result;
}
function advanceFixture() {
  return LedgerSchema.parse({
    ...base,
    contracts: [
      { id: "first", personId: "worker", workId: "one", total: 1000 },
      { id: "second", personId: "worker", workId: "two", total: 1000 },
    ],
    entries: [
      {
        ...bill("earned-first", "worker", 1000),
        account: "labour",
        contractId: "first",
        lines: [
          {
            id: "earned-first-line",
            workId: "one",
            amount: 1000,
            costType: "labour",
          },
        ],
      },
      {
        ...bill("earned-second", "worker", 1000, "two"),
        account: "labour",
        contractId: "second",
        lines: [
          {
            id: "earned-second-line",
            workId: "two",
            amount: 1000,
            costType: "labour",
          },
        ],
      },
      {
        ...payment("overpaid", "worker", 1500),
        account: "labour",
        contractId: "first",
      },
    ],
  });
}

describe("homepage payable breakdown", () => {
  it("includes named, anonymous, work-contract and whole-house earned bills once", () => {
    const ledger = LedgerSchema.parse({
      ...base,
      contracts: [
        { id: "work-job", personId: "worker", workId: "two", total: 5000 },
        {
          id: "house-job",
          personId: "house-worker",
          scope: "house",
          workId: null,
          total: 8000,
        },
      ],
      entries: [
        {
          ...bill("earned-work", "worker", 5000, "two"),
          account: "labour",
          contractId: "work-job",
          lines: [
            {
              id: "earned-work-line",
              workId: "two",
              amount: 5000,
              costType: "labour",
            },
          ],
        },
        {
          ...bill("earned-house", "house-worker", 8000),
          account: "labour",
          contractId: "house-job",
          lines: [
            {
              id: "earned-house-line",
              workId: "one",
              amount: 8000,
              costType: "labour",
            },
          ],
        },
        bill("shop-bill", "shop", 10000),
        payment("shop-paid", "shop", 4000),
        bill("anonymous-bill", null, 3000),
        {
          ...payment("anonymous-paid", null, 1000),
          relatedEntryId: "anonymous-bill",
        },
      ],
    });
    expect(read(ledger)).toEqual({
      total: 21000,
      rows: [
        {
          id: "house-worker",
          personId: "house-worker",
          entryId: null,
          amount: 8000,
          workIds: ["one"],
          wholeHouse: true,
        },
        {
          id: "shop",
          personId: "shop",
          entryId: null,
          amount: 6000,
          workIds: ["one"],
          wholeHouse: false,
        },
        {
          id: "worker",
          personId: "worker",
          entryId: null,
          amount: 5000,
          workIds: ["two"],
          wholeHouse: false,
        },
        {
          id: "anonymous:anonymous-bill",
          personId: null,
          entryId: "anonymous-bill",
          amount: 2000,
          workIds: ["one"],
          wholeHouse: false,
        },
      ],
    });
  });

  it("keeps an anonymous multi-work settlement together without offsetting an unrelated anonymous bill", () => {
    const ledger = LedgerSchema.parse({
      ...base,
      entries: [
        {
          ...bill("split", null, 1000),
          lines: [
            { id: "door-line", workId: "one", amount: 1000 },
            { id: "roof-line", workId: "two", amount: 1000 },
          ],
        },
        {
          ...payment("split-paid", null, 1500),
          relatedEntryId: "split",
        },
        bill("another-bill", null, 700),
        payment("unrelated-advance", null, 5000),
      ],
    });
    const result = read(ledger);
    expect(result.total).toBe(1200);
    expect(result.rows.map((row) => [row.entryId, row.amount])).toEqual([
      ["another-bill", 700],
      ["split", 500],
    ]);
    expect(result.rows[1].workIds).toEqual(["one", "two"]);
  });

  it("keeps linked anonymous material returns and cash refunds in the original bill's balance", () => {
    const ledger = LedgerSchema.parse({
      ...base,
      entries: [
        bill("bill", null, 1000),
        { ...payment("paid", null, 800), relatedEntryId: "bill" },
        {
          ...bill("returned-materials", null, 200),
          kind: "expense_credit",
          relatedEntryId: "bill",
        },
        {
          ...payment("cash-refund", null, 100),
          kind: "refund",
          relatedEntryId: "bill",
        },
      ],
    });
    expect(read(ledger)).toEqual({
      total: 100,
      rows: [
        {
          id: "anonymous:bill",
          personId: null,
          entryId: "bill",
          amount: 100,
          workIds: ["one"],
          wholeHouse: false,
        },
      ],
    });
  });

  it("keeps legacy driver transport bills and their linked payments in the effective other account", () => {
    const ledger = LedgerSchema.parse({
      ...base,
      people: [{ id: "driver", name: "ভ্যানচালক", kind: "driver" }],
      entries: [
        {
          ...bill("trip", "driver", 1000),
          lines: [
            {
              id: "trip-line",
              workId: "one",
              label: "ভাড়া",
              costType: "transport",
              amount: 1000,
            },
          ],
        },
        { ...payment("trip-paid", "driver", 400), relatedEntryId: "trip" },
        bill("materials", "driver", 500, "two"),
      ],
    });
    expect(reconciledPayableGroups(ledger).groups).toEqual([
      { party: "driver", account: "other", amount: 600 },
      { party: "driver", account: "materials", amount: 500 },
    ]);
    expect(read(ledger).rows).toEqual([
      {
        id: "driver",
        personId: "driver",
        entryId: null,
        amount: 1100,
        workIds: ["one", "two"],
        wholeHouse: false,
      },
    ]);
  });

  it("preserves a person's separate contract advance instead of subtracting it from another contract's due", () => {
    const ledger = advanceFixture();
    expect(read(ledger).rows).toEqual([
      {
        id: "worker",
        personId: "worker",
        entryId: null,
        amount: 1000,
        workIds: ["one", "two"],
        wholeHouse: false,
      },
    ]);
    expect(
      reconciledTotals(ledger, { personId: "worker", account: "labour" })
        .reconciledPayable,
    ).toBe(500);
  });

  it("uses an explicit person-wide correction pool and supports correction-only opening dues", () => {
    let ledger = appendBalanceAdjustment(advanceFixture(), {
      target: "person",
      basis: "paid",
      personId: "worker",
      account: "labour",
      expectedBefore: 1500,
      after: 1600,
      reason: "দেওয়া টাকার মোট মিলিয়েছি",
    });
    ledger = appendBalanceAdjustment(ledger, {
      target: "person",
      basis: "balance",
      personId: "shop",
      account: "materials",
      expectedBefore: 0,
      after: 3000,
      reason: "আগের খাতার বাকি",
    });
    expect(read(ledger).rows.map((row) => [row.personId, row.amount])).toEqual([
      ["shop", 3000],
      ["worker", 400],
    ]);
  });

  it("applies a contract-specific correction without consuming another contract's advance", () => {
    const ledger = appendBalanceAdjustment(advanceFixture(), {
      target: "person",
      basis: "balance",
      personId: "worker",
      account: "labour",
      contractId: "second",
      expectedBefore: 1000,
      after: 700,
      reason: "এই কাজের বাকি মিলিয়েছি",
    });
    const result = read(ledger);
    expect(result.total).toBe(700);
    expect(result.rows.map((row) => [row.personId, row.amount])).toEqual([
      ["worker", 700],
    ]);
  });

  it.each([
    ["balance", 600, 400],
    ["cost", 1000, 800],
    ["paid", 400, 600],
  ] as const)(
    "includes a person's %s correction once and leaves work-only corrections outside global dues",
    (basis, expectedBefore, after) => {
      let ledger = LedgerSchema.parse({
        ...base,
        entries: [bill("bill", "shop", 1000), payment("paid", "shop", 400)],
      });
      ledger = appendBalanceAdjustment(ledger, {
        target: "person",
        basis,
        personId: "shop",
        account: "materials",
        workId: "one",
        expectedBefore,
        after,
        reason: "দোকানের সঙ্গে মিলিয়েছি",
      });
      const beforeWorkCorrection = read(ledger);
      expect(beforeWorkCorrection.rows[0].amount).toBe(400);
      ledger = appendBalanceAdjustment(ledger, {
        target: "work",
        basis: "balance",
        account: null,
        workId: "one",
        expectedBefore: 400,
        after: 200,
        reason: "খাতার মোট মিলিয়েছি",
      });
      expect(read(ledger)).toEqual(beforeWorkCorrection);
    },
  );

  it("keeps archived earned dues while excluding historical and voided entries from amounts and context", () => {
    let ledger = LedgerSchema.parse({
      ...base,
      contracts: [
        { id: "job", personId: "worker", workId: "two", total: 1000 },
      ],
      entries: [
        {
          ...bill("earned", "worker", 1000, "two"),
          account: "labour",
          contractId: "job",
          lines: [
            {
              id: "earned-line",
              workId: "two",
              amount: 1000,
              costType: "labour",
            },
          ],
        },
        bill("current", "shop", 1000),
        { ...bill("old", "shop", 9000, "two"), balanceImpact: "historical" },
        { ...bill("cancelled", "shop", 7000, "two"), voided: true },
      ],
    });
    ledger = setEntityRemoved(ledger, "person", "worker", true);
    ledger = setEntityRemoved(ledger, "work", "two", true);
    ledger = setEntityRemoved(ledger, "contract", "job", true);
    const result = read(ledger);
    expect(result.total).toBe(2000);
    expect(result.rows.map((row) => [row.personId, row.workIds])).toEqual(
      expect.arrayContaining([
        ["shop", ["one"]],
        ["worker", ["two"]],
      ]),
    );
  });

  it("uses canonical groups if an imported person id also matches an anonymous party id", () => {
    const ledger = LedgerSchema.parse({
      ...base,
      people: [{ id: "anonymous:bill", name: "দোকান" }],
      entries: [
        bill("named", "anonymous:bill", 1000, "two"),
        bill("bill", null, 1000),
        { ...payment("paid", null, 1500), relatedEntryId: "bill" },
      ],
    });
    expect(read(ledger)).toEqual({
      total: 500,
      rows: [
        {
          id: "anonymous:bill",
          personId: "anonymous:bill",
          entryId: null,
          amount: 500,
          workIds: ["two", "one"],
          wholeHouse: false,
        },
      ],
    });
  });

  it("returns no rows for an empty ledger and preserves the reconciliation result shape", () => {
    const ledger = LedgerSchema.parse({});
    expect(read(ledger)).toEqual({ total: 0, rows: [] });
    expect(reconciledPayableGroups(ledger)).toEqual({ total: 0, groups: [] });
    expect(Object.keys(reconciledTotals(ledger))).not.toContain("groups");
    expect(Object.keys(reconciledTotals(ledger))).not.toContain("totals");
  });

  it("keeps an exact maximum-safe total when combining accounts and anonymous dues", () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const ledger = LedgerSchema.parse({
      ...base,
      entries: [
        bill("large", "shop", maximum - 2),
        { ...bill("other-account", "shop", 1, "two"), account: "other" },
        bill("anonymous", null, 1),
      ],
    });
    const result = read(ledger);
    expect(result.total).toBe(maximum);
    expect(result.rows.map((row) => row.amount)).toEqual([maximum - 1, 1]);
  });
});
