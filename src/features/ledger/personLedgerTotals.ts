import type { AdjustmentBasis } from "../../domain/adjustmentMath";
import { unresolvedContractAdjustmentIds } from "../../domain/contractObligations";
import type { Entry, Ledger } from "../../domain/model";

type PersonLedgerScope = { personId: string; workId?: string };
export type PersonLedgerTotals = {
  paid: number;
  refunds: number;
  paidCorrection: number;
  netPaid: number;
  cashEntryCount: number;
  paymentEntryCount: number;
  refundEntryCount: number;
  historicalCashEntryCount: number;
  adjustmentEntryCount: number;
  adjustmentCounts: Record<AdjustmentBasis, number>;
  adjustmentAmounts: Record<AdjustmentBasis, number | null>;
  unresolvedAdjustmentCount: number;
};

const maximum = BigInt(Number.MAX_SAFE_INTEGER);
const exact = (amount: bigint) => {
  if (amount < -maximum || amount > maximum)
    throw new Error("person_ledger_amount_out_of_range");
  return Number(amount);
};
const integer = (amount: number, signed = false) => {
  if (!Number.isSafeInteger(amount) || (!signed && amount < 0))
    throw new Error("person_ledger_amount_out_of_range");
  return BigInt(amount);
};

export function personLedgerSummary(
  ledger: Ledger,
  selectedEntries: readonly Entry[],
  scope: PersonLedgerScope,
): PersonLedgerTotals {
  const selectedIds = new Set(selectedEntries.map((entry) => entry.id));
  const unresolved = unresolvedContractAdjustmentIds(ledger);
  let paid = 0n;
  let refunds = 0n;
  let paymentEntryCount = 0;
  let refundEntryCount = 0;
  let historicalCashEntryCount = 0;
  let unresolvedAdjustmentCount = 0;
  const adjustmentCounts = { paid: 0, cost: 0, balance: 0 };
  const adjustmentAmounts = { paid: 0n, cost: 0n, balance: 0n };
  const ambiguousBases = new Set<AdjustmentBasis>();
  for (const entry of ledger.entries) {
    if (
      !selectedIds.has(entry.id) ||
      entry.personId !== scope.personId ||
      entry.voided
    )
      continue;
    if (entry.kind === "payment" || entry.kind === "refund") {
      const amount = entry.allocations
        .filter((part) => !scope.workId || part.workId === scope.workId)
        .reduce((sum, part) => sum + integer(part.amount), 0n);
      if (!amount) continue;
      if (entry.balanceImpact === "historical") {
        historicalCashEntryCount++;
        continue;
      }
      if (entry.kind === "payment") {
        paid += amount;
        paymentEntryCount++;
      } else {
        refunds += amount;
        refundEntryCount++;
      }
      continue;
    }
    const change = entry.adjustment;
    if (
      entry.kind !== "adjustment" ||
      entry.balanceImpact === "historical" ||
      !change ||
      change.target !== "person" ||
      (scope.workId && change.workId !== scope.workId)
    )
      continue;
    adjustmentCounts[change.basis]++;
    if (unresolved.has(entry.id)) {
      unresolvedAdjustmentCount++;
      ambiguousBases.add(change.basis);
      continue;
    }
    // Corrections are differences; their before/after snapshots are not new money.
    adjustmentAmounts[change.basis] += integer(change.delta, true);
  }
  const paidCorrection = exact(adjustmentAmounts.paid);
  return {
    paid: exact(paid),
    refunds: exact(refunds),
    paidCorrection,
    netPaid: exact(paid - refunds + adjustmentAmounts.paid),
    cashEntryCount: paymentEntryCount + refundEntryCount,
    paymentEntryCount,
    refundEntryCount,
    historicalCashEntryCount,
    adjustmentEntryCount: Object.values(adjustmentCounts).reduce(
      (sum, count) => sum + count,
      0,
    ),
    adjustmentCounts,
    adjustmentAmounts: {
      paid: paidCorrection,
      cost: ambiguousBases.has("cost") ? null : exact(adjustmentAmounts.cost),
      balance: ambiguousBases.has("balance")
        ? null
        : exact(adjustmentAmounts.balance),
    },
    unresolvedAdjustmentCount,
  };
}
