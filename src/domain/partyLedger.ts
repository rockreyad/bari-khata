import {
  PaymentAllocationSchema,
  validateLedger,
  type Account,
  type Entry,
  type Ledger,
  type PaymentAllocation,
} from "./model.js";
import { reconciledTotals } from "./adjustmentMath.js";

type AllocationInput = { billId: string; amount: number; workId?: string };
const total = (entry: Entry) =>
  (entry.kind === "expense" || entry.kind === "expense_credit"
    ? entry.lines
    : entry.paymentParts
  ).reduce((sum, part) => sum + part.amount, 0);
const bucketKey = (entry: Entry, workId: string) =>
  JSON.stringify([entry.account, entry.contractId, workId]);
const contextKey = (entry: Entry, workId: string) =>
  JSON.stringify([
    entry.account,
    entry.contractId,
    workId,
    entry.paymentContext ?? null,
  ]);
const add = (map: Map<string, number>, key: string, amount: number) =>
  map.set(key, (map.get(key) ?? 0) + amount);

export function partyLedger(
  ledger: Ledger,
  personId: string,
  account?: Account,
) {
  const entries = ledger.entries.filter(
    (entry) =>
      entry.personId === personId && (!account || entry.account === account),
  );
  const active = entries.filter(
    (entry) => !entry.voided && entry.balanceImpact === "normal",
  );
  const activeIds = new Set(active.map((entry) => entry.id));
  const entryIds = new Set(entries.map((entry) => entry.id));
  const allocationHistory = (ledger.paymentAllocations ?? []).filter(
    (allocation) => entryIds.has(allocation.paymentId),
  );
  const allocations = allocationHistory.filter(
    (allocation) =>
      !allocation.cancelledAt && activeIds.has(allocation.paymentId),
  );
  const allocatedByBill = new Map<string, number>();
  const allocatedByPayment = new Map<string, number>();
  const allocatedWork = new Map<string, number>();
  const allocatedBillWork = new Map<string, number>();
  const credits = new Map<string, number>();
  const creditedWork = new Map<string, number>();
  for (const entry of active)
    if (entry.kind === "expense_credit" && entry.relatedEntryId) {
      add(credits, entry.relatedEntryId, total(entry));
      for (const line of entry.lines)
        add(
          creditedWork,
          JSON.stringify([entry.relatedEntryId, line.workId]),
          line.amount,
        );
    }
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const allocation of allocations) {
    add(allocatedByBill, allocation.billId, allocation.amount);
    add(allocatedByPayment, allocation.paymentId, allocation.amount);
    const bill = byId.get(allocation.billId)!;
    const workId = allocation.workId ?? bill.lines[0].workId;
    add(
      allocatedWork,
      JSON.stringify([allocation.paymentId, workId]),
      allocation.amount,
    );
    add(
      allocatedBillWork,
      JSON.stringify([allocation.billId, workId]),
      allocation.amount,
    );
  }
  const bills = active
    .filter(
      (entry) => entry.kind === "expense" && entry.reviewStatus === "confirmed",
    )
    .map((entry) => {
      const amount = total(entry);
      const credited = credits.get(entry.id) ?? 0;
      const allocated = allocatedByBill.get(entry.id) ?? 0;
      const lineAmounts = new Map<string, number>();
      for (const line of entry.lines)
        add(lineAmounts, line.workId, line.amount);
      const works = [...lineAmounts].map(([workId, amount]) => {
        const key = JSON.stringify([entry.id, workId]);
        const credited = creditedWork.get(key) ?? 0;
        const allocated = allocatedBillWork.get(key) ?? 0;
        return {
          workId,
          amount,
          credited,
          allocated,
          outstanding: Math.max(0, amount - credited - allocated),
        };
      });
      return {
        entry,
        amount,
        credited,
        allocated,
        outstanding: Math.max(0, amount - credited - allocated),
        works,
      };
    });
  const refundPools = new Map<string, number>();
  const netCash = new Map<string, number>();
  for (const entry of active) {
    if (entry.kind !== "payment" && entry.kind !== "refund") continue;
    for (const part of entry.allocations) {
      add(
        netCash,
        bucketKey(entry, part.workId),
        part.amount * (entry.kind === "refund" ? -1 : 1),
      );
      if (entry.kind === "refund")
        add(refundPools, contextKey(entry, part.workId), part.amount);
    }
  }
  const payments = active
    .filter(
      (entry) => entry.kind === "payment" && entry.reviewStatus === "confirmed",
    )
    .sort(
      (a, b) =>
        (a.date ?? "").localeCompare(b.date ?? "") ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    )
    .map((entry) => {
      const workAmounts = new Map<string, number>();
      for (const part of entry.allocations)
        add(workAmounts, part.workId, part.amount);
      const works = [...workAmounts].map(([workId, amount]) => {
        const allocated =
          allocatedWork.get(JSON.stringify([entry.id, workId])) ?? 0;
        const key = contextKey(entry, workId);
        const refunded = Math.min(
          amount - allocated,
          refundPools.get(key) ?? 0,
        );
        refundPools.set(key, (refundPools.get(key) ?? 0) - refunded);
        return {
          workId,
          amount,
          allocated,
          refunded,
          available: amount - allocated - refunded,
        };
      });
      const amount = total(entry);
      const allocated = allocatedByPayment.get(entry.id) ?? 0;
      return {
        entry,
        id: entry.id,
        amount,
        allocated,
        context: entry.paymentContext ?? null,
        works,
        unallocated: 0,
        available: 0,
      };
    });
  const unmatchedRefunds = new Map<string, number>();
  for (const [key, amount] of refundPools) {
    if (!amount) continue;
    const [entryAccount, contractId, workId] = JSON.parse(key);
    add(
      unmatchedRefunds,
      JSON.stringify([entryAccount, contractId, workId]),
      amount,
    );
  }
  // An old refund without a matching cash context must not be assigned to an invented source.
  for (const payment of payments) {
    for (const work of payment.works)
      work.available = Math.max(
        0,
        work.available -
          (unmatchedRefunds.get(bucketKey(payment.entry, work.workId)) ?? 0),
      );
    payment.available = payment.works.reduce(
      (sum, work) => sum + work.available,
      0,
    );
    payment.unallocated = payment.available;
  }
  const allocatedByBucket = new Map<string, number>();
  for (const allocation of allocations) {
    const payment = byId.get(allocation.paymentId)!;
    const bill = byId.get(allocation.billId)!;
    add(
      allocatedByBucket,
      bucketKey(payment, allocation.workId ?? bill.lines[0].workId),
      allocation.amount,
    );
  }
  const unallocatedCash = [...netCash].reduce(
    (sum, [key, amount]) =>
      sum + Math.max(0, amount - (allocatedByBucket.get(key) ?? 0)),
    0,
  );
  const advance = payments
    .filter((payment) => payment.context === "advance")
    .reduce((sum, payment) => sum + payment.available, 0);
  const receivable = payments
    .filter((payment) => payment.context === "receivable")
    .reduce((sum, payment) => sum + payment.available, 0);
  const legacyUnclassifiedCredit = payments
    .filter((payment) => !payment.context)
    .reduce((sum, payment) => sum + payment.available, 0);
  const ordinaryUnallocatedCash = payments
    .filter((payment) => payment.context === "settlement")
    .reduce((sum, payment) => sum + payment.available, 0);
  const totals = reconciledTotals(ledger, {
    personId,
    ...(account ? { account } : {}),
  });
  return {
    entries,
    bills,
    payments,
    unallocatedPayments: payments.filter((payment) => payment.available > 0),
    allocations,
    allocationHistory,
    cancelledAllocations: allocationHistory.filter(
      (allocation) => allocation.cancelledAt,
    ),
    payable: totals.reconciledPayable,
    earnedPayable: totals.balanceAmbiguous ? null : totals.reconciledPayable,
    balanceAmbiguous: totals.balanceAmbiguous,
    unresolvedAdjustmentIds: totals.unresolvedAdjustmentIds,
    billOutstanding: bills.reduce((sum, bill) => sum + bill.outstanding, 0),
    allocated: allocations.reduce(
      (sum, allocation) => sum + allocation.amount,
      0,
    ),
    unallocatedCash,
    advance,
    explicitAdvance: advance,
    receivable,
    legacyUnclassifiedCredit,
    ordinaryUnallocatedCash,
    ambiguousCredit: Math.max(
      0,
      unallocatedCash -
        advance -
        receivable -
        legacyUnclassifiedCredit -
        ordinaryUnallocatedCash,
    ),
    unclassifiedRefunds: [...unmatchedRefunds.values()].reduce(
      (sum, amount) => sum + amount,
      0,
    ),
    creditAmbiguous: unmatchedRefunds.size > 0,
  };
}

