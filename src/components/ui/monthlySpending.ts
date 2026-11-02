import { cashSummary } from "../../domain/cashSummary";
import { effectiveAccounts } from "../../domain/effectiveAccounts";
import type { Account, Ledger } from "../../domain/model";
import { validHistoryDate } from "../../features/history/history";

export type SpendingScope = {
  workId?: string;
  personId?: string;
  account?: Account;
};
export type SpendingMonth = {
  month: string;
  material: number;
  labour: number;
  other: number;
  total: number;
};
export type SpendingCategory = "material" | "labour" | "other";
export const spendingCategories: SpendingCategory[] = [
  "material",
  "labour",
  "other",
];

function recentMonths(latest: string): SpendingMonth[] {
  if (!latest) return [];
  const [year, month] = latest.split("-").map(Number);
  const end = year * 12 + month - 1;
  return Array.from({ length: 6 }, (_, index) => {
    const serial = end - 5 + index;
    return {
      month: `${Math.floor(serial / 12)}-${String((serial % 12) + 1).padStart(2, "0")}`,
      material: 0,
      labour: 0,
      other: 0,
      total: 0,
    };
  });
}
export function monthlyCashSpending(
  ledger: Ledger,
  scope: SpendingScope = {},
): SpendingMonth[] {
  const rows = cashSummary(ledger, scope).rows.filter(
    (row) => row.entry.date && validHistoryDate(row.entry.date),
  );
  const latest = rows.reduce(
    (month, row) =>
      row.entry.date!.slice(0, 7) > month ? row.entry.date!.slice(0, 7) : month,
    "",
  );
  const months = recentMonths(latest);
  const buckets = new Map(months.map((row) => [row.month, row]));
  for (const row of rows) {
    const bucket = buckets.get(row.entry.date!.slice(0, 7));
    if (!bucket) continue;
    const category =
      row.account === "materials"
        ? "material"
        : row.account === "labour"
          ? "labour"
          : "other";
    bucket[category] += row.amount;
    bucket.total += row.amount;
  }
  return months;
}

export function monthlySpending(
  ledger: Ledger,
  scope: SpendingScope = {},
): SpendingMonth[] {
  const accounts = effectiveAccounts(ledger);
  const entries = ledger.entries.filter(
    (entry) =>
      !entry.voided &&
      (entry.kind === "expense" || entry.kind === "expense_credit") &&
      (!scope.personId || entry.personId === scope.personId) &&
      (!scope.account || accounts.get(entry.id) === scope.account) &&
      entry.date &&
      validHistoryDate(entry.date) &&
      entry.lines.some((line) => !scope.workId || line.workId === scope.workId),
  );
  const latest = entries.reduce(
    (month, entry) =>
      entry.date!.slice(0, 7) > month ? entry.date!.slice(0, 7) : month,
    "",
  );
  if (!latest) return [];
  const months = recentMonths(latest);
  const buckets = new Map(months.map((row) => [row.month, row]));
  for (const entry of entries) {
    const bucket = buckets.get(entry.date!.slice(0, 7));
    if (!bucket) continue;
    const sign = entry.kind === "expense_credit" ? -1 : 1;
    for (const line of entry.lines) {
      if (scope.workId && line.workId !== scope.workId) continue;
      const category =
        line.costType === "material"
          ? "material"
          : line.costType === "labour"
            ? "labour"
            : "other";
      bucket[category] += sign * line.amount;
      bucket.total += sign * line.amount;
    }
  }
  return months;
}

export function smoothSpendingPath(points: { x: number; y: number }[]) {
  return points
    .map((point, index) => {
      if (!index) return `M ${point.x} ${point.y}`;
      const previous = points[index - 1];
      const middle = (previous.x + point.x) / 2;
      return `C ${middle} ${previous.y} ${middle} ${point.y} ${point.x} ${point.y}`;
    })
    .join(" ");
}
