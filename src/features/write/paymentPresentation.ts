import type { Ledger } from "../../domain/model";
import {
  planHousePayment,
  recordHousePayment,
  type HousePaymentPlan,
  type HousePaymentRequest,
} from "../../domain/housePayments";
import { partyLedger } from "../../domain/partyLedger";
import { reconciledTotals } from "../../domain/adjustmentMath";

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
  options: { date?: string; method?: "cash" | "bkash" | "bank" | "other" } = {},
): PaymentPresentation {
  const summary = partyLedger(ledger, request.personId);
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
  const uncertain = summary.balanceAmbiguous || summary.creditAmbiguous;
  const result: PaymentPresentation = {
    beforeDue: uncertain ? null : summary.earnedPayable,
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
      summary.legacyUnclassifiedCredit > 0 ||
      current.requiresCashReview,
    legacyUnallocatedCash: summary.legacyUnclassifiedCredit,
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
    const after = partyLedger(next, request.personId);
    if (
      after.balanceAmbiguous ||
      after.creditAmbiguous ||
      after.earnedPayable === null
    )
      return result;
    result.afterDue = after.earnedPayable;
    const beforeCredit = reconciledTotals(ledger, {
      personId: request.personId,
    }).reconciledAdvance;
    const afterCredit = reconciledTotals(next, {
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
