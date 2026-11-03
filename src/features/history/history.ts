import { poishaDecimal } from "../../domain/money";
import { effectiveAccounts } from "../../domain/effectiveAccounts";
import type { Entry, Ledger } from "../../domain/model";
import { entryTotal, entryWorkIds } from "../../domain/ledger";
export type HistoryOrder = "newest" | "oldest";
export type HistoryFilters = {
  query?: string;
  personId?: string;
  workId?: string;
  account?: string;
  kind?: string;
  costType?: string;
  from?: string;
  to?: string;
  includeVoided?: boolean;
};
const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[০-৯]/g, (digit) => String("০১২৩৪৫৬৭৮৯".indexOf(digit)))
    .replace(/\s+/g, " ")
    .trim();
export function validHistoryDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(stamp) &&
    new Date(stamp).toISOString().slice(0, 10) === value
    ? value
    : "";
}
export function sortHistory(entries: Entry[], order: HistoryOrder = "newest") {
  const sign = order === "oldest" ? 1 : -1;
  return [...entries].sort((a, b) => {
    if (!a.date && b.date) return 1;
    if (a.date && !b.date) return -1;
    return (
      sign *
      ((a.date ?? "").localeCompare(b.date ?? "") ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id))
    );
  });
}
export function filterHistory(ledger: Ledger, filters: HistoryFilters = {}) {
  const accounts = effectiveAccounts(ledger);
  const people = new Map(ledger.people.map((p) => [p.id, p.name]));
  const works = new Map(ledger.works.map((w) => [w.id, w.name]));
  const items = new Map(ledger.items.map((i) => [i.id, i]));
  const groups = new Map(ledger.materialGroups.map((g) => [g.id, g.name]));
  const purposes = new Map(
    ledger.paymentPurposes.map((purpose) => [purpose.id, purpose.name]),
  );
  const words = normalize(filters.query ?? "")
    .split(" ")
    .filter(Boolean);
  return ledger.entries.filter((entry) => {
    if (!filters.includeVoided && entry.voided) return false;
    if (filters.personId && entry.personId !== filters.personId) return false;
    if (filters.workId && !entryWorkIds(entry).includes(filters.workId))
      return false;
    if (filters.account && accounts.get(entry.id) !== filters.account)
      return false;
    if (filters.kind && entry.kind !== filters.kind) return false;
    if (
      filters.costType &&
      !entry.lines.some((l) => l.costType === filters.costType)
    )
      return false;
    if (filters.from && (!entry.date || entry.date < filters.from))
      return false;
    if (filters.to && (!entry.date || entry.date > filters.to)) return false;
    if (!words.length) return true;
    const haystack = normalize(
      [
        entry.note,
        entry.source?.note,
        entry.paymentPurposeId ? purposes.get(entry.paymentPurposeId) : "",
        entry.personId ? people.get(entry.personId) : "",
        poishaDecimal(entryTotal(entry)),
        ...entryWorkIds(entry).map((id) => works.get(id)),
        ...entry.lines.flatMap((line) => {
          const item = line.itemId ? items.get(line.itemId) : undefined;
          return [
            line.label,
            line.usage,
            item?.name,
            item?.brand,
            item?.usage,
            ...(item?.aliases ?? []),
            groups.get(line.materialGroupId ?? item?.materialGroupId ?? ""),
          ];
        }),
      ]
        .filter(Boolean)
        .join(" "),
    );
    return words.every((word) => haystack.includes(word));
  });
}
export const entryKindLabels = {
  expense: "খরচ",
  payment: "টাকা দিয়েছি",
  expense_credit: "মাল ফেরত",
  refund: "টাকা ফেরত পেয়েছি",
};
export function historyTitle(ledger: Ledger, entry: Entry, hidePerson = false) {
  const person = ledger.people.find((p) => p.id === entry.personId);
  if (entry.kind === "payment" || entry.kind === "refund")
    return (
      (!hidePerson && person?.name) ||
      ledger.paymentPurposes.find(
        (purpose) => purpose.id === entry.paymentPurposeId,
      )?.name ||
      (entry.kind === "refund"
        ? "টাকা ফেরত পেয়েছি"
        : entry.account === "labour"
          ? "মজুরি দিয়েছি"
          : "টাকা দিয়েছি")
    );
  return (
    entry.lines[0]?.label ||
    entry.note ||
    (entry.account === "labour" ? "মজুরির হিসাব" : "খরচ")
  );
}
export function historySubtitle(
  ledger: Ledger,
  entry: Entry,
  {
    hidePerson = false,
    hideWork = false,
  }: { hidePerson?: boolean; hideWork?: boolean } = {},
) {
  const parts: string[] = [];
  if (!hideWork)
    parts.push(
      ...entryWorkIds(entry)
        .map((id) => ledger.works.find((w) => w.id === id)?.name ?? "")
        .filter(Boolean),
    );
  if (!hidePerson && entry.lines.length && entry.personId) {
    const name = ledger.people.find((p) => p.id === entry.personId)?.name;
    if (name) parts.push(name);
  }
  if (!hidePerson && entry.paymentPurposeId) {
    const purpose = ledger.paymentPurposes.find(
      (value) => value.id === entry.paymentPurposeId,
    );
    if (purpose) parts.push(purpose.name);
  }
  if (!parts.length) parts.push(entryKindLabels[entry.kind]);
  return [...new Set(parts)].join(" · ");
}

export function historyGroups(entries: Entry[]) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const payments = new Map<string, Entry[]>();
  const hiddenIds = new Set<string>();
  for (const entry of entries) {
    const bill = entry.relatedEntryId
      ? byId.get(entry.relatedEntryId)
      : undefined;
    if (
      entry.kind !== "payment" ||
      entry.voided ||
      !bill ||
      bill.kind !== "expense" ||
      bill.voided ||
      !entry.createdAt ||
      entry.createdAt !== bill.createdAt ||
      entry.date !== bill.date ||
      entry.balanceImpact !== bill.balanceImpact
    )
      continue;
    hiddenIds.add(entry.id);
    payments.set(bill.id, [...(payments.get(bill.id) ?? []), entry]);
  }
  return {
    entries: entries.filter((entry) => !hiddenIds.has(entry.id)),
    payments,
    hiddenIds,
  };
}
export function compactHistory(entries: Entry[]) {
  return historyGroups(entries).entries;
}
