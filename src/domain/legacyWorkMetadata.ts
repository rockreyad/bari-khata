import { z } from "zod";
import { LedgerSchema, type Ledger } from "./model.js";

const RetiredWorkMetadataSchema = z.object({
  milestones: z
    .array(
      z.object({
        id: z.string().min(1).max(160),
        contractId: z.string().min(1).max(160),
        title: z.string().trim().min(1).max(300),
        amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        dueOn: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .default(null),
        status: z.enum(["planned", "ongoing", "done"]).default("planned"),
      }),
    )
    .max(10000)
    .optional(),
  entries: z
    .array(
      z.object({
        milestoneId: z.string().min(1).max(160).nullable().optional(),
        revisions: z
          .array(
            z.object({
              before: z.object({
                milestoneId: z.string().min(1).max(160).nullable().optional(),
              }),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

// Old checksums include retired metadata in schema order; verify those bytes before removing it.
export function ledgerBeforeWorkMetadataRemoval(value: unknown) {
  const ledger = LedgerSchema.parse(value);
  const retired = RetiredWorkMetadataSchema.parse(value);
  const seen = new Set<string>();
  const totals = new Map<string, bigint>();
  const contracts = new Map(
    ledger.contracts.map((contract) => [contract.id, contract]),
  );
  const rows = new Map((retired.milestones ?? []).map((row) => [row.id, row]));
  for (const row of retired.milestones ?? []) {
    const contract = contracts.get(row.contractId);
    const total = (totals.get(row.contractId) ?? 0n) + BigInt(row.amount);
    const date = row.dueOn ? new Date(`${row.dueOn}T00:00:00Z`) : null;
    if (
      seen.has(row.id) ||
      !contract ||
      total > BigInt(contract.total) ||
      (date &&
        (!Number.isFinite(date.getTime()) ||
          date.toISOString().slice(0, 10) !== row.dueOn))
    )
      throw new Error("retired_work_metadata_invalid");
    seen.add(row.id);
    totals.set(row.contractId, total);
  }
  for (const [index, entry] of ledger.entries.entries()) {
    const snapshots = [
      entry,
      ...entry.revisions.map((revision) => revision.before),
    ];
    const references = [
      retired.entries[index],
      ...retired.entries[index].revisions.map((revision) => revision.before),
    ];
    for (const [position, snapshot] of snapshots.entries()) {
      const id = references[position].milestoneId;
      if (!id) continue;
      const row = rows.get(id);
      const contract = row ? contracts.get(row.contractId) : undefined;
      if (
        !row ||
        !contract ||
        snapshot.kind !== "expense" ||
        snapshot.contractId !== contract.id ||
        snapshot.personId !== contract.personId ||
        snapshot.account !== "labour" ||
        (contract.scope === "work" &&
          snapshot.lines.some((line) => line.workId !== contract.workId))
      )
        throw new Error("retired_work_metadata_invalid");
    }
  }
  const withReference = (
    entry: object,
    previous: { milestoneId?: string | null },
  ) =>
    Object.fromEntries(
      Object.entries(entry).flatMap(([key, value]) => [
        [key, value],
        ...(key === "contractId" && Object.hasOwn(previous, "milestoneId")
          ? [["milestoneId", previous.milestoneId]]
          : []),
      ]),
    );
  const entries = ledger.entries.map((entry, index) => ({
    ...withReference(entry, retired.entries[index]),
    revisions: entry.revisions.map((revision, revisionIndex) => ({
      ...revision,
      before: withReference(
        revision.before,
        retired.entries[index].revisions[revisionIndex].before,
      ),
    })),
  }));
  return Object.fromEntries(
    Object.entries(ledger).flatMap(([key, value]) => [
      [key, key === "entries" ? entries : value],
      ...(key === "contracts" && retired.milestones !== undefined
        ? [["milestones", retired.milestones]]
        : []),
    ]),
  );
}

export function hasRetiredWorkMetadata(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Object.hasOwn(value, "milestones") || Object.hasOwn(value, "milestoneId"))
    return true;
  return Object.values(value).some((child) =>
    Array.isArray(child)
      ? child.some(hasRetiredWorkMetadata)
      : hasRetiredWorkMetadata(child),
  );
}

export function removeRetiredWorkMetadata(value: unknown): Ledger {
  ledgerBeforeWorkMetadataRemoval(value);
  return LedgerSchema.parse(value);
}
