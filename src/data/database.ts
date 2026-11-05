import { z } from "zod";
import type { MigrationReview } from "../domain/migrationReview";
import {
  writeEntityLedger,
  readEntityLedger,
  readPreChecksumEntityLedger,
  type LedgerEntityRow,
  type LedgerHeaderRow,
} from "./entityStorage";
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

export type StoredWorkspaceRow = Omit<WorkspaceRow, "ledger"> & {
  storageVersion?: 3;
  ledger?: Ledger;
};

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
  // File uploads and cross-window Blobs share the native Blob storage.
  blob: z.custom<Blob>((value) => {
    if (!value || typeof value !== "object") return false;
    try {
      Blob.prototype.slice.call(value, 0, 0);
      const blob = value as Blob;
      return (
        Number.isSafeInteger(blob.size) &&
        blob.size >= 0 &&
        typeof blob.type === "string" &&
        typeof blob.arrayBuffer === "function" &&
        typeof blob.slice === "function"
      );
    } catch {
      return false;
    }
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
  workspaces!: EntityTable<StoredWorkspaceRow, "id">;
  ledgerHeaders!: EntityTable<LedgerHeaderRow, "id">;
  ledgerEntities!: EntityTable<LedgerEntityRow, "key">;
  storageRecoveries!: EntityTable<
    {
      id: string;
      workspace: WorkspaceMode;
      metadata: StoredWorkspaceRow;
      header: unknown;
      entities: LedgerEntityRow[];
      receipts: ReceiptRow[];
      createdAt: string;
    },
    "id"
  >;
  migrationReviews!: EntityTable<
    { id: string; workspace: WorkspaceMode; report: MigrationReview },
    "id"
  >;
  receipts!: EntityTable<ReceiptRow, "key">;
  outbox!: EntityTable<OutboxRow, "id">;
  conflicts!: EntityTable<ConflictRow, "id">;
  drafts!: EntityTable<DraftRow, "id">;
  recoveries!: EntityTable<RecoveryRow, "id">;
  migrations!: EntityTable<ArchitectureMigrationRow, "id">;

  workspaceTables() {
    return [this.workspaces, this.ledgerHeaders, this.ledgerEntities];
  }

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
    this.version(3)
      .stores({
        ledgerHeaders: "id",
        migrationReviews: "id, workspace",
        ledgerEntities:
          "key, workspace, [workspace+collection], [workspace+collection+id]",
      })
      .upgrade(async (transaction) => {
        const workspaces = transaction.table<WorkspaceRow, WorkspaceMode>(
          "workspaces",
        );
        for (const before of await workspaces.toArray()) {
          const metadata = WorkspaceMigrationMetadataSchema.parse(before);
          const migration = migrateArchitecture(before.ledger);
          if (
            migration.ledger.isDemo !== (before.id === "demo") ||
            (this.ownerId && metadata.ownerId !== this.ownerId)
          )
            throw new Error("workspace_mode_or_owner_mismatch");
          const receipts = await transaction
            .table<ReceiptRow, string>("receipts")
            .where("workspace")
            .equals(before.id)
            .toArray();
          validateMigrationReceipts(receipts, before.id, migration.ledger);
          const generation = metadata.generation + (migration.changed ? 1 : 0);
          await transaction
            .table<ArchitectureMigrationRow, string>("migrations")
            .add({
              id: `storage:${before.id}:3`,
              workspace: before.id,
              source: "local",
              before,
              receipts,
              afterLedger: migration.ledger,
              generationAfter: generation,
              report: migration.report,
              status: "completed",
              createdAt: new Date().toISOString(),
            });
          await writeEntityLedger(this, before.id, migration.ledger);
          await transaction
            .table<StoredWorkspaceRow, WorkspaceMode>("workspaces")
            .put({
              ...metadata,
              storageVersion: 3,
              generation,
              pending:
                metadata.pending || (migration.changed && before.id === "real"),
            });
        }
      });
    this.version(4)
      .stores({
        migrationReviews: "id, workspace",
        storageRecoveries: "id, workspace, createdAt",
      })
      .upgrade(async (transaction) => {
        const rows = await transaction
          .table<StoredWorkspaceRow, WorkspaceMode>("workspaces")
          .toArray();
        for (const metadata of rows) {
          WorkspaceMigrationMetadataSchema.parse(metadata);
          if (
            metadata.storageVersion !== 3 ||
            Object.hasOwn(metadata, "ledger")
          )
            throw new Error("workspace_storage_invalid");
          const header = await this.ledgerHeaders.get(metadata.id);
          if (header && Object.hasOwn(header, "checksum")) {
            await readEntityLedger(this, metadata.id);
            continue;
          }
          const ledger = await readPreChecksumEntityLedger(this, metadata.id);
          migrateArchitecture(ledger);
          if (this.ownerId && metadata.ownerId !== this.ownerId)
            throw new Error("owner_mismatch");
          const receipts = await this.receipts
            .where("workspace")
            .equals(metadata.id)
            .toArray();
          validateMigrationReceipts(receipts, metadata.id, ledger);
          await this.storageRecoveries.add({
            id: `integrity:${metadata.id}:4`,
            workspace: metadata.id,
            metadata,
            header,
            entities: await this.ledgerEntities
              .where("workspace")
              .equals(metadata.id)
              .toArray(),
            receipts,
            createdAt: new Date().toISOString(),
          });
          await writeEntityLedger(this, metadata.id, ledger);
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
