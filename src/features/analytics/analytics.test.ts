import { describe, expect, it } from "vitest";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { selectLedgerSearch } from "../ledger/searchAnalytics";
import {
  analyticsCsv,
  buildCostReportIndex,
  breakdownRows,
  costRows,
  filterCostRows,
  matchingEntries,
  selectCostReport,
  summarizeRows,
} from "./analytics";

function fixture(): Ledger {
  const entries: unknown[] = [];
  const add = (
    id: string,
    workId: string,
    itemId: string | null,
    costType: string,
    amount: number,
    options: Record<string, unknown> = {},
  ) => {
    entries.push({
      id,
      kind: "expense",
      personId: "shop",
      account: costType === "labour" ? "labour" : "materials",
      date: "2026-11-01",
      lines: [
        { id: `${id}-line`, workId, itemId, costType, amount, ...options },
      ],
      ...("historical" in options
        ? {
            balanceImpact: "historical",
            reviewStatus: "needs_review",
            date: null,
          }
        : {}),
    });
  };
  add("iron-roof", "roof", "rebar", "material", 400000);
  add("iron-door", "door", "door-iron", "material", 200000);
  add("iron-electric", "electric", "wire-iron", "material", 30000);
  add("iron-plumbing", "plumbing", "pipe-iron", "material", 50000);
  entries.push({
    id: "iron-return",
    kind: "expense_credit",
    personId: "shop",
    account: "materials",
    date: "2026-11-02",
    lines: [
      {
        id: "iron-return-line",
        workId: "door",
        itemId: "door-iron",
        costType: "material",
        amount: 50000,
      },
    ],
  });
  add("crown", "roof", "cement-crown", "material", 200000);
  add("shah", "plaster", "cement-shah", "material", 300000);
  add("super", "roof", "cement-super", "material", 400000);
  add("cement-unload-a", "roof", null, "unload", 20000, {
    materialGroupId: "cement",
  });
  add("cement-unload-b", "plaster", "cement-shah", "unload", 30000);
  add("sand-plaster", "plaster", "plaster-sand", "material", 40000);
  add("sand-fill", "foundation", "fill-sand", "material", 60000);
  add("sand-labour", "foundation", null, "labour", 12000, {
    materialGroupId: "sand",
    usage: "ভরাট",
  });
  add("chemical-plaster", "plaster", "chemical-a", "material", 50000);
  add("chemical-roof", "roof", "chemical-b", "material", 70000);
  add("old-poly", "roof", "polythene", "material", 6500, { historical: true });
  entries.push({
    id: "cash-payment",
    kind: "payment",
    personId: "shop",
    account: "materials",
    allocations: [{ workId: "roof", amount: 900000 }],
    paymentParts: [{ method: "bkash", amount: 900000 }],
  });
  add("voided", "roof", "rebar", "material", 999999);
  (entries.at(-1) as { voided?: boolean }).voided = true;
  return LedgerSchema.parse({
    works: [
      "roof",
      "door",
      "electric",
      "plumbing",
      "plaster",
      "foundation",
    ].map((id) => ({ id, name: id })),
    people: [{ id: "shop", name: "দোকান" }],
    materialGroups: [
      { id: "iron", name: "লোহা", aliases: ["Loha", "Steel"] },
      { id: "cement", name: "সিমেন্ট" },
      { id: "sand", name: "বালু" },
      { id: "chemical", name: "রাসায়নিক" },
      { id: "poly", name: "পলিথিন" },
    ],
    items: [
      { id: "rebar", name: "রড", materialGroupId: "iron", brand: "AKS" },
      { id: "door-iron", name: "দরজার লোহা", materialGroupId: "iron" },
      { id: "wire-iron", name: "তারের কাজে লোহা", materialGroupId: "iron" },
      { id: "pipe-iron", name: "পাইপের লোহা", materialGroupId: "iron" },
      {
        id: "cement-crown",
        name: "Crown সিমেন্ট",
        brand: "Crown",
        materialGroupId: "cement",
      },
      {
        id: "cement-shah",
        name: "Shah সিমেন্ট",
        brand: "Shah",
        materialGroupId: "cement",
      },
      {
        id: "cement-super",
        name: "Supercrete+ সিমেন্ট",
        brand: "Supercrete+",
        materialGroupId: "cement",
      },
      {
        id: "plaster-sand",
        name: "প্লাস্টারের বালু",
        materialGroupId: "sand",
        usage: "প্লাস্টার",
      },
      {
        id: "fill-sand",
        name: "ভরাটের বালু",
        materialGroupId: "sand",
        usage: "ভরাট",
      },
      {
        id: "chemical-a",
        name: "প্লাস্টারের মিশ্রণ",
        materialGroupId: "chemical",
        usage: "প্লাস্টার",
      },
      {
        id: "chemical-b",
        name: "ছাদের মিশ্রণ",
        materialGroupId: "chemical",
        usage: "ছাদ",
      },
      { id: "polythene", name: "পলিথিন", materialGroupId: "poly" },
    ],
    entries,
  });
}

