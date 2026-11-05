import { parseMoneyText } from "./money.js";
import { effectiveAccounts } from "./effectiveAccounts.js";
import type { Account, CostType, Entry, Ledger } from "./model.js";
import { EntryCoreSchema, validateLedger } from "./model.js";
import { adjustmentBalanceDelta, reconciledTotals } from "./adjustmentMath.js";
import { cashObligationParts } from "./cashObligations.js";
import { unresolvedContractAdjustmentIds } from "./contractObligations.js";
import { allocatePayment, partyLedger } from "./partyLedger.js";

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
  if (entry.kind === "adjustment")
    return Math.abs(entry.adjustment?.delta ?? 0);
  return entry.kind === "expense" || entry.kind === "expense_credit"
    ? entry.lines.reduce((total, line) => total + line.amount, 0)
    : entry.paymentParts.reduce((total, part) => total + part.amount, 0);
}

export function entryWorkAmount(entry: Entry, workId?: string): number {
  if (!workId) return entryTotal(entry);
  if (entry.kind === "adjustment")
    return entry.adjustment?.workId === workId ? entryTotal(entry) : 0;
  return entry.kind === "expense" || entry.kind === "expense_credit"
    ? entry.lines
        .filter((line) => line.workId === workId)
        .reduce((total, line) => total + line.amount, 0)
    : entry.allocations
        .filter((line) => line.workId === workId)
        .reduce((total, line) => total + line.amount, 0);
}

