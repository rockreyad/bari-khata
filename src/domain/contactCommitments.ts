import { commitmentTotals } from "./adjustmentMath.js";
import { effectiveAccounts } from "./effectiveAccounts.js";
import type { Account, Ledger } from "./model.js";
import { partyLedger } from "./partyLedger.js";

export type ContactCommitmentScope = { workId?: string; account?: Account };

export function contactCommitmentSummary(
  ledger: Ledger,
  personId: string,
  scope: ContactCommitmentScope = {},
) {
  const empty = {
    remaining: 0,
    extra: 0,
    contractRemaining: 0,
    nonContractRemaining: 0,
    baseExtra: 0,
    correctionEffect: 0,
    balanceAmbiguous: false,
    netBalanceAmbiguous: false,
    creditAmbiguous: false,
    reviewEntryIds: [] as string[],
    valid: false,
  };
  if (!ledger.people.some((person) => person.id === personId)) return empty;
  if (scope.workId && !ledger.works.some((work) => work.id === scope.workId))
    return empty;
  const accounts = effectiveAccounts(ledger);
  const source = {
    ...ledger,
    entries: ledger.entries.filter(
      (entry) =>
        entry.personId === personId &&
        (!scope.account || accounts.get(entry.id) === scope.account),
    ),
    contracts: ledger.contracts.filter(
      (contract) =>
        contract.personId === personId &&
        (!scope.account || scope.account === "labour"),
    ),
  };
  const reviewEntryIds = source.entries
    .filter(
      (entry) =>
        !entry.voided &&
        !entry.contractId &&
        entry.kind === "expense" &&
        accounts.get(entry.id) === "labour" &&
        (entry.balanceImpact === "historical" ||
          entry.reviewStatus === "needs_review") &&
        entry.lines.some(
          (line) =>
            (!scope.workId || line.workId === scope.workId) &&
            source.contracts.some(
              (contract) =>
                contract.scope === "house" || contract.workId === line.workId,
            ),
        ),
    )
    .map((entry) => entry.id);
  try {
    // A selected account still keeps each contract's credit with its own promise.
    const totals = commitmentTotals(source, {
      personId,
      ...(scope.workId ? { workId: scope.workId } : {}),
    });
    const sum = (contract: boolean) =>
      totals.buckets
        .filter((bucket) => Boolean(bucket.contractId) === contract)
        .reduce((amount, bucket) => amount + BigInt(bucket.remaining), 0n);
    const contractRemaining = sum(true);
    const nonContractRemaining = sum(false);
    const baseExtra = totals.buckets.reduce(
      (amount, bucket) => amount + BigInt(bucket.extra),
      0n,
    );
    // Include credits so a correction past zero keeps its full signed effect.
    const correctionEffect =
      BigInt(totals.reconciledPayable) -
      BigInt(totals.reconciledAdvance) -
      (contractRemaining + nonContractRemaining - baseExtra);
    if (
      [
        contractRemaining,
        nonContractRemaining,
        baseExtra,
        correctionEffect,
      ].some(
        (amount) =>
          amount > BigInt(Number.MAX_SAFE_INTEGER) ||
          amount < -BigInt(Number.MAX_SAFE_INTEGER),
      )
    )
      return {
        ...empty,
        balanceAmbiguous: true,
        netBalanceAmbiguous: true,
        reviewEntryIds,
      };
    const creditAmbiguous = partyLedger(ledger, personId).creditAmbiguous;
    const netBalanceAmbiguous =
      totals.balanceAmbiguous || reviewEntryIds.length > 0;
    return {
      remaining: totals.reconciledPayable,
      extra: totals.reconciledAdvance,
      contractRemaining: Number(contractRemaining),
      nonContractRemaining: Number(nonContractRemaining),
      baseExtra: Number(baseExtra),
      correctionEffect: Number(correctionEffect),
      // Existing consumers keep the conservative warning; net totals have separate certainty.
      balanceAmbiguous: netBalanceAmbiguous || creditAmbiguous,
      netBalanceAmbiguous,
      creditAmbiguous,
      reviewEntryIds: [
        ...new Set([...reviewEntryIds, ...totals.unresolvedAdjustmentIds]),
      ],
      valid: true,
    };
  } catch {
    return {
      ...empty,
      balanceAmbiguous: true,
      netBalanceAmbiguous: true,
      reviewEntryIds,
    };
  }
}
