import { describe, it, expect } from "vitest";
import { EntrySchema, ItemSchema, LedgerSchema } from "../../domain/model";
import { materialItems, materialSuggestion } from "./materialSuggestion";
describe("material suggestions", () => {
  it("does not guess a brand when the same material name has different brands", () => {
    const items = ["Crown", "Shah"].map((brand) =>
      ItemSchema.parse({
        id: brand,
        name: "সিমেন্ট",
        materialGroupId: "cement",
        brand,
      }),
    );
    expect(materialSuggestion(items, "সিমেন্ট", {})).toEqual({
      label: "সিমেন্ট",
    });
  });
  it("fills a uniquely named variant and removes its automatic metadata after changing the material", () => {
    const item = ItemSchema.parse({
      id: "crown",
      name: "Crown সিমেন্ট",
      materialGroupId: "cement",
      brand: "Crown",
    });
    expect(materialSuggestion([item], item.name, {})).toMatchObject({
      brand: "Crown",
      autoItemName: item.name,
    });
    expect(
      materialSuggestion([item], "দরজা", { autoItemName: item.name }),
    ).toMatchObject({ brand: "", groupId: "", autoItemName: "" });
  });
  it("preserves explicitly entered metadata while editing an unrelated description", () => {
    expect(materialSuggestion([], "আঠা + ক্লিপ", { autoItemName: "" })).toEqual(
      { label: "আঠা + ক্লিপ" },
    );
  });
  it("does not suggest items used only for wages as things to buy", () => {
    const ledger = LedgerSchema.parse({
      works: [{ id: "work", name: "দরজা" }],
      items: [
        { id: "wage", name: "মজুরি" },
        { id: "door", name: "দরজা" },
      ],
    });
    ledger.entries.push(
      EntrySchema.parse({
        id: "bill",
        date: "2026-11-02",
        kind: "expense",
        account: "labour",
        lines: [
          {
            id: "line",
            workId: "work",
            itemId: "wage",
            costType: "labour",
            label: "মজুরি",
            amount: 100,
          },
        ],
      }),
    );
    expect(materialItems(ledger).map((item) => item.name)).toEqual(["দরজা"]);
  });
});

it("matches a legacy material's Bengali digits to English input without rewriting its original name", () => {
  const item = ItemSchema.parse({
    id: "legacy-16",
    name: "Rod ১৬ mm",
    materialGroupId: "rod",
    brand: "BSRM",
    usage: "Door ২",
    unit: "kg",
  });
  expect(materialSuggestion([item], "Rod 16 mm", {})).toMatchObject({
    label: "Rod 16 mm",
    brand: "BSRM",
    usage: "Door ২",
    groupId: "rod",
  });
  expect(item.name).toBe("Rod ১৬ mm");
  expect(
    materialSuggestion(
      [ItemSchema.parse({ ...item, name: "Rod 16 mm" })],
      "Rod ১৬ mm",
      {},
    ),
  ).toMatchObject({ label: "Rod ১৬ mm", brand: "BSRM" });
});
it("does not select a brand when digit-equivalent legacy names have genuinely different variants", () => {
  const items = [
    ItemSchema.parse({
      id: "a",
      name: "Rod ১৬ mm",
      materialGroupId: "rod",
      brand: "BSRM",
    }),
    ItemSchema.parse({
      id: "b",
      name: "Rod 16 mm",
      materialGroupId: "rod",
      brand: "AKS",
    }),
  ];
  expect(materialSuggestion(items, "Rod 16 mm", {})).toEqual({
    label: "Rod 16 mm",
  });
});

it("matches normalized names and aliases while preserving the user's entered label", () => {
  const item = ItemSchema.parse({
    id: "rod",
    name: "Rod ১৬ mm",
    aliases: ["রড ১৬"],
    materialGroupId: "rod",
    brand: "BSRM",
    unit: "kg",
  });
  for (const label of ["  ROD   16 MM  ", "রড 16"]) {
    expect(materialSuggestion([item], label, {})).toMatchObject({
      label,
      groupId: "rod",
      brand: "BSRM",
      unit: "kg",
    });
  }
});

it("suggests previous materials even when no catalog item or material group was selected", () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "work", name: "দরজা" }],
    entries: [
      {
        id: "purchase",
        kind: "expense",
        lines: [
          {
            id: "line",
            workId: "work",
            label: "সিমেন্ট",
            unit: "বস্তা",
            amount: 55000,
          },
          {
            id: "food",
            workId: "work",
            label: "খাবার",
            costType: "other",
            amount: 5000,
          },
        ],
      },
    ],
  });
  const before = structuredClone(ledger);
  const items = materialItems(ledger);
  expect(items.map((item) => item.name)).toEqual(["সিমেন্ট"]);
  expect(materialSuggestion(items, "সিমেন্ট", {})).toMatchObject({
    label: "সিমেন্ট",
    unit: "বস্তা",
    groupId: "",
    brand: "",
  });
  expect(ledger).toEqual(before);
});

it("does not guess metadata when historical materials used different units", () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "work", name: "দরজা" }],
    entries: [
      {
        id: "purchase",
        kind: "expense",
        lines: [
          { id: "kg", workId: "work", label: "রড", unit: "kg", amount: 10000 },
          {
            id: "piece",
            workId: "work",
            label: "রড",
            unit: "টি",
            amount: 20000,
          },
        ],
      },
    ],
  });
  expect(materialSuggestion(materialItems(ledger), "রড", {})).toEqual({
    label: "রড",
  });
});

it("leaves explicitly entered metadata intact even when the typed material name has one match", () => {
  const item = ItemSchema.parse({
    id: "rod",
    name: "রড",
    brand: "BSRM",
    unit: "kg",
  });
  expect(
    materialSuggestion([item], "রড", {
      autoItemName: "",
      brand: "AKS",
      unit: "টি",
    }),
  ).toEqual({ label: "রড" });
});
