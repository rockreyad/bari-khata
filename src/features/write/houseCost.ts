import {
  LedgerSchema,
  PersonSchema,
  type Ledger,
  type Receipt,
} from "../../domain/model";
import { allocatePayment } from "../../domain/partyLedger";
import { canRecordContactCost } from "../../domain/contactEntryPolicy";
import { buildQuickEntry, type QuickDraft } from "../entries/quickEntry";

export function recordHouseCost(
  ledger: Ledger,
  draft: QuickDraft,
  receipts: Receipt[],
  generalName: string,
) {
  let source = ledger;
  let resolved = draft;
  if (draft.payment === "worker" && draft.personId === "__new__") {
    if (
      !draft.personName.trim() ||
      !draft.personNewId ||
      ledger.people.some((row) => row.id === draft.personNewId)
    )
      throw new Error("person");
    const payer = PersonSchema.parse({
      id: draft.personNewId,
      name: draft.personName.trim(),
      kind: "other",
      contactType: "custom",
      roles: [],
    });
    source = { ...ledger, people: [...ledger.people, payer] };
    resolved = { ...draft, personId: payer.id };
  }
  const person = source.people.find((row) => row.id === resolved.personId);
  if (
    person &&
    !canRecordContactCost(person, {
      costType: resolved.costType,
      account: resolved.account,
      reimbursement: resolved.payment === "worker",
      contractId: resolved.contractId,
    })
  )
    throw new Error("contact_rules");
  // A missing material category is a reporting choice, not an unconfirmed bill.
  const next = buildQuickEntry(
    source,
    { ...resolved, kind: "expense" },
    receipts,
    generalName,
  );
  const bill = next.entries.find((entry) => entry.id === draft.id)!;
  bill.reviewStatus = "confirmed";
  bill.reviewReason = "";
  const payment = next.entries.find((entry) => entry.id === draft.paymentId);
  const paid =
    payment?.paymentParts.reduce((sum, part) => sum + part.amount, 0) ?? 0;
  const total = bill.lines.reduce((sum, line) => sum + line.amount, 0);
  if (paid > total) throw new Error("amount");
  const validated = LedgerSchema.parse(next);
  if (!payment || !bill.personId) return validated;
  return allocatePayment(validated, payment.id, [
    { billId: bill.id, workId: bill.lines[0].workId, amount: paid },
  ]);
}
