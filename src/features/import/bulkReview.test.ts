import { describe, expect, it } from "vitest";
import { LedgerSchema } from "../../domain/model";
import { summarize } from "../../domain/ledger";
import {
  bulkOrganizeHistoricalEntries,
  pendingReviewEntries,
} from "./bulkReview";
function fixture() {
  return LedgerSchema.parse({
    works: [
      { id: "old", name: "পুরোনো" },
      { id: "sand", name: "বালু" },
    ],
    materialGroups: [{ id: "sand", name: "বালু" }],
    entries: [1, 2, 3].map((id) => ({
      id: `e${id}`,
      kind: id === 2 ? "expense_credit" : "expense",
      balanceImpact: "historical",
      reviewStatus: id === 3 ? "confirmed" : "needs_review",
      date: id === 1 ? null : "2026-01-01",
      note: `মূল নোট ${id}`,
      source: {
        file: "original.xlsx",
        sheet: "cost",
        cell: `A${id}`,
        checksum: `${id}`.repeat(64),
        ledger: "Cost",
        note: `মূল লেখা ${id}`,
      },
      lines: [
        {
          id: `l${id}`,
          workId: "old",
          label: "বালু",
          costType: "other",
          amount: id * 10000,
          quantity: "3",
          unit: "ফুট",
        },
      ],
    })),
  });
}
describe("bulk historical review", () => {
  it("classifies selected rows together while preserving every money/date/provenance field", () => {
    const source = fixture();
    const originals = structuredClone(source.entries.slice(0, 2));
    const before = summarize(source);
    const result = bulkOrganizeHistoricalEntries(source, originals, {
      workId: "sand",
      costType: "material",
      groupId: "sand",
    });
    expect(pendingReviewEntries(source)).toHaveLength(2);
    expect(pendingReviewEntries(result)).toHaveLength(0);
    expect(result.entries[2]).toEqual(source.entries[2]);
    for (let index = 0; index < 2; index++) {
      const { revisions, reviewStatus, lines, ...rest } = result.entries[index];
      const {
        revisions: oldRevisions,
        reviewStatus: oldStatus,
        lines: oldLines,
        ...oldRest
      } = originals[index];
      expect(rest).toMatchObject({ ...oldRest, updatedAt: expect.any(String) });
      expect(lines[0]).toMatchObject({
        amount: oldLines[0].amount,
        quantity: "3",
        unit: "ফুট",
        workId: "sand",
        materialGroupId: "sand",
        costType: "material",
      });
      expect(revisions).toHaveLength(oldRevisions.length + 1);
      expect(revisions[0].before).toMatchObject({
        reviewStatus: oldStatus,
        source: originals[index].source,
        date: originals[index].date,
      });
      expect(reviewStatus).toBe("confirmed");
    }
    const after = summarize(result);
    expect([
      after.cost,
      after.historicalCost,
      after.paid,
      after.payable,
      after.advance,
    ]).toEqual([
      before.cost,
      before.historicalCost,
      before.paid,
      before.payable,
      before.advance,
    ]);
    expect(source.entries[0].reviewStatus).toBe("needs_review");
  });
  it("checks the whole selection before changing anything, including concurrent edits", () => {
    const source = fixture();
    const originals = structuredClone(source.entries.slice(0, 2));
    source.entries[1].note = "অন্য জায়গায় বদলেছে";
    expect(() => bulkOrganizeHistoricalEntries(source, originals, {})).toThrow(
      "review_conflict",
    );
    expect(source.entries[0].revisions).toHaveLength(0);
    expect(source.entries[0].reviewStatus).toBe("needs_review");
    expect(() =>
      bulkOrganizeHistoricalEntries(source, [source.entries[0]], {
        groupId: "missing",
      }),
    ).toThrow("unknown_material_group");
    expect(() =>
      bulkOrganizeHistoricalEntries(
        source,
        [source.entries[0], source.entries[0]],
        {},
      ),
    ).toThrow("invalid_review_selection");
  });
});
