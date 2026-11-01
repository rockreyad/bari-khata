import { z } from "zod";

export const MoneySchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const AccountSchema = z.enum(["materials", "labour", "other"]);
export type Account = z.infer<typeof AccountSchema>;
export const CostTypeSchema = z.enum([
  "material",
  "labour",
  "transport",
  "unload",
  "rental",
  "other",
]);
export type CostType = z.infer<typeof CostTypeSchema>;
const Id = z.string().trim().min(1).max(160);
const Text = z.string().max(10000);

const WorkDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();
export const WorkActionSchema = z.enum([
  "expense",
  "payment",
  "labour",
  "transport",
]);
export type WorkAction = z.infer<typeof WorkActionSchema>;
export const WorkSnapshotSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: Text.default(""),
  color: z.string().max(40).default("sage"),
  icon: z.string().max(40).default("home"),
  status: z.enum(["planned", "ongoing", "done"]).default("ongoing"),
  startedOn: WorkDateSchema.default(null),
  completedOn: WorkDateSchema.default(null),
  quickActions: z.array(WorkActionSchema).max(4).nullable().default(null),
});
export type WorkSnapshot = z.infer<typeof WorkSnapshotSchema>;
export const WorkActivitySchema = z.object({
  id: Id,
  at: z.string().datetime(),
  before: WorkSnapshotSchema.nullable().default(null),
  after: WorkSnapshotSchema,
});
export type WorkActivity = z.infer<typeof WorkActivitySchema>;
export const WorkSchema = WorkSnapshotSchema.extend({
  id: Id,
  activity: z.array(WorkActivitySchema).max(2000).default([]),
}).superRefine((work, ctx) => {
  const validDate = (value: string | null) =>
    !value ||
    (!Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
  const snapshots = [
    work,
    ...work.activity.flatMap((event) =>
      event.before ? [event.before, event.after] : [event.after],
    ),
  ];
  if (
    new Set(work.activity.map((event) => event.id)).size !==
    work.activity.length
  )
    ctx.addIssue({
      code: "custom",
      message: "Duplicate work activity id",
      path: ["activity"],
    });
  for (const snapshot of snapshots) {
    if (
      !validDate(snapshot.startedOn) ||
      !validDate(snapshot.completedOn) ||
      (snapshot.startedOn &&
        snapshot.completedOn &&
        snapshot.completedOn < snapshot.startedOn)
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid work dates",
        path: ["startedOn"],
      });
    if (
      snapshot.quickActions &&
      new Set(snapshot.quickActions).size !== snapshot.quickActions.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Duplicate work quick action",
        path: ["quickActions"],
      });
  }
});
export type Work = z.infer<typeof WorkSchema>;

export const PersonKindSchema = z.enum(["worker", "shop", "driver", "other"]);
export type PersonKind = z.infer<typeof PersonKindSchema>;
export const ContactActionSchema = z.enum([
  "payment",
  "purchase",
  "return",
  "transport",
]);
export type ContactAction = z.infer<typeof ContactActionSchema>;
export const PersonSchema = z.object({
  id: Id,
  name: z.string().trim().min(1).max(200),
  role: z.string().max(200).default(""),
  phone: z.string().max(60).default(""),
  kind: PersonKindSchema.nullable().default(null),
  quickActions: z.array(ContactActionSchema).max(4).nullable().default(null),
});
export type Person = z.infer<typeof PersonSchema>;

export const MaterialGroupSchema = z.object({
  id: Id,
  name: z.string().trim().min(1).max(200),
  aliases: z.array(z.string().max(200)).max(100).default([]),
});
export type MaterialGroup = z.infer<typeof MaterialGroupSchema>;

export const ItemSchema = z.object({
  id: Id,
  materialGroupId: Id.nullable().default(null),
  brand: z.string().max(200).default(""),
  usage: z.string().max(200).default(""),
  name: z.string().trim().min(1).max(200),
  unit: z.string().max(60).default(""),
  aliases: z.array(z.string().max(200)).max(100).default([]),
});
export type Item = z.infer<typeof ItemSchema>;

