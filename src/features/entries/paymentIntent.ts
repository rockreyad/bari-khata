import type { Ledger } from "../../domain/model";
import { reconciledTotals } from "../../domain/adjustmentMath";
import { entryPaymentBalance } from "./entryPaymentBalance";
import { contactAccountLedger } from "../../domain/contacts";
import { quickWageAmount, type QuickDraft } from "./quickEntry";
import { moneyInputValue } from "../../lib/numericFields";

export function paymentIntent(
  ledger: Ledger,
  scope: Pick<QuickDraft, "personId" | "account" | "contractId">,
) {
  const person = ledger.people.find((row) => row.id === scope.personId);
  const job = scope.contractId
    ? ledger.contracts.find(
        (row) =>
          row.id === scope.contractId &&
          row.personId === scope.personId &&
          scope.account === "labour",
      )
    : null;
  const balance = scope.contractId
    ? job
      ? reconciledTotals(ledger, {
          personId: scope.personId,
          account: scope.account,
          contractId: job.id,
        }).reconciledBalance
      : null
    : person
      ? entryPaymentBalance(ledger, person, scope.account).balance
      : 0;
  const canSettle = balance !== null && balance > 0;
  const hasJob = Boolean(scope.contractId);
  const defaultPurpose: QuickDraft["purpose"] = canSettle
    ? "settle"
    : balance === null
      ? "settle"
      : hasJob
        ? "advance"
        : "charge";
  return { balance, canSettle, hasJob, defaultPurpose };
}

export function paymentPurpose(
  ledger: Ledger,
  scope: Pick<QuickDraft, "personId" | "account" | "contractId">,
  requested?: QuickDraft["purpose"],
) {
  const state = paymentIntent(ledger, scope);
  return requested && requested !== "settle" ? requested : state.defaultPurpose;
}

export function hasPaymentWriting(draft: QuickDraft) {
  return [
    draft.amount,
    draft.paid,
    draft.wageDays,
    draft.wageRate,
    draft.note,
    draft.paymentPurposeId,
    draft.paymentPurposeName,
    ...draft.rows.flatMap((row) => [
      row.amount,
      row.label,
      row.groupId,
      row.groupName,
      row.brand,
      row.usage,
      row.quantity,
      row.unit,
    ]),
  ].some((value) => value.trim());
}

export function paymentScopeChange(
  ledger: Ledger,
  draft: QuickDraft,
  change: Partial<QuickDraft>,
) {
  const next = { ...draft, ...change };
  if (
    next.kind === "payment" &&
    ["personId", "account", "contractId"].some(
      (key) => next[key as keyof QuickDraft] !== draft[key as keyof QuickDraft],
    ) &&
    !hasPaymentWriting(draft) &&
    draft.purpose !== "advance"
  )
    next.purpose = paymentPurpose(ledger, next);
  return next;
}

export function inferPaymentJob(
  ledger: Ledger,
  personId: string,
  account: QuickDraft["account"],
  contractId: string,
) {
  const person = ledger.people.find((row) => row.id === personId);
  return Boolean(
    person &&
    !contactAccountLedger(ledger, person, account).entries.some(
      (entry) => !entry.voided && !entry.contractId,
    ) &&
    paymentIntent(ledger, { personId, account, contractId }).canSettle,
  );
}

export function changePaymentPurpose(
  draft: QuickDraft,
  purpose: "charge" | "settle" | "advance",
) {
  const daily = draft.purpose === "wage" && draft.wageBasis === "day";
  if (
    purpose === "charge" &&
    draft.purpose === "wage" &&
    draft.account === "labour"
  )
    return draft;
  return {
    ...draft,
    purpose,
    amount: daily ? moneyInputValue(quickWageAmount(draft)) : draft.amount,
    ...(purpose === "charge"
      ? { contractId: "", wageBasis: "total" as const }
      : {}),
  };
}
