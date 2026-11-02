import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { LedgerDatabase } from "../data/database";
import { LedgerRepository } from "../data/repository";
import {
  buildQuickEntry,
  QuickDraftSchema,
} from "../features/entries/quickEntry";
import { createEmptyLedger } from "./demo";
import { entryTotal, summarize } from "./ledger";
import { LedgerSchema } from "./model";

function base() {
  return LedgerSchema.parse({
    works: [{ id: "home", name: "বাড়ির কাজ" }],
    people: [{ id: "shop", name: "Golam", kind: "shop" }],
  });
}
function oldEnglishLedger(kind: "expense" | "payment") {
  return LedgerSchema.parse({
    ...base(),
    entries: [
      {
        id: "che",
        kind: "expense",
        date: "2026-11-02",
        lines: [{ id: "che-line", workId: "home", label: "che", amount: 100 }],
      },
      kind === "expense"
        ? {
            id: "golam",
            kind,
            date: "2026-11-01",
            personId: "shop",
            lines: [
              {
                id: "golam-line",
                workId: "home",
                label: "Golam",
                amount: 16200,
              },
            ],
          }
        : {
            id: "golam",
            kind,
            date: "2026-11-01",
            personId: "shop",
            allocations: [{ workId: "home", amount: 16200 }],
            paymentParts: [{ method: "cash", amount: 16200 }],
          },
    ],
  });
}

describe("numeric storage and the homeowner's totals", () => {
  it("counts two actual expenses of 1 and 162 as 163, irrespective of English labels or older dates", () => {
    const ledger = oldEnglishLedger("expense");
    expect(ledger.entries.map(entryTotal)).toEqual([100, 16200]);
    expect(summarize(ledger)).toMatchObject({
      cost: 16300,
      paid: 0,
      byType: { material: 16300, labour: 0 },
    });
  });

  it("keeps a payment of 162 separate from a cost of 1 rather than assuming both history rows are expenses", () => {
    const ledger = oldEnglishLedger("payment");
    expect(summarize(ledger)).toMatchObject({
      cost: 100,
      paid: 16200,
      netPaid: 16200,
      advance: 16200,
      byType: { material: 100, labour: 0 },
    });
    expect(ledger.entries.map(entryTotal)).toEqual([100, 16200]);
  });

  it("stores the same integer paisa from English and Bengali typed monetary values", () => {
    const result = (amount: string, paid: string) =>
      buildQuickEntry(
        base(),
        QuickDraftSchema.parse({
          id: "bill",
          paymentId: "bill-payment",
          workId: "home",
          personId: "shop",
          date: "2026-11-02",
          payment: "partial",
          paid,
          rows: [
            {
              id: "line",
              label: "Rod 16 mm",
              quantity: "8",
              unit: "টি",
              amount,
            },
          ],
        }),
      );
    const english = result("162.25", "62.25");
    const bengali = result("১৬২.২৫", "৬২.২৫");
    for (const ledger of [english, bengali]) {
      expect(ledger.entries.map(entryTotal)).toEqual([16225, 6225]);
      expect(summarize(ledger)).toMatchObject({
        cost: 16225,
        paid: 6225,
        payable: 10000,
      });
      expect(typeof ledger.entries[0].lines[0].amount).toBe("number");
      expect(typeof ledger.entries[1].paymentParts[0].amount).toBe("number");
    }
    expect(english.entries[0].lines).toEqual(bengali.entries[0].lines);
  });

  it("reopens and restores older numeric amounts exactly without treating stored paisa as newly typed taka", async () => {
    const original = oldEnglishLedger("expense");
    const database = new LedgerDatabase(
      `numeric-integrity-${crypto.randomUUID()}`,
    );
    const restoredDatabase = new LedgerDatabase(
      `numeric-integrity-restore-${crypto.randomUUID()}`,
    );
    try {
      const repository = new LedgerRepository(database);
      await repository.ensure("real", original);
      database.close();
      await database.open();
      const reopened = (await repository.read("real"))!.ledger;
      expect(reopened.entries.map(entryTotal)).toEqual([100, 16200]);
      const backup = await repository.exportBackup("real");
      const payload = JSON.parse(backup);
      expect(payload.ledger.entries[1].lines[0].amount).toBe(16200);
      expect(typeof payload.ledger.entries[1].lines[0].amount).toBe("number");
      const restored = new LedgerRepository(restoredDatabase);
      await restored.ensure("real", createEmptyLedger());
      await restored.importBackup(backup, { replace: true });
      const ledger = (await restored.read("real"))!.ledger;
      expect(ledger).toEqual(original);
      expect(summarize(ledger).cost).toBe(16300);
      for (const formattedAmount of ["16200", "১৬২০০"]) {
        const corrupt = JSON.parse(backup);
        corrupt.ledger.entries[1].lines[0].amount = formattedAmount;
        await expect(
          restored.importBackup(JSON.stringify(corrupt), { replace: true }),
        ).rejects.toThrow();
        expect((await restored.read("real"))!.ledger).toEqual(original);
      }
    } finally {
      await database.delete();
      await restoredDatabase.delete();
    }
  });
});