export const ContractSchema = z.object({
  id: Id,
  workId: Id,
  personId: Id,
  title: z.string().max(300).default(""),
  basis: z.enum(["sqft", "day", "fixed"]).default("fixed"),
  quantity: z.string().max(60).default("1"),
  rate: MoneySchema.default(0),
  total: MoneySchema,
  notes: Text.default(""),
  history: z
    .array(
      z.object({ at: z.string(), total: MoneySchema, note: Text.default("") }),
    )
    .default([]),
});
export type Contract = z.infer<typeof ContractSchema>;

export const EntryLineSchema = z.object({
  id: Id,
  workId: Id,
  itemId: Id.nullable().default(null),
  materialGroupId: Id.nullable().default(null),
  usage: z.string().max(200).default(""),
  label: z.string().max(300).default(""),
  costType: CostTypeSchema.default("material"),
  amount: MoneySchema,
  quantity: z.string().max(60).default(""),
  unit: z.string().max(60).default(""),
});
export type EntryLine = z.infer<typeof EntryLineSchema>;

export const PaymentPartSchema = z.object({
  method: z.enum(["cash", "bkash", "bank", "other"]).default("cash"),
  amount: MoneySchema,
});
export type PaymentPart = z.infer<typeof PaymentPartSchema>;

export const ReceiptSchema = z.object({
  id: Id,
  name: z.string().min(1).max(300),
  mime: z.string().max(100),
  size: z
    .number()
    .int()
    .min(0)
    .max(25 * 1024 * 1024),
});
export type Receipt = z.infer<typeof ReceiptSchema>;

export const PaymentPurposeSchema = z.object({
  id: Id,
  name: z.string().trim().min(1).max(200),
  account: AccountSchema.default("other"),
});
export type PaymentPurpose = z.infer<typeof PaymentPurposeSchema>;

export const EntryCoreSchema = z.object({
  id: Id,
  balanceImpact: z.enum(["normal", "historical"]).default("normal"),
  reviewStatus: z.enum(["confirmed", "needs_review"]).default("confirmed"),
  reviewReason: Text.default(""),
  source: z
    .object({
      file: z.string().max(300),
      sheet: z.string().max(200).default(""),
      cell: z.string().max(100),
      note: Text.default(""),
      checksum: z.string().max(128),
      ledger: z.string().max(200).default(""),
    })
    .nullable()
    .default(null),
  kind: z.enum(["expense", "payment", "expense_credit", "refund"]),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  note: Text.default(""),
  personId: Id.nullable().default(null),
  account: AccountSchema.default("materials"),
  paymentPurposeId: Id.nullable().default(null),
  contractId: Id.nullable().default(null),
  relatedEntryId: Id.nullable().default(null),
  lines: z.array(EntryLineSchema).max(1000).default([]),
  allocations: z
    .array(z.object({ workId: Id, amount: MoneySchema }))
    .max(1000)
    .default([]),
  paymentParts: z.array(PaymentPartSchema).max(100).default([]),
  receipts: z.array(ReceiptSchema).max(30).default([]),
  createdAt: z.string().datetime().or(z.literal("")).default(""),
  updatedAt: z.string().datetime().or(z.literal("")).default(""),
  voided: z.boolean().default(false),
});
export const EntryRevisionSchema = z.object({
  at: z.string().datetime(),
  before: EntryCoreSchema,
});
export type EntryRevision = z.infer<typeof EntryRevisionSchema>;
export const EntrySchema = EntryCoreSchema.extend({
  revisions: z.array(EntryRevisionSchema).max(2000).default([]),
});
export type Entry = z.infer<typeof EntrySchema>;

const LedgerBaseSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  isDemo: z.boolean().default(false),
  project: z
    .object({
      id: Id.default("my-home"),
      name: z.string().trim().min(1).max(200).default("আমার বাড়ি"),
      currency: z.literal("BDT").default("BDT"),
    })
    .default({ id: "my-home", name: "আমার বাড়ি", currency: "BDT" }),
  works: z.array(WorkSchema).max(10000).default([]),
  people: z.array(PersonSchema).max(10000).default([]),
  materialGroups: z.array(MaterialGroupSchema).max(10000).default([]),
  items: z.array(ItemSchema).max(10000).default([]),
  paymentPurposes: z.array(PaymentPurposeSchema).max(1000).default([]),
  contracts: z.array(ContractSchema).max(10000).default([]),
  entries: z.array(EntrySchema).max(100000).default([]),
});

