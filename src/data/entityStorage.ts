import { z } from "zod";
import Dexie from "dexie";
import { LedgerSchema, type Ledger } from "../domain/model";
import type { LedgerDatabase, WorkspaceMode } from "./database";

export const ledgerCollections = [
  "works",
  "people",
  "materialGroups",
  "items",
  "paymentPurposes",
  "contracts",
  "entries",
  "milestones",
  "paymentAllocations",
] as const;
export type LedgerCollection = (typeof ledgerCollections)[number];
export type LedgerHeaderRow = Pick<
  Ledger,
  "schemaVersion" | "architectureVersion" | "isDemo" | "project"
> & {
  id: WorkspaceMode;
  collections: Record<LedgerCollection, number>;
  checksum: string;
  optionalCollections: ("milestones" | "paymentAllocations")[];
};
export interface LedgerEntityRow {
  key: string;
  workspace: WorkspaceMode;
  collection: LedgerCollection;
  id: string;
  position: number;
  value: unknown;
}
const EntityRowSchema = z.object({
  key: z.string(),
  workspace: z.enum(["real", "demo"]),
  collection: z.enum(ledgerCollections),
  id: z.string().min(1).max(160),
  position: z.number().int().nonnegative().max(100000),
  value: z.unknown(),
});
const HeaderSchema = z.object({
  id: z.enum(["real", "demo"]),
  schemaVersion: z.literal(1),
  architectureVersion: z.literal(2).optional(),
  isDemo: z.boolean(),
  project: z.unknown(),
  collections: z.record(
    z.enum(ledgerCollections),
    z.number().int().nonnegative().max(100000),
  ),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
  optionalCollections: z.array(z.enum(["milestones", "paymentAllocations"])),
});
const key = (
  workspace: WorkspaceMode,
  collection: LedgerCollection,
  id: string,
) => JSON.stringify([workspace, collection, id]);

const LegacyHeaderSchema = HeaderSchema.omit({ checksum: true });

export async function readEntityLedger(
  database: LedgerDatabase,
  mode: WorkspaceMode,
): Promise<Ledger> {
  const header = HeaderSchema.parse(await database.ledgerHeaders.get(mode));
  const ledger = await assembleEntityLedger(database, mode, header);
  if ((await Dexie.waitFor(ledgerChecksum(ledger))) !== header.checksum)
    throw new Error("ledger_entity_checksum_mismatch");
  return ledger;
}

export async function readPreChecksumEntityLedger(
  database: LedgerDatabase,
  mode: WorkspaceMode,
): Promise<Ledger> {
  const raw = await database.ledgerHeaders.get(mode);
  if (!raw || Object.hasOwn(raw, "checksum"))
    throw new Error("legacy_integrity_header_required");
  return assembleEntityLedger(database, mode, LegacyHeaderSchema.parse(raw));
}

async function assembleEntityLedger(
  database: LedgerDatabase,
  mode: WorkspaceMode,
  header: z.infer<typeof LegacyHeaderSchema>,
): Promise<Ledger> {
  if (header.id !== mode || header.isDemo !== (mode === "demo"))
    throw new Error("workspace_mode_mismatch");
  const rows = z
    .array(EntityRowSchema)
    .parse(
      await database.ledgerEntities.where("workspace").equals(mode).toArray(),
    );
  const candidate: Record<string, unknown> = {
    schemaVersion: header.schemaVersion,
    ...(header.architectureVersion
      ? { architectureVersion: header.architectureVersion }
      : {}),
    isDemo: header.isDemo,
    project: header.project,
  };
  for (const collection of ledgerCollections) {
    const records = rows
      .filter((row) => row.collection === collection)
      .sort((a, b) => a.position - b.position);
    if (records.length !== header.collections[collection])
      throw new Error("ledger_entities_incomplete");
    records.forEach((row, index) => {
      if (
        row.workspace !== mode ||
        row.position !== index ||
        row.key !== key(mode, collection, row.id) ||
        !row.value ||
        typeof row.value !== "object" ||
        !("id" in row.value) ||
        row.value.id !== row.id
      )
        throw new Error("ledger_entity_invalid");
    });
    if (
      !(["milestones", "paymentAllocations"] as string[]).includes(
        collection,
      ) ||
      header.optionalCollections.includes(
        collection as "milestones" | "paymentAllocations",
      )
    )
      candidate[collection] = records.map((row) => row.value);
    else if (records.length) throw new Error("ledger_entity_invalid");
  }
  const ledger = LedgerSchema.parse(candidate);
  return ledger;
}

async function ledgerChecksum(ledger: Ledger) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(ledger)),
    ),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function writeEntityLedger(
  database: LedgerDatabase,
  mode: WorkspaceMode,
  ledger: Ledger,
) {
  const existing = new Map(
    (
      await database.ledgerEntities.where("workspace").equals(mode).toArray()
    ).map((row) => [row.key, row]),
  );
  const writes: LedgerEntityRow[] = [];
  const collections = {} as Record<LedgerCollection, number>;
  for (const collection of ledgerCollections) {
    const records = ledger[collection] ?? [];
    collections[collection] = records.length;
    records.forEach((value, position) => {
      const row: LedgerEntityRow = {
        key: key(mode, collection, value.id),
        workspace: mode,
        collection,
        id: value.id,
        position,
        value,
      };
      const before = existing.get(row.key);
      if (
        !before ||
        before.position !== position ||
        JSON.stringify(before.value) !== JSON.stringify(value)
      )
        writes.push(row);
      existing.delete(row.key);
    });
  }
  if (existing.size)
    await database.ledgerEntities.bulkDelete([...existing.keys()]);
  if (writes.length) await database.ledgerEntities.bulkPut(writes);
  await database.ledgerHeaders.put({
    id: mode,
    schemaVersion: ledger.schemaVersion,
    ...(ledger.architectureVersion
      ? { architectureVersion: ledger.architectureVersion }
      : {}),
    isDemo: ledger.isDemo,
    project: ledger.project,
    collections,
    checksum: await Dexie.waitFor(ledgerChecksum(ledger)),
    optionalCollections: [
      ...(Array.isArray(ledger.milestones) ? ["milestones" as const] : []),
      ...(Array.isArray(ledger.paymentAllocations)
        ? ["paymentAllocations" as const]
        : []),
    ],
  });
}
