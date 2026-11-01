import { describe, expect, it } from "vitest";
import { importWallet, sourceAmount, type WalletGrid } from "./importWallet";
import { EntrySchema, LedgerSchema } from "./model";
import { appendEntries, personSummary, summarize } from "./ledger";

function grid(): WalletGrid {
  return {
    "Home Construstion.html": {
      checksum: "a".repeat(64),
      cells: {
        B7: "একটি দল",
        F7: "Bricks",
        J7: "Sand",
        N7: "Cement",
        R7: "Electric",
        V7: "Others",
        F100: "Steel",
        J100: "Sanitary",
        N100: "Door",
        F120: "একজন মিস্ত্রি",
        J120: "Bathroom (same worker)",
        N120: "Electric (same worker)",
        R120: "Grill (another worker)",
        B8: "2/14/2026",
        C8: "4 KG Guna",
        D8: "500৳",
        C9: "4 Jon, Guna",
        D9: "700৳",
        B9: "2/30/2026",
        K8: "Plaster balu 1",
        L8: "100৳",
        K9: "Bitbalu Lebar",
        L9: "20৳",
        K10: "Dhalai 1, Plaster 1",
        L10: "150৳",
        N8: "2",
        O8: "Bag Crown",
        P8: "200৳",
        O9: "100 Bag Unload",
        P9: "10৳",
        O10: "10 Bag Crown Unload",
        P10: "5৳",
        G101: "100KG",
        H101: "1000৳",
        O104: "Clam Steel perak",
        P104: "40৳",
        J121: "3/1/2026",
        K121: "Pipe fitting",
        L121: "30৳",
        N121: "3/1/2026",
        O121: "Technisian",
        P121: "40৳",
        G148: "Adjustment",
        H148: "-10৳",
        W53: "Adjustment",
        X53: "10৳",
        D111: "1200৳",
      },
    },
    "TOTAL HOME COST.html": { checksum: "b".repeat(64), cells: { F3: "1৳" } },
  };
}

describe("historical wallet import", () => {
  it("imports independent side by side ledgers without borrowing dates or quantities", () => {
    const { ledger, rows, report } = importWallet(grid());
    expect(rows).toHaveLength(14);
    expect(
      ledger.entries.find((entry) => entry.source?.cell === "L8")?.date,
    ).toBe(null);
    expect(
      ledger.entries.find((entry) => entry.source?.cell === "P8")?.date,
    ).toBe(null);
    expect(
      ledger.entries.find((entry) => entry.source?.cell === "P8")?.lines[0]
        .quantity,
    ).toBe("2");
    expect(
      ledger.entries.find((entry) => entry.source?.cell === "D8")?.date,
    ).toBe("2026-02-14");
    expect(report.invalidDates).toEqual([{ cell: "B9", rawDate: "2/30/2026" }]);
    expect(rows.some((row) => row.cell === "D111")).toBe(false);
    expect(report.unmappedMoneyCells).toEqual([]);
  });

  it("preserves mixed notes unsplit and material groups across unrelated works", () => {
    const { ledger } = importWallet(grid());
    const line = (cell: string) =>
      ledger.entries.find((entry) => entry.source?.cell === cell)!.lines[0];
    expect(line("D8").materialGroupId).toBe("steel");
    expect(line("H101").materialGroupId).toBe("steel");
    expect(line("P104").materialGroupId).toBe("steel");
    expect(line("D9")).toMatchObject({
      amount: 70000,
      materialGroupId: null,
      itemId: null,
      costType: "other",
    });
    expect(line("L10")).toMatchObject({
      amount: 15000,
      materialGroupId: "sand",
      usage: "",
      itemId: null,
    });
    expect(line("L9")).toMatchObject({
      materialGroupId: "sand",
      usage: "ভরাট",
      costType: "labour",
    });
    expect(line("P9")).toMatchObject({
      materialGroupId: "cement",
      itemId: null,
      costType: "unload",
    });
    expect(line("P10")).toMatchObject({
      materialGroupId: "cement",
      itemId: "cement-crown",
      costType: "unload",
    });
  });

  it("keeps signed recorded spend out of current payables, advances and cash", () => {
    const { ledger, report } = importWallet(grid());
    const totals = summarize(ledger);
    expect(totals.cost).toBe(report.historicalRecordedCost);
    expect(totals.historicalCost).toBe(totals.cost);
    expect(totals.confirmedCost).toBe(0);
    expect([
      totals.payable,
      totals.advance,
      totals.paid,
      totals.refunds,
    ]).toEqual([0, 0, 0, 0]);
    expect(totals.unreviewedCount).toBe(14);
    expect(
      ledger.entries.find((entry) => entry.source?.cell === "H148")?.kind,
    ).toBe("expense_credit");
    const person = ledger.entries.find(
      (entry) => entry.source?.cell === "D8",
    )!.personId!;
    expect(personSummary(ledger, person)).toMatchObject({
      cost: 120000,
      historicalCost: 120000,
      payable: 0,
      advance: 0,
    });
    const withCurrent = appendEntries(ledger, [
      EntrySchema.parse({
        id: "new-bill",
        kind: "expense",
        personId: person,
        lines: [{ id: "new-line", workId: "wallet-structure", amount: 20000 }],
      }),
    ]);
    expect(summarize(withCurrent)).toMatchObject({
      payable: 20000,
      confirmedCost: 20000,
    });
    expect(personSummary(withCurrent, person)).toMatchObject({
      cost: 140000,
      historicalCost: 120000,
      confirmedCost: 20000,
      payable: 20000,
    });
  });

  it("deduplicates repeated imports and keeps reviewed edits without overwriting", () => {
    const initial = importWallet(grid());
    const repeated = importWallet(grid(), initial.ledger);
    expect(repeated.ledger).toEqual(initial.ledger);
    expect(repeated.report.importedCount).toBe(0);
    const edited = LedgerSchema.parse({
      ...initial.ledger,
      entries: initial.ledger.entries.map((entry, index) =>
        index === 0
          ? { ...entry, note: "নিজে যাচাই করেছি", reviewStatus: "confirmed" }
          : entry,
      ),
    });
    expect(importWallet(grid(), edited).ledger.entries[0].note).toBe(
      "নিজে যাচাই করেছি",
    );
    const changed = grid();
    changed["Home Construstion.html"].checksum = "c".repeat(64);
    expect(() => importWallet(changed, initial.ledger)).toThrow(
      "Source changed",
    );
  });

  it("connects one named worker across separate original ledgers", () => {
    const { ledger } = importWallet(grid());
    expect(
      ledger.entries.find((entry) => entry.source?.cell === "L121")?.personId,
    ).toBe(
      ledger.entries.find((entry) => entry.source?.cell === "P121")?.personId,
    );
    expect(
      ledger.people.filter((person) => person.name === "same worker"),
    ).toHaveLength(1);
  });

  it("uses exact integer poisha and validates additive fields on old data", () => {
    expect(sourceAmount("-1,234.50৳")).toBe(-123450);
    expect(() => sourceAmount("1,000 nonsense")).toThrow();
    const old = LedgerSchema.parse({ entries: [] });
    expect(old.materialGroups).toEqual([]);
    const entry = EntrySchema.parse({
      id: "old",
      kind: "expense",
      lines: [{ id: "line", workId: "work", amount: 1 }],
    });
    expect(entry).toMatchObject({
      balanceImpact: "normal",
      reviewStatus: "confirmed",
      source: null,
    });
    expect(entry.lines[0]).toMatchObject({ materialGroupId: null, usage: "" });
  });
});
