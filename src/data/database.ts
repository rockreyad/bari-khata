import Dexie, { type EntityTable } from "dexie";
import type { Ledger } from "../domain/model";

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

export class LedgerDatabase extends Dexie {
  workspaces!: EntityTable<WorkspaceRow, "id">;
  receipts!: EntityTable<ReceiptRow, "key">;
  outbox!: EntityTable<OutboxRow, "id">;
  conflicts!: EntityTable<ConflictRow, "id">;
  drafts!: EntityTable<DraftRow, "id">;
  recoveries!: EntityTable<RecoveryRow, "id">;

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
