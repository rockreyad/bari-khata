import { replaceEntry } from "../../domain/ledger";
import {
  EntrySchema,
  type CostType,
  type Entry,
  type Item,
  type Ledger,
} from "../../domain/model";

export type LineDraft = {
  id: string;
  workId: string;
  groupId: string;
  itemId: string;
  brand: string;
  usage: string;
  costType: CostType;
};

export function reviewDraft(entry: Entry, ledger: Ledger): LineDraft[] {
  return entry.lines.map((line) => {
    const item = ledger.items.find((value) => value.id === line.itemId);
    return {
      id: line.id,
      workId: line.workId,
      groupId: line.materialGroupId || item?.materialGroupId || "",
      itemId: item?.id || "",
      brand: item?.brand || "",
      usage: line.usage || item?.usage || "",
      costType: line.costType,
    };
  });
}

export function organizeHistoricalEntry(
  current: Ledger,
  original: Entry,
  drafts: LineDraft[],
): Ledger {
  const latest = current.entries.find((value) => value.id === original.id);
  if (!latest || JSON.stringify(latest) !== JSON.stringify(original))
    throw new Error("review_conflict");
  if (
    original.balanceImpact !== "historical" ||
    !original.source ||
    (original.kind !== "expense" && original.kind !== "expense_credit")
  )
    throw new Error("historical_entry_required");
  const items = [...current.items];
  const lines = original.lines.map((line) => {
    const draft = drafts.find((value) => value.id === line.id);
    if (!draft) throw new Error("missing_line");
    let item = items.find((value) => value.id === draft.itemId);
    const groupId = draft.groupId || null;
    const brand = draft.brand.trim();
    const usage = draft.usage.trim();
    if (item && item.materialGroupId !== groupId)
      throw new Error("item_group_mismatch");
    if (
      groupId &&
      ((item && (item.brand !== brand || item.usage !== usage)) ||
        (!item && brand))
    ) {
      const matching = items.find(
        (value) =>
          value.materialGroupId === groupId &&
          value.brand === brand &&
          value.usage === usage,
      );
      if (matching) item = matching;
      else {
        const group = current.materialGroups.find(
          (value) => value.id === groupId,
        );
        if (!group) throw new Error("unknown_material_group");
        const variant: Item = {
          id: `review-item:${crypto.randomUUID()}`,
          materialGroupId: groupId,
          name: [group.name, brand, usage]
            .filter(Boolean)
            .join(" · ")
            .slice(0, 200),
          brand,
          usage,
          unit: item?.unit || line.unit,
          aliases: [],
        };
        items.push(variant);
        item = variant;
      }
    }
    return {
      ...line,
      workId: draft.workId,
      materialGroupId: groupId,
      itemId: groupId ? (item?.id ?? null) : null,
      usage,
      costType: draft.costType,
    };
  });
  return replaceEntry(
    { ...current, items },
    EntrySchema.parse({
      ...original,
      lines,
      reviewStatus: "confirmed",
      balanceImpact: original.balanceImpact,
      source: original.source,
    }),
  );
}
