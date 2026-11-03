import type { Entry } from "../../domain/model";
import { entryWorkAmount } from "../../domain/ledger";
import { historyGroups, sortHistory } from "../history/history";

export type WorkTab =
  "all" | "material" | "labour" | "transport" | "other" | "activity";
export function workTabEntries(entries: Entry[], workId: string, tab: WorkTab) {
  if (tab === "all") return entries;
  const types =
    tab === "transport"
      ? ["transport", "unload"]
      : tab === "other"
        ? ["other", "rental"]
        : [tab];
  const bills = entries.filter((entry) =>
    entry.lines.some(
      (line) => line.workId === workId && types.includes(line.costType),
    ),
  );
  const billIds = new Set(bills.map((entry) => entry.id));
  const unambiguousBills = new Set(
    bills
      .filter((entry) =>
        entry.lines
          .filter((line) => line.workId === workId)
          .every((line) => types.includes(line.costType)),
      )
      .map((entry) => entry.id),
  );
  return entries.filter(
    (entry) =>
      billIds.has(entry.id) ||
      ((entry.kind === "payment" || entry.kind === "refund") &&
        (entry.relatedEntryId
          ? unambiguousBills.has(entry.relatedEntryId)
          : tab === "material"
            ? entry.account === "materials"
            : tab === "labour"
              ? entry.account === "labour"
              : false)),
  );
}
export function workEntryAmount(entry: Entry, workId: string, tab: WorkTab) {
  if (entry.kind === "adjustment") {
    const amount = tab === "all" ? entryWorkAmount(entry, workId) : 0;
    return amount ? amount * ((entry.adjustment?.delta ?? 0) < 0 ? -1 : 1) : 0;
  }
  if (entry.kind === "payment" || entry.kind === "refund" || tab === "all")
    return (
      entryWorkAmount(entry, workId) *
      (entry.kind === "expense_credit" || entry.kind === "refund" ? -1 : 1)
    );
  const types =
    tab === "transport"
      ? ["transport", "unload"]
      : tab === "other"
        ? ["other", "rental"]
        : [tab];
  return (
    entry.lines
      .filter((line) => line.workId === workId && types.includes(line.costType))
      .reduce((sum, line) => sum + line.amount, 0) *
    (entry.kind === "expense_credit" ? -1 : 1)
  );
}
export function recentWorkEntries(entries: Entry[], limit = 10) {
  const grouped = historyGroups(sortHistory(entries));
  return grouped.entries
    .slice(0, limit)
    .flatMap((entry) => [entry, ...(grouped.payments.get(entry.id) ?? [])]);
}
