import { latinDigits } from "../../lib/numerals";
import {
  contractQuantity,
  contractTotal,
  moneyInputValue,
  numericDraftText,
} from "../../lib/numericFields";
import { contractAppliesToWork } from "../../domain/contracts";
import { z } from "zod";
import {
  EntrySchema,
  EntryLineSchema,
  ItemSchema,
  MaterialGroupSchema,
  WorkSchema,
  PersonSchema,
  LedgerSchema,
  PaymentPurposeSchema,
  type Ledger,
} from "../../domain/model";
import {
  canRecordContactCash,
  canRecordContactCost,
  canRecordContactReturn,
} from "../../domain/contactEntryPolicy";
import { saveWorkChange } from "../../domain/workActivity";
import { parseAmount } from "../../domain/ledger";

const id = () => z.string().max(160).default("");
const text = (max = 200) => z.string().max(max).default("");
export const QuickDraftSchema = z.object({
  id: id(),
  paymentId: id(),
  refundId: id(),
  workId: id(),
  personId: id(),
  personName: text(),
  personNewId: id(),
  kind: z
    .enum(["expense", "payment", "refund", "return", "wage"])
    .default("expense"),
  purpose: z.enum(["settle", "advance", "wage", "charge"]).default("settle"),
  advanceContext: z.enum(["advance", "receivable"]).default("advance"),
  refundContext: z
    .enum(["unknown", "settlement", "advance", "receivable"])
    .default("unknown"),
  date: text(10),
  note: text(10000),
  amount: numericDraftText(),
  paid: numericDraftText(),
  wageBasis: z.enum(["total", "day"]).default("total"),
  wageDays: numericDraftText(),
  wageRate: numericDraftText(),
  refund: numericDraftText(),
  payment: z.enum(["full", "partial", "due", "worker"]).default("full"),
  method: z.enum(["cash", "bkash", "bank", "other"]).default("cash"),
  account: z.enum(["materials", "labour", "other"]).default("materials"),
  paymentPurposeId: id(),
  paymentPurposeName: text(),
  paymentPurposeNewId: id(),
  contractId: id(),
  milestoneId: id(),
  costType: z
    .enum(["material", "labour", "transport", "unload", "rental", "other"])
    .default("material"),
  rows: z
    .array(
      z.object({
        id: z.string().min(1).max(160),
        label: text(200),
        amount: numericDraftText(),
        groupId: id(),
        groupName: text(),
        autoItemName: text(),
        brand: text(),
        usage: text(),
        quantity: numericDraftText(),
        unit: text(60),
      }),
    )
    .max(1000)
    .default([]),
});
export type QuickDraft = z.infer<typeof QuickDraftSchema>;
const receiptTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
export const QuickSavedDraftSchema = z
  .object({
    draft: QuickDraftSchema,
    files: z
      .array(
        z.object({
          id: z.string().min(1).max(160),
          entryId: z.string().min(1).max(160),
          name: z.string().max(300).optional(),
          file: z.custom<Blob>(
            (value) =>
              typeof Blob !== "undefined" &&
              value instanceof Blob &&
              receiptTypes.has(value.type) &&
              value.size <= 10 * 1024 * 1024,
          ),
        }),
      )
      .max(20)
      .default([]),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const file of value.files) {
      if (file.entryId !== value.draft.id || seen.has(file.id))
        ctx.addIssue({ code: "custom", message: "invalid_receipt_reference" });
      seen.add(file.id);
    }
  });

export function validQuickDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = Date.parse(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date) && new Date(date).toISOString().slice(0, 10) === value
  );
}
function positiveAmount(value: string) {
  try {
    const amount = parseAmount(value);
    if (amount > 0) return amount;
  } catch {
    /* malformed and oversized amounts have the same form error */
  }
  throw new Error("amount");
}

export function quickWageAmount(
  draft: Pick<QuickDraft, "amount" | "wageBasis" | "wageDays" | "wageRate">,
) {
  if (draft.wageBasis === "day")
    return contractTotal(draft.wageDays, draft.wageRate);
  try {
    return parseAmount(draft.amount);
  } catch {
    return 0;
  }
}

