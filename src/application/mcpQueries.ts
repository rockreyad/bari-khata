import { z } from "zod";
import { partyLedger } from "../domain/partyLedger.js";
import { LedgerSchema, type Entry, type Ledger } from "../domain/model.js";
import {
  summarize,
  personSummary,
  workSummary,
  contractSummary,
  entryTotal,
  entryWorkIds,
} from "../domain/ledger.js";
import { effectiveAccounts } from "../domain/effectiveAccounts.js";
import { latinDigits } from "../lib/numerals.js";
import { McpCommandError } from "./mcpCommands.js";
import { reconciledTotals } from "../domain/balanceAdjustments.js";

const Id = z.string().trim().min(1).max(160);
const DateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const stamp = Date.parse(`${value}T00:00:00Z`);
    return (
      Number.isFinite(stamp) &&
      new Date(stamp).toISOString().slice(0, 10) === value
    );
  });
const QuerySchema = z
  .object({
    query: z.string().max(500).optional(),
    q: z.string().max(500).optional(),
    person_id: Id.optional(),
    work_id: Id.optional(),
    contract_id: Id.optional(),
    item_id: Id.optional(),
    material_group_id: Id.optional(),
    brand: z.string().max(200).optional(),
    usage: z.string().max(200).optional(),
    entry_id: Id.optional(),
    entity_id: Id.optional(),
    id: Id.optional(),
    entity_type: z
      .enum([
        "entry",
        "person",
        "work",
        "contract",
        "item",
        "material_group",
        "payment_purpose",
      ])
      .optional(),
    account: z.enum(["materials", "labour", "other"]).optional(),
    kind: z
      .enum(["expense", "payment", "expense_credit", "refund", "adjustment"])
      .optional(),
    cost_type: z
      .enum(["material", "labour", "transport", "unload", "rental", "other"])
      .optional(),
    from: DateOnly.optional(),
    to: DateOnly.optional(),
    include_voided: z.boolean().default(false),
    include_archived: z.boolean().default(false),
    order: z.enum(["newest", "oldest"]).default("newest"),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().max(2000).optional(),
  })
  .strict()
  .refine(
    (value) => !value.from || !value.to || value.from <= value.to,
    "invalid_date_range",
  );