export function allocatePayment(
  ledger: Ledger,
  paymentId: string,
  allocations: AllocationInput[],
): Ledger;
export function allocatePayment(
  ledger: Ledger,
  allocations: PaymentAllocation[],
): Ledger;
export function allocatePayment(
  ledger: Ledger,
  paymentOrRows: string | PaymentAllocation[],
  requested: AllocationInput[] = [],
): Ledger {
  const current = validateLedger(ledger);
  const next = [...(current.paymentAllocations ?? [])];
  const fullRows =
    typeof paymentOrRows === "string"
      ? requested.map((input) => {
          const bill = current.entries.find(
            (entry) => entry.id === input.billId,
          );
          const works = [
            ...new Set(bill?.lines.map((line) => line.workId) ?? []),
          ];
          const workId =
            input.workId ?? (works.length === 1 ? works[0] : undefined);
          return PaymentAllocationSchema.parse({
            ...input,
            workId,
            paymentId: paymentOrRows,
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
          });
        })
      : paymentOrRows.map((row) => PaymentAllocationSchema.parse(row));
  for (const row of fullRows) {
    const existing = next.find((candidate) => candidate.id === row.id);
    if (existing) {
      if (
        JSON.stringify(PaymentAllocationSchema.parse(existing)) !==
        JSON.stringify(row)
      )
        throw new Error("payment_allocation_conflict");
    } else next.push(row);
  }
  return validateLedger({ ...current, paymentAllocations: next });
}

