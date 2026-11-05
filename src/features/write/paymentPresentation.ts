import type { Ledger } from "../../domain/model";
import {
  planHousePayment,
  recordHousePayment,
  type HousePaymentPlan,
  type HousePaymentRequest,
} from "../../domain/housePayments";
import { partyLedger } from "../../domain/partyLedger";
import { reconciledTotals } from "../../domain/adjustmentMath";
import { contractSummary } from "../../domain/ledger";

export type PaymentPresentation = {
  beforeDue: number | null;
  afterDue: number | null;
  matchedBillAmount: number;
  remaining: number;
  excess: number | null;
  hasScopedBills: boolean;
  hasOtherBills: boolean;
  requiresReview: boolean;
  legacyUnallocatedCash: number;
  canPreview: boolean;
};

export function paymentPresentation(
  ledger: Ledger,
  request: HousePaymentRequest,
  plan: HousePaymentPlan,
  options: {
    date?: string;
    method?: "cash" | "bkash" | "bank" | "other";
    balanceBasis?: "earned" | "commitment";
  } = {},
): PaymentPresentation {
  const summary = partyLedger(ledger, request.personId);
  const scopedLedger = (source: Ledger): Ledger =>
    request.contractId
      ? {
          ...source,
          entries: source.entries.filter(
            (entry) => entry.contractId === request.contractId,
          ),
          contracts: source.contracts.filter(
            (contract) => contract.id === request.contractId,
          ),
        }
      : source;
  const balanceLedger = scopedLedger(ledger);
  const scoped = request.contractId
    ? partyLedger(balanceLedger, request.personId)
    : summary;
  const commitment = Boolean(
    request.contractId &&
    (options.balanceBasis ??
      (request.intent === "payment" ? "commitment" : "earned")) ===
      "commitment",
  );
  const selected = request.contractId
    ? contractSummary(ledger, request.contractId)
    : null;
  const current = planHousePayment(ledger, request);
  const openWorks = summary.bills.flatMap((bill) =>
    bill.works
      .filter((work) => work.outstanding > 0)
      .map((work) => ({ bill, work })),
  );
  const matches = ({ bill, work }: (typeof openWorks)[number]) =>
    (!request.account || bill.entry.account === request.account) &&
    (request.contractId === undefined ||
      bill.entry.contractId === request.contractId) &&
    (!request.workId || work.workId === request.workId);
  const uncertain =
    scoped.balanceAmbiguous ||
    scoped.creditAmbiguous ||
    Boolean(
      request.contractId &&
      (!selected?.contract ||
        selected.contract.personId !== request.personId ||
        (commitment && !selected.commitmentValid)),
    );
  const result: PaymentPresentation = {
    beforeDue: uncertain
      ? null
      : commitment
        ? selected!.remainingCommitment
        : scoped.earnedPayable,
    afterDue: null,
    matchedBillAmount: current.allocations.reduce(
      (sum, row) => sum + row.amount,
      0,
    ),
    remaining: current.remainder,
    excess: null,
    hasScopedBills: openWorks.some(matches),
    hasOtherBills: openWorks.some((row) => !matches(row)),
    requiresReview:
      uncertain ||
      scoped.legacyUnclassifiedCredit > 0 ||
      current.requiresCashReview,
    legacyUnallocatedCash: scoped.legacyUnclassifiedCredit,
    canPreview: false,
  };
  if (
    !ledger.people.some(
      (person) => person.id === request.personId && !person.archivedAt,
    ) ||
    uncertain ||
    current.issues.length ||
    current.signature !== plan.signature ||
    (request.intent === "settlement" && !result.matchedBillAmount)
  )
    return result;
  let suffix = 0;
  let id = "payment-preview";
  while (
    ledger.entries.some(
      (entry) => entry.id === id || entry.id.startsWith(`${id}:`),
    ) ||
    ledger.paymentAllocations?.some((row) => row.id.startsWith(`${id}:`))
  )
    id = `payment-preview-${++suffix}`;
  try {
    // This projects the proposed result; the form still requires the real save confirmations.
    const next = recordHousePayment(
      ledger,
      {
        ...request,
        id,
        date: options.date ?? "9999-12-31",
        method: options.method ?? "cash",
        confirmRemainderAdvance: true,
      },
      current,
    );
    const afterLedger = scopedLedger(next);
    const after = partyLedger(afterLedger, request.personId);
    const afterContract = commitment
      ? contractSummary(next, request.contractId!)
      : null;
    if (
      after.balanceAmbiguous ||
      after.creditAmbiguous ||
      after.earnedPayable === null ||
      (commitment && !afterContract?.commitmentValid)
    )
      return result;
    result.afterDue = commitment
      ? afterContract!.remainingCommitment
      : after.earnedPayable;
    const beforeCredit = commitment
      ? selected!.commitmentExtra
      : reconciledTotals(balanceLedger, {
          personId: request.personId,
        }).reconciledAdvance;
    const afterCredit = commitment
      ? afterContract!.commitmentExtra
      : reconciledTotals(afterLedger, {
          personId: request.personId,
        }).reconciledAdvance;
    result.excess = Math.min(
      current.remainder,
      Math.max(0, afterCredit - beforeCredit),
    );
    result.canPreview = true;
  } catch {
    // Invalid or no longer applicable plans have no reliable projected outcome.
  }
  return result;
}
