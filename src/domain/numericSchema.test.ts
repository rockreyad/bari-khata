import { expect, it } from "vitest";
import { EntrySchema, LedgerSchema } from "./model";

it("normalizes typed numeric text at the schema boundary without rewriting financial amounts or free text", () => {
  const input = {
    people: [
      { id: "worker-১৬", name: "মিস্ত্রি ১৬", phone: "+৮৮০১৭১২-345৬৭৮" },
    ],
    works: [{ id: "door", name: "দরজা ৮" }],
    contracts: [
      {
        id: "contract",
        workId: "door",
        personId: "worker-১৬",
        quantity: "৫৭০০",
        rate: 2200,
        total: 12540000,
        notes: "পুরোনো কথা ১২৩",
      },
    ],
    entries: [
      {
        id: "old-১২",
        kind: "expense",
        lines: [
          {
            id: "line",
            workId: "door",
            label: "৮টি দরজা",
            quantity: "৮.৫",
            amount: 16225,
          },
        ],
        note: "বিল ১২৩",
      },
    ],
  };
  const ledger = LedgerSchema.parse(input);
  expect(ledger.people[0]).toMatchObject({
    id: "worker-১৬",
    name: "মিস্ত্রি ১৬",
    phone: "+8801712-345678",
  });
  expect(ledger.contracts[0]).toMatchObject({
    quantity: "5700",
    rate: 2200,
    total: 12540000,
    notes: "পুরোনো কথা ১২৩",
  });
  expect(ledger.entries[0]).toMatchObject({
    id: "old-১২",
    note: "বিল ১২৩",
    lines: [{ label: "৮টি দরজা", quantity: "8.5", amount: 16225 }],
  });
  expect(input.entries[0].lines[0].quantity).toBe("৮.৫");
  expect(LedgerSchema.parse(ledger)).toEqual(ledger);
  expect(JSON.parse(JSON.stringify(ledger)).entries[0].lines[0].amount).toBe(
    16225,
  );
});

it("applies the same quantity contract to old revision snapshots", () => {
  const entry = EntrySchema.parse({
    id: "entry",
    kind: "expense",
    lines: [{ id: "line", workId: "work", quantity: "২", amount: 200 }],
    revisions: [
      {
        at: "2026-11-02T00:00:00Z",
        before: {
          id: "entry",
          kind: "expense",
          lines: [{ id: "line", workId: "work", quantity: "১", amount: 100 }],
        },
      },
    ],
  });
  expect(entry.lines[0].quantity).toBe("2");
  expect(entry.revisions[0].before.lines[0]).toMatchObject({
    quantity: "1",
    amount: 100,
  });
});