export function buildQuickEntry(
  current: Ledger,
  input: QuickDraft,
  receipts: unknown[] = [],
  generalName = "সাধারণ খরচ",
  chargeLabel = "কাজের বিল",
): Ledger {
  const draft = QuickDraftSchema.parse(input);
  if (!validQuickDate(draft.date)) throw new Error("date");
  if (
    !draft.id ||
    current.entries.some((entry) =>
      [draft.id, draft.paymentId, draft.refundId].includes(entry.id),
    )
  )
    throw new Error("duplicate");
  const next = structuredClone(current);
  const now = new Date().toISOString();
  let workId = draft.workId;
  if (!workId) {
    let work = next.works.find(
      (work) => !work.archivedAt && work.name === generalName,
    );
    if (!work) {
      work = WorkSchema.parse({
        id: `general-${draft.id}`,
        name: generalName,
        color: "blue",
        icon: "home",
      });
      next.works = saveWorkChange(next, work, now).works;
    }
    workId = work.id;
  }
  if (!next.works.some((work) => work.id === workId)) throw new Error("work");
  if (next.works.some((work) => work.id === workId && work.archivedAt))
    throw new Error("removed_entity");
  let personId = draft.personId || null;
  if (personId === "__new__") {
    if (
      !draft.personName.trim() ||
      !draft.personNewId ||
      next.people.some((person) => person.id === draft.personNewId)
    )
      throw new Error("person");
    personId = draft.personNewId;
    next.people.push(
      PersonSchema.parse({
        id: personId,
        name: draft.personName.trim(),
        kind:
          draft.costType === "labour" ||
          draft.kind === "wage" ||
          (draft.kind === "payment" && draft.purpose === "wage") ||
          draft.account === "labour"
            ? "worker"
            : draft.costType === "transport"
              ? "driver"
              : draft.costType !== "material" || draft.account === "other"
                ? "other"
                : "shop",
      }),
    );
  }
  if (personId && !next.people.some((person) => person.id === personId))
    throw new Error("person");
  if (
    next.people.some((person) => person.id === personId && person.archivedAt) ||
    next.contracts.some((job) => job.id === draft.contractId && job.archivedAt)
  )
    throw new Error("removed_entity");
  const wage =
    draft.kind === "wage" ||
    (draft.kind === "payment" && draft.purpose === "wage");
  const charge = draft.kind === "payment" && draft.purpose === "charge";
  const isCash =
    draft.kind === "refund" || (draft.kind === "payment" && !wage && !charge);
  const unlinkedJobPayment =
    draft.kind === "payment" &&
    isCash &&
    draft.account === "labour" &&
    next.contracts.some(
      (contract) =>
        contract.id === draft.contractId &&
        contract.scope === "house" &&
        contract.personId === personId,
    );
  if (isCash && !draft.workId && !unlinkedJobPayment) throw new Error("work");
  const labour =
    wage ||
    (!isCash &&
      (charge ? draft.account === "labour" : draft.costType === "labour"));
  const account = charge
    ? draft.account
    : labour
      ? "labour"
      : !isCash
        ? draft.costType === "material"
          ? "materials"
          : "other"
        : draft.account;
  const person = next.people.find((p) => p.id === personId);
  const contractId =
    account === "labour" && draft.contractId ? draft.contractId : null;
  if (
    person &&
    !(isCash
      ? canRecordContactCash(current, person, {
          account,
          contractId,
          workId: draft.workId || undefined,
          amount: positiveAmount(draft.amount),
          context:
            draft.purpose === "advance" ? draft.advanceContext : "settlement",
          refund: draft.kind === "refund",
        })
      : draft.kind === "return"
        ? canRecordContactReturn(current, person, {
            account,
            contractId,
            workId: draft.workId || undefined,
          })
        : canRecordContactCost(person, {
            account,
            contractId,
            costType: labour
              ? "labour"
              : charge
                ? account === "materials"
                  ? "material"
                  : draft.costType === "transport"
                    ? "transport"
                    : "other"
                : draft.costType,
            reimbursement: draft.payment === "worker",
          }))
  )
    throw new Error("contact_rules");
  if (
    contractId &&
    !next.contracts.some(
      (contract) =>
        contract.id === contractId &&
        contractAppliesToWork(contract, workId) &&
        contract.personId === personId,
    )
  )
    throw new Error("contract");
  let paymentPurposeId = isCash || charge || wage ? draft.paymentPurposeId : "";
  if (paymentPurposeId === "__new__") {
    const name = draft.paymentPurposeName.trim();
    if (!name || !draft.paymentPurposeNewId) throw new Error("payment_purpose");
    const existing = next.paymentPurposes.find(
      (p) =>
        p.account === account &&
        p.name.normalize("NFKC").toLocaleLowerCase() ===
          name.normalize("NFKC").toLocaleLowerCase(),
    );
    paymentPurposeId = existing?.id ?? draft.paymentPurposeNewId;
    if (!existing)
      next.paymentPurposes.push(
        PaymentPurposeSchema.parse({ id: paymentPurposeId, name, account }),
      );
  }
  if (
    paymentPurposeId &&
    !next.paymentPurposes.some(
      (p) => p.id === paymentPurposeId && p.account === account,
    )
  )
    throw new Error("payment_purpose");
  const base = {
    paymentPurposeId: paymentPurposeId || null,
    date: draft.date,
    note:
      draft.note.trim() ||
      (draft.kind === "payment" && draft.purpose === "advance"
        ? "আগাম টাকা"
        : ""),
    personId,
    account,
    contractId,
    createdAt: now,
    updatedAt: now,
  };
  const addCash = (
    id: string,
    amount: number,
    kind: "payment" | "refund",
    relatedEntryId: string | null = null,
  ) => {
    if (!id || !amount || !Number.isSafeInteger(amount))
      throw new Error("amount");
    next.entries.push(
      EntrySchema.parse({
        ...base,
        id,
        kind,
        relatedEntryId,
        ...(kind === "payment"
          ? {
              paymentContext:
                draft.purpose === "advance"
                  ? draft.advanceContext
                  : "settlement",
            }
          : draft.refundContext !== "unknown"
            ? { paymentContext: draft.refundContext }
            : {}),
        allocations: [{ workId, amount }],
        paymentParts: [{ method: draft.method, amount }],
        receipts: isCash ? receipts : [],
      }),
    );
  };
  if (isCash) {
    if (!personId) throw new Error("person");
    addCash(
      draft.id,
      positiveAmount(draft.amount),
      draft.kind === "refund" ? "refund" : "payment",
    );
  } else {
    const wageAmount = wage
      ? quickWageAmount(draft)
      : charge
        ? positiveAmount(draft.amount)
        : 0;
    if ((wage || charge) && !wageAmount) throw new Error("amount");
    const daily = wage && draft.wageBasis === "day";
    const dailyQuantity = daily ? contractQuantity(draft.wageDays)! : "";
    const dailyDescription = daily
      ? `${dailyQuantity} দিন × ${moneyInputValue(parseAmount(draft.wageRate))} টাকা`
      : "";
    const rows =
      wage || charge
        ? [
            {
              id: `line-${draft.id}`,
              label: [
                next.paymentPurposes.find(
                  (purpose) => purpose.id === paymentPurposeId,
                )?.name ||
                  draft.note.trim() ||
                  (charge ? chargeLabel : "মজুরি"),
                dailyDescription,
              ]
                .filter(Boolean)
                .join(" · "),
              amount: moneyInputValue(wageAmount),
              groupId: "",
              groupName: "",
              brand: "",
              usage: "",
              quantity: dailyQuantity,
              unit: daily ? "দিন" : "",
            },
          ]
        : draft.rows;
    if (!rows.length) throw new Error("label");
    const lines = rows.map((row) => {
      if (!row.label.trim()) throw new Error("label");
      const amount = positiveAmount(row.amount);
      let groupId = row.groupId;
      if (groupId === "__new__") {
        const name = row.groupName.trim();
        if (!name) throw new Error("group");
        const normalized = name.normalize("NFKC").toLocaleLowerCase();
        const match = next.materialGroups.find((group) =>
          [group.name, ...group.aliases].some(
            (alias) =>
              alias.normalize("NFKC").trim().toLocaleLowerCase() === normalized,
          ),
        );
        groupId = match?.id ?? `group-${row.id}`;
        if (!match)
          next.materialGroups.push(
            MaterialGroupSchema.parse({ id: groupId, name }),
          );
      }
      let itemId: string | null = null;
      if (groupId) {
        const match = next.items.find(
          (item) =>
            latinDigits(item.name) === latinDigits(row.label.trim()) &&
            latinDigits(item.brand) === latinDigits(row.brand.trim()) &&
            item.materialGroupId === groupId &&
            latinDigits(item.usage) === latinDigits(row.usage.trim()),
        );
        if (match) itemId = match.id;
        else {
          itemId = `item-${row.id}`;
          next.items.push(
            ItemSchema.parse({
              id: itemId,
              name: row.label.trim(),
              brand: row.brand.trim(),
              materialGroupId: groupId,
              usage: row.usage.trim(),
              unit: row.unit.trim(),
            }),
          );
        }
      }
      return EntryLineSchema.parse({
        id: row.id,
        workId,
        itemId,
        materialGroupId: groupId || null,
        usage: row.usage.trim(),
        label: row.label.trim(),
        amount,
        costType: labour
          ? "labour"
          : charge
            ? account === "materials"
              ? "material"
              : draft.costType === "transport"
                ? "transport"
                : "other"
            : draft.costType,
        quantity: row.quantity.trim(),
        unit: row.unit.trim(),
      });
    });
    const total = lines.reduce((sum, line) => sum + line.amount, 0);
    if (!Number.isSafeInteger(total)) throw new Error("amount");
    if (
      (draft.payment !== "full" || draft.kind === "return" || labour) &&
      !personId
    )
      throw new Error("person");
    const cost = EntrySchema.parse({
      ...base,
      paymentPurposeId: null,
      reviewStatus:
        !draft.workId ||
        (!wage &&
          !charge &&
          draft.costType === "material" &&
          draft.rows.some((row) => !row.groupId))
          ? "needs_review"
          : "confirmed",
      reviewReason: !draft.workId ? "সেক্টর পরে বেছে নিন।" : "",
      id: draft.id,
      ...(draft.milestoneId ? { milestoneId: draft.milestoneId } : {}),
      kind: draft.kind === "return" ? "expense_credit" : "expense",
      lines,
      receipts,
    });
    next.entries.push(cost);
    if (draft.kind === "return") {
      const refund = draft.refund.trim() ? parseAmount(draft.refund) : 0;
      if (refund > total) throw new Error("refund");
      if (refund) addCash(draft.refundId, refund, "refund");
    } else if (draft.payment === "full" || draft.payment === "partial") {
      const paid =
        draft.payment === "partial" ? positiveAmount(draft.paid) : total;
      if (!personId && paid !== total) throw new Error("person");
      addCash(draft.paymentId, paid, "payment", cost.id);
    }
  }
  return LedgerSchema.parse(next);
}
