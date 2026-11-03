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
  it("moves explicitly selected all-labour lines into the labour account without creating wages or cash", () => {
    const before = LedgerSchema.parse({
      ...example(),
      people: [{ id: "worker", name: "মিস্ত্রি", kind: "worker" }],
      entries: example().entries.map((entry) => ({
        ...entry,
        personId: "worker",
        date: "2026-01-03",
        lines: [
          ...entry.lines,
          { ...entry.lines[0], id: "second", amount: 20000 },
        ],
      })),
    });
    const original = structuredClone(before),
      entry = before.entries[0];
    const drafts = reviewDraft(entry, before).map((draft) => ({
      ...draft,
      costType: "labour" as const,
    }));
    const after = organizeHistoricalEntry(before, entry, drafts);
    expect(after.entries[0]).toMatchObject({
      account: "labour",
      personId: "worker",
      source: entry.source,
      date: entry.date,
      note: entry.note,
      balanceImpact: "historical",
      reviewStatus: "confirmed",
    });
    expect(after.entries[0].lines).toEqual(
      entry.lines.map((line) => ({
        ...line,
        materialGroupId: "cement",
        costType: "labour",
        usage: "",
      })),
    );
    expect(after.entries[0].revisions[0].before).toMatchObject({
      account: "materials",
      source: entry.source,
      lines: entry.lines,
    });
    expect(summarize(after)).toMatchObject({
      cost: 70000,
      historicalCost: 70000,
      confirmedCost: 0,
      paid: 0,
      refunds: 0,
      payable: 0,
      advance: 0,
    });
    expect(before).toEqual(original);
  });
  it.each(["material", "transport", "unload", "rental", "other"] as const)(
    "moves all lines out of labour into the appropriate account for %s",
    (costType) => {
      const before = LedgerSchema.parse({
        ...example(),
        entries: example().entries.map((entry) => ({
          ...entry,
          account: "labour",
          lines: entry.lines.map((line) => ({ ...line, costType: "labour" })),
        })),
      });
      const entry = before.entries[0];
      const after = organizeHistoricalEntry(
        before,
        entry,
        reviewDraft(entry, before).map((draft) => ({ ...draft, costType })),
      );
      expect(after.entries[0].account).toBe(
        costType === "material" ? "materials" : "other",
      );
      expect(after.entries[0].lines[0]).toMatchObject({
        costType,
        id: entry.lines[0].id,
        amount: 50000,
      });
      expect(after.entries[0]).toMatchObject({
        personId: entry.personId,
        date: entry.date,
        source: entry.source,
        balanceImpact: "historical",
      });
      expect(summarize(after)).toMatchObject({
        historicalCost: 50000,
        confirmedCost: 0,
        paid: 0,
        payable: 0,
        advance: 0,
      });
    },
  );
  it("never infers wages from a worker's identity or normalizes an unchanged legacy account", () => {
    const before = LedgerSchema.parse({
      ...example(),
      people: [{ id: "worker", name: "মিস্ত্রি", kind: "worker" }],
      entries: example().entries.map((entry) => ({
        ...entry,
        personId: "worker",
        account: "other",
      })),
    });
    const after = organizeHistoricalEntry(
      before,
      before.entries[0],
      reviewDraft(before.entries[0], before),
    );
    expect(after.entries[0]).toMatchObject({
      personId: "worker",
      account: "other",
      lines: [{ costType: "material", amount: 50000 }],
    });
  });
  it("rejects mixed labour and nonlabour selections without rewriting any other line", () => {
    const before = LedgerSchema.parse({
      ...example(),
      entries: example().entries.map((entry) => ({
        ...entry,
        lines: [
          ...entry.lines,
          { ...entry.lines[0], id: "second", amount: 20000 },
        ],
      })),
    });
    const original = structuredClone(before),
      drafts = reviewDraft(before.entries[0], before);
    drafts[0].costType = "labour";
    expect(() =>
      organizeHistoricalEntry(before, before.entries[0], drafts),
    ).toThrow("mixed_historical_cost_types");
    expect(before).toEqual(original);
  });
  it.each([false, true])(
    "rejects account changes with linked settlements, including cancelled ones (%s)",
    (voided) => {
      const before = LedgerSchema.parse({
        ...example(),
        entries: [
          ...example().entries,
          {
            id: "paid",
            kind: "payment",
            relatedEntryId: "old",
            voided,
            account: "materials",
            paymentParts: [{ amount: 1000 }],
            allocations: [{ workId: "plaster", amount: 1000 }],
          },
        ],
      });
      const original = structuredClone(before);
      const drafts = reviewDraft(before.entries[0], before).map((draft) => ({
        ...draft,
        costType: "labour" as const,
      }));
      expect(() =>
        organizeHistoricalEntry(before, before.entries[0], drafts),
      ).toThrow("historical_review_linked_account");
      expect(before).toEqual(original);
    },
  );
  it("rejects changing a contract-linked entry out of labour without unlinking or rewriting relationships", () => {
    const before = LedgerSchema.parse({
      ...example(),
      people: [{ id: "worker", name: "মিস্ত্রি" }],
      contracts: [
        { id: "job", personId: "worker", workId: "plaster", total: 100000 },
      ],
      entries: example().entries.map((entry) => ({
        ...entry,
        personId: "worker",
        contractId: "job",
        account: "labour",
        lines: entry.lines.map((line) => ({ ...line, costType: "labour" })),
      })),
    });
    const original = structuredClone(before);
    expect(() =>
      organizeHistoricalEntry(
        before,
        before.entries[0],
        reviewDraft(before.entries[0], before).map((draft) => ({
          ...draft,
          costType: "material",
        })),
      ),
    ).toThrow("historical_review_linked_account");
    expect(before).toEqual(original);
  });
  it("rejects ordinary financial entries even when they have a source attachment", () => {
    const before = LedgerSchema.parse({
      ...example(),
      entries: example().entries.map((entry) => ({
        ...entry,
        balanceImpact: "normal",
      })),
    });
    expect(() =>
      organizeHistoricalEntry(
        before,
        before.entries[0],
        reviewDraft(before.entries[0], before),
      ),
    ).toThrow("historical_entry_required");
  });
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
