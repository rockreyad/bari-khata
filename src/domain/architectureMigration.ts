import { z } from "zod";
import {
  createMigrationReview,
  type MigrationReview,
} from "./migrationReview.js";
import { contactPresetFrom } from "./contactTypes.js";
import { preservesPaymentAllocationHistory } from "./partyLedger.js";
import { LedgerSchema, type Account, type Ledger } from "./model.js";
import { accounts, entryWorkIds, personSummary, summarize } from "./ledger.js";
import { effectiveAccounts } from "./effectiveAccounts.js";
import { reconciledTotals } from "./adjustmentMath.js";
import { balanceAdjustmentHistoryIsValid } from "./adjustmentHistory.js";
import { normalizeLabel } from "../lib/normalizeLabel.js";

export const ARCHITECTURE_VERSION = 2 as const;
const MigrationEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  isDemo: z.boolean(),
  project: z.object({
    id: z.string(),
    name: z.string(),
    currency: z.literal("BDT"),
  }),
  works: z.array(z.unknown()),
  people: z.array(z.unknown()),
  items: z.array(z.unknown()),
  contracts: z.array(z.unknown()),
  entries: z.array(z.unknown()),
});
const VersionSchema = z.object({
  architectureVersion: z.literal(ARCHITECTURE_VERSION).optional(),
});

export function assertSupportedArchitecture(value: unknown) {
  VersionSchema.parse(value);
}

function financialTotals(
  ledger: Ledger,
  personId?: string,
  account?: Account,
  workId?: string,
) {
  const scope = {
    ...(personId ? { personId } : {}),
    ...(account ? { account } : {}),
    ...(workId ? { workId } : {}),
  };
  const totals = reconciledTotals(ledger, scope);
  const effective = effectiveAccounts(ledger);
  const entries = ledger.entries.filter(
    (entry) =>
      (!personId || entry.personId === personId) &&
      (!account || effective.get(entry.id) === account) &&
      (!workId || entryWorkIds(entry).includes(workId)),
  );
  return {
    cost: totals.actualCost,
    paid: totals.actualPaid,
    refunds: totals.actualRefunds,
    netPaid: totals.actualNetPaid,
    payable: totals.reconciledPayable,
    advance: totals.reconciledAdvance,
    costCorrection: totals.costCorrection,
    paidCorrection: totals.paidCorrection,
    balanceCorrection: totals.balanceCorrection,
    historicalCount: entries.filter(
      (entry) => entry.balanceImpact === "historical",
    ).length,
  };
}

export function architectureReconciliation(ledger: Ledger) {
  return {
    projectId: ledger.project.id,
    counts: {
      people: ledger.people.length,
      works: ledger.works.length,
      items: ledger.items.length,
      materialGroups: ledger.materialGroups.length,
      contracts: ledger.contracts.length,
      entries: ledger.entries.length,
      revisions: ledger.entries.reduce(
        (sum, entry) => sum + entry.revisions.length,
        0,
      ),
      receipts: ledger.entries.reduce(
        (sum, entry) =>
          sum +
          entry.receipts.length +
          entry.revisions.reduce(
            (count, revision) => count + revision.before.receipts.length,
            0,
          ),
        0,
      ),
    },
    recordedExpense: summarize(ledger).cost,
    project: financialTotals(ledger),
    parties: ledger.people.map((person) => ({
      id: person.id,
      ...financialTotals(ledger, person.id),
      recordedExpense: personSummary(ledger, person.id).cost,
      accounts: accounts.map((account) => ({
        account,
        ...financialTotals(ledger, person.id, account),
      })),
    })),
    accounts: accounts.map((account) => ({
      account,
      ...financialTotals(ledger, undefined, account),
    })),
    works: ledger.works.map((work) => ({
      id: work.id,
      ...financialTotals(ledger, undefined, undefined, work.id),
      recordedExpense: summarize(ledger, work.id).cost,
    })),
  };
}

export type ArchitectureReconciliation = ReturnType<
  typeof architectureReconciliation
>;
export type ArchitectureMigrationReport = {
  fromVersion: 1 | 2;
  toVersion: 2;
  before: ArchitectureReconciliation;
  after: ArchitectureReconciliation;
  reconciled: true;
  duplicatePartyCandidates: string[][];
  ambiguousCashEntryIds: string[];
  unspecifiedIdentityPartyIds: string[];
  review?: MigrationReview;
};

function duplicatePartyCandidates(ledger: Ledger) {
  const groups = new Map<string, string[]>();
  for (const person of ledger.people) {
    for (const key of [
      `name:${normalizeLabel(person.name)}`,
      ...(person.phone.trim()
        ? [`phone:${person.phone.replace(/\D/g, "")}`]
        : []),
    ]) {
      groups.set(key, [...(groups.get(key) ?? []), person.id]);
    }
  }
  return [
    ...new Map(
      [...groups.values()]
        .filter((ids) => ids.length > 1)
        .map((ids) => [JSON.stringify(ids), ids]),
    ).values(),
  ];
}

