import { describe, expect, it } from "vitest";
import { appendBalanceAdjustment } from "../../domain/balanceAdjustments";
import { EntrySchema, LedgerSchema, type Ledger } from "../../domain/model";
import {
  buildLedgerSearchIndex,
  materialSuggestions,
  selectLedgerSearch,
} from "./searchAnalytics";

const context = {
  works: [
    { id: "one", name: "নমুনা ভিত্তি" },
    { id: "two", name: "নমুনা ছাদ" },
  ],
  people: [{ id: "shop", name: "নমুনা দোকান", kind: "shop" }],
  materialGroups: [
    { id: "sand", name: "বালু" },
    { id: "cement", name: "সিমেন্ট", aliases: ["Cement"] },
  ],
  items: [
    { id: "sand-item", name: "ভরাটের বালু", materialGroupId: "sand" },
    {
      id: "cement-item",
      name: "সিমেন্ট",
      brand: "নমুনা Crown",
      materialGroupId: "cement",
    },
  ],
};
const line = (
  id: string,
  label: string,
  amount: number,
  workId = "one",
  itemId: string | null = null,
) => ({ id, workId, itemId, label, amount });
function fixture(entries: unknown[] = []) {
  return LedgerSchema.parse({ ...context, entries });
}
const bill = (
  id: string,
  lines: unknown[],
  date: string | null = "2026-01-15",
  note = "",
) => ({ id, kind: "expense", personId: "shop", date, note, lines });
const read = (
  ledger: Ledger,
  filters: Parameters<typeof selectLedgerSearch>[1] = {},
) => selectLedgerSearch(buildLedgerSearchIndex(ledger), filters);

