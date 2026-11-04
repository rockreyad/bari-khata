import { z } from "zod";
import {
  AccountSchema,
  CostTypeSchema,
  ContractSchema,
  EntrySchema,
  ItemSchema,
  LedgerSchema,
  MaterialGroupSchema,
  MoneySchema,
  PaymentPurposeSchema,
  PersonSchema,
  WorkSchema,
  type Account,
  type Ledger,
  type Receipt,
  type EntryProvenance,
} from "../domain/model.js";
import {
  appendEntries,
  entryTotal,
  replaceEntry,
  setEntryVoided,
} from "../domain/ledger.js";
import {
  saveContractChange,
  preservesContractHistory,
} from "../domain/contracts.js";
import {
  saveWorkChange,
  preservesWorkHistory,
} from "../domain/workActivity.js";
import {
  setEntityRemoved,
  preservesRemovalHistory,
} from "../domain/entityDeletion.js";
import { preservesPaymentPurposes } from "../domain/paymentPurposes.js";
import { preservesPersonWorkLinks } from "../domain/personWorkLinks.js";
import {
  ContactTypeSchema,
  contactPresetFrom,
  preservesContactTypes,
} from "../domain/contactTypes.js";
import { preservesBalanceAdjustments } from "../domain/adjustmentHistory.js";
import { canAssignContact } from "../domain/contacts.js";

const Id = z.string().trim().min(1).max(160);
const Text = z.string().max(10000);
const Name = z.string().trim().min(1).max(200);
const PositiveMoney = MoneySchema.refine(
  (amount) => amount > 0,
  "positive_amount_required",
);
const Reason = z.string().trim().min(1).max(2000);
const DateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const stamp = Date.parse(`${value}T00:00:00Z`);
    return (
      Number.isFinite(stamp) &&
      new Date(stamp).toISOString().slice(0, 10) === value
    );
  }, "invalid_date");
const Method = z.enum(["cash", "bkash", "bank", "other"]);
const Provenance = z
  .object({
    origin: z.enum(["text", "image", "voice"]),
    source_event_id: Id.optional(),
    asset_digests: z.array(z.string().min(1).max(128)).max(30).default([]),
  })
  .strict();
const Line = z
  .object({
    id: Id.optional(),
    label: z.string().trim().min(1).max(300),
    amount_paisa: PositiveMoney,
    cost_type: CostTypeSchema,
    work_id: Id.optional(),
    item_id: Id.nullable().optional(),
    material_group_id: Id.nullable().optional(),
    quantity: z.string().max(60).default(""),
    unit: z.string().max(60).default(""),
    usage: z.string().max(200).default(""),
  })
  .strict();
const Allocation = z
  .object({ work_id: Id, amount_paisa: PositiveMoney })
  .strict();
const Payment = z
  .object({
    amount_paisa: PositiveMoney,
    method: Method,
    allocations: z.array(Allocation).min(1).max(1000).optional(),
  })
  .strict();
const base = {
  date: DateOnly,
  note: Text.default(""),
  work_id: Id.optional(),
  person_id: Id.nullable().optional(),
  contract_id: Id.nullable().optional(),
  receipt_ids: z.array(Id).max(30).default([]),
  provenance: Provenance.optional(),
};
const billed = {
  ...base,
  lines: z.array(Line).min(1).max(1000),
  payment_state: z.enum(["unpaid", "partial", "paid"]),
  payment: Payment.optional(),
};
const cash = {
  ...base,
  person_id: Id,
  account: AccountSchema,
  amount_paisa: PositiveMoney,
  method: Method,
  related_entry_id: Id.nullable().optional(),
  payment_purpose_id: Id.nullable().optional(),
  allocations: z.array(Allocation).min(1).max(1000).optional(),
};
const edit = {
  entry_id: Id,
  expected_updated_at: z.string().datetime().or(z.literal("")),
  reason: Reason,
};
const personFields = {
  name: Name,
  role: z.string().max(200).default(""),
  phone: z.string().max(60).default(""),
  kind: z.enum(["worker", "shop", "driver", "other"]),
  contact_type: ContactTypeSchema.nullable().optional(),
};
const workFields = {
  name: Name,
  description: Text.default(""),
  color: z.string().max(40).default("sage"),
  icon: z.string().max(40).default("home"),
  status: z.enum(["planned", "ongoing", "done"]).default("ongoing"),
  started_on: DateOnly.nullable().default(null),
  completed_on: DateOnly.nullable().default(null),
};
const contractFields = {
  person_id: Id,
  work_id: Id.nullable().default(null),
  scope: z.enum(["work", "house"]),
  title: z.string().max(300).default(""),
  basis: z.enum(["sqft", "day", "fixed"]).default("fixed"),
  quantity: z
    .string()
    .regex(/^\d+(?:\.\d{1,4})?$/)
    .default("1"),
  rate_paisa: MoneySchema.default(0),
  total_paisa: PositiveMoney,
  notes: Text.default(""),
  agreed_on: DateOnly.nullable().default(null),
  status: z.enum(["planned", "ongoing", "done"]).nullable().default(null),
};
const itemFields = {
  name: Name,
  material_group_id: Id.nullable().default(null),
  brand: z.string().max(200).default(""),
  usage: z.string().max(200).default(""),
  unit: z.string().max(60).default(""),
  aliases: z.array(z.string().max(200)).max(100).default([]),
};
const personChanges = z
  .object({
    name: Name.optional(),
    role: z.string().max(200).optional(),
    phone: z.string().max(60).optional(),
    kind: personFields.kind.optional(),
    contact_type: personFields.contact_type,
  })
  .strict();
