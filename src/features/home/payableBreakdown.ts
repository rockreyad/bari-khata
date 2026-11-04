import { reconciledPayableGroups } from "../../domain/adjustmentMath";
import { effectiveAccounts } from "../../domain/effectiveAccounts";
import { entryWorkIds } from "../../domain/ledger";
import type { Account, Ledger } from "../../domain/model";

export type PayableRow = {
  id: string;
  personId: string | null;
  entryId: string | null;
  amount: number;
  workIds: string[];
  wholeHouse: boolean;
};

export function payableBreakdown(ledger: Ledger): {
  total: number;
  rows: PayableRow[];
} {
  const { total, groups } = reconciledPayableGroups(ledger);
  const people = new Set(ledger.people.map((person) => person.id));
  const rows = new Map<
    string,
    {
      row: PayableRow;
      amount: bigint;
      accounts: Set<Account>;
      workIds: Set<string>;
    }
  >();
  for (const group of groups) {
    let current = rows.get(group.party);
    if (!current) {
      const personId = people.has(group.party) ? group.party : null;
      const entryId =
        !personId && group.party.startsWith("anonymous:")
          ? group.party.slice("anonymous:".length)
          : null;
      current = {
        row: {
          id: group.party,
          personId,
          entryId,
          amount: 0,
          workIds: [],
          wholeHouse: false,
        },
        amount: 0n,
        accounts: new Set(),
        workIds: new Set(),
      };
      rows.set(group.party, current);
    }
    current.amount += BigInt(group.amount);
    current.accounts.add(group.account);
  }
  const accounts = effectiveAccounts(ledger);
  for (const entry of ledger.entries) {
    if (
      entry.voided ||
      entry.balanceImpact === "historical" ||
      (entry.kind === "adjustment" && entry.adjustment?.target !== "person")
    )
      continue;
    const party =
      entry.personId ?? `anonymous:${entry.relatedEntryId ?? entry.id}`;
    const current = rows.get(party);
    if (!current?.accounts.has(accounts.get(entry.id) ?? entry.account))
      continue;
    for (const workId of entryWorkIds(entry)) current.workIds.add(workId);
  }
  for (const contract of ledger.contracts) {
    const current = rows.get(contract.personId);
    if (!current?.accounts.has("labour")) continue;
    if (contract.scope === "house") current.row.wholeHouse = true;
    else if (contract.workId) current.workIds.add(contract.workId);
  }
  return {
    total,
    rows: [...rows.values()]
      .map(({ row, amount, workIds }) => ({
        ...row,
        amount: Number(amount),
        workIds: [...workIds],
      }))
      .sort((a, b) => b.amount - a.amount),
  };
}
