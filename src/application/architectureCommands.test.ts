import { expect, it } from "vitest";
import { LedgerSchema } from "../domain/model";
import { summarize } from "../domain/ledger";
import { applyMcpCommand } from "./mcpCommands";
import { queryMcpLedger } from "./mcpQueries";

const context = {
  now: "2026-11-05T00:00:00.000Z",
  actor: { connectionId: "test", name: "নমুনা সহকারী" },
};
const fixture = () =>
  LedgerSchema.parse({
    architectureVersion: 2,
    milestones: [],
    paymentAllocations: [],
    works: [{ id: "work", name: "নমুনা কাজ" }],
    people: [
      { id: "party", name: "নমুনা ব্যক্তি", roles: ["supplier", "transport"] },
    ],
    contracts: [
      { id: "contract", personId: "party", workId: "work", total: 1000 },
    ],
    entries: ["first", "second"].map((id) => ({
      id,
      kind: "expense",
      personId: "party",
      lines: [{ id: `${id}-line`, workId: "work", amount: 500 }],
    })),
  });

it("allocates an earlier advance to multiple bills without adding cost or cash", () => {
  const paid = applyMcpCommand(
    fixture(),
    {
      type: "record_advance",
      person_id: "party",
      work_id: "work",
      account: "materials",
      date: "2026-11-05",
      amount_paisa: 700,
      method: "cash",
    },
    context,
  );
  const payment = paid.ledger.entries.at(-1)!;
  expect(payment.paymentContext).toBe("advance");
  const allocated = applyMcpCommand(
    paid.ledger,
    {
      type: "allocate_payment",
      payment_id: payment.id,
      reason: "দুটি বিলের টাকা মেলানো",
      allocations: [
        { bill_id: "first", amount_paisa: 400 },
        { bill_id: "second", amount_paisa: 300 },
      ],
    },
    context,
  );
  expect(allocated.requiredScopes).toEqual(["entries:update"]);
  expect(allocated.amountPaisa).toBe(700);
  expect(allocated.ledger.entries).toEqual(paid.ledger.entries);
  expect(summarize(allocated.ledger)).toMatchObject({ cost: 1000, paid: 700 });
  const report = queryMcpLedger(allocated.ledger, "get_person_statement", {
    person_id: "party",
  });
  expect(report).toMatchObject({
    bill_settlements: {
      allocated: 700,
      billOutstanding: 300,
      explicitAdvance: 0,
    },
    payment_allocations: expect.any(Array),
  });
  expect(() =>
    applyMcpCommand(
      allocated.ledger,
      {
        type: "allocate_payment",
        payment_id: payment.id,
        reason: "বাড়তি টাকা",
        allocations: [{ bill_id: "first", amount_paisa: 1 }],
      },
      context,
    ),
  ).toThrow();
  const cancelled = applyMcpCommand(
    allocated.ledger,
    {
      type: "cancel_payment_allocation",
      allocation_id: allocated.ledger.paymentAllocations![0].id,
      reason: "ভুল বিল বেছে নিয়েছিলাম",
    },
    context,
  );
  expect(cancelled.requiredScopes).toEqual(["entries:update"]);
  expect(cancelled.ledger.entries).toEqual(paid.ledger.entries);
  expect(cancelled.ledger.paymentAllocations![0]).toMatchObject({
    cancelledAt: context.now,
    cancellationReason: "ভুল বিল বেছে নিয়েছিলাম",
  });
  expect(
    queryMcpLedger(cancelled.ledger, "get_person_statement", {
      person_id: "party",
    }),
  ).toMatchObject({
    bill_settlements: { allocated: 300, explicitAdvance: 400 },
  });
});

it("keeps history when changing roles and records optional milestone bills separately", () => {
  const original = fixture();
  const changed = applyMcpCommand(
    original,
    {
      type: "update_person",
      person_id: "party",
      reason: "পরিচয় যোগ",
      changes: {
        roles: ["professional", "supplier"],
        identity_type: "organization",
      },
    },
    context,
  );
  expect(changed.ledger.entries).toEqual(original.entries);
  expect(changed.ledger.people[0]).toMatchObject({
    id: "party",
    roles: ["professional", "supplier"],
    identityType: "organization",
  });
  const milestone = applyMcpCommand(
    changed.ledger,
    {
      type: "create_milestone",
      contract_id: "contract",
      title: "প্রথম ধাপ",
      amount_paisa: 400,
    },
    context,
  );
  expect(milestone.requiredScopes).toEqual(["contracts:write"]);
  expect(summarize(milestone.ledger).cost).toBe(1000);
  const wage = applyMcpCommand(
    milestone.ledger,
    {
      type: "record_wage",
      person_id: "party",
      work_id: "work",
      contract_id: "contract",
      milestone_id: milestone.affectedIds[0],
      date: "2026-11-05",
      amount_paisa: 400,
      payment_state: "partial",
      payment: { amount_paisa: 100, method: "cash" },
    },
    context,
  );
  expect(wage.ledger.entries.at(-2)).toMatchObject({
    kind: "expense",
    milestoneId: milestone.affectedIds[0],
  });
  expect(summarize(wage.ledger)).toMatchObject({ cost: 1400, paid: 100 });
});