const workChanges = z
  .object({
    name: Name.optional(),
    description: Text.optional(),
    color: z.string().max(40).optional(),
    icon: z.string().max(40).optional(),
    status: z.enum(["planned", "ongoing", "done"]).optional(),
    started_on: DateOnly.nullable().optional(),
    completed_on: DateOnly.nullable().optional(),
  })
  .strict();
const contractChanges = z
  .object({
    person_id: Id.optional(),
    work_id: Id.nullable().optional(),
    scope: z.enum(["work", "house"]).optional(),
    title: z.string().max(300).optional(),
    basis: z.enum(["sqft", "day", "fixed"]).optional(),
    quantity: z
      .string()
      .regex(/^\d+(?:\.\d{1,4})?$/)
      .optional(),
    rate_paisa: MoneySchema.optional(),
    total_paisa: PositiveMoney.optional(),
    notes: Text.optional(),
    agreed_on: DateOnly.nullable().optional(),
    status: z.enum(["planned", "ongoing", "done"]).nullable().optional(),
  })
  .strict();
const itemChanges = z
  .object({
    name: Name.optional(),
    material_group_id: Id.nullable().optional(),
    brand: z.string().max(200).optional(),
    usage: z.string().max(200).optional(),
    unit: z.string().max(60).optional(),
    aliases: z.array(z.string().max(200)).max(100).optional(),
  })
  .strict();

