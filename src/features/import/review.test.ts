import { describe, expect, it } from "vitest";
import { defaultTaxonomy } from "../../domain/importWallet";
import { LedgerSchema } from "../../domain/model";
import { summarize } from "../../domain/ledger";
import { organizeHistoricalEntry, reviewDraft } from "./review";

function example() {
  return LedgerSchema.parse({
    ...defaultTaxonomy(),
    works: [
      { id: "plaster", name: "প্লাস্টার" },
      { id: "casting", name: "ঢালাই" },
    ],
    entries: [
      {
        id: "old",
        kind: "expense",
        balanceImpact: "historical",
        reviewStatus: "needs_review",
        note: "মূল বিবরণ",
        source: {
          file: "sheet.html",
          cell: "P8",
          note: "মূল বিবরণ",
          checksum: "a".repeat(64),
          ledger: "Cement",
        },
        lines: [
          {
            id: "old-line",
            workId: "plaster",
            itemId: "cement-crown",
            amount: 50000,
            costType: "material",
          },
        ],
      },
    ],
  });
}

describe("historical organization", () => {
  it("preserves source, amount and historical accounting while organizing metadata", () => {
    const before = example();
    const entry = before.entries[0];
    const drafts = reviewDraft(entry, before);
    drafts[0] = {
      ...drafts[0],
      workId: "casting",
      costType: "unload",
      usage: "ঢালাই",
    };
    const after = organizeHistoricalEntry(before, entry, drafts);
    expect(after.entries[0]).toMatchObject({
      reviewStatus: "confirmed",
      balanceImpact: "historical",
      note: "মূল বিবরণ",
      source: entry.source,
      lines: [
        {
          amount: 50000,
          workId: "casting",
          costType: "unload",
          usage: "ঢালাই",
        },
      ],
    });
    expect(after.entries[0].revisions[0].before.lines[0].workId).toBe(
      "plaster",
    );
    expect(summarize(after)).toMatchObject({
      cost: 50000,
      historicalCost: 50000,
      confirmedCost: 0,
      payable: 0,
      advance: 0,
      unreviewedCount: 0,
    });
  });

  it("creates a brand variant without rewriting past items or unrelated entries", () => {
    const before = example();
    const drafts = reviewDraft(before.entries[0], before);
    drafts[0].brand = "নতুন ব্র্যান্ড";
    const after = organizeHistoricalEntry(before, before.entries[0], drafts);
    expect(after.items.find((item) => item.id === "cement-crown")?.brand).toBe(
      "Crown",
    );
    expect(
      after.items.find((item) => item.id === after.entries[0].lines[0].itemId)
        ?.brand,
    ).toBe("নতুন ব্র্যান্ড");
    expect(before.items).toHaveLength(defaultTaxonomy().items.length);
    expect(after.items).toHaveLength(before.items.length + 1);
  });

  it("can clear a usage inherited from a selected item", () => {
    const before = example();
    before.entries[0].lines[0].itemId = "sand-plaster";
    const drafts = reviewDraft(before.entries[0], before);
    drafts[0].usage = "";
    const after = organizeHistoricalEntry(before, before.entries[0], drafts);
    const line = after.entries[0].lines[0];
    expect(line.usage).toBe("");
    expect(after.items.find((item) => item.id === line.itemId)?.usage).toBe("");
  });

  it("rejects concurrent edits and mismatched groups without overwriting", () => {
    const before = example();
    const original = structuredClone(before.entries[0]);
    const drafts = reviewDraft(original, before);
    before.entries[0].note = "অন্য জায়গায় বদলেছে";
    expect(() => organizeHistoricalEntry(before, original, drafts)).toThrow(
      "review_conflict",
    );
    const untouched = example();
    drafts[0].groupId = "sand";
    expect(() =>
      organizeHistoricalEntry(untouched, untouched.entries[0], drafts),
    ).toThrow("item_group_mismatch");
    expect(untouched.entries[0].reviewStatus).toBe("needs_review");
  });
});