describe("ledger search costs", () => {
  it("sums matching lines across the complete result set while preserving original mixed bills", () => {
    const ledger = fixture([
      bill("mixed", [
        line("sand", "বালু", 100000, "one", "sand-item"),
        line("cement", "সিমেন্ট", 900000, "one", "cement-item"),
        line("roof", "বালু", 20000, "two", "sand-item"),
      ]),
    ]);
    const result = read(ledger, { query: "বালু" });
    expect(result.totalCost).toBe(120000);
    expect(result.amounts.mixed).toBe(120000);
    expect(result.matchedLineCount).toBe(2);
    expect(result.matchedPartEntryIds).toEqual(["mixed"]);
    expect(result.entries[0]).toBe(ledger.entries[0]);
    expect(result.entries[0].lines).toHaveLength(3);
    expect(read(ledger, { query: "বালু", workId: "one" }).amounts.mixed).toBe(
      100000,
    );
    expect(read(ledger, { query: "বালু", workId: "two" }).totalCost).toBe(
      20000,
    );
  });

  it("subtracts goods returns once without counting settlement, advance or cash refunds as cost", () => {
    const ledger = fixture([
      bill("bill", [line("sand", "বালু", 100000, "one", "sand-item")]),
      {
        ...bill(
          "return",
          [line("returned", "মাল ফেরত", 20000, "one", "sand-item")],
          "2026-03-01",
        ),
        kind: "expense_credit",
        relatedEntryId: "bill",
      },
      {
        id: "payment",
        kind: "payment",
        personId: "shop",
        note: "বালু",
        date: "2026-02-01",
        relatedEntryId: "bill",
        allocations: [{ workId: "one", amount: 100000 }],
        paymentParts: [{ amount: 100000 }],
      },
      {
        id: "advance",
        kind: "payment",
        personId: "shop",
        note: "বালু",
        date: "2026-02-01",
        allocations: [{ workId: "one", amount: 50000 }],
        paymentParts: [{ amount: 50000 }],
      },
      {
        id: "refund",
        kind: "refund",
        personId: "shop",
        note: "বালু",
        date: "2026-03-01",
        allocations: [{ workId: "one", amount: 20000 }],
        paymentParts: [{ amount: 20000 }],
      },
    ]);
    const result = read(ledger, { query: "বালু" });
    expect(result.entries).toHaveLength(5);
    expect(result).toMatchObject({
      totalCost: 80000,
      purchases: 100000,
      returns: 20000,
      costEntryCount: 2,
    });
    expect(result.amounts.return).toBe(-20000);
    expect(result.amounts.payment).toBeUndefined();
    expect(
      result.monthlyRows.map(({ month, total }) => [month, total]),
    ).toEqual([
      ["2026-01", 100000],
      ["2026-03", -20000],
    ]);
  });

  it("retains note-only and cross-line discoveries without assigning their full bills to a material", () => {
    const ledger = fixture([
      bill(
        "note-only",
        [line("cement", "সিমেন্ট", 900000, "one", "cement-item")],
        "2026-01-15",
        "বালুর পাশে রাখা হয়েছে",
      ),
      bill("cross-line", [
        line("sand", "বালু", 100000, "one", "sand-item"),
        line("cement", "সিমেন্ট", 900000, "one", "cement-item"),
      ]),
    ]);
    const note = read(ledger, { query: "বালু" });
    expect(note.totalCost).toBe(100000);
    expect(note.entries).toHaveLength(2);
    expect(note.ambiguousEntryIds).toEqual(["note-only"]);
    expect(note.amounts["note-only"]).toBeUndefined();
    const collision = read(ledger, { query: "বালু Crown" });
    expect(collision.entries.map((entry) => entry.id)).toEqual([
      "note-only",
      "cross-line",
    ]);
    expect(collision.totalCost).toBe(0);
    expect(collision.ambiguousEntryCount).toBe(2);
    expect(collision.monthlyRows).toEqual([]);
  });

  it("uses person/work context within each line and never borrows a sibling line's work", () => {
    const ledger = fixture([
      bill("bill", [
        line("sand", "বালু", 100000, "one", "sand-item"),
        line("cement", "সিমেন্ট", 900000, "two", "cement-item"),
      ]),
    ]);
    expect(read(ledger, { query: "দোকান ছাদ" }).totalCost).toBe(900000);
    const mismatch = read(ledger, { query: "বালু ছাদ" });
    expect(mismatch.entries).toHaveLength(1);
    expect(mismatch.totalCost).toBe(0);
    expect(mismatch.ambiguousEntryIds).toEqual(["bill"]);
    expect(read(ledger, { query: "দোকান", workId: "one" }).totalCost).toBe(
      100000,
    );
  });

  it("keeps all 65 results in totals independently of list pagination or sort order", () => {
    const ledger = fixture(
      Array.from({ length: 65 }, (_, index) =>
        bill(`bill-${index}`, [
          line(`line-${index}`, "বালু", 100, "one", "sand-item"),
        ]),
      ),
    );
    const result = read(ledger, { query: "বালু" });
    expect(result.entries).toHaveLength(65);
    expect(result.totalCost).toBe(6500);
    expect(result.costEntryCount).toBe(65);
  });

  it("prioritizes material identity over a matching person's or sector's name", () => {
    const ledger = LedgerSchema.parse({
      ...context,
      works: [
        { id: "one", name: "বালুর কাজ" },
        { id: "two", name: "নমুনা ছাদ" },
      ],
      people: [{ id: "shop", name: "বালু দোকান", kind: "shop" }],
      entries: [
        bill("mixed", [
          line("sand", "বালু", 100000, "one", "sand-item"),
          line("cement", "সিমেন্ট", 900000, "one", "cement-item"),
          line("roof-cement", "সিমেন্ট", 20000, "two", "cement-item"),
        ]),
      ],
    });
    expect(read(ledger, { query: "বালু" }).totalCost).toBe(100000);
    expect(read(ledger, { query: "বালুর কাজ" }).totalCost).toBe(1000000);
    expect(read(ledger, { query: "ছাদ" }).totalCost).toBe(20000);
    expect(read(ledger, { personId: "shop" }).totalCost).toBe(1020000);
  });

  it("uses catalog names for projected rows whose saved line label is blank", () => {
    const ledger = fixture([
      bill("blank", [line("blank-line", "", 100000, "one", "sand-item")]),
    ]);
    expect(read(ledger, { query: "বালু" }).titles.blank).toBe("ভরাটের বালু");
  });

  it("treats an exact numeric bill-total query as whole-bill context while respecting line scopes", () => {
    const ledger = fixture([
      bill("mixed", [
        line("sand", "বালু", 40000, "one", "sand-item"),
        line("cement", "সিমেন্ট", 60000, "two", "cement-item"),
      ]),
      bill(
        "number-in-note",
        [line("other", "সিমেন্ট", 900000, "one", "cement-item")],
        "2026-01-15",
        "আগের নোট 1000",
      ),
    ]);
    for (const query of ["1000", "১০০০", "1000.00"]) {
      expect(read(ledger, { query }).totalCost).toBe(100000);
      const scoped = read(ledger, { query, workId: "one" });
      expect(scoped.totalCost).toBe(40000);
      expect(scoped.amounts.mixed).toBe(40000);
      expect(scoped.ambiguousEntryIds).not.toContain("mixed");
      expect(scoped.amounts["number-in-note"]).toBeUndefined();
    }
  });

  it("excludes voided money even when cancelled records are requested for discovery", () => {
    const ledger = fixture([
      bill("active", [line("active-line", "বালু", 100000, "one", "sand-item")]),
      {
        ...bill("cancelled", [
          line("cancelled-line", "বালু", 900000, "one", "sand-item"),
        ]),
        voided: true,
      },
    ]);
    expect(read(ledger, { query: "বালু" }).entries).toHaveLength(1);
    const result = read(ledger, { query: "বালু", includeVoided: true });
    expect(result.entries).toHaveLength(2);
    expect(result.totalCost).toBe(100000);
    expect(result.costEntryCount).toBe(1);
    expect(result.monthlyRows[0].total).toBe(100000);
  });

  it("retains historical/review costs and keeps undated money outside months without inventing a date", () => {
    const ledger = fixture([
      bill("dated", [line("dated-line", "বালু", 100000, "one", "sand-item")]),
      {
        ...bill(
          "old",
          [line("old-line", "বালু", 30000, "one", "sand-item")],
          "2026-02-15",
        ),
        balanceImpact: "historical",
        reviewStatus: "needs_review",
      },
      {
        ...bill(
          "undated",
          [line("undated-line", "বালু", 20000, "one", "sand-item")],
          null,
        ),
        createdAt: "2026-03-01T00:00:00.000Z",
      },
    ]);
    const result = read(ledger, { query: "বালু" });
    expect(result).toMatchObject({
      totalCost: 150000,
      undatedCost: 20000,
      undatedEntryCount: 1,
      historicalCost: 30000,
      historicalEntryCount: 1,
      reviewCost: 30000,
      reviewEntryCount: 1,
    });
    expect(result.monthlyRows.map((row) => row.month)).toEqual([
      "2026-01",
      "2026-02",
    ]);
    expect(read(ledger, { query: "বালু", from: "2026-02-01" })).toMatchObject({
      totalCost: 30000,
      undatedCost: 0,
    });
    const month = read(ledger, { query: "বালু", month: "2026-01" });
    expect(month).toMatchObject({
      totalCost: 100000,
      undatedCost: 0,
      baseUndatedCost: 20000,
      baseUndatedEntryCount: 1,
    });
    expect(month.monthlyRows).toEqual(result.monthlyRows);
    expect(month.entries.map((entry) => entry.id)).toEqual(["dated"]);
    const undated = read(ledger, { query: "বালু", month: "undated" });
    expect(undated).toMatchObject({ totalCost: 20000, undatedCost: 20000 });
    expect(undated.monthlyRows).toEqual(result.monthlyRows);
  });

  it("preserves observed months with a zero net total and does not fill long empty gaps", () => {
    const ledger = fixture([
      bill(
        "old",
        [line("old-line", "বালু", 100000, "one", "sand-item")],
        "2000-01-01",
      ),
      {
        ...bill(
          "return",
          [line("return-line", "বালু", 100000, "one", "sand-item")],
          "2000-01-02",
        ),
        kind: "expense_credit",
      },
      bill(
        "recent",
        [line("recent-line", "বালু", 20000, "one", "sand-item")],
        "2026-11-01",
      ),
    ]);
    const result = read(ledger, { query: "বালু" });
    expect(
      result.monthlyRows.map(({ month, total }) => [month, total]),
    ).toEqual([
      ["2000-01", 0],
      ["2026-11", 20000],
    ]);
    expect(
      read(ledger, { query: "বালু", month: "2000-01" }).entries,
    ).toHaveLength(2);
  });

  it("applies account, kind, type, person and date constraints to both rows and totals", () => {
    const ledger = fixture([
      bill("material", [line("sand", "বালু", 100000, "one", "sand-item")]),
      {
        ...bill(
          "labour",
          [
            {
              ...line("labour-line", "বালু নামানো", 20000),
              costType: "unload",
              materialGroupId: "sand",
            },
          ],
          "2026-02-01",
        ),
        account: "other",
      },
    ]);
    expect(read(ledger, { material: "group:sand" }).totalCost).toBe(120000);
    const result = read(ledger, {
      material: "group:sand",
      personId: "shop",
      account: "other",
      kind: "expense",
      costType: "unload",
      workId: "one",
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(result.totalCost).toBe(20000);
    expect(result.entries.map((entry) => entry.id)).toEqual(["labour"]);
    expect(result.monthlyRows[0]).toMatchObject({
      material: 0,
      labour: 0,
      other: 20000,
    });
    expect(read(ledger, { personId: "unknown" }).entries).toEqual([]);
  });

  it("keeps general adjustments discoverable while never allocating their amounts to a material", () => {
    let ledger = fixture([
      bill("bill", [line("sand", "বালু", 100000, "one", "sand-item")]),
    ]);
    ledger = appendBalanceAdjustment(ledger, {
      target: "work",
      basis: "cost",
      account: null,
      workId: "one",
      expectedBefore: 100000,
      after: 150000,
      reason: "বালুর খাতার মোট মিলিয়েছি",
    });
    const result = read(ledger, { query: "বালু" });
    expect(result.totalCost).toBe(100000);
    expect(result.unassignedAdjustmentCount).toBe(1);
    expect(result.entries).toHaveLength(2);
    expect(Object.keys(result.amounts)).toEqual(["bill"]);
    expect(read(ledger, { material: "group:sand" }).totalCost).toBe(100000);
  });
});

describe("material identity and suggestions", () => {
  it("offers Balu/common aliases and bounded fuzzy spellings as proposals without silently changing totals", () => {
    const ledger = fixture([
      bill("bill", [line("sand", "বালু", 100000, "one", "sand-item")]),
    ]);
    const index = buildLedgerSearchIndex(ledger);
    for (const query of ["Balu", "baalu", "sand", "বালূ"]) {
      expect(
        materialSuggestions(index, query).some(
          (choice) => choice.token === "group:sand",
        ),
      ).toBe(true);
      expect(selectLedgerSearch(index, { query }).totalCost).toBe(0);
    }
    const selected = selectLedgerSearch(index, { material: "group:sand" });
    expect(selected.material).toEqual({ token: "group:sand", label: "বালু" });
    expect(selected.totalCost).toBe(100000);
    expect(
      selectLedgerSearch(index, { material: "group:sand", query: "অসম্পর্কিত" })
        .totalCost,
    ).toBe(0);
  });

  it("supports saved aliases, Bengali/English digits and legacy label selections without rewriting names", () => {
    const ledger = LedgerSchema.parse({
      ...context,
      items: [
        {
          id: "rod",
          name: "Rod ১৬ mm",
          aliases: ["রড ১৬"],
          materialGroupId: "cement",
        },
      ],
      entries: [
        bill("rod", [line("rod-line", "রড ১৬", 10000, "one", "rod")]),
        bill("legacy", [line("legacy-line", "পুরোনো মাল ১৬", 20000)]),
      ],
    });
    const index = buildLedgerSearchIndex(ledger);
    expect(
      selectLedgerSearch(index, { query: "  ROD 16   MM " }).totalCost,
    ).toBe(10000);
    expect(selectLedgerSearch(index, { query: "রড 16" }).totalCost).toBe(10000);
    const choice = materialSuggestions(index, "পুরোনো মাল 16")[0];
    expect(choice.token).toBe("label:পুরোনো মাল 16");
    expect(
      selectLedgerSearch(index, { material: choice.token }).totalCost,
    ).toBe(20000);
    expect(ledger.items[0].name).toBe("Rod ১৬ mm");
  });

  it("fails closed for unknown material/month tokens instead of broadening to all costs", () => {
    const ledger = fixture([
      bill("bill", [line("sand", "বালু", 100000, "one", "sand-item")]),
    ]);
    expect(read(ledger, { material: "group:missing" })).toMatchObject({
      entries: [],
      totalCost: 0,
      materialInvalid: true,
    });
    expect(read(ledger, { month: "2026-13" })).toMatchObject({
      entries: [],
      totalCost: 0,
      monthInvalid: true,
    });
    expect(materialSuggestions(buildLedgerSearchIndex(ledger), "")).toEqual([]);
    expect(
      materialSuggestions(buildLedgerSearchIndex(ledger), "বালু", 0),
    ).toEqual([]);
  });

  it("uses unique linked return identity without inheriting its bill's amount or date", () => {
    const ledger = fixture([
      bill("bill", [line("sand", "বালু", 100000, "one", "sand-item")]),
      {
        ...bill(
          "return",
          [line("return-line", "মাল ফেরত", 20000)],
          "2026-03-01",
        ),
        kind: "expense_credit",
        relatedEntryId: "bill",
      },
    ]);
    for (const filters of [{ query: "বালু" }, { material: "group:sand" }]) {
      const result = read(ledger, filters);
      expect(result).toMatchObject({
        totalCost: 80000,
        returns: 20000,
        ambiguousEntryCount: 0,
      });
      expect(result.amounts.return).toBe(-20000);
      expect(result.monthlyRows[1]).toMatchObject({
        month: "2026-03",
        total: -20000,
      });
    }
  });

  it("keeps an unidentified mixed-bill return visible and excluded instead of inventing an allocation", () => {
    const ledger = fixture([
      bill("bill", [
        line("sand", "বালু", 100000, "one", "sand-item"),
        line("cement", "সিমেন্ট", 900000, "one", "cement-item"),
      ]),
      {
        ...bill(
          "return",
          [line("return-line", "মাল ফেরত", 20000)],
          "2026-03-01",
        ),
        kind: "expense_credit",
        relatedEntryId: "bill",
      },
    ]);
    for (const filters of [{ query: "বালু" }, { material: "group:sand" }]) {
      const result = read(ledger, filters);
      expect(result).toMatchObject({
        totalCost: 100000,
        returns: 0,
        ambiguousEntryCount: 1,
        ambiguousEntryIds: ["return"],
      });
      expect(result.entries.map((entry) => entry.id)).toEqual([
        "bill",
        "return",
      ]);
      expect(result.amounts.return).toBeUndefined();
    }
    expect(read(ledger, { query: "দোকান" })).toMatchObject({
      totalCost: 980000,
      ambiguousEntryCount: 0,
    });
  });

  it("distinguishes partially identified returns from entries excluded in full", () => {
    const ledger = fixture([
      bill("bill", [
        line("sand", "বালু", 100000, "one", "sand-item"),
        line("cement", "সিমেন্ট", 900000, "one", "cement-item"),
      ]),
      {
        ...bill(
          "return",
          [
            line("known-return", "বালু ফেরত", 5000, "one", "sand-item"),
            line("unknown-return", "মাল ফেরত", 10000),
          ],
          "2026-03-01",
        ),
        kind: "expense_credit",
        relatedEntryId: "bill",
      },
    ]);
    const result = read(ledger, { material: "group:sand" });
    expect(result).toMatchObject({
      totalCost: 95000,
      returns: 5000,
      ambiguousEntryIds: [],
      partiallyAmbiguousEntryIds: ["return"],
      ambiguousEntryCount: 1,
    });
    expect(result.amounts.return).toBe(-5000);
  });

  it("does not inherit a return identity from a different work or expense type", () => {
    const ledger = fixture([
      bill("bill", [
        line("sand", "বালু", 100000, "one", "sand-item"),
        line("cement", "সিমেন্ট", 900000, "two", "cement-item"),
      ]),
      {
        ...bill("wrong-work", [
          line("wrong-work-line", "মাল ফেরত", 10000, "two"),
        ]),
        kind: "expense_credit",
        relatedEntryId: "bill",
      },
      {
        ...bill("wrong-type", [
          { ...line("wrong-type-line", "মাল ফেরত", 10000), costType: "unload" },
        ]),
        kind: "expense_credit",
        relatedEntryId: "bill",
      },
    ]);
    const result = read(ledger, { material: "group:sand" });
    expect(result.totalCost).toBe(100000);
    expect(result.entries.map((entry) => entry.id)).toEqual(["bill"]);
  });
});

describe("exact local projections", () => {
  it("preserves source data and reuses one built index for independent queries", () => {
    const ledger = fixture([
      bill("bill", [
        line("sand", "বালু", 100000, "one", "sand-item"),
        line("cement", "সিমেন্ট", 900000, "one", "cement-item"),
      ]),
    ]);
    const before = structuredClone(ledger);
    const index = buildLedgerSearchIndex(ledger);
    expect(selectLedgerSearch(index, { query: "বালু" }).totalCost).toBe(100000);
    expect(selectLedgerSearch(index, { query: "সিমেন্ট" }).totalCost).toBe(
      900000,
    );
    materialSuggestions(index, "বালূ");
    expect(ledger).toEqual(before);
    expect(index.documents[0].entry).toBe(ledger.entries[0]);
  });

  it("aggregates maximum-safe poisha exactly and rejects corrupted overflow", () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const ledger = fixture([
      bill("large", [line("large-line", "বালু", maximum - 1)]),
      bill("one", [line("one-line", "বালু", 1)]),
    ]);
    expect(read(ledger, { query: "বালু" }).totalCost).toBe(maximum);
    const unsafe = {
      ...ledger,
      entries: [
        ...ledger.entries,
        EntrySchema.parse(bill("extra", [line("extra-line", "বালু", 1)])),
      ],
    };
    expect(LedgerSchema.safeParse(unsafe).success).toBe(false);
    expect(() => read(unsafe, { query: "বালু" })).toThrow(
      "search_amount_out_of_range",
    );
    const fraction = structuredClone(ledger);
    fraction.entries[0].lines[0].amount = 1.5;
    expect(() => buildLedgerSearchIndex(fraction)).toThrow(
      "search_amount_out_of_range",
    );
  });

  it("handles imported IDs safely when supplying partial amount/title overrides", () => {
    const ledger = fixture([
      bill("__proto__", [
        line("sand", "বালু", 100000),
        line("cement", "সিমেন্ট", 900000),
      ]),
    ]);
    const result = read(ledger, { query: "বালু" });
    expect(result.totalCost).toBe(100000);
    expect(result.amounts["__proto__"]).toBe(100000);
    expect(result.titles["__proto__"]).toBe("বালু");
    expect(result.amounts.constructor).toBeUndefined();
  });
});
