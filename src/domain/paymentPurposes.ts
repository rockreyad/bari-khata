import type { Ledger } from "./model.js";
export function preservesPaymentPurposes(before: Ledger, after: Ledger) {
  return (
    before.paymentPurposes.every((purpose) =>
      after.paymentPurposes.some(
        (p) => p.id === purpose.id && p.account === purpose.account,
      ),
    ) &&
    before.entries.every(
      (entry) =>
        !entry.paymentPurposeId ||
        after.entries.some(
          (e) =>
            e.id === entry.id && e.paymentPurposeId === entry.paymentPurposeId,
        ),
    )
  );
}
