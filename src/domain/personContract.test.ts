import { describe, it, expect } from "vitest";
import { LedgerSchema, PersonSchema } from "./model";
import { savePersonWithContract } from "./personContract";
import { summarize } from "./ledger";
describe("optional contact agreement", () => {
  it("saves worker and fixed wage atomically without booking a cost or payment", () => {
    const ledger = LedgerSchema.parse({
      works: [{ id: "plaster", name: "প্লাস্টার" }],
    });
    const next = savePersonWithContract(
      ledger,
      PersonSchema.parse({ id: "shah", name: "শাহ আলম", kind: "worker" }),
      { id: "agreement", workId: "plaster", amount: "৬০০০০০" },
    );
    expect(next.people).toHaveLength(1);
    expect(next.contracts[0]).toMatchObject({
      personId: "shah",
      total: 60000000,
      basis: "fixed",
      workId: "plaster",
    });
    expect(summarize(next)).toMatchObject({ cost: 0, paid: 0 });
    expect(ledger.people).toHaveLength(0);
  });
  it("creates no agreement unless explicitly supplied", () => {
    const ledger = LedgerSchema.parse({ works: [{ id: "work", name: "কাজ" }] });
    const shop = PersonSchema.parse({ id: "s", name: "দোকান", kind: "shop" });
    expect(savePersonWithContract(ledger, shop).contracts).toHaveLength(0);
    expect(
      savePersonWithContract(ledger, shop, {
        id: "c",
        workId: "work",
        amount: "10",
      }).contracts[0],
    ).toMatchObject({ personId: "s", total: 1000 });
    expect(ledger.people).toHaveLength(0);
  });

  it.each(["worker", "shop", "driver", "other"] as const)(
    "keeps an explicitly agreed responsibility separate from cost and payment for %s",
    (kind) => {
      const ledger = LedgerSchema.parse({
        works: [{ id: "work", name: "নমুনা কাজ" }],
        people: [
          { id: "person", name: "নমুনা ব্যক্তি", kind, role: "নমুনা পরিচয়" },
        ],
        entries: [
          {
            id: "old-material",
            kind: "expense",
            personId: "person",
            lines: [
              {
                id: "old-line",
                workId: "work",
                amount: 12000,
                costType: "material",
              },
            ],
          },
        ],
      });
      const person = PersonSchema.parse({
        ...ledger.people[0],
        role: "নমুনা নতুন পরিচয়",
      });
      const next = savePersonWithContract(ledger, person, {
        id: "agreement",
        scope: "house",
        amount: "450",
      });
      expect(next.contracts[0]).toMatchObject({
        personId: "person",
        scope: "house",
        workId: null,
        total: 45000,
      });
      expect(next.entries).toEqual(ledger.entries);
      expect(summarize(next)).toMatchObject({ cost: 12000, paid: 0 });
      expect(next.people[0]).toMatchObject({ kind, role: "নমুনা নতুন পরিচয়" });
    },
  );

  it("rejects invalid or removed agreement dependencies without changing the original ledger", () => {
    const at = "2026-11-04T08:00:00.000Z";
    const ledger = LedgerSchema.parse({
      works: [
        { id: "work", name: "নমুনা কাজ" },
        {
          id: "removed",
          name: "নমুনা সরানো কাজ",
          archivedAt: at,
          removalHistory: [{ id: "remove-work", at, archived: true }],
        },
      ],
    });
    const person = PersonSchema.parse({
      id: "person",
      name: "নমুনা ব্যক্তি",
      kind: "shop",
    });
    const before = JSON.stringify(ledger);
    for (const contract of [
      { id: "unknown-work", workId: "missing", amount: "450" },
      { id: "removed-work", workId: "removed", amount: "450" },
      { id: "zero", workId: "work", amount: "0" },
    ])
      expect(() => savePersonWithContract(ledger, person, contract)).toThrow(
        "contract",
      );
    expect(() =>
      savePersonWithContract(
        ledger,
        {
          ...person,
          archivedAt: at,
          removalHistory: [{ id: "remove-person", at, archived: true }],
        },
        { id: "removed-person", workId: "work", amount: "450" },
      ),
    ).toThrow("contract");
    const archivedLedger = LedgerSchema.parse({
      ...ledger,
      people: [
        {
          ...person,
          archivedAt: at,
          removalHistory: [{ id: "previously-removed", at, archived: true }],
        },
      ],
    });
    expect(() =>
      savePersonWithContract(archivedLedger, person, {
        id: "cannot-implicitly-restore",
        workId: "work",
        amount: "450",
      }),
    ).toThrow("contract");
    expect(JSON.stringify(ledger)).toBe(before);
  });
});
