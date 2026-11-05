import {
  EntryCoreSchema,
  EntrySchema,
  validateLedger,
  type Entry,
  type Ledger,
} from "./model";
import { entryTotal, replaceExpenseAndSettlements } from "./ledger";
import { allocatePayment } from "./partyLedger";

type EntryCore = Entry["revisions"][number]["before"];

function simplePair(
  bill: EntryCore,
  payment: EntryCore,
  requireSameDate = true,
) {
  const works = new Set(bill.lines.map((line) => line.workId));
  return (
    bill.kind === "expense" &&
    payment.kind === "payment" &&
    !bill.voided &&
    !payment.voided &&
    bill.balanceImpact === "normal" &&
    payment.balanceImpact === "normal" &&
    Boolean(bill.createdAt) &&
    bill.createdAt === payment.createdAt &&
    (!requireSameDate || (Boolean(bill.date) && bill.date === payment.date)) &&
    payment.relatedEntryId === bill.id &&
    bill.personId === payment.personId &&
    bill.account === payment.account &&
    bill.contractId === payment.contractId &&
    works.size === 1 &&
    payment.allocations.length === 1 &&
    payment.paymentParts.length === 1 &&
    works.has(payment.allocations[0].workId) &&
    payment.paymentParts[0].amount > 0 &&
    payment.paymentParts[0].amount === payment.allocations[0].amount
  );
}

function core(entry: Entry | EntryCore) {
  return EntryCoreSchema.parse(entry);
}
function sameCore(a: Entry | EntryCore, b: Entry | EntryCore) {
  return (
    JSON.stringify({ ...core(a), updatedAt: "" }) ===
    JSON.stringify({ ...core(b), updatedAt: "" })
  );
}

function pairedRevision(
  billBefore: EntryCore,
  billAfter: EntryCore,
  paymentBefore: EntryCore,
  paymentAfter: EntryCore,
) {
  if (
    !simplePair(billBefore, paymentBefore, false) ||
    !simplePair(billAfter, paymentAfter, false) ||
    billBefore.account !== billAfter.account ||
    billBefore.contractId !== billAfter.contractId ||
    (billBefore.personId !== billAfter.personId && billBefore.personId !== null)
  )
    return false;
  const afterAmount = paymentAfter.paymentParts[0].amount;
  const beforeAmount = paymentBefore.paymentParts[0].amount;
  const expected: EntryCore = {
    ...paymentBefore,
    personId: billAfter.personId,
    allocations: [
      {
        ...paymentBefore.allocations[0],
        workId: billAfter.lines[0].workId,
        amount: afterAmount,
      },
    ],
    paymentParts: [{ ...paymentBefore.paymentParts[0], amount: afterAmount }],
  };
  if (!sameCore(expected, paymentAfter)) return false;
  const billTotal = billAfter.lines.reduce(
    (sum, line) => sum + BigInt(line.amount),
    0n,
  );
  return beforeAmount === afterAmount || BigInt(afterAmount) === billTotal;
}

export function paidPurchasePayment(
  ledger: Ledger,
  expenseId: string,
): Entry | null {
  const bill = ledger.entries.find((entry) => entry.id === expenseId);
  if (!bill) return null;
  const linked = ledger.entries.filter(
    (entry) => entry.relatedEntryId === expenseId,
  );
  if (linked.length !== 1) return null;
  const payment = linked[0];
  const firstBill = bill.revisions[0]?.before ?? bill;
  const firstPayment = payment.revisions[0]?.before ?? payment;
  if (!simplePair(firstBill, firstPayment) || !simplePair(bill, payment, false))
    return null;
  let previousBillIndex = -1;
  for (const [paymentIndex, revision] of payment.revisions.entries()) {
    const afterPayment = payment.revisions[paymentIndex + 1]?.before ?? payment;
    const index = bill.revisions.findIndex(
      (candidate, position) =>
        position > previousBillIndex &&
        candidate.at === revision.at &&
        pairedRevision(
          candidate.before,
          bill.revisions[position + 1]?.before ?? bill,
          revision.before,
          afterPayment,
        ),
    );
    if (index < 0) return null;
    previousBillIndex = index;
  }
  return payment;
}

