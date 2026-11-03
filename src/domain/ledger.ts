import { parseMoneyText } from "./money.js";
import { effectiveAccounts } from "./effectiveAccounts.js";
import type { Account, CostType, Entry, Ledger } from "./model.js";
import { EntryCoreSchema, validateLedger } from "./model.js";

export const accounts: Account[] = ["materials", "labour", "other"];
export const costTypes: CostType[] = [
  "material",
  "labour",
  "transport",
  "unload",
  "rental",
  "other",
];

export function entryTotal(entry: Entry): number {
  return entry.kind === "expense" || entry.kind === "expense_credit"
    ? entry.lines.reduce((total, line) => total + line.amount, 0)
    : entry.paymentParts.reduce((total, part) => total + part.amount, 0);
}

export function entryWorkAmount(entry: Entry, workId?: string): number {
  if (!workId) return entryTotal(entry);
  return entry.kind === "expense" || entry.kind === "expense_credit"
    ? entry.lines
        .filter((line) => line.workId === workId)
        .reduce((total, line) => total + line.amount, 0)
    : entry.allocations
        .filter((line) => line.workId === workId)
        .reduce((total, line) => total + line.amount, 0);
}

export function entryWorkIds(entry: Entry): string[] {
  return [
    ...new Set(
      (entry.kind === "expense" || entry.kind === "expense_credit"
        ? entry.lines
        : entry.allocations
      ).map((line) => line.workId),
    ),
  ];
}

export function activeEntries(ledger: Ledger, workId?: string): Entry[] {
  return ledger.entries.filter(
    (entry) =>
      !entry.voided && (!workId || entryWorkIds(entry).includes(workId)),
  );
}

type Balance = {
  cost: number;
  paid: number;
  refunds: number;
  netPaid: number;
  balance: number;
  payable: number;
  advance: number;
};
const emptyBalance = (): Balance => ({
  cost: 0,
  paid: 0,
  refunds: 0,
  netPaid: 0,
  balance: 0,
  payable: 0,
  advance: 0,
});

function accountBalances(
  entries: Entry[],
  effective: Map<string, Account>,
  workId?: string,
): Map<string, Balance> {
  const balances = new Map<string, Balance>();
  for (const entry of entries) {
    if (entry.balanceImpact === "historical") continue;
    const isCost = entry.kind === "expense" || entry.kind === "expense_credit";
    const parts = isCost ? entry.lines : entry.allocations;
    for (const part of parts) {
      if (workId && part.workId !== workId) continue;
      // Unknown shops cannot settle each other's bills just because both names are blank.
      const party =
        entry.personId ?? `anonymous:${entry.relatedEntryId ?? entry.id}`;
      const key = JSON.stringify([
        party,
        effective.get(entry.id) ?? entry.account,
        workId ? part.workId : null,
        entry.contractId,
      ]);
      const balance = balances.get(key) ?? emptyBalance();
      if (isCost)
        balance.cost +=
          part.amount * (entry.kind === "expense_credit" ? -1 : 1);
      else if (entry.kind === "payment") balance.paid += part.amount;
      else balance.refunds += part.amount;
      balance.netPaid = balance.paid - balance.refunds;
      balance.balance = balance.cost - balance.netPaid;
      balance.payable = Math.max(balance.balance, 0);
      balance.advance = Math.max(-balance.balance, 0);
      balances.set(key, balance);
    }
  }
  return balances;
}

export function summarize(ledger: Ledger, workId?: string) {
  const entries = activeEntries(ledger, workId);
  const byType = Object.fromEntries(
    costTypes.map((type) => [type, 0]),
  ) as Record<CostType, number>;
  const byItem = new Map<
    string,
    { id: string; name: string; amount: number; unit: string }
  >();
  let cost = 0;
  let paid = 0;
  let refunds = 0;
  let historicalCost = 0;
  let reviewCount = 0;
  let historicalEntryCount = 0;
  for (const entry of entries) {
    const amount = entryWorkAmount(entry, workId);
    if (entry.reviewStatus === "needs_review") reviewCount++;
    if (entry.balanceImpact === "historical") historicalEntryCount++;
    if (
      entry.balanceImpact === "historical" &&
      (entry.kind === "expense" || entry.kind === "expense_credit")
    )
      historicalCost += amount * (entry.kind === "expense_credit" ? -1 : 1);
    if (entry.kind === "payment") {
      if (entry.balanceImpact !== "historical") paid += amount;
    } else if (entry.kind === "refund") {
      if (entry.balanceImpact !== "historical") refunds += amount;
    } else {
      const sign = entry.kind === "expense_credit" ? -1 : 1;
      cost += sign * amount;
      for (const line of entry.lines) {
        if (workId && line.workId !== workId) continue;
        byType[line.costType] += sign * line.amount;
        if (line.costType === "material" && (line.itemId || line.label)) {
          const item = ledger.items.find((item) => item.id === line.itemId);
          const id =
            line.itemId || `label:${line.label.trim().toLocaleLowerCase()}`;
          const row = byItem.get(id) ?? {
            id,
            name: item?.name || line.label,
            unit: item?.unit || line.unit,
            amount: 0,
          };
          row.amount += sign * line.amount;
          byItem.set(id, row);
        }
      }
    }
  }
  const balances = [
    ...accountBalances(entries, effectiveAccounts(ledger), workId).values(),
  ];
  const contracts = ledger.contracts.filter(
    (contract) =>
      !workId || (contract.scope === "work" && contract.workId === workId),
  );
  const contractSummaries = contracts.map((contract) =>
    contractSummary(ledger, contract.id),
  );
  return {
    cost,
    totalCost: cost,
    historicalCost,
    confirmedCost: cost - historicalCost,
    reviewCount,
    unreviewedCount: reviewCount,
    historicalEntryCount,
    paid,
    cashPaid: paid,
    refunds,
    cashReturned: refunds,
    netPaid: paid - refunds,
    payable: balances.reduce((sum, b) => sum + b.payable, 0),
    advance: balances.reduce((sum, b) => sum + b.advance, 0),
    byType,
    byItem: [...byItem.values()].sort((a, b) => b.amount - a.amount),
    entryCount: entries.length,
    entries,
    contractTotal: contracts.reduce((sum, contract) => sum + contract.total, 0),
    contractPaid: contractSummaries.reduce(
      (sum, contract) => sum + contract.netPaid,
      0,
    ),
    contractRemaining: contractSummaries.reduce(
      (sum, contract) => sum + contract.remaining,
      0,
    ),
  };
}

