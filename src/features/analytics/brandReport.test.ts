import { describe, expect, it } from "vitest";
import { LedgerSchema } from "../../domain/model";
import {
  analyticsCsv,
  breakdownRows,
  buildCostReportIndex,
  costRows,
  filterCostRows,
  matchingEntries,
  selectCostReport,
  summarizeRows,
} from "./analytics";

function fixture() {
  const line = (id: string, itemId: string | null, amount: number) => ({
    id,
    workId: "roof",
    itemId,
    materialGroupId: itemId ? "panel" : null,
    label: itemId ? "প্যানেল" : "মাল ফেরত",
    amount,
    costType: "material",
  });
  const bill = (id: string, date: string, lines: unknown[], extra = {}) => ({
    id,
    kind: "expense",
    date,
    lines,
    ...extra,
  });
  return LedgerSchema.parse({
    works: [{ id: "roof", name: "নমুনা ছাদ" }],
    materialGroups: [{ id: "panel", name: "প্যানেল" }],
    items: [
      { id: "a", name: "প্যানেল", brand: "Nova", materialGroupId: "panel" },
      { id: "b", name: "প্যানেল", brand: "nova", materialGroupId: "panel" },
      {
        id: "plus-a",
        name: "প্যানেল",
        brand: "Nova +",
        materialGroupId: "panel",
      },
      {
        id: "plus-b",
        name: "প্যানেল",
        brand: "nova plus",
        materialGroupId: "panel",
      },
      {
        id: "other",
        name: "প্যানেল",
        brand: "Orion",
        materialGroupId: "panel",
      },
      { id: "missing", name: "প্যানেল", materialGroupId: "panel" },
    ],
    entries: [
      bill("january", "2026-01-02", [line("a-line", "a", 10000)]),
      bill("february", "2026-02-03", [line("b-line", "b", 20000)]),
      bill("specific-return", "2026-03-04", [line("returned", null, 1000)], {
        kind: "expense_credit",
        relatedEntryId: "january",
      }),
      bill("mixed-items", "2026-04-05", [
        line("mixed-a", "a", 1000),
        line("mixed-b", "b", 2000),
      ]),
      bill("unspecified-return", "2026-05-06", [line("uncertain", null, 500)], {
        kind: "expense_credit",
        relatedEntryId: "mixed-items",
      }),
      bill("plus-a-bill", "2026-06-07", [line("plus-a-line", "plus-a", 4000)]),
      bill("plus-b-bill", "2026-07-08", [line("plus-b-line", "plus-b", 5000)]),
      bill("other-bill", "2026-08-09", [line("other-line", "other", 6000)]),
      bill("missing-bill", "2026-09-10", [
        line("missing-line", "missing", 7000),
      ]),
      bill("cancelled", "2026-10-11", [line("void-line", "a", 99999)], {
        voided: true,
      }),
      {
        id: "settlement",
        kind: "payment",
        date: "2026-11-12",
        relatedEntryId: "january",
        allocations: [{ workId: "roof", amount: 10000 }],
        paymentParts: [{ amount: 10000 }],
      },
    ],
  });
}