export const McpQuerySchema = QuerySchema;
type QueryArgs = z.infer<typeof QuerySchema>;
const normalize = (value: string | number) =>
  latinDigits(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
function matches(query: string | undefined, values: unknown[]) {
  const words = normalize(query ?? "")
    .split(" ")
    .filter(Boolean);
  const text = normalize(
    values.filter((value) => value !== undefined && value !== null).join(" "),
  );
  return words.every((word) => text.includes(word));
}
function requiredId(
  args: QueryArgs,
  key: "person_id" | "work_id" | "contract_id" | "entry_id" | "entity_id",
) {
  const id = args[key] ?? args.id;
  if (!id)
    throw new McpCommandError("validation_error", `${key}_required`, {
      field: key,
    });
  return id;
}
function entityRecords(ledger: Ledger) {
  return [
    ...ledger.people.map((entity) => ({ ...entity, entity_type: "person" })),
    ...ledger.works.map((entity) => ({ ...entity, entity_type: "work" })),
    ...ledger.contracts.map((entity) => ({
      ...entity,
      name: entity.title,
      entity_type: "contract",
    })),
    ...ledger.items.map((entity) => ({ ...entity, entity_type: "item" })),
    ...ledger.materialGroups.map((entity) => ({
      ...entity,
      entity_type: "material_group",
    })),
    ...ledger.paymentPurposes.map((entity) => ({
      ...entity,
      entity_type: "payment_purpose",
    })),
  ];
}
export function mcpEntryView(entry: Entry) {
  return {
    id: entry.id,
    kind: entry.kind,
    date: entry.date,
    note: entry.note,
    amount_paisa: entryTotal(entry),
    ...(entry.kind === "adjustment" && entry.adjustment
      ? {
          adjustment: {
            target: entry.adjustment.target,
            basis: entry.adjustment.basis,
            account: entry.adjustment.account,
            delta_paisa: entry.adjustment.delta,
            before_paisa: entry.adjustment.before,
            after_paisa: entry.adjustment.after,
            work_id: entry.adjustment.workId,
          },
          noncash: true,
        }
      : {}),
    person_id: entry.personId,
    account: entry.adjustment ? entry.adjustment.account : entry.account,
    contract_id: entry.contractId,
    milestone_id: entry.milestoneId ?? null,
    payment_context: entry.paymentContext ?? null,
    related_entry_id: entry.relatedEntryId,
    payment_purpose_id: entry.paymentPurposeId,
    balance_impact: entry.balanceImpact,
    review_status: entry.reviewStatus,
    review_reason: entry.reviewReason,
    voided: entry.voided,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
    provenance: entry.provenance ?? null,
    source: entry.source,
    lines: entry.lines.map((line) => ({
      id: line.id,
      work_id: line.workId,
      item_id: line.itemId,
      material_group_id: line.materialGroupId,
      label: line.label,
      cost_type: line.costType,
      amount_paisa: line.amount,
      quantity: line.quantity,
      unit: line.unit,
      usage: line.usage,
    })),
    allocations: entry.allocations.map((part) => ({
      work_id: part.workId,
      amount_paisa: part.amount,
    })),
    payment_parts: entry.paymentParts.map((part) => ({
      method: part.method,
      amount_paisa: part.amount,
    })),
    receipts: entry.receipts,
  };
}
function filteredEntries(ledger: Ledger, args: QueryArgs, dates = true) {
  const effective = effectiveAccounts(ledger);
  const people = new Map(ledger.people.map((person) => [person.id, person]));
  const works = new Map(ledger.works.map((work) => [work.id, work]));
  const items = new Map(ledger.items.map((item) => [item.id, item]));
  const groups = new Map(
    ledger.materialGroups.map((group) => [group.id, group]),
  );
  const purposes = new Map(
    ledger.paymentPurposes.map((purpose) => [purpose.id, purpose]),
  );
  return ledger.entries
    .filter((entry) => {
      if (!args.include_voided && entry.voided) return false;
      if (args.person_id && args.person_id !== entry.personId) return false;
      if (args.contract_id && args.contract_id !== entry.contractId)
        return false;
      if (args.work_id && !entryWorkIds(entry).includes(args.work_id))
        return false;
      if (
        args.account &&
        (entry.adjustment
          ? entry.adjustment.account !== args.account
          : effective.get(entry.id) !== args.account)
      )
        return false;
      if (args.kind && entry.kind !== args.kind) return false;
      if (
        args.cost_type &&
        !entry.lines.some((line) => line.costType === args.cost_type)
      )
        return false;
      if (
        (args.item_id || args.material_group_id || args.brand || args.usage) &&
        !entry.lines.some((line) => {
          const item = items.get(line.itemId ?? "");
          return (
            (!args.item_id || args.item_id === line.itemId) &&
            (!args.material_group_id ||
              args.material_group_id ===
                (line.materialGroupId ?? item?.materialGroupId)) &&
            (!args.brand || args.brand === item?.brand) &&
            (!args.usage || args.usage === (line.usage || item?.usage))
          );
        })
      )
        return false;
      if (dates && args.from && (!entry.date || entry.date < args.from))
        return false;
      if (dates && args.to && (!entry.date || entry.date > args.to))
        return false;
      return matches(args.query ?? args.q, [
        entry.id,
        entry.kind,
        entry.adjustment?.basis,
        entry.note,
        entry.source?.note,
        people.get(entry.personId ?? "")?.name,
        purposes.get(entry.paymentPurposeId ?? "")?.name,
        entryTotal(entry) / 100,
        ...entryWorkIds(entry).map((id) => works.get(id)?.name),
        ...entry.lines.flatMap((line) => {
          const item = items.get(line.itemId ?? "");
          const group = groups.get(
            line.materialGroupId ?? item?.materialGroupId ?? "",
          );
          return [
            line.label,
            line.usage,
            item?.name,
            item?.brand,
            item?.usage,
            ...(item?.aliases ?? []),
            group?.name,
            ...(group?.aliases ?? []),
          ];
        }),
      ]);
    })
    .sort((left, right) => {
      if (!left.date && right.date) return 1;
      if (left.date && !right.date) return -1;
      const order =
        (left.date ?? "").localeCompare(right.date ?? "") ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id);
      return args.order === "oldest" ? order : -order;
    });
}
function moneySummary(
  summary: ReturnType<typeof summarize> | ReturnType<typeof personSummary>,
) {
  return {
    cost_paisa: summary.cost,
    historical_cost_paisa: summary.historicalCost,
    confirmed_cost_paisa: summary.cost - summary.historicalCost,
    paid_paisa: summary.paid,
    refunds_paisa: summary.refunds,
    net_paid_paisa: summary.netPaid,
    adjustment_paisa: summary.owedCorrection,
    cost_correction_paisa: summary.costCorrection,
    paid_correction_paisa: summary.paidCorrection,
    balance_correction_paisa: summary.balanceCorrection,
    reconciled_cost_paisa: summary.reconciledCost,
    reconciled_net_paid_paisa: summary.reconciledNetPaid,
    reconciled_payable_paisa: summary.reconciledPayable,
    reconciled_advance_paisa: summary.reconciledAdvance,
    payable_paisa: summary.payable,
    advance_paisa: summary.advance,
  };
}
function scopedCostLines(ledger: Ledger, entry: Entry, args: QueryArgs) {
  return entry.lines.filter((line) => {
    const item = ledger.items.find((value) => value.id === line.itemId);
    const groupId = line.materialGroupId ?? item?.materialGroupId;
    const group = ledger.materialGroups.find((value) => value.id === groupId);
    return (
      (!args.work_id || line.workId === args.work_id) &&
      (!args.cost_type || line.costType === args.cost_type) &&
      (!args.item_id || line.itemId === args.item_id) &&
      (!args.material_group_id || groupId === args.material_group_id) &&
      (!args.brand || item?.brand === args.brand) &&
      (!args.usage || (line.usage || item?.usage) === args.usage) &&
      matches(args.query ?? args.q, [
        entry.id,
        entry.note,
        entry.source?.note,
        ledger.people.find((person) => person.id === entry.personId)?.name,
        ledger.works.find((work) => work.id === line.workId)?.name,
        line.label,
        line.usage,
        item?.name,
        item?.brand,
        item?.usage,
        ...(item?.aliases ?? []),
        group?.name,
        ...(group?.aliases ?? []),
      ])
    );
  });
}
function currentSummary(ledger: Ledger, args: QueryArgs) {
  const all = {
    ...ledger,
    entries: filteredEntries(
      ledger,
      {
        ...args,
        from: undefined,
        to: undefined,
        query: undefined,
        q: undefined,
        kind: undefined,
        cost_type: undefined,
        item_id: undefined,
        material_group_id: undefined,
        brand: undefined,
        usage: undefined,
        include_voided: false,
      },
      false,
    ),
  };
  return args.person_id
    ? personSummary(all, args.person_id, args.work_id)
    : summarize(all, args.work_id);
}
function eventHistory(ledger: Ledger, args: QueryArgs) {
  const events: Record<string, unknown>[] = [];
  const entries = filteredEntries(
    ledger,
    { ...args, from: undefined, to: undefined, include_voided: true },
    false,
  );
  for (const entry of entries) {
    if (args.entity_id && args.entity_id !== entry.id) continue;
    if (args.entity_type && args.entity_type !== "entry") continue;
    events.push({
      id: `entry:${entry.id}:created`,
      entity_type: "entry",
      entity_id: entry.id,
      action: "created",
      at: entry.createdAt,
      entry: mcpEntryView(
        entry.revisions[0]
          ? { ...entry.revisions[0].before, revisions: [] }
          : entry,
      ),
    });
    entry.revisions.forEach((revision, index) => {
      const after = entry.revisions[index + 1]?.before ?? entry;
      events.push({
        id: `entry:${entry.id}:revision:${index}`,
        entity_type: "entry",
        entity_id: entry.id,
        action:
          after.voided !== revision.before.voided
            ? after.voided
              ? "voided"
              : "restored"
            : "updated",
        at: revision.at,
        before: mcpEntryView({ ...revision.before, revisions: [] }),
        after: mcpEntryView({ ...after, revisions: [] }),
      });
    });
  }
  for (const entity of entityRecords(ledger)) {
    if (args.entity_id && args.entity_id !== entity.id) continue;
    if (args.entity_type && args.entity_type !== entity.entity_type) continue;
    if (
      args.person_id &&
      entity.id !== args.person_id &&
      !("personId" in entity && entity.personId === args.person_id)
    )
      continue;
    if (
      args.work_id &&
      entity.id !== args.work_id &&
      !("workId" in entity && entity.workId === args.work_id)
    )
      continue;
    if (args.contract_id && entity.id !== args.contract_id) continue;
    if ("activity" in entity)
      entity.activity.forEach((activity) =>
        events.push({
          entity_type: entity.entity_type,
          entity_id: entity.id,
          action: activity.before ? "updated" : "created",
          ...activity,
        }),
      );
    if ("removalHistory" in entity)
      entity.removalHistory.forEach((event) =>
        events.push({
          id: event.id,
          entity_type: entity.entity_type,
          entity_id: entity.id,
          action: event.archived ? "archived" : "restored",
          at: event.at,
        }),
      );
  }
  return events
    .filter((event) => {
      const day = String(event.at ?? "").slice(0, 10);
      return (
        (!args.from || (!!day && day >= args.from)) &&
        (!args.to || (!!day && day <= args.to))
      );
    })
    .sort((left, right) => {
      const order =
        String(left.at ?? "").localeCompare(String(right.at ?? "")) ||
        String(left.id).localeCompare(String(right.id));
      return args.order === "oldest" ? order : -order;
    });
}

