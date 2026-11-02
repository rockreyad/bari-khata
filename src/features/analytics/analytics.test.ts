import { describe, expect, it } from "vitest";
import { LedgerSchema, type Ledger } from "../../domain/model";
import {
  analyticsCsv,
  breakdownRows,
  costRows,
  filterCostRows,
  matchingEntries,
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
  it("defaults to material prices, never includes labour or transport in the material total", () => {
    const all = costRows(fixture());
    const section = reportSection(null);
    const rows = sectionRows(all, section);
    expect(section).toBe("material");
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