export const McpCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_purchase"), ...billed }).strict(),
  z.object({ type: z.literal("create_cost"), ...billed }).strict(),
  z
    .object({ type: z.literal("record_procurement"), ...billed, person_id: Id })
    .strict(),
  z
    .object({
      type: z.literal("record_wage"),
      ...base,
      person_id: Id,
      amount_paisa: PositiveMoney,
      payment_state: z.enum(["unpaid", "partial", "paid"]),
      payment: Payment.optional(),
      basis: z.enum(["total", "day"]).default("total"),
      days: z
        .string()
        .regex(/^\d+(?:\.\d{1,4})?$/)
        .optional(),
      rate_paisa: PositiveMoney.optional(),
    })
    .strict(),
  z.object({ type: z.literal("record_payment"), ...cash }).strict(),
  z.object({ type: z.literal("record_advance"), ...cash }).strict(),
  z
    .object({
      type: z.literal("record_reimbursement"),
      ...cash,
      account: z.literal("materials"),
    })
    .strict(),
  z.object({ type: z.literal("record_cash_refund"), ...cash }).strict(),
  z
    .object({
      type: z.literal("record_material_return"),
      ...base,
      person_id: Id,
      lines: z.array(Line).min(1).max(1000),
      related_entry_id: Id.nullable().optional(),
      refund: Payment.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("update_entry"),
      ...edit,
      changes: z
        .object({
          date: DateOnly.optional(),
          note: Text.optional(),
          person_id: Id.nullable().optional(),
          account: AccountSchema.optional(),
          work_id: Id.optional(),
          lines: z.array(Line).min(1).max(1000).optional(),
          amount_paisa: PositiveMoney.optional(),
          method: Method.optional(),
          payment_parts: z
            .array(Payment.omit({ allocations: true }))
            .min(1)
            .max(100)
            .optional(),
          allocations: z.array(Allocation).min(1).max(1000).optional(),
        })
        .strict()
        .refine((value) => Object.keys(value).length > 0, "changes_required"),
      provenance: Provenance.optional(),
    })
    .strict(),
  z.object({ type: z.literal("void_entry"), ...edit }).strict(),
  z.object({ type: z.literal("restore_entry"), ...edit }).strict(),
  z.object({ type: z.literal("create_person"), ...personFields }).strict(),
  z
    .object({
      type: z.literal("update_person"),
      person_id: Id,
      reason: Reason,
      changes: personChanges.refine(
        (value) => Object.keys(value).length > 0,
        "changes_required",
      ),
    })
    .strict(),
  z.object({ type: z.literal("create_work"), ...workFields }).strict(),
  z
    .object({
      type: z.literal("update_work"),
      work_id: Id,
      reason: Reason,
      changes: workChanges.refine(
        (value) => Object.keys(value).length > 0,
        "changes_required",
      ),
    })
    .strict(),
  z
    .object({
      type: z.literal("archive_entity"),
      entity_type: z.enum(["person", "work", "contract"]),
      entity_id: Id,
      reason: Reason,
    })
    .strict(),
  z
    .object({
      type: z.literal("restore_entity"),
      entity_type: z.enum(["person", "work", "contract"]),
      entity_id: Id,
      reason: Reason,
    })
    .strict(),
  z.object({ type: z.literal("create_contract"), ...contractFields }).strict(),
  z
    .object({
      type: z.literal("update_contract"),
      contract_id: Id,
      reason: Reason,
      changes: contractChanges.refine(
        (value) => Object.keys(value).length > 0,
        "changes_required",
      ),
    })
    .strict(),
  z
    .object({
      type: z.literal("create_material_group"),
      name: Name,
      aliases: z.array(z.string().max(200)).max(100).default([]),
    })
    .strict(),
  z
    .object({
      type: z.literal("update_material_group"),
      material_group_id: Id,
      reason: Reason,
      changes: z
        .object({
          name: Name.optional(),
          aliases: z.array(z.string().max(200)).max(100).optional(),
        })
        .strict()
        .refine((value) => Object.keys(value).length > 0, "changes_required"),
    })
    .strict(),
  z.object({ type: z.literal("create_item"), ...itemFields }).strict(),
  z
    .object({
      type: z.literal("update_item"),
      item_id: Id,
      reason: Reason,
      changes: itemChanges.refine(
        (value) => Object.keys(value).length > 0,
        "changes_required",
      ),
    })
    .strict(),
  z
    .object({
      type: z.literal("create_payment_purpose"),
      name: Name,
      account: AccountSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("update_payment_purpose"),
      payment_purpose_id: Id,
      reason: Reason,
      changes: z
        .object({ name: Name.optional(), account: AccountSchema.optional() })
        .strict()
        .refine((value) => Object.keys(value).length > 0, "changes_required"),
    })
    .strict(),
  z
    .object({ type: z.literal("attach_receipt"), ...edit, receipt_id: Id })
    .strict(),
  z
    .object({ type: z.literal("detach_receipt"), ...edit, receipt_id: Id })
    .strict(),
]);
export type McpCommand = z.infer<typeof McpCommandSchema>;
export type McpCommandContext = {
  now: string;
  actor: { connectionId: string; name: string };
  source?: {
    origin: "text" | "image" | "voice";
    sourceEventId?: string;
    assetDigests?: string[];
  };
  receipts?: Receipt[];
};
export class McpCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "McpCommandError";
  }
}
function fail(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): never {
  throw new McpCommandError(code, message, details);
}
const uuid = () => crypto.randomUUID();
const sum = (values: number[]) => {
  const total = values.reduce((value, amount) => value + amount, 0);
  if (!Number.isSafeInteger(total)) fail("validation_error", "unsafe_amount");
  return total;
};
export function requiredMcpScopes(command: McpCommand): string[] {
  if (command.type === "attach_receipt" || command.type === "detach_receipt")
    return ["entries:update", "receipts:write"];
  if (command.type === "update_entry") return ["entries:update"];
  if (command.type === "void_entry" || command.type === "restore_entry")
    return ["entries:void_restore"];
  if (
    command.type === "create_contract" ||
    command.type === "update_contract" ||
    ((command.type === "archive_entity" || command.type === "restore_entity") &&
      command.entity_type === "contract")
  )
    return ["contracts:write"];
  if (
    [
      "create_person",
      "update_person",
      "create_work",
      "update_work",
      "archive_entity",
      "restore_entity",
    ].includes(command.type)
  )
    return ["entities:write"];
  if (
    [
      "create_material_group",
      "update_material_group",
      "create_item",
      "update_item",
      "create_payment_purpose",
      "update_payment_purpose",
    ].includes(command.type)
  )
    return ["catalog:write"];
  return [
    "entries:create",
    ...("receipt_ids" in command && command.receipt_ids.length
      ? ["receipts:write"]
      : []),
  ];
}
function active<T extends { id: string; archivedAt?: string | null }>(
  records: T[],
  id: string,
  kind: string,
): T {
  const record = records.find((value) => value.id === id);
  if (!record) return fail("not_found", `unknown_${kind}`, { id });
  if (record.archivedAt)
    return fail("dependency_conflict", "archived_entity", {
      id,
      entity_type: kind,
    });
  return record;
}
function provenance(
  command: McpCommand,
  context: McpCommandContext,
): EntryProvenance {
  const supplied = "provenance" in command ? command.provenance : undefined;
  return {
    version: 1,
    origin: supplied?.origin ?? context.source?.origin ?? "text",
    connectionId: context.actor.connectionId,
    actorName: context.actor.name,
    sourceEventId:
      supplied?.source_event_id ?? context.source?.sourceEventId ?? null,
    assetDigests: supplied?.asset_digests ?? context.source?.assetDigests ?? [],
    recordedAt: context.now,
    reason: "reason" in command ? command.reason : "",
  };
}
function workId(ledger: Ledger, requested: string | undefined, now: string) {
  if (requested) return active(ledger.works, requested, "work").id;
  const general = ledger.works.find(
    (work) => !work.archivedAt && work.name === "সাধারণ খরচ",
  );
  if (general) return general.id;
  const created = WorkSchema.parse({
    id: uuid(),
    name: "সাধারণ খরচ",
    color: "blue",
  });
  ledger.works = saveWorkChange(ledger, created, now).works;
  return created.id;
}
function receipts(
  ids: string[],
  context: McpCommandContext,
  ledger: Ledger,
  targetEntryId?: string,
) {
  if (new Set(ids).size !== ids.length)
    return fail("validation_error", "duplicate_receipt");
  return ids.map((id) => {
    const receipt = context.receipts?.find((value) => value.id === id);
    if (!receipt) return fail("not_found", "unverified_receipt", { id });
    for (const entry of ledger.entries) {
      const previous = [
        ...entry.receipts,
        ...entry.revisions.flatMap((revision) => revision.before.receipts),
      ].find((value) => value.id === id);
      if (!previous) continue;
      if (entry.id !== targetEntryId)
        return fail("dependency_conflict", "receipt_belongs_to_another_entry", {
          receipt_id: id,
          entry_id: entry.id,
        });
      if (previous.mime !== receipt.mime || previous.size !== receipt.size)
        return fail("validation_error", "receipt_metadata_mismatch", {
          receipt_id: id,
        });
    }
    return receipt;
  });
}
function checkParty(
  ledger: Ledger,
  personId: string | null,
  account: Account,
  costTypes: string[],
  cash: boolean,
) {
  if (!personId) return;
  const person = active(ledger.people, personId, "person");
  if (!canAssignContact(person, account, costTypes, cash))
    fail("validation_error", "person_account_mismatch", {
      person_id: personId,
      account,
    });
}
function checkContract(
  ledger: Ledger,
  contractId: string | null,
  personId: string | null,
  account: Account,
  works: string[],
) {
  if (!contractId) return;
  const contract = active(ledger.contracts, contractId, "contract");
  if (
    account !== "labour" ||
    contract.personId !== personId ||
    (contract.scope === "work" && works.some((id) => id !== contract.workId))
  )
    fail("validation_error", "contract_mismatch");
}
function makeLines(
  ledger: Ledger,
  rows: z.infer<typeof Line>[],
  fallbackWork: string,
) {
  return rows.map((row) => {
    const targetWork = active(
      ledger.works,
      row.work_id ?? fallbackWork,
      "work",
    ).id;
    if (row.item_id) active(ledger.items, row.item_id, "item");
    if (row.material_group_id)
      active(ledger.materialGroups, row.material_group_id, "material_group");
    return {
      id: row.id ?? uuid(),
      workId: targetWork,
      itemId: row.item_id ?? null,
      materialGroupId: row.material_group_id ?? null,
      label: row.label,
      amount: row.amount_paisa,
      costType: row.cost_type,
      quantity: row.quantity,
      unit: row.unit,
      usage: row.usage,
    };
  });
}
function lineAccount(lines: { costType: string }[]): Account {
  const accounts = new Set(
    lines.map((line) =>
      line.costType === "material"
        ? "materials"
        : line.costType === "labour"
          ? "labour"
          : "other",
    ),
  );
  if (accounts.size !== 1)
    return fail("validation_error", "mixed_accounts_require_separate_commands");
  return [...accounts][0] as Account;
}
function checkPayment(
  state: "unpaid" | "partial" | "paid",
  payment: z.infer<typeof Payment> | undefined,
  total: number,
) {
  if (state === "unpaid" && payment)
    fail("validation_error", "unpaid_with_payment");
  if (state !== "unpaid" && !payment)
    fail("needs_clarification", "payment_amount_required", {
      field: "payment",
    });
  if (state === "partial" && payment && payment.amount_paisa >= total)
    fail("validation_error", "partial_payment_must_be_less_than_bill");
  if (state === "paid" && payment && payment.amount_paisa < total)
    fail("validation_error", "paid_amount_less_than_bill");
}
function updatedEntry(
  ledger: Ledger,
  command: Extract<
    McpCommand,
    {
      type:
        | "update_entry"
        | "void_entry"
        | "restore_entry"
        | "attach_receipt"
        | "detach_receipt";
    }
  >,
  context: McpCommandContext,
) {
  const original = ledger.entries.find(
    (entry) => entry.id === command.entry_id,
  );
  if (!original) return fail("not_found", "unknown_entry");
  if (original.updatedAt !== command.expected_updated_at)
    return fail("revision_conflict", "entry_changed", {
      updated_at: original.updatedAt,
    });
  let next = ledger;
  let replacement = { ...original };
  if (command.type === "void_entry" || command.type === "restore_entry") {
    if (original.voided === (command.type === "void_entry")) return ledger;
    next = setEntryVoided(ledger, original.id, command.type === "void_entry");
  } else {
    if (command.type === "update_entry") {
      const change = command.changes;
      if (change.date !== undefined) replacement.date = change.date;
      if (change.note !== undefined) replacement.note = change.note;
      if (change.person_id !== undefined)
        replacement.personId = change.person_id;
      if (change.account !== undefined) replacement.account = change.account;
      const isCost =
        original.kind === "expense" || original.kind === "expense_credit";
      if (
        isCost &&
        (change.amount_paisa !== undefined ||
          change.method !== undefined ||
          change.payment_parts !== undefined ||
          change.allocations !== undefined)
      )
        fail("validation_error", "bill_requires_cost_lines");
      if (!isCost && change.lines !== undefined)
        fail("validation_error", "payment_cannot_have_cost_lines");
      if (isCost && change.lines)
        replacement.lines = makeLines(
          ledger,
          change.lines,
          change.work_id ?? original.lines[0].workId,
        );
      else if (isCost && change.work_id)
        replacement.lines = original.lines.map((line) => ({
          ...line,
          workId: change.work_id!,
        }));
      if (!isCost) {
        if (change.payment_parts) {
          if (change.method)
            fail("validation_error", "choose_payment_parts_or_method");
          if (
            change.amount_paisa !== undefined &&
            sum(change.payment_parts.map((part) => part.amount_paisa)) !==
              change.amount_paisa
          )
            fail("validation_error", "payment_parts_total_mismatch");
          replacement.paymentParts = change.payment_parts.map((part) => ({
            method: part.method,
            amount: part.amount_paisa,
          }));
        } else if (change.method || change.amount_paisa !== undefined) {
          if (original.paymentParts.length !== 1 && !change.method)
            fail("needs_clarification", "split_payment_parts_required");
          replacement.paymentParts = [
            {
              method: change.method ?? original.paymentParts[0].method,
              amount: change.amount_paisa ?? entryTotal(original),
            },
          ];
        }
        if (change.allocations)
          replacement.allocations = change.allocations.map((allocation) => ({
            workId: allocation.work_id,
            amount: allocation.amount_paisa,
          }));
        else if (
          change.work_id ||
          change.amount_paisa !== undefined ||
          change.payment_parts !== undefined
        ) {
          if (original.allocations.length !== 1 && !change.work_id)
            fail("needs_clarification", "allocations_required");
          replacement.allocations = [
            {
              workId: change.work_id ?? original.allocations[0].workId,
              amount: entryTotal(replacement),
            },
          ];
        }
      }
      if (replacement.personId)
        active(ledger.people, replacement.personId, "person");
      const parts = isCost ? replacement.lines : replacement.allocations;
      parts.forEach((part) => active(ledger.works, part.workId, "work"));
      checkContract(
        ledger,
        replacement.contractId,
        replacement.personId,
        replacement.account,
        parts.map((part) => part.workId),
      );
      const sameFinancialIdentity =
        original.personId === replacement.personId &&
        original.account === replacement.account &&
        JSON.stringify(original.lines.map((line) => line.costType)) ===
          JSON.stringify(replacement.lines.map((line) => line.costType));
      if (!sameFinancialIdentity)
        checkParty(
          ledger,
          replacement.personId,
          replacement.account,
          replacement.lines.map((line) => line.costType),
          !isCost,
        );
    } else if (command.type === "attach_receipt") {
      if (
        original.receipts.some((receipt) => receipt.id === command.receipt_id)
      )
        return ledger;
      replacement.receipts = [
        ...original.receipts,
        ...receipts([command.receipt_id], context, ledger, original.id),
      ];
    } else {
      if (
        !original.receipts.some((receipt) => receipt.id === command.receipt_id)
      )
        return ledger;
      replacement.receipts = original.receipts.filter(
        (receipt) => receipt.id !== command.receipt_id,
      );
    }
    replacement.provenance = provenance(command, context);
    next = replaceEntry(ledger, replacement);
  }
  return LedgerSchema.parse({
    ...next,
    entries: next.entries.map((entry) =>
      entry.id !== original.id
        ? entry
        : {
            ...entry,
            updatedAt: context.now,
            provenance: provenance(command, context),
            revisions: entry.revisions.map((revision, index) =>
              index === entry.revisions.length - 1
                ? { ...revision, at: context.now }
                : revision,
            ),
          },
    ),
  });
}

