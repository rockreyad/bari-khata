import type { Entry, Ledger } from "./model.js";

export function cashObligationParts(
  ledger: Pick<Ledger, "entries" | "paymentAllocations">,
  entry: Entry,
) {
  if (entry.paymentContext !== "receivable") return entry.allocations;
  if (entry.kind !== "payment") return [];
  const bills = new Map(ledger.entries.map((row) => [row.id, row]));
  const amounts = new Map<string, number>();
  for (const allocation of ledger.paymentAllocations ?? []) {
    if (allocation.paymentId !== entry.id || allocation.cancelledAt) continue;
    const bill = bills.get(allocation.billId);
    const workId = allocation.workId ?? bill?.lines[0]?.workId;
    if (workId)
      amounts.set(workId, (amounts.get(workId) ?? 0) + allocation.amount);
  }
  return [...amounts].map(([workId, amount]) => ({ workId, amount }));
}