const definitions = [
  [
    "get_ledger_context",
    "Read the ledger identity, currency, date rules and limits before working.",
  ],
  [
    "search_entities",
    "Find people, shops, works, contracts, items, groups and payment purposes by name, alias or ID. Resolve ambiguous names before writing.",
  ],
  [
    "get_entity",
    "Read one entity by entity_type and entity_id, including its archived state.",
  ],
  [
    "get_summary",
    "Read period cost and cash flow separately from full current balances. All money values are integer paisa.",
  ],
  [
    "list_entries",
    "Find financial events by person, work, account, type and dates. Bills, payments and noncash adjustments are separate.",
  ],
  [
    "get_entry",
    "Read one event, receipts and provenance, with page-friendly linked events. Use get_change_history for revisions.",
  ],
  [
    "get_person_statement",
    "Read a person's bills, payments, returns, refunds, noncash adjustments and current balances across accounts.",
  ],
  [
    "get_work_statement",
    "Read a work's entries, period flow and current balances.",
  ],
  [
    "get_contract_summary",
    "Read agreed contract value, earned bills, payments, agreed remaining value and payable earned balance separately.",
  ],
  [
    "list_history",
    "Read creation, revisions, void/restore and work/contract/archive history.",
  ],
  ["get_change_history", "Read the change history of one entry or entity."],
  [
    "export_statement",
    "Read complete statement rows through revision-pinned pagination. Do not claim completeness before the final page.",
  ],
] as const;
export const queryToolDefinitions = definitions.map(([name, description]) => ({
  name,
  description,
  inputSchema: z.toJSONSchema(QuerySchema, { io: "input" }) as Record<
    string,
    unknown
  >,
}));