export function applyMcpCommand(
  input: Ledger,
  raw: unknown,
  context: McpCommandContext,
): {
  ledger: Ledger;
  affectedIds: string[];
  requiredScopes: string[];
  amountPaisa: number;
} {
  const parsed = McpCommandSchema.safeParse(raw);
  if (!parsed.success) {
    const value = raw as Record<string, unknown> | null;
    const requiresPayment =
      value &&
      [
        "create_purchase",
        "create_cost",
        "record_procurement",
        "record_wage",
      ].includes(String(value.type));
    if (
      requiresPayment &&
      !["unpaid", "partial", "paid"].includes(String(value.payment_state))
    )
      fail("needs_clarification", "payment_state_required", {
        field: "payment_state",
      });
    fail("validation_error", "invalid_command", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
      })),
    });
  }
  const command = parsed.data;
  const current = LedgerSchema.parse(input);
  let ledger = structuredClone(current);
  z.string().datetime().parse(context.now);
  const affectedIds: string[] = [];
  let amountPaisa = 0;
  const affected = (id: string) => affectedIds.push(id);
  if (
    command.type === "create_purchase" ||
    command.type === "create_cost" ||
    command.type === "record_procurement" ||
    command.type === "record_wage" ||
    command.type === "record_material_return"
  ) {
    const work = workId(ledger, command.work_id, context.now);
    const wage = command.type === "record_wage";
    const lines = wage
      ? [
          {
            id: uuid(),
            workId: work,
            itemId: null,
            materialGroupId: null,
            label: command.note || "মজুরি",
            amount: command.amount_paisa,
            costType: "labour" as const,
            quantity: command.days ?? "",
            unit: command.basis === "day" ? "দিন" : "",
            usage: "",
          },
        ]
      : makeLines(ledger, command.lines, work);
    const account = lineAccount(lines);
    if (
      (command.type === "create_purchase" ||
        command.type === "record_procurement" ||
        command.type === "record_material_return") &&
      account !== "materials"
    )
      fail("validation_error", "material_command_requires_material_lines");
    const total = sum(lines.map((line) => line.amount));
    const person = command.person_id ?? null;
    const contract = command.contract_id ?? null;
    if (wage && command.basis === "day") {
      if (!command.days || !command.rate_paisa)
        fail("needs_clarification", "daily_wage_requires_days_and_rate");
      const [whole, fraction = ""] = command.days.split(".");
      const denominator = 10n ** BigInt(fraction.length);
      const exact =
        (BigInt(whole + fraction) * BigInt(command.rate_paisa) +
          denominator / 2n) /
        denominator;
      if (exact !== BigInt(total) || exact <= 0n)
        fail("validation_error", "wage_total_mismatch");
    }
    const returning = command.type === "record_material_return";
    if (!returning) checkPayment(command.payment_state, command.payment, total);
    if (
      !person &&
      (returning ||
        wage ||
        (!returning &&
          (command.payment_state !== "paid" ||
            command.payment?.amount_paisa !== total)))
    )
      fail("needs_clarification", "person_required_for_balance");
    checkParty(
      ledger,
      person,
      account,
      lines.map((line) => line.costType),
      false,
    );
    checkContract(
      ledger,
      contract,
      person,
      account,
      lines.map((line) => line.workId),
    );
    const bill = EntrySchema.parse({
      id: uuid(),
      kind: returning ? "expense_credit" : "expense",
      date: command.date,
      note: command.note,
      personId: person,
      account,
      contractId: contract,
      lines,
      relatedEntryId: returning ? (command.related_entry_id ?? null) : null,
      receipts: receipts(command.receipt_ids, context, ledger),
      createdAt: context.now,
      updatedAt: context.now,
      provenance: provenance(command, context),
    });
    const entries = [bill];
    affected(bill.id);
    amountPaisa = total;
    const cashPayment = returning ? command.refund : command.payment;
    if (cashPayment) {
      if (returning && cashPayment.amount_paisa > total)
        fail("validation_error", "refund_exceeds_return");
      const allocations = new Map<string, number>();
      const workTotals = new Map<string, number>();
      for (const line of lines)
        workTotals.set(
          line.workId,
          (workTotals.get(line.workId) ?? 0) + line.amount,
        );
      if (cashPayment.allocations) {
        if (
          sum(cashPayment.allocations.map((part) => part.amount_paisa)) !==
          cashPayment.amount_paisa
        )
          fail("validation_error", "allocation_mismatch");
        for (const part of cashPayment.allocations) {
          if (!workTotals.has(part.work_id))
            fail("validation_error", "payment_work_mismatch");
          allocations.set(
            part.work_id,
            (allocations.get(part.work_id) ?? 0) + part.amount_paisa,
          );
        }
      } else if (workTotals.size > 1 && cashPayment.amount_paisa !== total) {
        fail("needs_clarification", "payment_allocations_required", {
          field: "payment.allocations",
        });
      } else if (cashPayment.amount_paisa === total) {
        for (const [id, value] of workTotals) allocations.set(id, value);
      } else allocations.set(lines[0].workId, cashPayment.amount_paisa);
      const paid = EntrySchema.parse({
        id: uuid(),
        kind: returning ? "refund" : "payment",
        date: command.date,
        note: command.note,
        personId: person,
        account,
        contractId: contract,
        relatedEntryId: returning
          ? (command.related_entry_id ?? null)
          : bill.id,
        allocations: [...allocations].map(([workId, amount]) => ({
          workId,
          amount,
        })),
        paymentParts: [
          { amount: cashPayment.amount_paisa, method: cashPayment.method },
        ],
        createdAt: context.now,
        updatedAt: context.now,
        provenance: provenance(command, context),
      });
      entries.push(paid);
      affected(paid.id);
      amountPaisa = Math.max(total, cashPayment.amount_paisa);
    }
    ledger = appendEntries(ledger, entries);
  } else if (
    command.type === "record_payment" ||
    command.type === "record_advance" ||
    command.type === "record_reimbursement" ||
    command.type === "record_cash_refund"
  ) {
    const work = workId(
      ledger,
      command.work_id ?? command.allocations?.[0]?.work_id,
      context.now,
    );
    const allocations = command.allocations?.map((part) => ({
      workId: active(ledger.works, part.work_id, "work").id,
      amount: part.amount_paisa,
    })) ?? [{ workId: work, amount: command.amount_paisa }];
    if (sum(allocations.map((part) => part.amount)) !== command.amount_paisa)
      fail("validation_error", "allocation_mismatch");
    checkParty(ledger, command.person_id, command.account, [], true);
    checkContract(
      ledger,
      command.contract_id ?? null,
      command.person_id,
      command.account,
      allocations.map((part) => part.workId),
    );
    if (command.payment_purpose_id) {
      const purpose = active(
        ledger.paymentPurposes,
        command.payment_purpose_id,
        "payment_purpose",
      );
      if (purpose.account !== command.account)
        fail("validation_error", "payment_purpose_account_mismatch");
    }
    const entry = EntrySchema.parse({
      id: uuid(),
      kind: command.type === "record_cash_refund" ? "refund" : "payment",
      date: command.date,
      note:
        command.note || (command.type === "record_advance" ? "আগাম টাকা" : ""),
      personId: command.person_id,
      account: command.account,
      contractId: command.contract_id ?? null,
      relatedEntryId: command.related_entry_id ?? null,
      paymentPurposeId: command.payment_purpose_id ?? null,
      allocations,
      paymentParts: [{ method: command.method, amount: command.amount_paisa }],
      receipts: receipts(command.receipt_ids, context, ledger),
      createdAt: context.now,
      updatedAt: context.now,
      provenance: provenance(command, context),
    });
    ledger = appendEntries(ledger, [entry]);
    affected(entry.id);
    amountPaisa = command.amount_paisa;
  } else if (
    command.type === "update_entry" ||
    command.type === "void_entry" ||
    command.type === "restore_entry" ||
    command.type === "attach_receipt" ||
    command.type === "detach_receipt"
  ) {
    const before = ledger.entries.find(
      (entry) => entry.id === command.entry_id,
    );
    ledger = updatedEntry(ledger, command, context);
    affected(command.entry_id);
    const after = ledger.entries.find((entry) => entry.id === command.entry_id);
    if (
      before &&
      after &&
      command.type !== "attach_receipt" &&
      command.type !== "detach_receipt"
    )
      amountPaisa = Math.max(entryTotal(before), entryTotal(after));
  } else if (command.type === "create_person") {
    const person = PersonSchema.parse({
      ...command,
      id: uuid(),
      ...(command.contact_type !== undefined
        ? { contactType: command.contact_type }
        : {}),
    });
    ledger.people.push(person);
    affected(person.id);
  } else if (command.type === "update_person") {
    const person = active(ledger.people, command.person_id, "person");
    ledger.people = ledger.people.map((value) =>
      value.id === person.id
        ? PersonSchema.parse({
            ...person,
            ...command.changes,
            ...(command.changes.contact_type !== undefined
              ? { contactType: command.changes.contact_type }
              : command.changes.kind && command.changes.kind !== person.kind
                ? {
                    contactType: contactPresetFrom(
                      command.changes.kind,
                      command.changes.role ?? person.role,
                    ).id,
                  }
                : {}),
          })
        : value,
    );
    affected(person.id);
  } else if (command.type === "create_work" || command.type === "update_work") {
    const previous =
      command.type === "update_work"
        ? active(ledger.works, command.work_id, "work")
        : undefined;
    const fields = command.type === "update_work" ? command.changes : command;
    const work = WorkSchema.parse({
      ...previous,
      id: previous?.id ?? uuid(),
      ...fields,
      startedOn:
        fields.started_on !== undefined
          ? fields.started_on
          : previous?.startedOn,
      completedOn:
        fields.completed_on !== undefined
          ? fields.completed_on
          : previous?.completedOn,
    });
    ledger = saveWorkChange(ledger, work, context.now);
    affected(work.id);
  } else if (
    command.type === "archive_entity" ||
    command.type === "restore_entity"
  ) {
    ledger = setEntityRemoved(
      ledger,
      command.entity_type,
      command.entity_id,
      command.type === "archive_entity",
      undefined,
      context.now,
    );
    affected(command.entity_id);
  } else if (
    command.type === "create_contract" ||
    command.type === "update_contract"
  ) {
    const previous =
      command.type === "update_contract"
        ? active(ledger.contracts, command.contract_id, "contract")
        : undefined;
    const fields =
      command.type === "update_contract" ? command.changes : command;
    const record = ContractSchema.parse({
      ...previous,
      id: previous?.id ?? uuid(),
      ...fields,
      personId: fields.person_id ?? previous?.personId,
      workId: fields.work_id !== undefined ? fields.work_id : previous?.workId,
      rate: fields.rate_paisa ?? previous?.rate,
      total: fields.total_paisa ?? previous?.total,
      agreedOn:
        fields.agreed_on !== undefined ? fields.agreed_on : previous?.agreedOn,
    });
    active(ledger.people, record.personId, "person");
    if (record.workId) active(ledger.works, record.workId, "work");
    ledger = saveContractChange(
      ledger,
      record,
      command.type === "update_contract" ? command.reason : "চুক্তি করেছি",
      context.now,
    );
    affected(record.id);
    amountPaisa = record.total;
  } else if (
    command.type === "create_material_group" ||
    command.type === "update_material_group"
  ) {
    const previous =
      command.type === "update_material_group"
        ? active(
            ledger.materialGroups,
            command.material_group_id,
            "material_group",
          )
        : undefined;
    const group = MaterialGroupSchema.parse({
      ...previous,
      id: previous?.id ?? uuid(),
      ...(command.type === "update_material_group" ? command.changes : command),
    });
    ledger.materialGroups = [
      ...ledger.materialGroups.filter((value) => value.id !== group.id),
      group,
    ];
    affected(group.id);
  } else if (command.type === "create_item" || command.type === "update_item") {
    const previous =
      command.type === "update_item"
        ? active(ledger.items, command.item_id, "item")
        : undefined;
    const fields = command.type === "update_item" ? command.changes : command;
    const item = ItemSchema.parse({
      ...previous,
      id: previous?.id ?? uuid(),
      ...fields,
      materialGroupId:
        fields.material_group_id !== undefined
          ? fields.material_group_id
          : previous?.materialGroupId,
    });
    if (item.materialGroupId)
      active(ledger.materialGroups, item.materialGroupId, "material_group");
    ledger.items = [
      ...ledger.items.filter((value) => value.id !== item.id),
      item,
    ];
    affected(item.id);
  } else if (
    command.type === "create_payment_purpose" ||
    command.type === "update_payment_purpose"
  ) {
    const previous =
      command.type === "update_payment_purpose"
        ? active(
            ledger.paymentPurposes,
            command.payment_purpose_id,
            "payment_purpose",
          )
        : undefined;
    const purpose = PaymentPurposeSchema.parse({
      ...previous,
      id: previous?.id ?? uuid(),
      ...(command.type === "update_payment_purpose"
        ? command.changes
        : command),
    });
    if (previous && previous.account !== purpose.account)
      fail("dependency_conflict", "payment_purpose_account_immutable");
    ledger.paymentPurposes = [
      ...ledger.paymentPurposes.filter((value) => value.id !== purpose.id),
      purpose,
    ];
    affected(purpose.id);
  }
  ledger = LedgerSchema.parse(ledger);
  if (
    !preservesContractHistory(current, ledger) ||
    !preservesWorkHistory(current, ledger) ||
    !preservesPersonWorkLinks(current, ledger) ||
    !preservesContactTypes(current, ledger) ||
    !preservesBalanceAdjustments(current, ledger) ||
    !preservesRemovalHistory(current, ledger) ||
    !preservesPaymentPurposes(current, ledger)
  )
    fail("dependency_conflict", "history_must_be_preserved");
  for (const work of ledger.works)
    if (
      !current.works.some((previous) => previous.id === work.id) &&
      !affectedIds.includes(work.id)
    )
      affectedIds.push(work.id);
  return {
    ledger,
    affectedIds,
    requiredScopes: requiredMcpScopes(command),
    amountPaisa,
  };
}

export { preservesMcpProvenance } from "../domain/mcpProvenance.js";