describe("homeowner material reports", () => {
  it("finds iron across every work and subtracts returns without counting payments or voided records", () => {
    const ledger = fixture();
    const rows = filterCostRows(costRows(ledger), { groupId: "iron" });
    expect(summarizeRows(rows).total).toBe(630000);
    expect(summarizeRows(rows).returns).toBe(50000);
    expect(
      breakdownRows(rows, "work")
        .map((row) => row.id)
        .sort(),
    ).toEqual(["door", "electric", "plumbing", "roof"]);
    expect(
      summarizeRows(filterCostRows(costRows(ledger), { query: "loha" })).total,
    ).toBe(630000);
  });
  it("separates cement brand prices from unload cost, including charges linked only to its material group", () => {
    const rows = costRows(fixture());
    const cement = filterCostRows(rows, { groupId: "cement" });
    expect(summarizeRows(cement).material).toBe(900000);
    expect(summarizeRows(cement).supporting).toBe(50000);
    expect(
      summarizeRows(
        filterCostRows(rows, { groupId: "cement", costType: "unload" }),
      ).total,
    ).toBe(50000);
    expect(
      summarizeRows(
        filterCostRows(rows, {
          groupId: "cement",
          brand: "Crown",
          costType: "material",
        }),
      ).total,
    ).toBe(200000);
    expect(
      breakdownRows(filterCostRows(cement, { costType: "material" }), "brand")
        .map((row) => row.label)
        .sort(),
    ).toEqual(["Crown", "Shah", "Supercrete+"]);
  });
  it("splits sand by use while retaining total sand and its own labour charges", () => {
    const rows = costRows(fixture());
    expect(
      summarizeRows(
        filterCostRows(rows, { groupId: "sand", costType: "material" }),
      ).total,
    ).toBe(100000);
    expect(
      summarizeRows(
        filterCostRows(rows, { groupId: "sand", usage: "প্লাস্টার" }),
      ).total,
    ).toBe(40000);
    expect(
      summarizeRows(
        filterCostRows(rows, {
          groupId: "sand",
          usage: "ভরাট",
          costType: "material",
        }),
      ).total,
    ).toBe(60000);
    expect(
      summarizeRows(
        filterCostRows(rows, { groupId: "sand", costType: "labour" }),
      ).total,
    ).toBe(12000);
    expect(
      summarizeRows(filterCostRows(rows, { groupId: "chemical" })).total,
    ).toBe(120000);
  });
  it("preserves historical uncertainty and excludes unknown dates only when a date range is requested", () => {
    const rows = costRows(fixture());
    const poly = filterCostRows(rows, { groupId: "poly" });
    expect(summarizeRows(poly)).toMatchObject({
      total: 6500,
      historical: 6500,
      reviewCount: 1,
      undatedCount: 1,
    });
    expect(
      filterCostRows(rows, { groupId: "poly", from: "2026-01-01" }),
    ).toHaveLength(0);
    expect(filterCostRows(rows, { dates: "unknown" })).toHaveLength(1);
  });
  it("keeps a selected line amount when a bill contains several different materials and safely exports notes", () => {
    const ledger = fixture();
    const entry = ledger.entries.find((row) => row.id === "crown")!;
    entry.note = ' =HYPERLINK("https://example.invalid")';
    entry.lines.push({
      ...entry.lines[0],
      id: "other-line",
      itemId: "polythene",
      amount: 75000,
    });
    const selected = filterCostRows(costRows(ledger), {
      groupId: "cement",
      brand: "Crown",
    });
    expect(matchingEntries(selected)).toHaveLength(1);
    expect(matchingEntries(selected)[0].amount).toBe(200000);
    const csv = analyticsCsv(selected, (text) => text);
    expect(csv).toContain('"2000.00"');
    expect(csv).not.toContain('"2750.00"');
    expect(csv).toContain("' =HYPERLINK");
  });
});

