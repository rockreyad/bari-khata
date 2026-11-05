import { z } from "zod";
import Dexie, { type EntityTable } from "dexie";
import type { Ledger } from "../domain/model";
import {
  migrateArchitecture,
  type ArchitectureMigrationReport,
} from "../domain/architectureMigration";

export type WorkspaceMode = "real" | "demo";

export interface WorkspaceRow {
  id: WorkspaceMode;
  ledger: Ledger;
  generation: number;
  cloudRevision: number;
  ownerId: string | null;
  pending: boolean;
  lastSyncedAt: string | null;
  updatedAt: string;
}

export interface ReceiptRow {
  key: string;
  id: string;
  workspace: WorkspaceMode;
  entryId: string;
  name: string;
  mime: string;
  blob: Blob;
  createdAt: string;
  uploadedFor: string | null;
}

export interface OutboxRow {
  id: string;
  workspace: WorkspaceMode;
  ownerId: string;
  generation: number;
  baseRevision: number;
  ledger: Ledger;
  createdAt: string;
}

export interface ConflictRow {
  id: WorkspaceMode;
  ledger: Ledger;
  revision: number;
  ownerId: string;
  updatedAt: string;
}

interface DraftRow {
  id: string;
  workspace: WorkspaceMode;
  value: unknown;
  updatedAt: string;
}

interface RecoveryRow {
  id: string;
  workspace: WorkspaceMode;
  ledger: Ledger;
  receipts: ReceiptRow[];
  reason: "restore" | "cloud-conflict";
  createdAt: string;
}

export interface ArchitectureMigrationRow {
  id: string;
  workspace: WorkspaceMode;
  source: "local" | "cloud" | "backup";
  before: WorkspaceRow;
  receipts: ReceiptRow[];
  afterLedger: Ledger;
  generationAfter: number;
  report: ArchitectureMigrationReport;
  status: "completed" | "rolled-back";
  createdAt: string;
}

export const architectureMigrationKey = (mode: WorkspaceMode) =>
  `architecture:${mode}:2`;

const WorkspaceMigrationMetadataSchema = z.object({
  id: z.enum(["real", "demo"]),
  generation: z.number().int().nonnegative().default(0),
  cloudRevision: z.number().int().nonnegative().default(0),
  ownerId: z.string().nullable().default(null),
  pending: z.boolean().default(false),
  lastSyncedAt: z.string().nullable().default(null),
  updatedAt: z.string(),
});
const MigrationReceiptSchema = z.object({
  key: z.string().min(1),
  id: z.string().min(1).max(200),
  workspace: z.enum(["real", "demo"]),
  entryId: z.string().min(1).max(200),
  name: z.string().max(300),
  mime: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
  // IndexedDB may return a native Blob from a different window realm.
  blob: z.custom<Blob>((value) => {
    if (
      !value ||
      typeof value !== "object" ||
      Object.prototype.toString.call(value) !== "[object Blob]"
    )
      return false;
    const blob = value as Blob;
    return (
      Number.isSafeInteger(blob.size) &&
      blob.size >= 0 &&
      typeof blob.type === "string" &&
      typeof blob.arrayBuffer === "function" &&
      typeof blob.slice === "function"
    );
  }),
  createdAt: z.string(),
  uploadedFor: z.string().nullable(),
});
export function validateMigrationReceipts(
  rows: ReceiptRow[],
  mode: WorkspaceMode,
  ledger: Ledger,
) {
  z.array(MigrationReceiptSchema).parse(rows);
  const references = new Map(
    ledger.entries.flatMap((entry) => [
      ...entry.receipts.map(
        (receipt) => [receipt.id, { ...receipt, entryId: entry.id }] as const,
      ),
      ...entry.revisions.flatMap((revision) =>
        revision.before.receipts.map(
          (receipt) => [receipt.id, { ...receipt, entryId: entry.id }] as const,
        ),
      ),
    ]),
  );
  const keys = new Set<string>();
  for (const row of rows) {
    const reference = references.get(row.id);
    if (
      row.workspace !== mode ||
      row.key !== `${mode}:${row.id}` ||
      keys.has(row.key) ||
      row.mime !== row.blob.type ||
      row.blob.size > 10 * 1024 * 1024 ||
      (reference &&
        (reference.entryId !== row.entryId ||
          reference.mime !== row.mime ||
          reference.size !== row.blob.size))
    )
      throw new Error("migration_receipt_invalid");
    keys.add(row.key);
  }
}