export function entryWorkIds(entry: Entry): string[] {
  if (entry.kind === "adjustment")
    return entry.adjustment?.workId ? [entry.adjustment.workId] : [];
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
  adjustment: number;
  paid: number;
  refunds: number;
  netPaid: number;
  balance: number;
  payable: number;
  advance: number;
};
const emptyBalance = (): Balance => ({
  cost: 0,
  adjustment: 0,
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
  ledger: Pick<Ledger, "entries" | "paymentAllocations"> = { entries },
): Map<string, Balance> {
  const balances = new Map<string, Balance>();
  for (const entry of entries) {
    if (entry.balanceImpact === "historical" || entry.kind === "adjustment")
      continue;
    const isCost = entry.kind === "expense" || entry.kind === "expense_credit";
    const amounts = new Map<string, number>();
    for (const part of entry.allocations)
      amounts.set(part.workId, (amounts.get(part.workId) ?? 0) + part.amount);
    const parts = isCost
      ? entry.lines
      : [...amounts].map(([workId, amount]) => ({ workId, amount }));
    const settled = new Map<string, number>();
    for (const part of cashObligationParts(ledger, entry))
      settled.set(part.workId, (settled.get(part.workId) ?? 0) + part.amount);
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
      if (isCost) {
        balance.cost +=
          part.amount * (entry.kind === "expense_credit" ? -1 : 1);
        balance.balance +=
          part.amount * (entry.kind === "expense_credit" ? -1 : 1);
      } else if (entry.kind === "payment") {
        balance.paid += part.amount;
        balance.balance -= settled.get(part.workId) ?? 0;
      } else {
        balance.refunds += part.amount;
        balance.balance += settled.get(part.workId) ?? 0;
      }
      balance.netPaid = balance.paid - balance.refunds;
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
  let adjustment = 0;
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
    if (entry.kind === "adjustment") {
      adjustment += adjustmentBalanceDelta(entry);
    } else if (entry.kind === "payment") {
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
    ...accountBalances(
      entries,
      effectiveAccounts(ledger),
      workId,
      ledger,
    ).values(),
  ];
  const contracts = ledger.contracts.filter(
    (contract) =>
      !workId || (contract.scope === "work" && contract.workId === workId),
  );
  const contractSummaries = contracts.map((contract) =>
    contractSummary(ledger, contract.id),
  );
  return {
    ...reconciledTotals(ledger, workId ? { workId } : {}),
    cost,
    adjustment,
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
          ledger,
        ).values(),
      ];
      const confirmed = balances.reduce(
        (sum, b) => ({
          cost: sum.cost + b.cost,
          adjustment: sum.adjustment + b.adjustment,
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
          ...reconciledTotals(ledger, {
            personId,
            account,
            ...(workId ? { workId } : {}),
          }),
          ...confirmed,
          cost: confirmed.cost + historicalCost,
          historicalCost,
          confirmedCost: confirmed.cost,
        },
      ];
    }),
  ) as Record<
    Account,
    Balance &
      ReturnType<typeof reconciledTotals> & {
        historicalCost: number;
        confirmedCost: number;
      }
  >;
  const total = Object.values(accountsResult).reduce(
    (sum, b) => ({
      cost: sum.cost + b.cost,
      adjustment: sum.adjustment + b.adjustment,
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
    ...reconciledTotals(ledger, { personId, ...(workId ? { workId } : {}) }),
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
  const entries = ledger.entries.filter(
    (entry) =>
      entry.personId === personId &&
      effective.get(entry.id) === account &&
      entry.contractId === contractId,
  );
  const actual = [
    ...accountBalances(
      entries.filter((entry) => !entry.voided),
      effective,
      undefined,
      ledger,
    ).values(),
  ].reduce(
    (sum, balance) => ({
      cost: sum.cost + balance.cost,
      adjustment: sum.adjustment + balance.adjustment,
      paid: sum.paid + balance.paid,
      refunds: sum.refunds + balance.refunds,
      netPaid: sum.netPaid + balance.netPaid,
      balance: sum.balance + balance.balance,
      payable: sum.payable + balance.payable,
      advance: sum.advance + balance.advance,
    }),
    emptyBalance(),
  );
  // This running account excludes other jobs and their agreed totals.
  const reconciled = reconciledTotals(
    { ...ledger, entries, contracts: [] },
    { personId, account },
  );
  return {
    ...actual,
    adjustment: reconciled.owedCorrection,
    balance: reconciled.reconciledBalance,
    payable: reconciled.reconciledPayable,
    advance: reconciled.reconciledAdvance,
  };
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
  let adjustment = 0;
  let commitmentAdjustment = 0;
  const unresolved = unresolvedContractAdjustmentIds(ledger);
  let paid = 0;
  let refunds = 0;
  let obligationPaid = 0;
  let obligationRefunds = 0;
  for (const entry of entries) {
    const total = entryTotal(entry);
    if (entry.kind === "expense") billed += total;
    if (entry.kind === "expense_credit") billed -= total;
    if (entry.kind === "payment") paid += total;
    if (entry.kind === "refund") refunds += total;
    if (entry.kind === "payment" || entry.kind === "refund") {
      const settled = cashObligationParts(ledger, entry).reduce(
        (sum, part) => sum + part.amount,
        0,
      );
      if (entry.kind === "payment") obligationPaid += settled;
      else obligationRefunds += settled;
    }
    if (entry.kind === "adjustment") {
      commitmentAdjustment += adjustmentBalanceDelta(entry);
      if (!unresolved.has(entry.id))
        adjustment += adjustmentBalanceDelta(entry);
    }
  }
  const agreed = contract?.total ?? 0;
  const netPaid = paid - refunds;
  const obligationNetPaid = obligationPaid - obligationRefunds;
  const balance =
    BigInt(Math.max(agreed, billed)) +
    BigInt(commitmentAdjustment) -
    BigInt(obligationNetPaid);
  const billedBalance =
    BigInt(billed) + BigInt(adjustment) - BigInt(obligationNetPaid);
  return {
    contract,
    agreed,
    adjustment,
    billed,
    paid,
    refunds,
    netPaid,
    obligationNetPaid,
    billedBalance: Number(billedBalance),
    remaining: Number(billedBalance > 0n ? billedBalance : 0n),
    remainingCommitment: Number(balance > 0n ? balance : 0n),
    unearnedCommitment: Math.max(agreed - billed, 0),
    commitmentAdjustment,
    balanceAmbiguous: entries.some((entry) => unresolved.has(entry.id)),
    payable: Number(billedBalance > 0n ? billedBalance : 0n),
    advance: Math.max(obligationNetPaid - billed, 0),
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
    paymentAllocations: voided
      ? ledger.paymentAllocations?.map((row) =>
          !row.cancelledAt &&
          (row.paymentId === entryId || row.billId === entryId)
            ? {
                ...row,
                cancelledAt: now,
                cancellationReason:
                  "লেনদেন বাতিল করায় বিলের সঙ্গে টাকার মিল খুলেছি",
              }
            : row,
        )
      : ledger.paymentAllocations,
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
  if (original.kind === "adjustment" || replacement.kind === "adjustment")
    throw new Error(
      "Balance adjustments are immutable; cancel and create a new adjustment",
    );
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
  const matched = (ledger.paymentAllocations ?? []).filter(
    (row) => !row.cancelledAt && row.billId === original.id,
  );
  const paidIds = new Set(matched.map((row) => row.paymentId));
  const pairedCash =
    paidIds.size === 1
      ? ledger.entries.find(
          (entry) =>
            paidIds.has(entry.id) &&
            entry.kind === "payment" &&
            entry.relatedEntryId === original.id,
        )
      : undefined;
  const changed =
    original.kind === "expense" &&
    replacement.kind === "expense" &&
    (entryTotal(original) !== entryTotal(replacement) ||
      JSON.stringify(entryWorkIds(original).sort()) !==
        JSON.stringify(entryWorkIds(replacement).sort()));
  if (
    changed &&
    pairedCash &&
    new Set(original.lines.map((line) => line.workId)).size === 1 &&
    new Set(replacement.lines.map((line) => line.workId)).size === 1 &&
    !(ledger.paymentAllocations ?? []).some(
      (row) =>
        !row.cancelledAt &&
        row.paymentId === pairedCash.id &&
        row.billId !== original.id,
    )
  ) {
    const at = new Date().toISOString();
    const neutral = validateLedger({
      ...ledger,
      paymentAllocations: ledger.paymentAllocations!.map((row) =>
        matched.some((previous) => previous.id === row.id)
          ? {
              ...row,
              cancelledAt: at,
              cancellationReason:
                "বিলের অঙ্ক বদলানোয় দেওয়া টাকার ভাগ আবার মিলিয়েছি",
            }
          : row,
      ),
    });
    const edited = replaceExpenseAndSettlements(neutral, replacement);
    const updatedBill = edited.entries.find(
      (entry) => entry.id === original.id,
    )!;
    const payment = partyLedger(
      edited,
      updatedBill.personId ?? "",
    ).payments.find((row) => row.id === pairedCash.id);
    const workId = updatedBill.lines[0].workId;
    const amount = Math.min(
      matched.reduce((sum, row) => sum + row.amount, 0),
      entryTotal(updatedBill),
      payment?.works.find((row) => row.workId === workId)?.available ?? 0,
    );
    return amount
      ? allocatePayment(edited, pairedCash.id, [
          { billId: updatedBill.id, workId, amount },
        ])
      : edited;
  }
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
