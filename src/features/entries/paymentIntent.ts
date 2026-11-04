import type { Contract, Ledger } from "../../domain/model";
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
  return (
    canInferPaymentScope(ledger, personId, account) &&
    paymentIntent(ledger, { personId, account, contractId }).canSettle
  );
}

function canInferPaymentScope(
  ledger: Ledger,
  personId: string,
  account: QuickDraft["account"],
) {
  const person = ledger.people.find((row) => row.id === personId);
  return Boolean(
    person &&
    !person.archivedAt &&
    account === "labour" &&
    !contactAccountLedger(ledger, person, account).entries.some(
      (entry) => !entry.voided && !entry.contractId,
    ),
  );
}

export function preferredPaymentJob(
  ledger: Ledger,
  personId: string,
  account: QuickDraft["account"],
  contracts: Contract[],
  allowUnclassified = true,
) {
  // Aggregate money cannot be silently assigned to one of the person's jobs.
  if (!canInferPaymentScope(ledger, personId, account)) return undefined;
  const available = contracts.filter(
    (job) =>
      job.personId === personId &&
      !job.archivedAt &&
      (job.scope === "house" ||
        ledger.works.some(
          (work) => work.id === job.workId && !work.archivedAt,
        )),
  );
  const ongoing = available.filter((job) => job.status === "ongoing");
  const preferred = ongoing.length
    ? ongoing
    : available.filter((job) => job.status === "done");
  const stamp = (job: Contract) => {
    const statusChanges = job.activity.filter(
      (event) =>
        event.after.status === job.status &&
        event.before?.status !== event.after.status,
    );
    const events = statusChanges.length
      ? statusChanges
      : [...job.activity, ...job.history];
    return (
      events.reduce(
        (latest, event) => Math.max(latest, Date.parse(event.at) || 0),
        0,
      ) ||
      Date.parse(job.agreedOn ?? "") ||
      0
    );
  };
  return (
    preferred
      .map((job) => ({ job, at: stamp(job) }))
      .sort((a, b) => b.at - a.at || a.job.id.localeCompare(b.job.id))[0]
      ?.job ??
    (allowUnclassified &&
    available.length === 1 &&
    inferPaymentJob(ledger, personId, account, available[0].id)
      ? available[0]
      : undefined)
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
