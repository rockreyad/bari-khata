import type { Account, Ledger, Person } from "../../domain/model";
import { contactAccountLedger } from "../../domain/contacts";
import { partyAccountBalance } from "../../domain/ledger";
import { reconciledTotals } from "../../domain/adjustmentMath";

export function entryPaymentBalance(
  ledger: Ledger,
  person: Person,
  account: Account,
  contractId: string | null = null,
) {
  const scoped = contactAccountLedger(ledger, person, account);
  const acrossJobs =
    !contractId &&
    account === "labour" &&
    ledger.contracts.some((job) => job.personId === person.id) &&
    scoped.entries.some(
      (entry) =>
        !entry.voided &&
        entry.kind === "adjustment" &&
        entry.adjustment?.target === "person" &&
        !entry.contractId,
    );
  // A person's correction cannot be separated from the jobs it reconciles.
  const totals = acrossJobs
    ? reconciledTotals(scoped, { personId: person.id, account })
    : null;
  const balance = totals
    ? totals.balanceAmbiguous
      ? null
      : totals.reconciledBalance
    : partyAccountBalance(scoped, person.id, account, contractId).balance;
  return { balance, acrossJobs };
}
