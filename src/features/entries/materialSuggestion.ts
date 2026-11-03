import { normalizeLabel } from "../../lib/normalizeLabel";
import type { Item, Ledger } from "../../domain/model";
type SuggestedRow = {
  autoItemName?: string;
  groupId?: string;
  brand?: string;
  usage?: string;
  unit?: string;
};
export function materialSuggestion(
  items: Item[],
  value: string,
  previous: SuggestedRow,
) {
  const query = normalizeLabel(value);
  const matches = query
    ? items.filter((item) =>
        [item.name, ...item.aliases].some(
          (name) => normalizeLabel(name) === query,
        ),
      )
    : [];
  const variants = new Set(
    matches.map((item) =>
      JSON.stringify([
        item.materialGroupId,
        normalizeLabel(item.brand),
        normalizeLabel(item.usage),
        normalizeLabel(item.unit),
      ]),
    ),
  );
  if (matches.length && variants.size === 1) {
    if (
      !previous.autoItemName &&
      [previous.groupId, previous.brand, previous.usage, previous.unit].some(
        Boolean,
      )
    )
      return { label: value };
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
  const items = ledger.items.filter(
    (item) => !otherCosts.has(item.id) || materials.has(item.id),
  );
  const byId = new Map(ledger.items.map((item) => [item.id, item]));
  for (const entry of ledger.entries) {
    if (entry.voided) continue;
    for (const line of entry.lines) {
      const name = line.label.trim();
      if (line.costType !== "material" || !name || name.length > 200) continue;
      const catalog = line.itemId ? byId.get(line.itemId) : undefined;
      items.push({
        id: `history-suggestion-${items.length}`,
        name,
        materialGroupId:
          line.materialGroupId ?? catalog?.materialGroupId ?? null,
        brand: catalog?.brand ?? "",
        usage: line.usage || catalog?.usage || "",
        unit: line.unit || catalog?.unit || "",
        aliases: catalog?.aliases ?? [],
      });
    }
  }
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = JSON.stringify([
      normalizeLabel(item.name),
      item.materialGroupId,
      normalizeLabel(item.brand),
      normalizeLabel(item.usage),
      normalizeLabel(item.unit),
      item.aliases.map(normalizeLabel).sort(),
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
