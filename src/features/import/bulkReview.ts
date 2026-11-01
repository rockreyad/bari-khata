import type { CostType, Entry, Ledger } from "../../domain/model";
import { organizeHistoricalEntry, reviewDraft } from "./review";

export function reviewableEntries(ledger: Ledger) {
  return ledger.entries.filter(
    (entry) =>
      !entry.voided &&
      entry.balanceImpact === "historical" &&
      entry.source &&
      (entry.kind === "expense" || entry.kind === "expense_credit"),
  );
}
export function pendingReviewEntries(ledger: Ledger) {
  return reviewableEntries(ledger).filter(
    (entry) => entry.reviewStatus === "needs_review",
  );
}
export type BulkReviewChanges = {
  workId?: string;
  costType?: CostType;
  groupId?: string;
};
export function bulkOrganizeHistoricalEntries(
  current: Ledger,
  originals: Entry[],
  changes: BulkReviewChanges,
): Ledger {
  if (
    !originals.length ||
    originals.length > 100 ||
    new Set(originals.map((entry) => entry.id)).size !== originals.length
  )
    throw new Error("invalid_review_selection");
  if (
    changes.workId &&
    !current.works.some((work) => work.id === changes.workId)
  )
    throw new Error("unknown_work");
  if (
    changes.groupId &&
    !current.materialGroups.some((group) => group.id === changes.groupId)
  )
    throw new Error("unknown_material_group");
  for (const original of originals) {
    const latest = current.entries.find((entry) => entry.id === original.id);
    if (
      !latest ||
      latest.voided ||
      JSON.stringify(latest) !== JSON.stringify(original)
    )
      throw new Error("review_conflict");
  }
  return originals.reduce((ledger, original) => {
    const drafts = reviewDraft(original, ledger).map((draft) => ({
      ...draft,
      ...(changes.workId ? { workId: changes.workId } : {}),
      ...(changes.costType ? { costType: changes.costType } : {}),
      ...(changes.groupId && changes.groupId !== draft.groupId
        ? { groupId: changes.groupId, itemId: "", brand: "" }
        : {}),
    }));
    return organizeHistoricalEntry(ledger, original, drafts);
  }, current);
}
