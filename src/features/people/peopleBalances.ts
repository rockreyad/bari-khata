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
const correctionTime = (value: string) => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
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
    recordReviewCount: summary.entries.filter(
      (entry) =>
        entry.balanceImpact === "normal" &&
        entry.reviewStatus === "needs_review" &&
        (entry.kind === "expense" || entry.kind === "expense_credit"),
    ).length,
    valid,
    needsReview:
      !valid ||
      (commitments?.netBalanceAmbiguous ?? summary.balanceAmbiguous) ||
      summary.entries.some(
        (entry) =>
          entry.balanceImpact === "normal" &&
          entry.reviewStatus === "needs_review" &&
          entry.kind !== "expense" &&
          entry.kind !== "expense_credit",
      ),
  };
  try {
    const cash = partyLedger(ledger, person.id);
    if (result.needsReview) return result;
    const totals = commitmentTotals(ledger, { personId: person.id });
    const accounts = effectiveAccounts(ledger);
    const adjustments = summary.entries.filter(
      (entry) =>
        entry.kind === "adjustment" &&
        !entry.contractId &&
        entry.adjustment?.target === "person",
    );
    const adjustedAccounts = new Set(
      adjustments.map((entry) => entry.adjustment!.account),
    );
    const uncertainAccounts = new Set<Account>();
    if (cash.creditAmbiguous)
      for (const payment of cash.payments) {
        if (
          (payment.context === "advance" || payment.context === "receivable") &&
          payment.works.some(
            (work) =>
              work.available < work.amount - work.allocated - work.refunded,
          )
        )
          uncertainAccounts.add(
            accounts.get(payment.id) ?? payment.entry.account,
          );
      }
    result.needsReview ||= uncertainAccounts.size > 0;
    const availableAdvance = (account: Account) =>
      sum(
        cash.payments
          .filter(
            (payment) =>
              !payment.entry.contractId &&
              accounts.get(payment.id) === account &&
              payment.context === "advance",
          )
          .map((payment) => payment.available),
      );
    const hasBill = (account: Account, includeContracts = false) =>
      summary.entries.some(
        (entry) =>
          (includeContracts || !entry.contractId) &&
          entry.balanceImpact === "normal" &&
          accounts.get(entry.id) === account &&
          (entry.kind === "expense" || entry.kind === "expense_credit"),
      );
    const allocatedPayments = new Set(
      cash.allocations.map((allocation) => allocation.paymentId),
    );
    const linkedBills = new Set(
      summary.entries
        .filter(
          (entry) =>
            entry.kind === "expense" && entry.balanceImpact === "normal",
        )
        .map((entry) => entry.id),
    );
    const provenCredit = (account: Account, credit: number) => {
      const unlinkedCash = sum(
        cash.payments
          .filter(
            (payment) =>
              !payment.entry.contractId &&
              !payment.context &&
              accounts.get(payment.id) === account &&
              !linkedBills.has(payment.entry.relatedEntryId ?? "") &&
              !allocatedPayments.has(payment.id),
          )
          .flatMap((payment) =>
            payment.works.map(
              (work) => work.amount - work.allocated - work.refunded,
            ),
          ),
      );
      const returned = sum(
        summary.entries
          .filter(
            (entry) =>
              !entry.contractId &&
              entry.kind === "expense_credit" &&
              entry.balanceImpact === "normal" &&
              accounts.get(entry.id) === account,
          )
          .flatMap((entry) => entry.lines.map((line) => line.amount)),
      );
      const refunded = sum(
        summary.entries
          .filter(
            (entry) =>
              !entry.contractId &&
              entry.kind === "refund" &&
              entry.balanceImpact === "normal" &&
              accounts.get(entry.id) === account &&
              (!entry.paymentContext || entry.paymentContext === "settlement"),
          )
          .flatMap((entry) => entry.allocations.map((part) => part.amount)),
      );
      // Unlinked old cash may have paid for work whose bill was never recorded.
      return Math.max(
        0,
        credit - unlinkedCash,
        Math.min(credit, Math.max(0, returned - refunded)),
      );
    };
    for (const account of ["materials", "labour", "other"] as const) {
      if (uncertainAccounts.has(account)) continue;
      if (adjustedAccounts.has(account)) {
        // A total correction does not identify which advance or contract changed.
        const corrected = contactCommitmentSummary(ledger, person.id, {
          account,
        });
        if (!corrected.valid || corrected.netBalanceAmbiguous)
          throw new Error("people_balance_needs_review");
        const balanceCorrections = adjustments.filter(
          (entry) =>
            entry.adjustment!.account === account &&
            entry.adjustment!.basis === "balance",
        );
        const latestCorrection = balanceCorrections.reduce(
          (latest, entry) => Math.max(latest, correctionTime(entry.createdAt)),
          Number.NEGATIVE_INFINITY,
        );
        // Tied timestamps do not establish which correction came last.
        const recordedCredit = balanceCorrections.length
          ? balanceCorrections
              .filter(
                (entry) => correctionTime(entry.createdAt) === latestCorrection,
              )
              .reduce(
                (credit, entry) =>
                  Math.min(credit, Math.max(0, -entry.adjustment!.after)),
                Number.MAX_SAFE_INTEGER,
              )
          : 0;
        const knownLiability =
          hasBill(account, true) ||
          (account === "labour" && Boolean(commitments)) ||
          recordedCredit > 0;
        if (knownLiability)
          result.credit = sum([
            result.credit,
            Math.max(
              provenCredit(account, corrected.extra),
              Math.min(corrected.extra, recordedCredit),
            ),
          ]);
        else
          result.advance = sum([
            result.advance,
            Math.min(
              provenCredit(account, corrected.extra),
              availableAdvance(account),
            ),
          ]);
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
      const knownCredit = provenCredit(account, uncontracted);
      const advance = Math.min(knownCredit, availableAdvance(account));
      result.advance = sum([result.advance, advance]);
      const remainingCredit = knownCredit - advance;
      if (hasBill(account))
        result.credit = sum([result.credit, remainingCredit]);
    }
    result.receivable = sum(
      cash.payments
        .filter(
          (payment) =>
            payment.context === "receivable" &&
            !uncertainAccounts.has(
              accounts.get(payment.id) ?? payment.entry.account,
            ),
        )
        .map((payment) => payment.available),
    );
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