export function migrateArchitecture(value: unknown): {
  ledger: Ledger;
  report: ArchitectureMigrationReport;
  changed: boolean;
} {
  assertSupportedArchitecture(value);
  MigrationEnvelopeSchema.parse(value);
  const original = LedgerSchema.parse(value);
  if (!balanceAdjustmentHistoryIsValid(original))
    throw new Error("balance_adjustment_history_invalid");
  const receiptMetadata = new Map<
    string,
    { entryId: string; mime: string; size: number }
  >();
  for (const entry of original.entries) {
    for (const receipt of [
      ...entry.receipts,
      ...entry.revisions.flatMap((revision) => revision.before.receipts),
    ]) {
      const before = receiptMetadata.get(receipt.id);
      if (
        before &&
        (before.entryId !== entry.id ||
          before.mime !== receipt.mime ||
          before.size !== receipt.size)
      )
        throw new Error("receipt_metadata_mismatch");
      receiptMetadata.set(receipt.id, {
        entryId: entry.id,
        mime: receipt.mime,
        size: receipt.size,
      });
    }
  }
  const before = architectureReconciliation(original);
  const ledger = LedgerSchema.parse({
    ...original,
    architectureVersion: ARCHITECTURE_VERSION,
    milestones: original.milestones ?? [],
    paymentAllocations: original.paymentAllocations ?? [],
    people: original.people.map((person) => ({
      ...person,
      roles:
        person.roles ??
        (person.contactType
          ? [person.contactType]
          : person.kind
            ? [contactPresetFrom(person.kind, person.role).id]
            : []),
    })),
  });
  const after = architectureReconciliation(ledger);
  if (
    JSON.stringify(before) !== JSON.stringify(after) ||
    JSON.stringify(original.entries) !== JSON.stringify(ledger.entries) ||
    JSON.stringify(original.contracts) !== JSON.stringify(ledger.contracts)
  )
    throw new Error("architecture_migration_reconciliation_failed");
  return {
    ledger,
    changed: JSON.stringify(original) !== JSON.stringify(ledger),
    report: {
      fromVersion: original.architectureVersion ?? 1,
      toVersion: ARCHITECTURE_VERSION,
      before,
      after,
      reconciled: true,
      review: createMigrationReview(original),
      duplicatePartyCandidates: duplicatePartyCandidates(ledger),
      ambiguousCashEntryIds: ledger.entries
        .filter(
          (entry) =>
            (entry.kind === "payment" || entry.kind === "refund") &&
            !entry.paymentContext &&
            !entry.relatedEntryId &&
            !(ledger.paymentAllocations ?? []).some(
              (allocation) => allocation.paymentId === entry.id,
            ),
        )
        .map((entry) => entry.id),
      unspecifiedIdentityPartyIds: ledger.people
        .filter((person) => !person.identityType)
        .map((person) => person.id),
    },
  };
}

export function preservesArchitecture(before: Ledger, after: Ledger) {
  if (before.architectureVersion === 2 && after.architectureVersion !== 2)
    return false;
  if (before.milestones && !after.milestones) return false;
  if (before.paymentAllocations && !after.paymentAllocations) return false;
  if (!preservesPaymentAllocationHistory(before, after)) return false;
  const milestones = new Set(
    (after.milestones ?? []).map((milestone) => milestone.id),
  );
  if (
    (before.milestones ?? []).some((milestone) => !milestones.has(milestone.id))
  )
    return false;
  const people = new Map(after.people.map((person) => [person.id, person]));
  for (const person of before.people) {
    const next = people.get(person.id);
    if (
      (person.roles && !next?.roles) ||
      (person.identityType && !next?.identityType)
    )
      return false;
  }
  const entries = new Map(after.entries.map((entry) => [entry.id, entry]));
  for (const entry of before.entries) {
    const next = entries.get(entry.id);
    if (
      (entry.paymentContext && !next?.paymentContext) ||
      (entry.milestoneId && !Object.hasOwn(next ?? {}, "milestoneId"))
    )
      return false;
  }
  return true;
}

export function preservesImportedArchitecture(
  before: Ledger,
  original: Ledger,
  converted: Ledger,
) {
  if (!preservesArchitecture(before, converted)) return false;
  if (
    (before.milestones?.length && !original.milestones) ||
    (before.paymentAllocations?.length && !original.paymentAllocations)
  )
    return false;
  const rawPeople = new Map(
    original.people.map((person) => [person.id, person]),
  );
  const people = new Map(converted.people.map((person) => [person.id, person]));
  return before.people.every((person) => {
    const raw = rawPeople.get(person.id);
    if (!raw || raw.roles || !person.roles) return true;
    return (
      JSON.stringify(person.roles) ===
      JSON.stringify(people.get(person.id)?.roles)
    );
  });
}
