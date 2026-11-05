import { expect, it } from "vitest";
import { LedgerSchema } from "../../domain/model";
import { purchaseSuggestions } from "./purchaseSuggestions";

const fixture = () =>
  LedgerSchema.parse({
    works: [{ id: "roof", name: "নমুনা ছাদ" }],
    materialGroups: [{ id: "cement", name: "সিমেন্ট" }],
    items: [
      {
        id: "crown",
        name: "সিমেন্ট",
        brand: "Crown",
        materialGroupId: "cement",
        unit: "বস্তা",
      },
      {
        id: "shah",
        name: "সিমেন্ট",
        brand: "Shah",
        materialGroupId: "cement",
        unit: "কেজি",
      },
    ],
    entries: [
      {
        id: "older",
        kind: "expense",
        date: "2026-10-01",
        lines: [
          {
            id: "crown-line",
            workId: "roof",
            label: "সিমেন্ট",
            itemId: "crown",
            quantity: "১০",
            unit: "বস্তা",
            amount: 999999,
          },
        ],
      },
      {
        id: "newer",
        kind: "expense",
        date: "2026-11-01",
        lines: [
          {
            id: "shah-line",
            workId: "roof",
            label: "সিমেন্ট",
            itemId: "shah",
            quantity: "৫",
            unit: "কেজি",
            amount: 777777,
          },
        ],
      },
    ],
  });

it("keeps same-name purchase variants and each record's quantity separate without offering prices or payment context", () => {
  const ledger = fixture();
  const before = structuredClone(ledger);
  const choices = purchaseSuggestions(ledger);
  const historic = choices.filter((choice) => choice.quantity);
  expect(historic).toHaveLength(2);
  expect(historic[0]).toMatchObject({
    value: "সিমেন্ট",
    brand: "Shah",
    quantity: "5",
    unit: "কেজি",
    groupId: "cement",
  });
  expect(historic[1]).toMatchObject({
    value: "সিমেন্ট",
    brand: "Crown",
    quantity: "10",
    unit: "বস্তা",
    groupId: "cement",
  });
  expect(historic[0].id).not.toBe(historic[1].id);
  for (const choice of historic)
    for (const field of ["amount", "date", "personId", "workId", "payment"])
      expect(choice).not.toHaveProperty(field);
  expect(ledger).toEqual(before);
});

it("uses an uncatalogued purchase without inventing a brand or category", () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "roof", name: "নমুনা ছাদ" }],
    entries: [
      {
        id: "purchase",
        kind: "expense",
        lines: [
          {
            id: "line",
            workId: "roof",
            label: "নমুনা বালু",
            quantity: "12",
            unit: "ফুট",
            amount: 150000,
          },
        ],
      },
    ],
  });
  expect(purchaseSuggestions(ledger)).toMatchObject([
    {
      value: "নমুনা বালু",
      quantity: "12",
      unit: "ফুট",
      groupId: "",
      brand: "",
    },
  ]);
});

it("offers unclassified legacy purchase metadata only as an explicit choice without changing its review or finances", () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "roof", name: "নমুনা ছাদ" }],
    items: [
      { id: "legacy-cement", name: "সিমেন্ট", brand: "Crown", unit: "বস্তা" },
    ],
    entries: [
      {
        id: "legacy",
        kind: "expense",
        reviewStatus: "needs_review",
        reviewReason: "মালের ধরন দেওয়া নেই",
        lines: [
          {
            id: "legacy-line",
            workId: "roof",
            label: "সিমেন্ট",
            itemId: "legacy-cement",
            quantity: "12",
            unit: "বস্তা",
            amount: 888888,
          },
        ],
      },
    ],
  });
  const before = structuredClone(ledger);
  const choice = purchaseSuggestions(ledger).find(
    (row) => row.quantity === "12",
  )!;
  expect(choice).toMatchObject({
    value: "সিমেন্ট",
    brand: "Crown",
    quantity: "12",
    unit: "বস্তা",
    groupId: "",
    groupName: "",
  });
  for (const field of [
    "amount",
    "reviewStatus",
    "reviewReason",
    "date",
    "personId",
    "workId",
    "payment",
  ])
    expect(choice).not.toHaveProperty(field);
  expect(ledger).toEqual(before);
  expect(ledger.entries[0].reviewStatus).toBe("needs_review");
});

it("ignores cancelled and non-material records, and tolerates unusable historical quantity", () => {
  const ledger = fixture();
  const source = ledger.entries[0];
  const changed = LedgerSchema.parse({
    ...ledger,
    items: [],
    entries: [
      {
        ...source,
        id: "cancelled",
        voided: true,
        lines: [{ ...source.lines[0], itemId: null }],
      },
      {
        ...source,
        id: "wage",
        account: "labour",
        lines: [{ ...source.lines[0], itemId: null, costType: "labour" }],
      },
      {
        ...source,
        id: "usable",
        lines: [
          { ...source.lines[0], itemId: null, quantity: "আগের অস্পষ্ট লেখা" },
        ],
      },
    ],
  });
  const choices = purchaseSuggestions(changed);
  expect(choices).toHaveLength(1);
  expect(choices[0]).toMatchObject({
    value: "সিমেন্ট",
    quantity: "",
    unit: "বস্তা",
  });
});