describe("resolved brand report identity", () => {
  it("drills into the same recorded Bengali and English brand without rewriting CSV spellings", () => {
    const ledger = fixture();
    ledger.items[0].brand = "Crown";
    ledger.items[1].brand = "ক্রাউন";
    const before = JSON.stringify(ledger);
    const index = buildCostReportIndex(ledger);
    const identity = index.brands.resolve("Crown")!;
    expect(index.brands.resolve("ক্রাউন")?.id).toBe(identity.id);
    for (const brand of [identity.id, "Crown", "ক্রাউন"]) {
      const report = selectCostReport(index, { brand });
      expect(report.search.totalCost).toBe(32000);
      expect(breakdownRows(report.rows, "brand")).toMatchObject([
        { id: identity.id, label: identity.label, amount: 32000 },
      ]);
      const csv = analyticsCsv(report.rows, (text) => text);
      expect(csv).toContain(',"Crown",');
      expect(csv).toContain(',"ক্রাউন",');
    }
    expect(JSON.stringify(ledger)).toBe(before);
  });

  it("uses the same complete brand scope for cards, raw aliases, months, rows and CSV", () => {
    const ledger = fixture();
    const before = JSON.stringify(ledger);
    const index = buildCostReportIndex(ledger);
    const base = index.brands.resolve("Nova")!;
    const plus = index.brands.resolve("Nova +")!;
    expect(plus.id).not.toBe(base.id);
    const cards = breakdownRows(index.rows, "brand");
    expect(cards.find((row) => row.id === base.id)?.amount).toBe(32000);
    expect(cards.find((row) => row.id === plus.id)?.amount).toBe(9000);
    expect(cards.reduce((sum, row) => sum + row.amount, 0)).toBe(53500);
    for (const brand of [base.id, "Nova", "nova", "ＮＯＶＡ"]) {
      const report = selectCostReport(index, { brand });
      expect(report.search.totalCost).toBe(32000);
      expect(summarizeRows(report.rows).total).toBe(32000);
      expect(
        matchingEntries(report.rows).reduce((sum, row) => sum + row.amount, 0),
      ).toBe(32000);
      expect(
        report.search.monthlyRows.reduce((sum, row) => sum + row.total, 0),
      ).toBe(32000);
      expect(
        filterCostRows(index.rows, { brand }).map((row) => row.key),
      ).toEqual(report.rows.map((row) => row.key));
      const csv = analyticsCsv(report.rows, (text) => text);
      expect(
        csv
          .split("\r\n")
          .slice(1)
          .map((row) => row.split(",")[4].slice(1, -1)),
      ).toEqual(report.rows.map((row) => row.brand));
      expect(csv).toContain(',"Nova",');
      expect(csv).toContain(',"nova",');
      expect(
        report.rows.every((row) => row.brandResolver === index.brands),
      ).toBe(true);
    }
    const february = selectCostReport(
      index,
      { brand: base.id },
      { month: "2026-02" },
    );
    expect(february.search.totalCost).toBe(20000);
    expect(breakdownRows(february.rows, "brand")).toMatchObject([
      { id: base.id, label: base.label, amount: 20000 },
    ]);
    expect(
      selectCostReport(index, { brand: "not recorded anywhere" }).search
        .totalCost,
    ).toBe(0);
    expect(JSON.stringify(ledger)).toBe(before);
  });

  it("does not assign a group-only return to a brand even when its source brand spellings merge", () => {
    const index = buildCostReportIndex(fixture());
    const unknown = selectCostReport(index, { brand: "__unknown__" });
    expect(unknown.search.totalCost).toBe(6500);
    expect(unknown.rows.map((row) => row.entry.id)).toEqual([
      "unspecified-return",
      "missing-bill",
    ]);
    const base = selectCostReport(index, { brand: "Nova" });
    expect(base.rows.map((row) => row.entry.id)).not.toContain(
      "unspecified-return",
    );
    expect(base.search.ambiguousEntryIds).toContain("unspecified-return");
    expect(
      base.rows.find((row) => row.entry.id === "specific-return")?.amount,
    ).toBe(-1000);
    expect(selectCostReport(index, { itemId: "a" }).search.totalCost).toBe(
      10000,
    );
    expect(selectCostReport(index, { itemId: "b" }).search.totalCost).toBe(
      22000,
    );
  });

  it("retains canonical identity through filtered subsets and reordered ledger input", () => {
    const ledger = fixture();
    const rows = costRows(ledger);
    const subset = filterCostRows(rows, {
      from: "2026-02-01",
      to: "2026-02-28",
    });
    const original = breakdownRows(
      filterCostRows(rows, { brand: "Nova" }),
      "brand",
    )[0];
    expect(
      breakdownRows(filterCostRows(subset, { brand: "Nova" }), "brand"),
    ).toMatchObject([
      { id: original.id, label: original.label, amount: 20000 },
    ]);
    const reversed = costRows({
      ...ledger,
      items: [...ledger.items].reverse(),
      entries: [...ledger.entries].reverse(),
    });
    expect(breakdownRows(reversed, "brand")).toEqual(
      breakdownRows(rows, "brand"),
    );
  });
});