export class LedgerDatabase extends Dexie {
  workspaces!: EntityTable<WorkspaceRow, "id">;
  receipts!: EntityTable<ReceiptRow, "key">;
  outbox!: EntityTable<OutboxRow, "id">;
  conflicts!: EntityTable<ConflictRow, "id">;
  drafts!: EntityTable<DraftRow, "id">;
  recoveries!: EntityTable<RecoveryRow, "id">;
  migrations!: EntityTable<ArchitectureMigrationRow, "id">;

  constructor(
    name = "bari-khata",
    readonly ownerId: string | null = null,
  ) {
    super(name);
    this.version(1).stores({
      workspaces: "id",
      receipts: "key, workspace, entryId, uploadedFor",
      outbox: "id, workspace, createdAt",
      conflicts: "id",
      drafts: "id, workspace",
      recoveries: "id, workspace, createdAt",
    });
    this.version(2)
      .stores({
        migrations: "id, workspace, createdAt",
      })
      .upgrade(async (transaction) => {
        const workspaces = transaction.table<WorkspaceRow, WorkspaceMode>(
          "workspaces",
        );
        for (const before of await workspaces.toArray()) {
          const metadata = WorkspaceMigrationMetadataSchema.parse(before);
          const migration = migrateArchitecture(before.ledger);
          if (!migration.changed) continue;
          if (
            migration.ledger.isDemo !== (before.id === "demo") ||
            (this.ownerId && before.ownerId !== this.ownerId)
          )
            throw new Error("workspace_mode_or_owner_mismatch");
          const createdAt = new Date().toISOString();
          const receipts = await transaction
            .table<ReceiptRow, string>("receipts")
            .where("workspace")
            .equals(before.id)
            .toArray();
          validateMigrationReceipts(receipts, before.id, migration.ledger);
          const row: ArchitectureMigrationRow = {
            id: architectureMigrationKey(before.id),
            workspace: before.id,
            source: "local",
            before,
            receipts,
            afterLedger: migration.ledger,
            generationAfter: metadata.generation + 1,
            report: migration.report,
            status: "completed",
            createdAt,
          };
          await transaction
            .table<ArchitectureMigrationRow, string>("migrations")
            .add(row);
          await workspaces.put({
            ...before,
            ...metadata,
            ledger: migration.ledger,
            generation: row.generationAfter,
            pending: metadata.pending || before.id === "real",
            updatedAt: createdAt,
          });
        }
      });
  }
}

export const db = new LedgerDatabase();

const accountDatabases = new Map<string, LedgerDatabase>();
const sampleDatabase = new LedgerDatabase("bari-khata-sample-v2");
let activeOwner: string | null = null;

export function setActiveOwner(ownerId: string | null) {
  if (
    ownerId !== null &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      ownerId,
    )
  ) {
    throw new Error("invalid_account_id");
  }
  activeOwner = ownerId;
}

export const getActiveOwner = () => activeOwner;

export function getAccountDatabase(ownerId: string): LedgerDatabase {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      ownerId,
    )
  )
    throw new Error("invalid_account_id");
  let database = accountDatabases.get(ownerId);
  if (!database) {
    database = new LedgerDatabase(`bari-khata-account-${ownerId}`, ownerId);
    accountDatabases.set(ownerId, database);
  }
  return database;
}

export function getWorkspaceDatabase(mode: WorkspaceMode): LedgerDatabase {
  if (mode === "demo") return sampleDatabase;
  if (!activeOwner) throw new Error("authentication_required");
  return getAccountDatabase(activeOwner);
}

export const receiptKey = (mode: WorkspaceMode, id: string) => `${mode}:${id}`;
