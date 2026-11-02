import { describe, expect, it } from "vitest";
import type { Ledger } from "./model";
import { mixedLedger } from "./testing/mixedNumericLedger";
import {
  contractSummary,
  entryWorkAmount,
  personSummary,
  summarize,
  workSummary,
} from "./ledger";
import { contactAccountSummary } from "./contacts";
import {
  costRows,
  filterCostRows,
  summarizeRows,
} from "../features/analytics/analytics";
import { contactStatement } from "../features/people/statement";
import { monthlySpending } from "../components/ui/monthlySpending";

const paisa = (taka: number) => taka * 100;

const costTotal = (ledger: Ledger, workId?: string) =>
  summarizeRows(filterCostRows(costRows(ledger), { workId })).total;
const chartTotal = (ledger: Ledger, workId?: string) =>
  monthlySpending(ledger, { workId }).reduce((sum, row) => sum + row.total, 0);

describe.each(["English", "Bengali"] as const)(
  "%s homeowner entries across totals",
  (script) => {
    it("keeps booked cost, paid cash, refunds, outstanding bills and advances distinct", () => {
      const ledger = mixedLedger(script);
      const before = JSON.stringify(ledger);
      expect(summarize(ledger)).toMatchObject({
        cost: paisa(143200),
        paid: paisa(90200),
        refunds: paisa(1000),
        netPaid: paisa(89200),
        payable: paisa(90000),
        advance: paisa(36000),
        byType: {
          material: paisa(127000),
          labour: paisa(16000),
          transport: paisa(200),
        },
      });
      expect(workSummary(ledger, "door")).toMatchObject({
        cost: paisa(117200),
        paid: paisa(83700),
        refunds: paisa(1000),
        netPaid: paisa(82700),
        payable: paisa(65500),
        advance: paisa(31000),
      });
      expect(workSummary(ledger, "roof")).toMatchObject({
        cost: paisa(26000),
        paid: paisa(6500),
        refunds: 0,
        netPaid: paisa(6500),
        payable: paisa(24500),
        advance: paisa(5000),
      });
      const split = ledger.entries.find(
        (entry) => entry.id === "split-payment",
      )!;
      expect(entryWorkAmount(split, "door")).toBe(paisa(500));
      expect(entryWorkAmount(split, "roof")).toBe(paisa(1500));
      expect(contractSummary(ledger, "mason-contract")).toMatchObject({
        agreed: paisa(600000),
        billed: 0,
        paid: paisa(30000),
        remaining: paisa(570000),
        payable: 0,
        advance: paisa(30000),
      });
      expect(
        ledger.entries
          .flatMap((entry) => entry.lines)
          .every((line) => line.quantity === "8" || !line.quantity),
      ).toBe(true);
      expect(JSON.stringify(ledger)).toBe(before);
    });

    it("agrees between work and contact balances and the copy each contact receives", () => {
      const ledger = mixedLedger(script);
      const expected = [
        ["shop", 117000, 32000, 85000, 0],
        ["worker", 16000, 11000, 5000, 0],
        ["mason", 0, 30000, 0, 30000],
        ["driver", 200, 200, 0, 0],
        ["return-shop", 10000, 11000, 0, 1000],
        ["advance-shop", 0, 5000, 0, 5000],
      ] as const;
      for (const [id, cost, netPaid, payable, advance] of expected) {
        const person = ledger.people.find((row) => row.id === id)!;
        const totals = {
          cost: paisa(cost),
          netPaid: paisa(netPaid),
          payable: paisa(payable),
          advance: paisa(advance),
        };
        expect(personSummary(ledger, id)).toMatchObject(totals);
        expect(contactAccountSummary(ledger, person)).toMatchObject(totals);
        const statement = contactStatement(ledger, person);
        expect(statement.totals).toMatchObject({
          cost: totals.cost,
          paid: totals.netPaid,
          payable: totals.payable,
          advance: totals.advance,
        });
        expect(statement.rows.reduce((sum, row) => sum + row.charge, 0)).toBe(
          totals.cost,
        );
        expect(statement.rows.reduce((sum, row) => sum + row.paid, 0)).toBe(
          totals.netPaid,
        );
      }
      const shop = ledger.people.find((person) => person.id === "shop")!;
      for (const [workId, cost, paid, due] of [
        ["door", 91000, 30500, 60500],
        ["roof", 26000, 1500, 24500],
      ] as const) {
        expect(contactStatement(ledger, shop, { workId }).totals).toMatchObject(
          {
            cost: paisa(cost),
            paid: paisa(paid),
            payable: paisa(due),
            advance: 0,
          },
        );
      }
    });

    it("reports and monthly charts count bills once, apply returns once and omit cash-only or void entries", () => {
      const ledger = mixedLedger(script);
      const before = JSON.stringify(ledger);
      for (const [workId, expected] of [
        [undefined, 143200],
        ["door", 117200],
        ["roof", 26000],
      ] as const) {
        expect(costTotal(ledger, workId)).toBe(paisa(expected));
        expect(chartTotal(ledger, workId)).toBe(paisa(expected));
      }
      expect(monthlySpending(ledger).filter((row) => row.total)).toEqual([
        {
          month: "2026-09",
          material: paisa(120000),
          labour: paisa(16000),
          other: paisa(200),
          total: paisa(136200),
        },
        {
          month: "2026-10",
          material: paisa(7000),
          labour: 0,
          other: 0,
          total: paisa(7000),
        },
      ]);
      expect(monthlySpending(ledger).at(-1)?.month).toBe("2026-10");
      for (const personId of ["mason", "advance-shop"]) {
        expect(
          summarizeRows(filterCostRows(costRows(ledger), { personId })).total,
        ).toBe(0);
        expect(monthlySpending(ledger, { personId })).toEqual([]);
      }
      expect(
        costRows(ledger).some(
          (row) =>
            row.entry.voided ||
            row.entry.kind === "payment" ||
            row.entry.kind === "refund",
        ),
      ).toBe(false);
      expect(JSON.stringify(ledger)).toBe(before);
    });
  },
);

it("persists identical canonical amounts and quantities regardless of the entry digit script", () => {
  const numericRecords = (ledger: Ledger) => ({
    contracts: ledger.contracts,
    entries: ledger.entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      account: entry.account,
      personId: entry.personId,
      contractId: entry.contractId,
      lines: entry.lines,
      allocations: entry.allocations,
      paymentParts: entry.paymentParts,
    })),
  });
  expect(numericRecords(mixedLedger("Bengali"))).toEqual(
    numericRecords(mixedLedger("English")),
  );
});
