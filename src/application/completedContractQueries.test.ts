import { expect, it } from "vitest";
import { LedgerSchema } from "../domain/model";
import { queryMcpLedger } from "./mcpQueries";

const fixture = (entries: unknown[] = []) =>
  LedgerSchema.parse({
    works: [{ id: "roof", name: "নমুনা ছাদ" }],
    people: [
      { id: "worker", name: "নমুনা কর্মী", kind: "worker" },
      { id: "shop", name: "নমুনা দোকান", kind: "shop" },
    ],
    contracts: [
      {
        id: "job",
        personId: "worker",
        workId: "roof",
        status: "done",
        total: 3500000,
      },
    ],
    entries,
  });

it("reports completed unpaid work in current earnings without inventing a period expense", () => {
  const result = queryMcpLedger(fixture(), "get_person_statement", {
    person_id: "worker",
    account: "labour",
  });
  expect(result.current).toMatchObject({
    cost_paisa: 0,
    paid_paisa: 0,
    reconciled_cost_paisa: 3500000,
    reconciled_payable_paisa: 3500000,
  });
  expect(result.period).toMatchObject({ cost_paisa: 0, paid_paisa: 0 });
  expect(result.items).toEqual([]);
});

it("keeps completed contract earnings out of unrelated account, person and contract views", () => {
  const ledger = fixture();
  for (const scope of [
    { account: "materials" },
    { account: "other" },
    { person_id: "shop" },
    { contract_id: "missing" },
  ])
    expect(queryMcpLedger(ledger, "get_summary", scope).current).toMatchObject({
      reconciled_cost_paisa: 0,
      reconciled_payable_paisa: 0,
    });
});

it("retains a hidden cancelled bill as evidence against reviving agreement earnings", () => {
  const ledger = fixture([
    {
      id: "cancelled",
      kind: "expense",
      personId: "worker",
      account: "labour",
      contractId: "job",
      voided: true,
      lines: [
        { id: "line", workId: "roof", amount: 10000, costType: "labour" },
      ],
    },
  ]);
  const result = queryMcpLedger(ledger, "get_person_statement", {
    person_id: "worker",
    account: "labour",
  });
  expect(result.current).toMatchObject({
    cost_paisa: 0,
    reconciled_cost_paisa: 0,
    reconciled_payable_paisa: 0,
  });
  expect(result.items).toEqual([]);
});
