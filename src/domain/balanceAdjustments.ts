import {
  AccountSchema,
  EntrySchema,
  LedgerSchema,
  SignedMoneySchema,
  newId,
  type Account,
  type Ledger,
} from "./model.js";
import { reconciledTotals, type AdjustmentBasis } from "./adjustmentMath.js";
export { adjustmentBalanceDelta, reconciledTotals } from "./adjustmentMath.js";
export type BalanceAdjustmentScope = {
  target: "person" | "work";
  basis: AdjustmentBasis;
  personId?: string | null;
  account: Account | null;
  workId?: string | null;
  contractId?: string | null;
};
export type BalanceAdjustmentInput = BalanceAdjustmentScope & {
  expectedBefore: number;
  after: number;
  reason: string;
  date?: string | null;
};
const maximum = BigInt(Number.MAX_SAFE_INTEGER);
function normalizeScope(ledger: Ledger, scope: BalanceAdjustmentScope) {
  if (!["paid", "cost", "balance"].includes(scope.basis))
    throw new Error("balance_adjustment_invalid_scope");
  if (scope.target === "work") {
    if (
      scope.personId != null ||
      scope.account !== null ||
      scope.contractId != null ||
      !scope.workId ||
      !ledger.works.some((work) => work.id === scope.workId)
    )
      throw new Error("balance_adjustment_invalid_scope");
    return {
      target: scope.target,
      basis: scope.basis,
      personId: null,
      account: null,
      workId: scope.workId,
      contractId: null,
    };
  }
  if (
    scope.target !== "person" ||
    !scope.personId ||
    !ledger.people.some((person) => person.id === scope.personId)
  )
    throw new Error("balance_adjustment_invalid_scope");
  const account = AccountSchema.parse(scope.account);
  const contractId = scope.contractId ?? null;
  const contract = contractId
    ? ledger.contracts.find((job) => job.id === contractId)
    : null;
  let workId = scope.workId ?? null;
  if (contractId) {
    if (
      !contract ||
      contract.personId !== scope.personId ||
      account !== "labour"
    )
      throw new Error("balance_adjustment_invalid_scope");
    if (contract.scope === "house") {
      if (workId !== null) throw new Error("balance_adjustment_invalid_scope");
    } else {
      if (workId !== null && workId !== contract.workId)
        throw new Error("balance_adjustment_invalid_scope");
      workId = contract.workId;
    }
  }
  if (workId && !ledger.works.some((work) => work.id === workId))
    throw new Error("balance_adjustment_invalid_scope");
  return {
    target: scope.target,
    basis: scope.basis,
    personId: scope.personId,
    account,
    workId,
    contractId,
  };
}
export function readBalanceAdjustmentScope(
  ledger: Ledger,
  input: BalanceAdjustmentScope,
) {
  const scope = normalizeScope(ledger, input);
  const totals = reconciledTotals(ledger, {
    ...(scope.personId ? { personId: scope.personId } : {}),
    account: scope.account,
    ...(scope.workId ? { workId: scope.workId } : {}),
    ...(scope.contractId ? { contractId: scope.contractId } : {}),
  });
  if (scope.basis === "balance" && totals.balanceAmbiguous)
    throw new Error("balance_adjustment_ambiguous");
  const value =
    scope.basis === "paid"
      ? totals.reconciledNetPaid
      : scope.basis === "cost"
        ? totals.reconciledCost
        : totals.reconciledBalance;
  return {
    ...scope,
    ...totals,
    value,
    cost: totals.actualCost,
    paid: totals.actualPaid,
    refunds: totals.actualRefunds,
    netPaid: totals.actualNetPaid,
    adjustment: totals.owedCorrection,
    balance: totals.reconciledBalance,
    agreed: scope.contractId
      ? (ledger.contracts.find((job) => job.id === scope.contractId)?.total ??
        0)
      : 0,
  };
}
export function appendBalanceAdjustment(
  ledger: Ledger,
  input: BalanceAdjustmentInput,
  at = new Date().toISOString(),
): Ledger {
  const current = LedgerSchema.parse(ledger);
  SignedMoneySchema.parse(input.expectedBefore);
  SignedMoneySchema.parse(input.after);
  const selected = normalizeScope(current, input);
  if (
    (selected.personId &&
      current.people.find((person) => person.id === selected.personId)
        ?.archivedAt) ||
    (selected.workId &&
      current.works.find((work) => work.id === selected.workId)?.archivedAt) ||
    (selected.contractId &&
      current.contracts.find((job) => job.id === selected.contractId)
        ?.archivedAt)
  )
    throw new Error("balance_adjustment_archived");
  const scope = readBalanceAdjustmentScope(current, input);
  if (scope.value !== input.expectedBefore)
    throw new Error("balance_adjustment_stale");
  const difference = BigInt(input.after) - BigInt(scope.value);
  if (difference < -maximum || difference > maximum)
    throw new Error("balance_adjustment_out_of_range");
  if (!difference) throw new Error("balance_adjustment_no_change");
  const reason = input.reason.trim();
  if (!reason) throw new Error("balance_adjustment_reason_required");
  const entry = EntrySchema.parse({
    id: newId(),
    kind: "adjustment",
    account: scope.account ?? "other",
    personId: scope.personId,
    contractId: scope.contractId,
    note: reason,
    adjustment: {
      target: scope.target,
      basis: scope.basis,
      account: scope.account,
      before: scope.value,
      after: input.after,
      delta: Number(difference),
      workId: scope.workId,
    },
    date:
      input.date === undefined
        ? new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Dhaka",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date(at))
        : input.date,
    createdAt: at,
    updatedAt: at,
  });
  return LedgerSchema.parse({
    ...current,
    entries: [...current.entries, entry],
  });
}
