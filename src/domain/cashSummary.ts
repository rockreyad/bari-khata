import type { Account, Entry, Ledger } from "./model";
import { effectiveAccounts } from "./effectiveAccounts";
import { latinDigits } from "../lib/numerals";

export type CashScope = {
  workId?: string;
  personId?: string;
  account?: Account;
  from?: string;
  to?: string;
  query?: string;
};
export type CashRow = {
  entry: Entry;
  workId: string;
  amount: number;
  account: Account;
};
export function cashSummary(ledger: Ledger, scope: CashScope = {}) {
  const accounts = effectiveAccounts(ledger);
  const people = new Map(
    ledger.people.map((person) => [person.id, person.name]),
  );
  const works = new Map(ledger.works.map((work) => [work.id, work.name]));
  const query = latinDigits(scope.query ?? "")
    .trim()
    .toLocaleLowerCase();
  const rows: CashRow[] = [];
  for (const entry of ledger.entries) {
    if (
      entry.voided ||
      entry.balanceImpact === "historical" ||
      (entry.kind !== "payment" && entry.kind !== "refund") ||
      (scope.personId &&
        (scope.personId === "__anonymous__"
          ? entry.personId !== null
          : entry.personId !== scope.personId)) ||
      (scope.from && (!entry.date || entry.date < scope.from)) ||
      (scope.to && (!entry.date || entry.date > scope.to))
    )
      continue;
    const account = accounts.get(entry.id) ?? entry.account;
    if (scope.account && scope.account !== account) continue;
    for (const part of entry.allocations) {
      if (scope.workId && part.workId !== scope.workId) continue;
      if (
        query &&
        !latinDigits(
          [people.get(entry.personId ?? ""), works.get(part.workId), entry.note]
            .filter(Boolean)
            .join(" "),
        )
          .toLocaleLowerCase()
          .includes(query)
      )
        continue;
      rows.push({
        entry,
        workId: part.workId,
        amount: part.amount * (entry.kind === "refund" ? -1 : 1),
        account,
      });
    }
  }
  const byAccount = { materials: 0, labour: 0, other: 0 };
  const workTotals = new Map<string, number>();
  const personTotals = new Map<string | null, number>();
  const entries = new Map<string, Entry>();
  let paid = 0,
    refunds = 0;
  for (const row of rows) {
    if (row.entry.kind === "payment") paid += row.amount;
    else refunds -= row.amount;
    byAccount[row.account] += row.amount;
    workTotals.set(row.workId, (workTotals.get(row.workId) ?? 0) + row.amount);
    personTotals.set(
      row.entry.personId,
      (personTotals.get(row.entry.personId) ?? 0) + row.amount,
    );
    entries.set(row.entry.id, row.entry);
  }
  const sortAmounts = <T extends { amount: number }>(values: T[]) =>
    values.sort((a, b) => b.amount - a.amount);
  return {
    paid,
    refunds,
    netPaid: paid - refunds,
    byAccount,
    rows,
    entries: [...entries.values()],
    byWork: sortAmounts(
      [...workTotals].map(([id, amount]) => ({ id, amount })),
    ),
    byPerson: sortAmounts(
      [...personTotals].map(([id, amount]) => ({ id, amount })),
    ),
  };
}