export function cancelPaymentAllocation(
  ledger: Ledger,
  id: string,
  reason: string,
  at = new Date().toISOString(),
): Ledger {
  const current = validateLedger(ledger);
  const existing = current.paymentAllocations?.find(
    (allocation) => allocation.id === id,
  );
  if (!existing) throw new Error("unknown_payment_allocation");
  if (existing.cancelledAt) {
    if (existing.cancellationReason !== reason.trim())
      throw new Error("payment_allocation_conflict");
    return current;
  }
  const cancelled = PaymentAllocationSchema.parse({
    ...existing,
    cancelledAt: at,
    cancellationReason: reason,
  });
  return validateLedger({
    ...current,
    paymentAllocations: current.paymentAllocations!.map((allocation) =>
      allocation.id === id ? cancelled : allocation,
    ),
  });
}

export function preservesPaymentAllocationHistory(
  before: Pick<Ledger, "paymentAllocations">,
  after: Pick<Ledger, "paymentAllocations">,
) {
  const replacements = new Map(
    (after.paymentAllocations ?? []).map((row) => [row.id, row]),
  );
  return (before.paymentAllocations ?? []).every((row) => {
    const replacement = replacements.get(row.id);
    if (!replacement) return false;
    const parsed = PaymentAllocationSchema.safeParse(replacement);
    if (!parsed.success) return false;
    if (row.cancelledAt)
      return (
        JSON.stringify(PaymentAllocationSchema.parse(row)) ===
        JSON.stringify(parsed.data)
      );
    const {
      cancelledAt: _at,
      cancellationReason: _reason,
      ...core
    } = parsed.data;
    return (
      JSON.stringify(PaymentAllocationSchema.parse(row)) ===
      JSON.stringify(core)
    );
  });
}
