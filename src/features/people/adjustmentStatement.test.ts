import { describe, expect, it } from "vitest";
import { LedgerSchema } from "../../domain/model";
import { cashSummary } from "../../domain/cashSummary";
import { costRows, summarizeRows, analyticsCsv } from "../analytics/analytics";
import { cashReportCsv } from "../analytics/cashReportCsv";
import { buildCsv } from "../../lib/display";
import { contactStatement, statementHtml } from "./statement";
import { reportAdjustments } from "../analytics/reportAdjustments";
const fixture = () =>
  LedgerSchema.parse({
    works: [{ id: "work", name: "পরীক্ষার খাতা" }],
    people: [{ id: "person", name: "পরীক্ষার নাম", kind: "shop" }],
    entries: [
      {
        id: "bill",
        kind: "expense",
        personId: "person",
        date: "2026-11-01",
        lines: [
          { id: "line", workId: "work", label: "মালের বিল", amount: 700000 },
        ],
      },
      {
        id: "paid",
        kind: "payment",
        personId: "person",
        date: "2026-11-02",
        paymentParts: [{ method: "cash", amount: 200000 }],
        allocations: [{ workId: "work", amount: 200000 }],
      },
      {
        id: "adjust",
        kind: "adjustment",
        personId: "person",
        date: "2026-11-03",
        note: "পুরোনো অঙ্ক মিলিয়েছি",
        adjustment: {
          target: "person",
          basis: "balance",
          account: "materials",
          before: 500000,
          after: 100000,
          delta: -400000,
          workId: "work",
        },
      },
    ],
  });
const format = {
  t: (value: string) => value,
  money: (value: number) => `৳${value / 100}`,
  date: (value: string | null) => value ?? "",
};
describe("noncash adjustment statement and report adapters", () => {
  it.each([
    ["paid", 200000, 300000, 400000, 700000, 300000],
    ["cost", 700000, 800000, 600000, 800000, 200000],
    ["balance", 500000, 600000, 600000, 700000, 200000],
  ] as const)(
    "keeps the %s metric correction distinct from actual cash and expense rows",
    (basis, before, after, payable, cost, paid) => {
      const base = fixture();
      const ledger = LedgerSchema.parse({
        ...base,
        entries: [
          ...base.entries.slice(0, 2),
          {
            ...base.entries[2],
            adjustment: {
              target: "person",
              basis,
              account: "materials",
              before,
              after,
              delta: after - before,
              workId: "work",
            },
          },
        ],
      });
      const statement = contactStatement(ledger, ledger.people[0], {
        workId: "work",
      });
      expect(statement.rows[2]).toMatchObject({
        charge: 0,
        paid: 0,
        adjustment: 100000,
        adjustmentBasis: basis,
        balance: payable,
      });
      expect(statement.totals).toMatchObject({
        cost: 700000,
        paid: 200000,
        reconciledCost: cost,
        reconciledNetPaid: paid,
        reconciledPayable: payable,
      });
      expect(cashSummary(ledger).netPaid).toBe(200000);
      expect(summarizeRows(costRows(ledger)).total).toBe(700000);
    },
  );
  it("does not copy a notebook-only paid correction into a named person's statement or reports", () => {
    const base = fixture();
    const ledger = LedgerSchema.parse({
      ...base,
      entries: [
        ...base.entries.slice(0, 2),
        {
          ...base.entries[2],
          personId: null,
          account: "other",
          adjustment: {
            target: "work",
            basis: "paid",
            account: null,
            before: 200000,
            after: 300000,
            delta: 100000,
            workId: "work",
          },
        },
      ],
    });
    const statement = contactStatement(ledger, ledger.people[0]);
    expect(statement.rows).toHaveLength(2);
    expect(statement.totals.reconciledNetPaid).toBe(200000);
    expect(
      reportAdjustments(ledger, { personId: "person" }).paidCorrection,
    ).toBe(0);
    expect(reportAdjustments(ledger, { workId: "work" }).paidCorrection).toBe(
      100000,
    );
    expect(
      reportAdjustments(ledger, { account: "materials" }).paidCorrection,
    ).toBe(0);
  });
  it("changes only the running balance and payable while preserving actual bills and paid totals", () => {
    const ledger = fixture();
    const statement = contactStatement(ledger, ledger.people[0], {
      workId: "work",
    });
    expect(statement.rows.map((row) => row.balance)).toEqual([
      700000, 500000, 100000,
    ]);
    expect(statement.rows[2]).toMatchObject({
      kind: "adjustment",
      charge: 0,
      paid: 0,
      adjustment: -400000,
      works: "পরীক্ষার খাতা",
    });
    expect(statement.totals).toMatchObject({
      cost: 700000,
      paid: 200000,
      payable: 500000,
      reconciledPayable: 100000,
      advance: 0,
      adjustment: -400000,
    });
    const html = statementHtml(statement, format);
    expect(html).toContain("সমন্বয়");
    expect(html).toContain("৳-4000");
  });
  it("excludes adjustments from pure cash and cost reports while ledger CSV labels the signed adjustment explicitly", () => {
    const ledger = fixture();
    const cash = cashSummary(ledger);
    const costs = costRows(ledger);
    expect(cash.netPaid).toBe(200000);
    expect(cash.rows.map((row) => row.entry.id)).toEqual(["paid"]);
    expect(summarizeRows(costs).total).toBe(700000);
    expect(cashReportCsv(ledger, cash.rows, format.t)).not.toContain("সমন্বয়");
    expect(analyticsCsv(costs, format.t)).not.toContain("পুরোনো অঙ্ক মিলিয়েছি");
    const csv = buildCsv(ledger, [ledger.entries[2]], format.t, "work");
    expect(csv).toContain("সমন্বয়");
    expect(csv).toContain("-4000");
    expect(csv).not.toContain("টাকা দিয়েছি");
    expect(csv).not.toContain("মাল কিনেছি");
  });
});