import { reportSection, sectionRows } from "./analytics";
describe("separate report accounts", () => {
  it("defaults to all costs while keeping the explicit material section limited to material prices", () => {
    const all = costRows(fixture());
    const section = reportSection(null);
    const rows = sectionRows(all, "material");
    expect(section).toBe("all");
    expect(sectionRows(all, section)).toBe(all);
    expect(rows.every((row) => row.line.costType === "material")).toBe(true);
    expect(summarizeRows(rows).labour).toBe(0);
    expect(summarizeRows(rows).supporting).toBe(0);
    expect(
      filterCostRows(rows, { groupId: "cement" }).reduce(
        (sum, row) => sum + row.amount,
        0,
      ),
    ).toBe(900000);
  });
  it("opens the correct separate account for an explicit labour or unloading query", () => {
    const all = costRows(fixture());
    expect(reportSection(null, "labour")).toBe("labour");
    expect(reportSection(null, "unload")).toBe("transport");
    expect(summarizeRows(sectionRows(all, "labour")).total).toBe(12000);
    expect(summarizeRows(sectionRows(all, "transport")).total).toBe(50000);
    expect(reportSection("material", "labour")).toBe("material");
    expect(sectionRows(all, "other")).toHaveLength(0);
  });
});

it("searches legacy descriptions and numeric labels in either script without changing their saved identities", () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "bn-work-16", name: "কাজ ১৬" }],
    entries: [
      {
        id: "bn",
        kind: "expense",
        lines: [
          {
            id: "bn-line",
            workId: "bn-work-16",
            label: "Rod ১৬ mm",
            amount: 16200,
          },
        ],
      },
      {
        id: "en",
        kind: "expense",
        lines: [
          {
            id: "en-line",
            workId: "bn-work-16",
            label: "Pipe 8 inch",
            amount: 80000,
          },
        ],
      },
    ],
  });
  const rows = costRows(ledger);
  expect(
    filterCostRows(rows, { query: "Rod 16" }).map((row) => row.entry.id),
  ).toEqual(["bn"]);
  expect(
    filterCostRows(rows, { query: "Pipe ৮" }).map((row) => row.entry.id),
  ).toEqual(["en"]);
  expect(
    filterCostRows(rows, { itemId: "label:Rod ১৬ mm" }).map(
      (row) => row.entry.id,
    ),
  ).toEqual(["bn"]);
  expect(ledger.entries[0].lines[0].label).toBe("Rod ১৬ mm");
  expect(ledger.works[0].id).toBe("bn-work-16");
});

