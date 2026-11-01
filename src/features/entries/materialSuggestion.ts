import type { Item, Ledger } from "../../domain/model";
type SuggestedRow = { autoItemName?: string };
export function materialSuggestion(
  items: Item[],
  value: string,
  previous: SuggestedRow,
) {
  const matches = items.filter((item) => item.name === value);
  const variants = new Set(
    matches.map((item) =>
      JSON.stringify([item.materialGroupId, item.brand, item.usage, item.unit]),
    ),
  );
  if (matches.length && variants.size === 1) {
    const item = matches[0];
    return {
      label: value,
      groupId: item.materialGroupId ?? "",
      brand: item.brand,
      usage: item.usage,
      unit: item.unit,
      autoItemName: value,
    };
  }
  return previous.autoItemName
    ? {
        label: value,
        groupId: "",
        brand: "",
        usage: "",
        unit: "",
        autoItemName: "",
      }
    : { label: value };
}

export function materialItems(ledger: Ledger) {
  const materials = new Set<string>();
  const otherCosts = new Set<string>();
  for (const entry of ledger.entries) {
    if (entry.voided) continue;
    for (const line of entry.lines) {
      if (line.itemId)
        (line.costType === "material" ? materials : otherCosts).add(
          line.itemId,
        );
    }
  }
  return ledger.items.filter(
    (item) => !otherCosts.has(item.id) || materials.has(item.id),
  );
}
