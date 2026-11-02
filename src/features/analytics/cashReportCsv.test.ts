import { expect, it } from "vitest";
import { LedgerSchema } from "../../domain/model";
import { cashSummary } from "../../domain/cashSummary";
import { cashReportCsv } from "./cashReportCsv";
it("exports a real negative numeric refund so spreadsheet SUM matches the app while escaping free text", () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "w", name: " =HYPERLINK()" }],
    people: [{ id: "p", name: "+SUM(1)" }],
    entries: [
      {
        id: "paid",
        personId: "p",
        kind: "payment",
        allocations: [{ workId: "w", amount: 16200 }],
        paymentParts: [{ amount: 16200 }],
      },
      {
        id: "refund",
        personId: "p",
        kind: "refund",
        allocations: [{ workId: "w", amount: 100 }],
        paymentParts: [{ amount: 100 }],
      },
    ],
  });
  const result = cashSummary(ledger);
  const csv = cashReportCsv(ledger, result.rows, (text) => text);
  expect(csv).toContain('"-1"');
  expect(csv).not.toContain("'-1");
  expect(csv).toContain("'+SUM");
  expect(csv).toContain("'=HYPERLINK");
  const amounts = csv
    .split("\r\n")
    .slice(1)
    .map((row) => Number(row.split(",").at(-1)!.replaceAll('"', "")));
  expect(amounts.reduce((sum, value) => sum + value, 0) * 100).toBe(
    result.netPaid,
  );
});