export function workSummary(ledger: Ledger, workId: string) {
  return {
    ...summarize(ledger, workId),
    work: ledger.works.find((work) => work.id === workId),
  };
}

export function personSummary(
  ledger: Ledger,
  personId: string,
  workId?: string,
) {
  const entries = activeEntries(ledger, workId).filter(
    (entry) => entry.personId === personId,
  );
  const effective = effectiveAccounts(ledger);
  const accountsResult = Object.fromEntries(
    accounts.map((account) => {
      const balances = [
        ...accountBalances(
          entries.filter((entry) => effective.get(entry.id) === account),
          effective,
          workId,
        ).values(),
      ];
      const confirmed = balances.reduce(
        (sum, b) => ({
          cost: sum.cost + b.cost,
          paid: sum.paid + b.paid,
          refunds: sum.refunds + b.refunds,
          netPaid: sum.netPaid + b.netPaid,
          balance: sum.balance + b.balance,
          payable: sum.payable + b.payable,
          advance: sum.advance + b.advance,
        }),
        emptyBalance(),
      );
      const historicalCost = entries
        .filter(
          (entry) =>
            effective.get(entry.id) === account &&
            entry.balanceImpact === "historical" &&
            (entry.kind === "expense" || entry.kind === "expense_credit"),
        )
        .reduce(
          (sum, entry) =>
            sum +
            entryWorkAmount(entry, workId) *
              (entry.kind === "expense_credit" ? -1 : 1),
          0,
        );
      return [
        account,
        {
          ...confirmed,
          cost: confirmed.cost + historicalCost,
          historicalCost,
          confirmedCost: confirmed.cost,
        },
      ];
    }),
  ) as Record<
    Account,
    Balance & { historicalCost: number; confirmedCost: number }
  >;
  const total = Object.values(accountsResult).reduce(
    (sum, b) => ({
      cost: sum.cost + b.cost,
      paid: sum.paid + b.paid,
      refunds: sum.refunds + b.refunds,
      netPaid: sum.netPaid + b.netPaid,
      balance: sum.balance + b.balance,
      payable: sum.payable + b.payable,
      advance: sum.advance + b.advance,
    }),
    emptyBalance(),
  );
  return {
    ...total,
    historicalCost: Object.values(accountsResult).reduce(
      (sum, account) => sum + account.historicalCost,
      0,
    ),
    confirmedCost: Object.values(accountsResult).reduce(
      (sum, account) => sum + account.confirmedCost,
      0,
    ),
    person: ledger.people.find((person) => person.id === personId),
    accounts: accountsResult,
    entries,
  };
}

export function partyAccountBalance(
  ledger: Ledger,
  personId: string,
  account: Account,
  contractId: string | null = null,
) {
  const effective = effectiveAccounts(ledger);
  const entries = activeEntries(ledger).filter(
    (entry) =>
      entry.personId === personId &&
      effective.get(entry.id) === account &&
      entry.contractId === contractId,
  );
  return [...accountBalances(entries, effective).values()].reduce(
    (sum, balance) => ({
      cost: sum.cost + balance.cost,
      paid: sum.paid + balance.paid,
      refunds: sum.refunds + balance.refunds,
      netPaid: sum.netPaid + balance.netPaid,
      balance: sum.balance + balance.balance,
      payable: sum.payable + balance.payable,
      advance: sum.advance + balance.advance,
    }),
    emptyBalance(),
  );
}