describe("shared ledger and cost report projection", () => {
  it("includes clear material processing once across ledger, reports and months without reclassifying the charge", () => {
    const charge = (
      id: string,
      label: string,
      amount: number,
      date: string,
      extra: Record<string, unknown> = {},
    ) => ({
      id,
      kind: "expense",
      account: "other",
      personId: "shop",
      date,
      lines: [
        { id: `${id}-line`, workId: "work", label, amount, costType: "other" },
      ],
      ...extra,
    });
    const ledger = LedgerSchema.parse({
      works: [{ id: "work", name: "নমুনা কাজ" }],
      people: [{ id: "shop", name: "নমুনা দোকান" }],
      materialGroups: [
        { id: "panel", name: "প্যানেল", aliases: ["Panel", "প্যানেল কাটা"] },
        { id: "pipe", name: "নল", aliases: ["Pipe"] },
      ],
      entries: [
        charge("purchase", "প্যানেল", 1000, "2026-01-02", {
          account: "materials",
          lines: [
            {
              id: "purchase-line",
              workId: "work",
              label: "প্যানেল",
              amount: 1000,
              costType: "material",
            },
          ],
        }),
        charge("cut", "প্যানেল কাটা", 125, "2026-02-03"),
        charge("cut-fee", "প্যানেলের কাটার বিল", 75, "2026-03-04"),
        charge("returned-charge", "ফেরত", 20, "2026-04-05", {
          kind: "expense_credit",
          relatedEntryId: "cut",
        }),
        charge("deliberate", "কাটার বিল", 25, "2026-05-06", {
          lines: [
            {
              id: "deliberate-line",
              workId: "work",
              label: "কাটার বিল",
              amount: 25,
              costType: "other",
              materialGroupId: "panel",
            },
          ],
        }),
        charge("general", "প্যানেলের কাজ", 300, "2026-06-07"),
        charge("machine", "", 400, "2026-06-07", {
          lines: [
            "প্যানেল কাটার মেশিন ভাড়া",
            "প্যানেল কাটা মজুরী",
            "প্যানেল ভাঙ্গার মেশিনটি",
            "Panel cutting widget",
          ].map((label, index) => ({
            id: `machine-${index}`,
            workId: "work",
            label,
            amount: 100,
            costType: "other",
          })),
        }),
        ...["labour", "rental"].map((costType, index) =>
          charge(costType, "প্যানেল কাটা", 500 + index * 100, "2026-06-07", {
            account: costType === "labour" ? "labour" : "other",
            lines: [
              {
                id: `${costType}-line`,
                workId: "work",
                label: "প্যানেল কাটা",
                amount: 500 + index * 100,
                costType,
              },
            ],
          }),
        ),
        charge("mixed", "প্যানেল ও নল কাটা", 700, "2026-06-07"),
        charge("note", "নল কাটা", 800, "2026-06-07", { note: "প্যানেল" }),
        {
          id: "paid",
          kind: "payment",
          personId: "shop",
          date: "2026-07-08",
          note: "প্যানেল",
          relatedEntryId: "purchase",
          allocations: [{ workId: "work", amount: 900 }],
          paymentParts: [{ amount: 900 }],
        },
      ],
    });
    const before = JSON.stringify(ledger);
    const index = buildCostReportIndex(ledger);
    for (const filters of [
      { groupId: "panel" },
      { query: "প্যানেল" },
      { query: "Panel" },
    ]) {
      const report = selectCostReport(index, filters);
      const shared = selectLedgerSearch(index.search, {
        query: filters.query,
        material: filters.groupId ? `group:${filters.groupId}` : undefined,
      });
      expect(report.search.totalCost).toBe(1205);
      expect(summarizeRows(report.rows).total).toBe(1205);
      expect(
        breakdownRows(report.rows, "work").map((row) => row.amount),
      ).toEqual([1205]);
      expect(
        matchingEntries(report.rows).reduce((sum, row) => sum + row.amount, 0),
      ).toBe(1205);
      expect(report.search.totalCost).toBe(shared.totalCost);
      expect(report.search.monthlyRows).toEqual(shared.monthlyRows);
      expect(
        report.search.monthlyRows.map(({ month, total, other }) => [
          month,
          total,
          other,
        ]),
      ).toEqual([
        ["2026-01", 1000, 0],
        ["2026-02", 125, 125],
        ["2026-03", 75, 75],
        ["2026-04", -20, -20],
        ["2026-05", 25, 25],
      ]);
      expect(report.search.groupAmbiguousEntryIds).toContain("mixed");
      expect(report.search.amounts.paid).toBeUndefined();
    }
    expect(
      selectCostReport(index, { groupId: "panel" }, { section: "material" })
        .search.totalCost,
    ).toBe(1000);
    expect(
      selectCostReport(index, { groupId: "panel" }, { account: "other" }).search
        .totalCost,
    ).toBe(205);
    const march = selectCostReport(
      index,
      { query: "প্যানেল" },
      { month: "2026-03" },
    );
    expect(march.search.totalCost).toBe(75);
    expect(march.rows.map((row) => row.key)).toEqual(["cut-fee:cut-fee-line"]);
    const service = index.rows.find((row) => row.key === "cut:cut-line")!;
    expect(service.line.costType).toBe("other");
    expect(service.entry.account).toBe("other");
    expect(selectCostReport(index).search.totalCost).toBe(4505);
    expect(selectLedgerSearch(index.search).totalCost).toBe(4505);
    expect(JSON.stringify(ledger)).toBe(before);
  });

  function reportFixture(entries: unknown[]) {
    return LedgerSchema.parse({
      works: [
        { id: "one", name: "ভিত্তি" },
        { id: "two", name: "ছাদ" },
      ],
      people: [{ id: "shop", name: "নমুনা দোকান" }],
      materialGroups: [
        { id: "cement", name: "সিমেন্ট", aliases: ["Cement"] },
        { id: "sand", name: "বালু" },
      ],
      items: [
        {
          id: "crown",
          name: "Crown সিমেন্ট",
          brand: "Crown",
          materialGroupId: "cement",
          usage: "ছাদ",
        },
        {
          id: "shah",
          name: "Shah সিমেন্ট",
          brand: "Shah",
          materialGroupId: "cement",
        },
      ],
      entries,
    });
  }
  const line = (
    id: string,
    label: string,
    amount: number,
    extra: Record<string, unknown> = {},
  ) => ({ id, label, amount, workId: "one", ...extra });
  const bill = (
    id: string,
    lines: unknown[],
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    kind: "expense",
    personId: "shop",
    date: "2026-01-15",
    lines,
    ...extra,
  });

  it("uses the same inferred names, matching portions and supporting costs as ledger search", () => {
    const ledger = reportFixture([
      bill("mixed", [
        line("cement", "সিমেন্ট", 11000),
        line("sand", "বালু", 9000),
        line("other-work", "সিমেন্ট", 7000, { workId: "two" }),
      ]),
      bill("unload", [
        line("unload", "Cement Unload", 500, { costType: "unload" }),
      ]),
      bill("rent", [
        line("rent", "সিমেন্ট মিক্সার ভাড়া", 3000, { costType: "rental" }),
      ]),
      bill("note-only", [line("sand-note", "বালু", 2500)], {
        note: "সিমেন্টের পাশেই",
      }),
      bill("old", [line("old", "সিমেন্ট", 400)], {
        date: null,
        reviewStatus: "needs_review",
        balanceImpact: "historical",
      }),
      bill("void", [line("void", "সিমেন্ট", 999999)], { voided: true }),
      {
        id: "paid",
        kind: "payment",
        personId: "shop",
        note: "সিমেন্ট",
        allocations: [{ workId: "one", amount: 11000 }],
        paymentParts: [{ amount: 11000 }],
      },
      {
        id: "refund",
        kind: "refund",
        personId: "shop",
        note: "সিমেন্ট",
        allocations: [{ workId: "one", amount: 1000 }],
        paymentParts: [{ amount: 1000 }],
      },
    ]);
    const before = JSON.stringify(ledger);
    const index = buildCostReportIndex(ledger);
    for (const filters of [
      { groupId: "cement" },
      { query: "সিমেন্ট" },
      { groupId: "cement", workId: "one" },
    ]) {
      const report = selectCostReport(index, filters);
      const shared = selectLedgerSearch(index.search, {
        query: filters.query,
        material: filters.groupId ? `group:${filters.groupId}` : undefined,
        workId: filters.workId,
      });
      expect(summarizeRows(report.rows).total).toBe(shared.totalCost);
      expect(report.search.totalCost).toBe(shared.totalCost);
      expect(report.search.monthlyRows).toEqual(shared.monthlyRows);
    }
    const query = selectCostReport(index, { query: "সিমেন্ট" });
    expect(query.search.totalCost).toBe(18900);
    expect(query.search.ambiguousEntryIds).toEqual(["rent", "note-only"]);
    expect(query.rows.find((row) => row.key === "unload:unload")?.groupId).toBe(
      "cement",
    );
    expect(
      query.search.entries.every((entry) => entry.kind === "expense"),
    ).toBe(true);
    expect(
      selectCostReport(index, { groupId: "cement" }, { section: "material" })
        .search.totalCost,
    ).toBe(18400);
    expect(JSON.stringify(ledger)).toBe(before);
  });

  it("preserves return attribution and never allocates a mixed-brand group return to one brand", () => {
    const ledger = reportFixture([
      bill("mixed-brands", [
        line("crown", "Crown সিমেন্ট", 10000, { itemId: "crown" }),
        line("shah", "Shah সিমেন্ট", 20000, { itemId: "shah" }),
      ]),
      bill("group-return", [line("group-return", "মাল ফেরত", 5000)], {
        kind: "expense_credit",
        relatedEntryId: "mixed-brands",
        date: "2026-02-15",
      }),
      bill("unique", [
        line("unique", "Crown সিমেন্ট", 8000, { itemId: "crown" }),
      ]),
      bill("unique-return", [line("unique-return", "মাল ফেরত", 2000)], {
        kind: "expense_credit",
        relatedEntryId: "unique",
        date: "2026-02-15",
      }),
    ]);
    const index = buildCostReportIndex(ledger);
    expect(
      selectCostReport(index, { groupId: "cement" }).search.totalCost,
    ).toBe(31000);
    const brand = selectCostReport(index, {
      groupId: "cement",
      brand: "Crown",
    });
    expect(brand.search.totalCost).toBe(16000);
    expect(summarizeRows(brand.rows).total).toBe(16000);
    const item = selectCostReport(index, { itemId: "crown" });
    expect(item.search.totalCost).toBe(16000);
    expect(item.search.ambiguousEntryIds).toContain("group-return");
    expect(breakdownRows(item.rows, "item")).toMatchObject([
      { id: "crown", amount: 16000 },
    ]);
  });

  it("excludes conflicted identities and ambiguous mixed-material returns while retaining discovery evidence", () => {
    const ledger = reportFixture([
      bill("conflict", [
        line("known", "সিমেন্ট", 10000),
        line("conflict", "বালু", 5000, { itemId: "crown" }),
      ]),
      bill("mixed", [
        line("cement", "সিমেন্ট", 8000),
        line("sand", "বালু", 6000),
      ]),
      bill("uncertain-return", [line("return", "মাল ফেরত", 3000)], {
        kind: "expense_credit",
        relatedEntryId: "mixed",
      }),
    ]);
    const index = buildCostReportIndex(ledger);
    const report = selectCostReport(index, { groupId: "cement" });
    expect(report.search.totalCost).toBe(18000);
    expect(report.search.groupAmbiguousEntryIds).toEqual([
      "conflict",
      "uncertain-return",
    ]);
    expect(report.search.entries.map((entry) => entry.id)).toContain(
      "uncertain-return",
    );
    expect(report.rows.map((row) => row.key)).not.toContain(
      "conflict:conflict",
    );
    expect(selectCostReport(index, { itemId: "crown" }).search.totalCost).toBe(
      0,
    );
    expect(selectCostReport(index).search.totalCost).toBe(26000);
  });

  it("keeps exact supporting-item and generic-return breakdown filters usable without creating material suggestions", () => {
    const ledger = reportFixture([
      bill("support", [
        line("support", "মাল নামানো", 500, {
          itemId: "crown",
          costType: "unload",
        }),
      ]),
      bill("mixed-brands", [
        line("crown", "Crown সিমেন্ট", 10000, { itemId: "crown" }),
        line("shah", "Shah সিমেন্ট", 20000, { itemId: "shah" }),
      ]),
      bill("return", [line("return", "মাল ফেরত", 3000)], {
        kind: "expense_credit",
        relatedEntryId: "mixed-brands",
      }),
    ]);
    const supportOnly = buildCostReportIndex(
      reportFixture([ledger.entries[0]]),
    );
    expect(supportOnly.search.materials.has("item:crown")).toBe(false);
    expect(
      selectCostReport(supportOnly, { itemId: "crown" }).search.totalCost,
    ).toBe(500);
    const index = buildCostReportIndex(ledger);
    expect(index.search.materials.has("label:মাল ফেরত")).toBe(false);
    const returned = selectCostReport(index, { itemId: "label:মাল ফেরত" });
    expect(returned.search.totalCost).toBe(-3000);
    expect(returned.search.materialInvalid).toBe(false);
    expect(returned.rows.map((row) => row.key)).toEqual(["return:return"]);
    expect(
      selectCostReport(index, { itemId: "missing" }).search.totalCost,
    ).toBe(0);
    expect(index.search.materials.has("label:মাল ফেরত")).toBe(false);
  });

  it("applies date, month, review, person, type and work scopes to both chart and rows", () => {
    const ledger = reportFixture([
      bill("one", [
        line("one", "সিমেন্ট", 10000),
        line("two", "সিমেন্ট", 9000, { workId: "two" }),
      ]),
      bill("feb", [line("feb", "সিমেন্ট", 4000)], {
        date: "2026-02-10",
        reviewStatus: "needs_review",
      }),
      bill("undated", [line("undated", "সিমেন্ট", 500)], {
        date: null,
        personId: null,
        reviewStatus: "needs_review",
        balanceImpact: "historical",
      }),
    ]);
    const index = buildCostReportIndex(ledger);
    const month = selectCostReport(
      index,
      { groupId: "cement", workId: "one" },
      { month: "2026-02" },
    );
    expect(month.search.totalCost).toBe(4000);
    expect(summarizeRows(month.rows).total).toBe(4000);
    expect(
      month.search.monthlyRows.map(({ month, total }) => [month, total]),
    ).toEqual([
      ["2026-01", 10000],
      ["2026-02", 4000],
    ]);
    expect(month.search.baseUndatedCost).toBe(500);
    expect(
      selectCostReport(index, { groupId: "cement", review: "needs_review" })
        .search.totalCost,
    ).toBe(4500);
    expect(
      selectCostReport(index, { groupId: "cement", dates: "unknown" }).search
        .totalCost,
    ).toBe(500);
    expect(
      selectCostReport(index, { groupId: "cement", personId: "__unknown__" })
        .search.totalCost,
    ).toBe(500);
    expect(
      selectCostReport(index, { groupId: "cement", from: "2026-02-01" }).search
        .totalCost,
    ).toBe(4000);
    expect(
      selectCostReport(index, {}, { account: "labour" }).search.totalCost,
    ).toBe(0);
    const numeric = selectCostReport(index, { query: "১৯০", workId: "one" });
    expect(numeric.search.totalCost).toBe(10000);
    expect(numeric.rows.map((row) => row.key)).toEqual(["one:one"]);
  });

  it("rejects unsafe monetary aggregates in summaries, groups and matched entries", () => {
    const rows = costRows(
      reportFixture([
        bill("large", [line("one", "সিমেন্ট", 1), line("two", "সিমেন্ট", 1)]),
      ]),
    );
    rows[0].amount = Number.MAX_SAFE_INTEGER;
    expect(() => summarizeRows(rows)).toThrow("report_amount_out_of_range");
    expect(() => breakdownRows(rows, "group")).toThrow(
      "report_amount_out_of_range",
    );
    expect(() => matchingEntries(rows)).toThrow("report_amount_out_of_range");
  });
});
