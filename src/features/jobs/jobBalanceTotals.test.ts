import { expect, it } from "vitest";
import { LedgerSchema } from "../../domain/model";
import { jobBalanceTotals } from "./jobView";

it("shows a worker's job balances separately rather than cancelling one job's overpayment against another job", () => {
  const ledger = LedgerSchema.parse({
    works: [
      { id: "bath", name: "বাথরুম" },
      { id: "electric", name: "বিদ্যুৎ" },
    ],
    people: [{ id: "worker", name: "মিস্ত্রি", kind: "worker" }],
    contracts: [
      { id: "bath-job", personId: "worker", workId: "bath", total: 100000 },
      {
        id: "electric-job",
        personId: "worker",
        workId: "electric",
        total: 200000,
      },
    ],
    entries: [
      {
        id: "a",
        kind: "payment",
        account: "labour",
        personId: "worker",
        contractId: "bath-job",
        allocations: [{ workId: "bath", amount: 120000 }],
        paymentParts: [{ amount: 120000 }],
      },
      {
        id: "b",
        kind: "payment",
        account: "labour",
        personId: "worker",
        contractId: "electric-job",
        allocations: [{ workId: "electric", amount: 50000 }],
        paymentParts: [{ amount: 50000 }],
      },
    ],
  });
  expect(jobBalanceTotals(ledger, ledger.contracts)).toEqual({
    remaining: 150000,
    extra: 20000,
    valid: true,
  });
});