export const LedgerSchema = LedgerBaseSchema.superRefine((ledger, ctx) => {
  const error = (message: string, path: (string | number)[] = []) =>
    ctx.addIssue({ code: "custom", message, path });
  const unique = (records: { id: string }[], name: string) => {
    const ids = new Set<string>();
    records.forEach((row, index) => {
      if (ids.has(row.id)) error(`Duplicate ${name} id`, [name, index, "id"]);
      ids.add(row.id);
    });
    return ids;
  };
  const purposes = unique(ledger.paymentPurposes, "paymentPurposes");
  const purposesById = new Map(ledger.paymentPurposes.map((p) => [p.id, p]));
  const works = unique(ledger.works, "works");
  const people = unique(ledger.people, "people");
  ledger.people.forEach((person, index) => {
    if (
      person.quickActions &&
      new Set(person.quickActions).size !== person.quickActions.length
    )
      error("Duplicate contact action", ["people", index, "quickActions"]);
  });
  const groups = unique(ledger.materialGroups, "materialGroups");
  const items = unique(ledger.items, "items");
  ledger.items.forEach((item, index) => {
    if (item.materialGroupId && !groups.has(item.materialGroupId))
      error("Unknown material group", ["items", index, "materialGroupId"]);
  });
  const contracts = unique(ledger.contracts, "contracts");
  const contractsById = new Map(
    ledger.contracts.map((contract) => [contract.id, contract]),
  );
  const entryIds = unique(ledger.entries, "entries");
  const entriesById = new Map(ledger.entries.map((entry) => [entry.id, entry]));
  const receiptIds = new Set<string>();
  const kindTotals = { expense: 0, payment: 0, expense_credit: 0, refund: 0 };
  ledger.contracts.forEach((contract, index) => {
    if (!works.has(contract.workId))
      error("Unknown contract work", ["contracts", index, "workId"]);
    if (!people.has(contract.personId))
      error("Unknown contract person", ["contracts", index, "personId"]);
    if (!contract.total)
      error("Contract total must be positive", ["contracts", index, "total"]);
    if (
      !/^\d+(?:\.\d{1,4})?$/.test(contract.quantity) ||
      Number(contract.quantity) <= 0
    )
      error("Contract quantity must be positive", [
        "contracts",
        index,
        "quantity",
      ]);
  });
  ledger.entries.forEach((entry, index) => {
    const path = ["entries", index];
    for (const snapshot of [entry, ...entry.revisions.map((r) => r.before)]) {
      if (
        snapshot.paymentPurposeId &&
        (!purposes.has(snapshot.paymentPurposeId) ||
          purposesById.get(snapshot.paymentPurposeId)?.account !==
            snapshot.account ||
          !["payment", "refund"].includes(snapshot.kind))
      )
        error("Invalid payment purpose", [...path, "paymentPurposeId"]);
    }
    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
    if (entry.personId && !people.has(entry.personId))
      error("Unknown entry person", [...path, "personId"]);
    if (entry.contractId && !contracts.has(entry.contractId))
      error("Unknown contract", [...path, "contractId"]);
    if (entry.relatedEntryId) {
      const related = entriesById.get(entry.relatedEntryId);
      if (
        !entryIds.has(entry.relatedEntryId) ||
        !related ||
        related.kind !== "expense" ||
        related.id === entry.id
      )
        error("Settlement must reference an existing expense", [
          ...path,
          "relatedEntryId",
        ]);
      else {
        if (entry.kind === "expense")
          error("An expense cannot settle another expense", [
            ...path,
            "relatedEntryId",
          ]);
        if (
          related.personId !== entry.personId ||
          related.account !== entry.account ||
          related.contractId !== entry.contractId
        )
          error("Settlement must use the original person and account", [
            ...path,
            "relatedEntryId",
          ]);
        const relatedWorkIds = new Set(
          related.lines.map((line) => line.workId),
        );
        const parts =
          entry.kind === "expense_credit" ? entry.lines : entry.allocations;
        if (parts.some((part) => !relatedWorkIds.has(part.workId)))
          error("Settlement must use the original work", [
            ...path,
            "relatedEntryId",
          ]);
      }
    }
    const contract = entry.contractId
      ? contractsById.get(entry.contractId)
      : undefined;
    if (
      contract &&
      (entry.personId !== contract.personId || entry.account !== "labour")
    )
      error("Contract entries must use its person and labour account", path);
    entry.receipts.forEach((receipt, r) => {
      if (receiptIds.has(receipt.id))
        error("Duplicate receipt id", [...path, "receipts", r]);
      receiptIds.add(receipt.id);
    });
    const isCost = entry.kind === "expense" || entry.kind === "expense_credit";
    if (isCost) {
      if (!entry.lines.length || !sum(entry.lines.map((l) => l.amount)))
        error("An expense needs positive cost lines", path);
      if (entry.paymentParts.length || entry.allocations.length)
        error("An expense cannot also be a payment", path);
    } else {
      const payments = sum(entry.paymentParts.map((p) => p.amount));
      const allocated = sum(entry.allocations.map((p) => p.amount));
      if (
        !payments ||
        payments !== allocated ||
        !Number.isSafeInteger(payments)
      )
        error("Payment allocations must equal payment amount", path);
      if (entry.lines.length)
        error("A payment cannot also create cost lines", path);
    }
    const lineIds = new Set<string>();
    entry.lines.forEach((line, l) => {
      if (lineIds.has(line.id))
        error("Duplicate line id", [...path, "lines", l]);
      lineIds.add(line.id);
      if (!line.amount)
        error("Cost line must be positive", [...path, "lines", l, "amount"]);
      if (!works.has(line.workId))
        error("Unknown line work", [...path, "lines", l, "workId"]);
      if (line.materialGroupId && !groups.has(line.materialGroupId))
        error("Unknown line material group", [
          ...path,
          "lines",
          l,
          "materialGroupId",
        ]);
      if (line.itemId && !items.has(line.itemId))
        error("Unknown line item", [...path, "lines", l, "itemId"]);
      if (entry.account === "labour" && line.costType !== "labour")
        error("Labour account requires labour cost", [...path, "lines", l]);
      if (entry.account !== "labour" && line.costType === "labour")
        error("Labour cost requires labour account", [...path, "lines", l]);
      if (contract && line.workId !== contract.workId)
        error("Contract cost must use its work", [...path, "lines", l]);
    });
    entry.allocations.forEach((allocation, a) => {
      if (!allocation.amount)
        error("Allocation must be positive", [...path, "allocations", a]);
      if (!works.has(allocation.workId))
        error("Unknown payment work", [...path, "allocations", a]);
      if (contract && allocation.workId !== contract.workId)
        error("Contract payment must use its work", [
          ...path,
          "allocations",
          a,
        ]);
    });
    const total = isCost
      ? sum(entry.lines.map((l) => l.amount))
      : sum(entry.paymentParts.map((p) => p.amount));
    if (!Number.isSafeInteger(total)) error("Entry total is too large", path);
    if (!entry.voided) kindTotals[entry.kind] += total;
    if (entry.date) {
      const timestamp = Date.parse(`${entry.date}T00:00:00Z`);
      if (
        Number.isNaN(timestamp) ||
        new Date(timestamp).toISOString().slice(0, 10) !== entry.date
      )
        error("Invalid entry date", [...path, "date"]);
    }
  });
  if (
    Object.values(kindTotals).some((total) => !Number.isSafeInteger(total)) ||
    !Number.isSafeInteger(
      Object.values(kindTotals).reduce((sum, total) => sum + total, 0),
    ) ||
    !Number.isSafeInteger(
      ledger.contracts.reduce((sum, contract) => sum + contract.total, 0),
    )
  )
    error("Ledger total is too large");
});

export type Ledger = z.infer<typeof LedgerSchema>;
export const validateLedger = (value: unknown): Ledger =>
  LedgerSchema.parse(value);
export const newId = (): string => crypto.randomUUID();