export function fullyPaidPurchasePayment(
  ledger: Ledger,
  expenseId: string,
): Entry | null {
  const payment = paidPurchasePayment(ledger, expenseId);
  const bill = ledger.entries.find((entry) => entry.id === expenseId);
  if (!bill || !payment || entryTotal(bill) !== entryTotal(payment))
    return null;
  const firstBill = bill.revisions[0]?.before ?? bill;
  const firstPayment = payment.revisions[0]?.before ?? payment;
  if (!simplePair(firstBill, firstPayment)) return null;
  const firstBillTotal = firstBill.lines.reduce(
    (sum, line) => sum + BigInt(line.amount),
    0n,
  );
  return firstBillTotal === BigInt(firstPayment.paymentParts[0].amount)
    ? payment
    : null;
}

export function replacePaidPurchase(
  ledger: Ledger,
  replacementBill: Entry,
  expectedPayment: Entry,
): Ledger {
  const current = validateLedger(ledger);
  const currentPayment = current.entries.find(
    (entry) => entry.id === expectedPayment.id,
  );
  if (
    !currentPayment ||
    JSON.stringify(EntrySchema.parse(currentPayment)) !==
      JSON.stringify(EntrySchema.parse(expectedPayment))
  )
    throw new Error("paid_purchase_payment_stale");
  const originalBill = current.entries.find(
    (entry) => entry.id === replacementBill.id,
  );
  const payment = paidPurchasePayment(current, replacementBill.id);
  if (
    !originalBill ||
    !payment ||
    payment.id !== expectedPayment.id ||
    replacementBill.kind !== "expense" ||
    replacementBill.voided ||
    replacementBill.balanceImpact !== "normal"
  )
    throw new Error("paid_purchase_not_eligible");
  const pairedAllocations = (current.paymentAllocations ?? []).filter(
    (row) =>
      !row.cancelledAt &&
      (row.paymentId === payment.id || row.billId === originalBill.id),
  );
  if (
    pairedAllocations.some(
      (row) => row.paymentId !== payment.id || row.billId !== originalBill.id,
    )
  )
    throw new Error("paid_purchase_allocations_need_review");
  const at = new Date().toISOString();
  const beforeEdit = validateLedger({
    ...current,
    paymentAllocations: current.paymentAllocations?.map((row) =>
      pairedAllocations.some((paired) => paired.id === row.id)
        ? {
            ...row,
            cancelledAt: at,
            cancellationReason: "কেনাকাটার অঙ্ক বদলানোয় আগের মিল বদলেছি",
          }
        : row,
    ),
  });
  const candidate = replaceExpenseAndSettlements(beforeEdit, replacementBill);
  const bill = candidate.entries.find((entry) => entry.id === originalBill.id)!;
  const mappedPayment = candidate.entries.find(
    (entry) => entry.id === payment.id,
  )!;
  const works = new Set(bill.lines.map((line) => line.workId));
  if (works.size !== 1) throw new Error("paid_purchase_not_eligible");
  const total = entryTotal(bill);
  const workId = bill.lines[0].workId;
  const nextPayment: Entry = {
    ...mappedPayment,
    allocations: [{ ...payment.allocations[0], workId, amount: total }],
    paymentParts: [{ ...payment.paymentParts[0], amount: total }],
  };
  const cashChanged = !sameCore(payment, nextPayment);
  const billChanged = !sameCore(originalBill, bill);
  if (!cashChanged && !billChanged) return current;
  const revise = (before: Entry, after: Entry): Entry => ({
    ...after,
    updatedAt: at,
    revisions: [...before.revisions, { at, before: core(before) }],
  });
  // A matching bill snapshot also records an explicit repair of previously mismatched cash.
  const updated = validateLedger({
    ...candidate,
    entries: candidate.entries.map((entry) =>
      entry.id === bill.id
        ? revise(originalBill, bill)
        : entry.id === payment.id
          ? cashChanged
            ? revise(payment, nextPayment)
            : payment
          : entry,
    ),
  });
  return pairedAllocations.length
    ? allocatePayment(updated, payment.id, [
        { billId: bill.id, workId, amount: total },
      ])
    : updated;
}
