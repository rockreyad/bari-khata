import type { AppSuggestion } from "../../components/ui/AppCombobox";
import type { CostType, Ledger } from "../../domain/model";
import { normalizeLabel } from "../../lib/normalizeLabel";

type DescriptionScope = {
  costType: CostType;
  personId?: string;
  workId?: string;
  contractId?: string;
};

export function workDescriptionSuggestions(
  ledger: Ledger,
  scope: DescriptionScope,
): AppSuggestion[] {
  const people = new Map(
    ledger.people.map((person) => [person.id, person.name]),
  );
  const works = new Map(ledger.works.map((work) => [work.id, work.name]));
  const candidates = ledger.entries
    .filter(
      (entry) =>
        entry.kind === "expense" &&
        !entry.voided &&
        entry.reviewStatus === "confirmed",
    )
    .flatMap((entry) =>
      entry.lines
        .filter(
          (line) =>
            line.costType !== "material" &&
            line.costType === scope.costType &&
            line.label.trim() &&
            line.label.trim().length <= 200,
        )
        .map((line) => ({
          value: line.label.trim(),
          description: [
            entry.personId ? people.get(entry.personId) : "",
            works.get(line.workId),
          ]
            .filter(Boolean)
            .join(" · "),
          priority:
            Number(
              Boolean(
                scope.contractId && entry.contractId === scope.contractId,
              ),
            ) *
              8 +
            Number(
              Boolean(scope.personId && entry.personId === scope.personId),
            ) *
              4 +
            Number(Boolean(scope.workId && line.workId === scope.workId)) * 2,
          at: entry.date ?? entry.createdAt,
          id: line.id,
        })),
    )
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        b.at.localeCompare(a.at) ||
        a.id.localeCompare(b.id),
    );
  const unique = new Map<string, AppSuggestion>();
  for (const candidate of candidates) {
    const key = normalizeLabel(candidate.value);
    if (!unique.has(key))
      unique.set(key, {
        value: candidate.value,
        description: candidate.description,
      });
    if (unique.size === 24) break;
  }
  return [...unique.values()];
}
