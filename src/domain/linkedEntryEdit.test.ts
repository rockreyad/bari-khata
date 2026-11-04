import { describe, expect, it } from "vitest";
import { LedgerSchema, type Ledger } from "./model";
import {
  entryTotal,
  personSummary,
  replaceEntry,
  replaceExpenseAndSettlements,
  summarize,
} from "./ledger";

function linkedEditFixture(): Ledger {
  const base = {
    personId: null,
    account: "materials",
    createdAt: "2026-11-01T08:00:00Z",
    updatedAt: "2026-11-01T08:00:00Z",
  };
  return LedgerSchema.parse({
    works: [
      { id: "general", name: "সাধারণ" },
      { id: "preparation", name: "নির্মাণ-পূর্ব কাজ" },
    ],
    people: [
      { id: "shop", name: "মিটারের দোকান", kind: "shop" },
      { id: "other-shop", name: "অন্য দোকান", kind: "shop" },
    ],
    entries: [
      {
        ...base,
        id: "bill",
        kind: "expense",
        date: "2026-11-01",
        lines: [
          {
            id: "meter-line",
            workId: "general",
            label: "পিডিবি মিটার",
            amount: 123456,
          },
        ],
      },
      {
        ...base,
        id: "paid",
        kind: "payment",
        relatedEntryId: "bill",
        date: "2026-11-02",
        allocations: [{ workId: "general", amount: 123456 }],
        paymentParts: [{ method: "cash", amount: 123456 }],
      },
      {
        ...base,
        id: "credit",
        kind: "expense_credit",
        relatedEntryId: "bill",
        date: "2026-11-03",
        lines: [
          { id: "credit-line", workId: "general", label: "ফেরত", amount: 3456 },
        ],
      },
      {
        ...base,
        id: "refund",
        kind: "refund",
        relatedEntryId: "bill",
        date: "2026-11-03",
        allocations: [{ workId: "general", amount: 3456 }],
        paymentParts: [{ method: "cash", amount: 3456 }],
      },
      {
        ...base,
        id: "cancelled-payment",
        kind: "payment",
        relatedEntryId: "bill",
        date: "2026-11-01",
        voided: true,
        allocations: [{ workId: "general", amount: 456 }],
        paymentParts: [{ method: "bank", amount: 456 }],
      },
      {
        ...base,
        id: "unrelated",
        kind: "expense",
        date: "2026-10-31",
        lines: [
          { id: "other-line", workId: "general", label: "চা", amount: 200 },
        ],
      },
    ],
  });
}

describe("linked expense corrections", () => {
  it("fills a missing shop on the bill and every linked settlement with an audit snapshot", () => {
    const original = linkedEditFixture();
    const before = structuredClone(original);
    const next = replaceExpenseAndSettlements(original, {
      ...original.entries[0],
      personId: "shop",
    });
    for (const entry of next.entries.slice(0, 5)) {
      const previous = original.entries.find((row) => row.id === entry.id)!;
      expect(entry.personId).toBe("shop");
      expect(entry.revisions).toHaveLength(1);
      expect(entry.revisions[0].before).toMatchObject({
        personId: null,
        date: previous.date,
      });
      expect(entry.date).toBe(previous.date);
      expect(entryTotal(entry)).toBe(entryTotal(previous));
      expect(entry.relatedEntryId).toBe(previous.relatedEntryId);
    }
    expect(next.entries[5]).toEqual(original.entries[5]);
    expect(next.entries.map((row) => row.id)).toEqual(
      original.entries.map((row) => row.id),
    );
    const { entries: _beforeEntries, ...beforeTotals } = summarize(original);
    const { entries: _afterEntries, ...afterTotals } = summarize(next);
    expect(afterTotals).toEqual(beforeTotals);
    expect(personSummary(next, "shop")).toMatchObject({
      cost: 120000,
      netPaid: 120000,
      payable: 0,
      advance: 0,
    });
    expect(original).toEqual(before);
  });

  it("moves a single-work bill with its settlements and preserves independent dates and money", () => {
    const original = linkedEditFixture();
    const next = replaceExpenseAndSettlements(original, {
      ...original.entries[0],
      lines: original.entries[0].lines.map((line) => ({
        ...line,
        workId: "preparation",
      })),
    });
    for (const entry of next.entries.slice(0, 5)) {
      expect(
        [...entry.lines, ...entry.allocations].every(
          (part) => part.workId === "preparation",
        ),
      ).toBe(true);
      expect(entry.revisions[0].before).toEqual(
        expect.objectContaining({ personId: null }),
      );
      expect(
        [
          ...entry.revisions[0].before.lines,
          ...entry.revisions[0].before.allocations,
        ].every((part) => part.workId === "general"),
      ).toBe(true);
    }
    expect(
      next.entries.map((entry) => [entry.id, entry.date, entryTotal(entry)]),
    ).toEqual(
      original.entries.map((entry) => [
        entry.id,
        entry.date,
        entryTotal(entry),
      ]),
    );
    expect(summarize(next, "preparation")).toMatchObject({
      cost: 120000,
      netPaid: 120000,
      payable: 0,
      advance: 0,
    });
    expect(summarize(next, "general")).toMatchObject({ cost: 200, netPaid: 0 });
  });

  it("keeps the paid amount and payment date when only the bill price or date changes", () => {
    const original = linkedEditFixture();
    const next = replaceExpenseAndSettlements(original, {
      ...original.entries[0],
      date: "2026-10-30",
      lines: [{ ...original.entries[0].lines[0], amount: 133456 }],
    });
    expect(next.entries[0].date).toBe("2026-10-30");
    expect(next.entries.slice(1)).toEqual(original.entries.slice(1));
    expect(summarize(next).payable).toBe(summarize(original).payable + 10000);
  });

  it("keeps ordinary callers from silently changing linked identities", () => {
    const original = linkedEditFixture();
    expect(() =>
      replaceEntry(original, { ...original.entries[0], personId: "shop" }),
    ).toThrow("Linked payment");
    const named = replaceExpenseAndSettlements(original, {
      ...original.entries[0],
      personId: "shop",
    });
    expect(() =>
      replaceExpenseAndSettlements(named, {
        ...named.entries[0],
        personId: "other-shop",
      }),
    ).toThrow("Linked payment");
    expect(() =>
      replaceExpenseAndSettlements(named, {
        ...named.entries[0],
        account: "other",
      }),
    ).toThrow("Linked payment");
  });

  it("rejects an ambiguous work split without changing the current ledger", () => {
    const original = linkedEditFixture();
    const before = structuredClone(original);
    expect(() =>
      replaceExpenseAndSettlements(original, {
        ...original.entries[0],
        lines: [
          { ...original.entries[0].lines[0], amount: 100000 },
          {
            ...original.entries[0].lines[0],
            id: "second-line",
            workId: "preparation",
            amount: 23456,
          },
        ],
      }),
    ).toThrow("Linked payment");
    expect(original).toEqual(before);
  });
});