export function contractSummary(ledger: Ledger, contractId: string) {
  const contract = ledger.contracts.find(
    (contract) => contract.id === contractId,
  );
  const entries = activeEntries(ledger).filter(
    (entry) =>
      entry.contractId === contractId && entry.balanceImpact !== "historical",
  );
  let billed = 0;
  let paid = 0;
  let refunds = 0;
  for (const entry of entries) {
    const total = entryTotal(entry);
    if (entry.kind === "expense") billed += total;
    if (entry.kind === "expense_credit") billed -= total;
    if (entry.kind === "payment") paid += total;
    if (entry.kind === "refund") refunds += total;
  }
  const agreed = contract?.total ?? 0;
  const netPaid = paid - refunds;
  return {
    contract,
    agreed,
    billed,
    paid,
    refunds,
    netPaid,
    remaining: Math.max(agreed - netPaid, 0),
    payable: Math.max(billed - netPaid, 0),
    advance: Math.max(netPaid - billed, 0),
    entries,
  };
}

export function appendEntries(ledger: Ledger, entries: Entry[]): Ledger {
  return validateLedger({
    ...ledger,
    entries: [...ledger.entries, ...entries],
  });
}

export function setEntryVoided(
  ledger: Ledger,
  entryId: string,
  voided: boolean,
): Ledger {
  if (!ledger.entries.some((entry) => entry.id === entryId))
    throw new Error("Unknown entry");
  const now = new Date().toISOString();
  return validateLedger({
    ...ledger,
    entries: ledger.entries.map((entry) =>
      entry.id === entryId && entry.voided !== voided
        ? {
            ...entry,
            voided,
            updatedAt: now,
            revisions: [
              ...entry.revisions,
              { at: now, before: EntryCoreSchema.parse(entry) },
            ],
          }
        : entry,
    ),
  });
}

export function replaceEntry(ledger: Ledger, replacement: Entry): Ledger {
  const original = ledger.entries.find((entry) => entry.id === replacement.id);
  if (!original) throw new Error("Unknown entry");
  const linked = ledger.entries.filter(
    (entry) => entry.relatedEntryId === original.id && !entry.voided,
  );
  const originalWorks = [
    ...new Set(original.lines.map((line) => line.workId)),
  ].sort();
  const replacementWorks = [
    ...new Set(replacement.lines.map((line) => line.workId)),
  ].sort();
  if (
    linked.length &&
    (original.personId !== replacement.personId ||
      original.account !== replacement.account ||
      original.contractId !== replacement.contractId ||
      JSON.stringify(originalWorks) !== JSON.stringify(replacementWorks))
  )
    throw new Error("Linked payment: keep the same person, account and work");
  const now = new Date().toISOString();
  const updated = {
    ...replacement,
    provenance: replacement.provenance ?? original.provenance,
    updatedAt: now,
    revisions: [
      ...original.revisions,
      { at: now, before: EntryCoreSchema.parse(original) },
    ],
  };
  return validateLedger({
    ...ledger,
    entries: ledger.entries.map((entry) =>
      entry.id === updated.id ? updated : entry,
    ),
  });
}

export function replaceExpenseAndSettlements(
  ledger: Ledger,
  replacement: Entry,
): Ledger {
  const original = ledger.entries.find((entry) => entry.id === replacement.id);
  if (!original) throw new Error("Unknown entry");
  const linked = ledger.entries.filter(
    (entry) => entry.relatedEntryId === original.id,
  );
  if (original.kind !== "expense" || !linked.length)
    return replaceEntry(ledger, replacement);
  const beforeWorks = entryWorkIds(original).sort();
  const afterWorks = entryWorkIds(replacement).sort();
  const moved = JSON.stringify(beforeWorks) !== JSON.stringify(afterWorks);
  if (
    replacement.kind !== "expense" ||
    original.account !== replacement.account ||
    original.contractId !== replacement.contractId ||
    (original.personId !== replacement.personId &&
      original.personId !== null) ||
    (moved && (beforeWorks.length !== 1 || afterWorks.length !== 1))
  )
    throw new Error("Linked payment: keep the same person, account and work");
  if (!moved && original.personId === replacement.personId)
    return replaceEntry(ledger, replacement);
  const now = new Date().toISOString();
  const revise = (entry: Entry, next: Entry): Entry => ({
    ...next,
    provenance: next.provenance ?? entry.provenance,
    updatedAt: now,
    revisions: [
      ...entry.revisions,
      { at: now, before: EntryCoreSchema.parse(entry) },
    ],
  });
  const linkedIds = new Set(linked.map((entry) => entry.id));
  return validateLedger({
    ...ledger,
    entries: ledger.entries.map((entry) => {
      if (entry.id === original.id) return revise(original, replacement);
      if (!linkedIds.has(entry.id)) return entry;
      // Cancelled settlements still share the bill's identity if restored later.
      return revise(entry, {
        ...entry,
        personId: replacement.personId,
        lines: entry.lines.map((line) =>
          moved ? { ...line, workId: afterWorks[0] } : line,
        ),
        allocations: entry.allocations.map((allocation) =>
          moved ? { ...allocation, workId: afterWorks[0] } : allocation,
        ),
      });
    }),
  });
}

export function parseAmount(value: string): number {
  return parseMoneyText(value);
}
