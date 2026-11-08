import { commitmentTotals } from "../../domain/adjustmentMath";
import { contactCommitmentSummary } from "../../domain/contactCommitments";
import { contactSummary } from "../../domain/contacts";
import { effectiveAccounts } from "../../domain/effectiveAccounts";
import type { Account, Ledger, Person } from "../../domain/model";
import { partyLedger } from "../../domain/partyLedger";

const sum = (amounts: number[]) => {
  const total = amounts.reduce((value, amount) => value + BigInt(amount), 0n);
  if (total < 0n || total > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("people_balance_out_of_range");
  return Number(total);
};

export function peopleBalances(ledger: Ledger, person: Person) {
  const summary = contactSummary(ledger, person);
  const commitments = ledger.contracts.some(
    (contract) => contract.personId === person.id,
  )
    ? contactCommitmentSummary(ledger, person.id)
    : null;
  const valid = commitments?.valid ?? !summary.balanceAmbiguous;
  const result = {
    summary,
    remaining: valid
      ? (commitments?.remaining ?? summary.reconciledPayable)
      : 0,
    advance: 0,
    extra: 0,
    credit: 0,
    receivable: 0,
    valid,
    needsReview:
      !valid ||
      (commitments?.balanceAmbiguous ?? summary.balanceAmbiguous) ||
      summary.entries.some((entry) => entry.reviewStatus === "needs_review"),
  };
  try {
    const cash = partyLedger(ledger, person.id);
    result.needsReview ||= cash.creditAmbiguous;
    if (result.needsReview) return result;
    const totals = commitmentTotals(ledger, { personId: person.id });
    const accounts = effectiveAccounts(ledger);
    const adjustedAccounts = new Set(
      summary.entries
        .filter(
          (entry) =>
            entry.kind === "adjustment" &&
            !entry.contractId &&
            entry.adjustment?.target === "person",
        )
        .map((entry) => entry.adjustment!.account),
    );
    const available = (account: Account, context: "advance" | null) =>
      sum(
        cash.payments
          .filter(
            (payment) =>
              !payment.entry.contractId &&
              accounts.get(payment.id) === account &&
              payment.context === context,
          )
          .map((payment) => payment.available),
      );
    for (const account of ["materials", "labour", "other"] as const) {
      if (adjustedAccounts.has(account)) {
        // A total correction does not identify which advance or contract changed.
        const corrected = contactCommitmentSummary(ledger, person.id, {
          account,
        });
        if (!corrected.valid || corrected.balanceAmbiguous)
          throw new Error("people_balance_needs_review");
        result.credit = sum([result.credit, corrected.extra]);
        continue;
      }
      const buckets = totals.buckets.filter(
        (bucket) => bucket.account === account,
      );
      result.extra = sum([
        result.extra,
        ...buckets
          .filter((bucket) => bucket.contractId)
          .map((bucket) => bucket.extra),
      ]);
      const uncontracted = sum(
        buckets
          .filter((bucket) => !bucket.contractId)
          .map((bucket) => bucket.extra),
      );
      const advance = Math.min(uncontracted, available(account, "advance"));
      result.advance = sum([result.advance, advance]);
      const remainingCredit = uncontracted - advance;
      const hasBill = summary.entries.some(
        (entry) =>
          !entry.contractId &&
          entry.balanceImpact === "normal" &&
          accounts.get(entry.id) === account &&
          (entry.kind === "expense" || entry.kind === "expense_credit"),
      );
      result.credit = sum([
        result.credit,
        hasBill
          ? remainingCredit
          : Math.min(remainingCredit, available(account, null)),
      ]);
    }
    result.receivable = sum([cash.receivable]);
    return result;
  } catch {
    return {
      ...result,
      advance: 0,
      extra: 0,
      credit: 0,
      receivable: 0,
      needsReview: true,
    };
  }
}