export function queryMcpLedger(
  input: Ledger,
  name: string,
  rawArgs: unknown = {},
): Record<string, unknown> {
  const ledger = LedgerSchema.parse(input);
  const parsed = QuerySchema.safeParse(rawArgs);
  if (!parsed.success)
    throw new McpCommandError("validation_error", "invalid_query", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
      })),
    });
  const args = parsed.data;
  const envelope = { source: "cloud", currency: "BDT", money_unit: "paisa" };
  if (name === "get_ledger_context" || name === "get_context")
    return {
      ...envelope,
      project: ledger.project,
      schema_version: ledger.schemaVersion,
      is_demo: ledger.isDemo,
      timezone: "Asia/Dhaka",
      local_unsynced_changes: "unknown",
      counts: {
        entries: ledger.entries.length,
        people: ledger.people.length,
        works: ledger.works.length,
        contracts: ledger.contracts.length,
      },
      rules: [
        "bills_and_payments_are_separate",
        "returns_and_cash_refunds_are_separate",
        "noncash_adjustments_are_not_costs_or_payments",
        "contracts_are_not_costs",
        "material_advances_do_not_pay_wages",
        "unknown_payment_requires_clarification",
      ],
    };
  if (name === "search_entities") {
    const items = entityRecords(ledger)
      .filter(
        (entity) =>
          (!args.entity_type || args.entity_type === entity.entity_type) &&
          (args.include_archived ||
            !("archivedAt" in entity && entity.archivedAt)) &&
          matches(args.query ?? args.q, [
            entity.id,
            entity.name,
            ...("aliases" in entity ? entity.aliases : []),
            "role" in entity ? entity.role : "",
            "phone" in entity ? entity.phone : "",
            "brand" in entity ? entity.brand : "",
            "usage" in entity ? entity.usage : "",
          ]),
      )
      .sort(
        (left, right) =>
          normalize(left.name).localeCompare(normalize(right.name)) ||
          left.id.localeCompare(right.id),
      );
    return { ...envelope, items, total_count: items.length };
  }
  if (name === "get_entity") {
    const id = requiredId(args, "entity_id");
    if (!args.entity_type)
      throw new McpCommandError("validation_error", "entity_type_required");
    const entity = entityRecords(ledger).find(
      (value) => value.id === id && value.entity_type === args.entity_type,
    );
    if (!entity) throw new McpCommandError("not_found", "unknown_entity");
    return { ...envelope, entity };
  }
  if (name === "get_entry") {
    const id = requiredId(args, "entry_id");
    const entry = ledger.entries.find((value) => value.id === id);
    if (!entry) throw new McpCommandError("not_found", "unknown_entry");
    const items = ledger.entries
      .filter((value) => value.relatedEntryId === entry.id)
      .map(mcpEntryView);
    return {
      ...envelope,
      entry: mcpEntryView(entry),
      payment_allocations: (ledger.paymentAllocations ?? []).filter(
        (allocation) =>
          allocation.paymentId === entry.id || allocation.billId === entry.id,
      ),
      items,
      total_count: items.length,
      revision_count: entry.revisions.length,
      revisions_tool: "get_change_history",
    };
  }
  if (name === "get_contract_summary") {
    const id = requiredId(args, "contract_id");
    if (!ledger.contracts.some((contract) => contract.id === id))
      throw new McpCommandError("not_found", "unknown_contract");
    const summary = contractSummary(ledger, id);
    const reconciled = reconciledTotals(ledger, { contractId: id });
    return {
      ...envelope,
      contract: summary.contract,
      milestones: (ledger.milestones ?? []).filter(
        (milestone) => milestone.contractId === id,
      ),
      agreed_paisa: summary.agreed,
      billed_paisa: summary.billed,
      paid_paisa: summary.paid,
      refunds_paisa: summary.refunds,
      net_paid_paisa: summary.netPaid,
      adjustment_paisa: reconciled.owedCorrection,
      paid_correction_paisa: reconciled.paidCorrection,
      cost_correction_paisa: reconciled.costCorrection,
      balance_correction_paisa: reconciled.balanceCorrection,
      reconciled_cost_paisa: reconciled.reconciledCost,
      reconciled_net_paid_paisa: reconciled.reconciledNetPaid,
      reconciled_payable_paisa: reconciled.reconciledPayable,
      remaining_paisa: summary.remaining,
      payable_paisa: summary.payable,
      advance_paisa: summary.advance,
      items: summary.entries.map(mcpEntryView),
      total_count: summary.entries.length,
      balance_basis: "current_snapshot",
    };
  }
  if (name === "list_history" || name === "get_change_history") {
    if (
      name === "get_change_history" &&
      !args.entity_id &&
      !args.entry_id &&
      !args.id
    )
      throw new McpCommandError("validation_error", "entity_id_required");
    const items = eventHistory(
      ledger,
      name === "get_change_history"
        ? { ...args, entity_id: args.entity_id ?? args.entry_id ?? args.id }
        : args,
    );
    return { ...envelope, items, total_count: items.length };
  }
  if (name === "get_person_statement") {
    const id = requiredId(args, "person_id");
    const person = ledger.people.find((value) => value.id === id);
    if (!person) throw new McpCommandError("not_found", "unknown_person");
    args.person_id = id;
  }
  if (name === "get_work_statement") {
    const id = requiredId(args, "work_id");
    if (!ledger.works.some((work) => work.id === id))
      throw new McpCommandError("not_found", "unknown_work");
    args.work_id = id;
  }
  if (
    [
      "get_summary",
      "get_person_statement",
      "get_work_statement",
      "export_statement",
    ].includes(name)
  ) {
    const periodEntries = filteredEntries(ledger, {
      ...args,
      include_voided: false,
    });
    const periodLedger = {
      ...ledger,
      entries: periodEntries.flatMap((entry) => {
        if (entry.kind !== "expense" && entry.kind !== "expense_credit")
          return [entry];
        const lines = scopedCostLines(ledger, entry, args);
        return lines.length ? [{ ...entry, lines }] : [];
      }),
    };
    const period = summarize(periodLedger, args.work_id);
    const current = currentSummary(ledger, args);
    const items = filteredEntries(ledger, args).map(mcpEntryView);
    return {
      ...envelope,
      person: args.person_id
        ? ledger.people.find((person) => person.id === args.person_id)
        : undefined,
      work: args.work_id ? workSummary(ledger, args.work_id).work : undefined,
      period: {
        from: args.from ?? null,
        to: args.to ?? null,
        cost_paisa: period.cost,
        historical_cost_paisa: period.historicalCost,
        paid_paisa: period.paid,
        refunds_paisa: period.refunds,
        net_paid_paisa: period.netPaid,
        adjustment_paisa: period.owedCorrection,
        paid_correction_paisa: period.paidCorrection,
        cost_correction_paisa: period.costCorrection,
        balance_correction_paisa: period.balanceCorrection,
        by_cost_type: period.byType,
      },
      current: moneySummary(current),
      ...(args.person_id
        ? {
            bill_settlements: partyLedger(ledger, args.person_id, args.account),
            payment_allocations: (ledger.paymentAllocations ?? []).filter(
              (allocation) =>
                ledger.entries.some(
                  (entry) =>
                    entry.id === allocation.paymentId &&
                    entry.personId === args.person_id,
                ),
            ),
            milestones: (ledger.milestones ?? []).filter((milestone) =>
              ledger.contracts.some(
                (contract) =>
                  contract.id === milestone.contractId &&
                  contract.personId === args.person_id,
              ),
            ),
          }
        : {}),
      balance_basis: "current_snapshot",
      unknown_date_count: filteredEntries(ledger, {
        ...args,
        from: undefined,
        to: undefined,
      }).filter((entry) => !entry.date).length,
      ...(name !== "get_summary" ? { items, total_count: items.length } : {}),
      ...(name === "export_statement"
        ? { format: "structured_rows", complete_requires_all_pages: true }
        : {}),
    };
  }
  if (name === "list_entries") {
    const items = filteredEntries(ledger, args).map(mcpEntryView);
    return { ...envelope, items, total_count: items.length };
  }
  throw new McpCommandError("not_found", "unknown_query_tool", { name });
}
