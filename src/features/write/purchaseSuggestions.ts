import type { AppSuggestion } from "../../components/ui/AppCombobox";
import type { Ledger } from "../../domain/model";
import { contractQuantity } from "../../lib/numericFields";
import { normalizeLabel } from "../../lib/normalizeLabel";
import { latinDigits } from "../../lib/numerals";
import { materialItems } from "../entries/materialSuggestion";

export type PurchaseSuggestion = AppSuggestion & {
  id: string;
  groupId: string;
  groupName: string;
  brand: string;
  usage: string;
  quantity: string;
  unit: string;
};
const knownQuantity = (value: string) => {
  const canonical = latinDigits(value).trim();
  return /^\d+(?:\.\d+)?$/.test(canonical)
    ? canonical
    : (contractQuantity(value) ?? "");
};

export function purchaseSuggestions(ledger: Ledger, workId = "") {
  const items = new Map(ledger.items.map((item) => [item.id, item]));
  const groups = new Map(
    ledger.materialGroups.map((group) => [group.id, group.name]),
  );
  const history = ledger.entries
    .filter((entry) => entry.kind === "expense" && !entry.voided)
    .flatMap((entry) =>
      entry.lines
        .filter(
          (line) =>
            line.costType === "material" &&
            line.label.trim() &&
            line.label.trim().length <= 200,
        )
        .map((line) => {
          const item = items.get(line.itemId ?? "");
          const groupId = line.materialGroupId ?? item?.materialGroupId ?? "";
          return {
            id: JSON.stringify(["history", entry.id, line.id]),
            value: line.label.trim(),
            groupId,
            groupName: groups.get(groupId) ?? "",
            brand: item?.brand ?? "",
            usage: line.usage || item?.usage || "",
            quantity: knownQuantity(line.quantity),
            unit: line.unit || item?.unit || "",
            workMatch: Boolean(workId && line.workId === workId),
            at: entry.date ?? entry.createdAt,
          };
        }),
    )
    .sort(
      (a, b) =>
        Number(b.workMatch) - Number(a.workMatch) ||
        b.at.localeCompare(a.at) ||
        a.id.localeCompare(b.id),
    );
  const catalog = materialItems(ledger)
    .filter((item) => items.has(item.id))
    .map((item) => ({
      id: JSON.stringify(["catalog", item.id]),
      value: item.name,
      groupId: item.materialGroupId ?? "",
      groupName: groups.get(item.materialGroupId ?? "") ?? "",
      brand: item.brand,
      usage: item.usage,
      quantity: "",
      unit: item.unit,
    }));
  const seen = new Set<string>();
  const choices: PurchaseSuggestion[] = [];
  for (const candidate of [...history, ...catalog]) {
    const key = JSON.stringify(
      [
        candidate.value,
        candidate.groupId,
        candidate.brand,
        candidate.usage,
        candidate.quantity,
        candidate.unit,
      ].map(normalizeLabel),
    );
    if (seen.has(key)) continue;
    seen.add(key);
    choices.push({
      id: candidate.id,
      value: candidate.value,
      groupId: candidate.groupId,
      groupName: candidate.groupName,
      brand: candidate.brand,
      usage: candidate.usage,
      quantity: candidate.quantity,
      unit: candidate.unit,
      description: [
        candidate.brand,
        [candidate.quantity, candidate.unit].filter(Boolean).join(" "),
        candidate.groupName,
        candidate.usage,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }
  return choices;
}
