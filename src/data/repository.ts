import { z } from "zod";
import Dexie from "dexie";
import {
  planBackupMerge,
  preservesBackupPersonWorkLinks,
  sameBackupLedger,
  type BackupDecisions,
} from "./backupMerge";
import { preservesPaymentPurposes } from "../domain/paymentPurposes";
import { preservesRemovalHistory } from "../domain/entityDeletion";
import { preservesContractHistory } from "../domain/contracts";
import { preservesWorkHistory } from "../domain/workActivity";
import { preservesPersonWorkLinks } from "../domain/personWorkLinks";
import { preservesMcpProvenance } from "../domain/mcpProvenance.js";
import {
  LedgerSchema,
  validateLedger as validateDomainLedger,
  type Ledger,
} from "../domain/model";
import {
  db,
  getActiveOwner,
  getWorkspaceDatabase,
  LedgerDatabase,
  receiptKey,
  type ReceiptRow,
  type WorkspaceMode,
  type WorkspaceRow,
} from "./database";

const ModeSchema = z.enum(["real", "demo"]);
const LedgerDocumentShape = z
  .object({
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
  })
  .passthrough();
const PersistedLedgerSchema = LedgerDocumentShape.transform((value) =>
  LedgerSchema.parse(value),
);
const WorkspaceSchema = z.object({
  id: ModeSchema,
  ledger: PersistedLedgerSchema,
  generation: z.number().int().nonnegative().default(0),
  cloudRevision: z.number().int().nonnegative().default(0),
  ownerId: z.string().nullable().default(null),
  pending: z.boolean().default(false),
  lastSyncedAt: z.string().nullable().default(null),
  updatedAt: z.string(),
});

const ReceiptBackupSchema = z.object({
  id: z.string().min(1).max(200),
  entryId: z.string().min(1).max(200),
  name: z.string().max(300),
  mime: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
  createdAt: z.string(),
  base64: z
    .string()
    .max(14_000_000)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/),
});

const BackupSchema = z.object({
  format: z.literal("bari-khata-backup"),
  version: z.literal(1),
  exportedAt: z.string(),
  ledger: PersistedLedgerSchema,
  receipts: z.array(ReceiptBackupSchema).default([]),
});

export type LedgerBackup = z.infer<typeof BackupSchema>;
export type LedgerChange = Ledger | ((current: Ledger) => Ledger);
export type BackupMergeOptions = {
  mode?: WorkspaceMode;
  confirmed: true;
  expectedLedger: Ledger;
  decisions: BackupDecisions;
  at: string;
};
export type ReceiptInput = {
  id: string;
  entryId: string;
  file: Blob;
  name?: string;
};

const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const now = () => new Date().toISOString();

export function validateLedger(value: unknown): Ledger {
  LedgerDocumentShape.parse(value);
  const ledger = validateDomainLedger(value);
  receiptReferences(ledger);
  return ledger;
}

export function receiptReferences(ledger: Ledger) {
  const references = new Map<
    string,
    { id: string; name: string; mime: string; size: number; entryId: string }
  >();
  for (const entry of ledger.entries) {
    const receipts = [
      ...entry.receipts,
      ...entry.revisions.flatMap((revision) => revision.before.receipts),
    ];
    for (const receipt of receipts) {
      const existing = references.get(receipt.id);
      if (
        existing &&
        (existing.entryId !== entry.id ||
          existing.size !== receipt.size ||
          existing.mime !== receipt.mime)
      ) {
        throw new Error("receipt_metadata_mismatch");
      }
      references.set(receipt.id, { ...receipt, entryId: entry.id });
    }
  }
  return [...references.values()];
}

export class LedgerRepository {
  constructor(readonly database: LedgerDatabase = db) {}

  async ensure(mode: WorkspaceMode, initial: Ledger): Promise<WorkspaceRow> {
    return this.database.transaction(
      "rw",
      this.database.workspaces,
      async () => {
        const existing = await this.database.workspaces.get(mode);
        if (existing) {
          const parsed = WorkspaceSchema.parse(existing);
          if (this.database.ownerId && parsed.ownerId !== this.database.ownerId)
            throw new Error("owner_mismatch");
          parsed.ledger = validateLedger(parsed.ledger);
          return parsed;
        }
        if (initial.isDemo !== (mode === "demo"))
          throw new Error("workspace_mode_mismatch");
        const row: WorkspaceRow = {
          id: mode,
          ledger: validateLedger(initial),
          generation: 0,
          cloudRevision: 0,
          ownerId: this.database.ownerId,
          pending: false,
          lastSyncedAt: null,
          updatedAt: now(),
        };
        await this.database.workspaces.add(row);
        return row;
      },
    );
  }

  async read(mode: WorkspaceMode = "real"): Promise<WorkspaceRow | null> {
    const row = await this.database.workspaces.get(mode);
    if (!row) return null;
    const parsed = WorkspaceSchema.parse(row);
    parsed.ledger = validateLedger(parsed.ledger);
    if (parsed.ledger.isDemo !== (mode === "demo"))
      throw new Error("workspace_mode_mismatch");
    if (this.database.ownerId && parsed.ownerId !== this.database.ownerId)
      throw new Error("owner_mismatch");
    return parsed;
  }

  async save(
    change: LedgerChange,
    mode: WorkspaceMode = "real",
    files: ReceiptInput[] = [],
  ): Promise<void> {
    const prepared = files.map((input): ReceiptRow => {
      if (
        !allowedTypes.has(input.file.type) ||
        input.file.size > 10 * 1024 * 1024
      ) {
        throw new Error("receipt_invalid");
      }
      return {
        key: receiptKey(mode, input.id),
        id: input.id,
        workspace: mode,
        entryId: input.entryId,
        name:
          input.name ??
          ("name" in input.file ? String(input.file.name) : input.id),
        mime: input.file.type,
        blob: input.file,
        createdAt: now(),
        uploadedFor: null,
      };
    });
    await this.database.transaction(
      "rw",
      this.database.workspaces,
      this.database.receipts,
      async () => {
        const current = await this.read(mode);
        if (!current) throw new Error("workspace_missing");
        const ledger = validateLedger(
          typeof change === "function"
            ? change(structuredClone(current.ledger))
            : change,
        );
        if (!preservesRemovalHistory(current.ledger, ledger))
          throw new Error("removal_history_would_be_lost");
        if (!preservesContractHistory(current.ledger, ledger))
          throw new Error("contract_history_would_be_lost");
        if (!preservesPersonWorkLinks(current.ledger, ledger))
          throw new Error("person_work_links_would_be_lost");
        if (!preservesMcpProvenance(current.ledger, ledger))
          throw new Error("mcp_provenance_would_be_lost");
        if (ledger.isDemo !== (mode === "demo"))
          throw new Error("workspace_mode_mismatch");
        const refs = receiptReferences(ledger);
        for (const receipt of prepared) {
          const ref = refs.find(
            (candidate) =>
              candidate.id === receipt.id &&
              candidate.entryId === receipt.entryId,
          );
          if (
            !ref ||
            ref.size !== receipt.blob.size ||
            ref.mime !== receipt.mime
          )
            throw new Error("receipt_metadata_mismatch");
        }
        const oldIds = new Set(
          receiptReferences(current.ledger).map((receipt) => receipt.id),
        );
        for (const ref of refs) {
          if (
            !oldIds.has(ref.id) &&
            !prepared.some((receipt) => receipt.id === ref.id) &&
            !(await this.database.receipts.get(receiptKey(mode, ref.id)))
          )
            throw new Error("receipt_missing");
        }
        await this.database.receipts.bulkPut(prepared);
        await this.database.workspaces.put({
          ...current,
          ledger,
          generation: current.generation + 1,
          pending: mode === "real",
          updatedAt: now(),
        });
      },
    );
  }

  async getReceipt(
    id: string,
    mode: WorkspaceMode = "real",
  ): Promise<ReceiptRow | null> {
    return (await this.database.receipts.get(receiptKey(mode, id))) ?? null;
  }

  async exportBackup(mode: WorkspaceMode = "real"): Promise<string> {
    const snapshot = await this.database.transaction(
      "r",
      this.database.workspaces,
      this.database.receipts,
      async () => {
        const row = await this.read(mode);
        if (!row) throw new Error("workspace_missing");
        const receipts: ReceiptRow[] = [];
        for (const ref of receiptReferences(row.ledger)) {
          const receipt = await this.database.receipts.get(
            receiptKey(mode, ref.id),
          );
          if (!receipt) throw new Error("receipt_missing");
          receipts.push(receipt);
        }
        return { ledger: row.ledger, receipts };
      },
    );
    const receipts = await Promise.all(
      snapshot.receipts.map(async (receipt) =>
        ReceiptBackupSchema.parse({
          id: receipt.id,
          entryId: receipt.entryId,
          name: receipt.name,
          mime: receipt.mime,
          createdAt: receipt.createdAt,
          base64: await blobToBase64(receipt.blob),
        }),
      ),
    );
    const backup: LedgerBackup = {
      format: "bari-khata-backup",
      version: 1,
      exportedAt: now(),
      ledger: snapshot.ledger,
      receipts,
    };
    const text = JSON.stringify(backup);
    if (text.length > 100 * 1024 * 1024) throw new Error("backup_too_large");
    return text;
  }

  async importBackup(
    text: string,
    options: { mode?: WorkspaceMode; replace: true },
  ): Promise<void> {
    if (options.replace !== true)
      throw new Error("restore_confirmation_required");
    const backup = parseBackup(text);
    const mode = options.mode ?? "real";
    if (backup.ledger.isDemo !== (mode === "demo"))
      throw new Error("workspace_mode_mismatch");
    const receipts: ReceiptRow[] = backup.receipts.map((receipt) => ({
      ...receipt,
      key: receiptKey(mode, receipt.id),
      workspace: mode,
      blob: base64ToBlob(receipt.base64, receipt.mime),
      uploadedFor: null,
    }));
    await this.database.transaction(
      "rw",
      this.database.workspaces,
      this.database.receipts,
      this.database.outbox,
      this.database.conflicts,
      this.database.recoveries,
      async () => {
        const current = await this.read(mode);
        if (current && !preservesRemovalHistory(current.ledger, backup.ledger))
          throw new Error("removal_history_would_be_lost");
        if (current && !preservesPaymentPurposes(current.ledger, backup.ledger))
          throw new Error("payment_purpose_would_be_lost");
        if (current && !preservesContractHistory(current.ledger, backup.ledger))
          throw new Error("contract_history_would_be_lost");
        if (current && !preservesWorkHistory(current.ledger, backup.ledger))
          throw new Error("work_history_would_be_lost");
        if (current && !preservesPersonWorkLinks(current.ledger, backup.ledger))
          throw new Error("person_work_links_would_be_lost");
        if (current && !preservesMcpProvenance(current.ledger, backup.ledger))
          throw new Error("mcp_provenance_would_be_lost");
        if (current)
          await this.database.recoveries.add({
            id: crypto.randomUUID(),
            workspace: mode,
            ledger: current.ledger,
            receipts: await this.database.receipts
              .where("workspace")
              .equals(mode)
              .toArray(),
            reason: "restore",
            createdAt: now(),
          });
        // Keep old receipt blobs for the automatic recovery snapshot.
        await this.database.receipts.bulkPut(receipts);
        await this.database.outbox.where("workspace").equals(mode).delete();
        await this.database.conflicts.delete(mode);
        await this.database.workspaces.put({
          id: mode,
          ledger: backup.ledger,
          generation: (current?.generation ?? 0) + 1,
          cloudRevision: current?.cloudRevision ?? 0,
          ownerId: current?.ownerId ?? this.database.ownerId,
          pending: mode === "real",
          lastSyncedAt: current?.lastSyncedAt ?? null,
          updatedAt: now(),
        });
      },
    );
  }

  async mergeBackup(
    text: string,
    options: BackupMergeOptions,
  ): Promise<{ changed: boolean }> {
    if (options.confirmed !== true)
      throw new Error("restore_confirmation_required");
    const backup = parseBackup(text);
    const expected = validateLedger(options.expectedLedger);
    const decisions = z
      .record(z.string(), z.enum(["current", "backup"]))
      .parse(options.decisions);
    const at = z.string().datetime().parse(options.at);
    const mode = options.mode ?? "real";
    if (backup.ledger.isDemo !== (mode === "demo"))
      throw new Error("workspace_mode_mismatch");
    const incomingReceipts = new Map(
      backup.receipts.map((receipt) => [receipt.id, receipt]),
    );
    const checkOwner = () => {
      if (this.database.ownerId && getActiveOwner() !== this.database.ownerId)
        throw new Error("account_changed");
    };
    checkOwner();
    return this.database.transaction(
      "rw",
      this.database.workspaces,
      this.database.receipts,
      this.database.conflicts,
      this.database.recoveries,
      async () => {
        checkOwner();
        const current = await this.read(mode);
        if (!current || !sameBackupLedger(current.ledger, expected))
          throw new Error("backup_preview_changed");
        if (await this.database.conflicts.get(mode))
          throw new Error("backup_sync_conflict");
        const plan = planBackupMerge(
          current.ledger,
          backup.ledger,
          decisions,
          at,
        );
        if (plan.unresolved.length)
          throw new Error("backup_decisions_required");
        if (plan.historyConflict) throw new Error("backup_history_conflict");
        if (!plan.ledger) throw new Error("backup_merge_invalid");
        const ledger = validateLedger(plan.ledger);
        if (!preservesRemovalHistory(current.ledger, ledger))
          throw new Error("removal_history_would_be_lost");
        if (!preservesPaymentPurposes(current.ledger, ledger))
          throw new Error("payment_purpose_would_be_lost");
        if (!preservesContractHistory(current.ledger, ledger))
          throw new Error("contract_history_would_be_lost");
        if (!preservesWorkHistory(current.ledger, ledger))
          throw new Error("work_history_would_be_lost");
        if (!preservesMcpProvenance(current.ledger, ledger))
          throw new Error("mcp_provenance_would_be_lost");
        if (!preservesBackupPersonWorkLinks(current.ledger, ledger))
          throw new Error("person_work_links_would_be_lost");
        const prepared: ReceiptRow[] = [];
        for (const ref of receiptReferences(ledger)) {
          const existing = await this.database.receipts.get(
            receiptKey(mode, ref.id),
          );
          const incoming = incomingReceipts.get(ref.id);
          if (existing && incoming) {
            // Blob পড়ার সময়ও IndexedDB-এর transaction সচল রাখতে হবে।
            const contents = await Dexie.waitFor(blobToBase64(existing.blob));
            if (
              existing.entryId !== incoming.entryId ||
              existing.mime !== incoming.mime ||
              contents !== incoming.base64
            )
              throw new Error("receipt_content_conflict");
          }
          if (!existing) {
            if (!incoming) throw new Error("receipt_missing");
            prepared.push({
              ...incoming,
              key: receiptKey(mode, incoming.id),
              workspace: mode,
              blob: base64ToBlob(incoming.base64, incoming.mime),
              uploadedFor: null,
            });
          }
        }
        checkOwner();
        if (sameBackupLedger(current.ledger, ledger) && !prepared.length)
          return { changed: false };
        await this.database.recoveries.add({
          id: crypto.randomUUID(),
          workspace: mode,
          ledger: current.ledger,
          receipts: await this.database.receipts
            .where("workspace")
            .equals(mode)
            .toArray(),
          reason: "restore",
          createdAt: now(),
        });
        await this.database.receipts.bulkPut(prepared);
        await this.database.workspaces.put({
          ...current,
          ledger,
          generation: current.generation + 1,
          pending: mode === "real",
          updatedAt: now(),
        });
        checkOwner();
        return { changed: true };
      },
    );
  }
}

export function parseBackup(text: string): LedgerBackup {
  if (text.length > 100 * 1024 * 1024) throw new Error("backup_too_large");
  const backup = BackupSchema.parse(JSON.parse(text));
  backup.ledger = validateLedger(backup.ledger);
  const ids = new Set<string>();
  for (const receipt of backup.receipts) {
    if (ids.has(receipt.id)) throw new Error("duplicate_receipt");
    ids.add(receipt.id);
    const ref = receiptReferences(backup.ledger).find(
      (candidate) =>
        candidate.id === receipt.id && candidate.entryId === receipt.entryId,
    );
    if (!ref) throw new Error("receipt_entry_missing");
    const decoded = base64ToBlob(receipt.base64, receipt.mime);
    if (
      decoded.size > 10 * 1024 * 1024 ||
      decoded.size !== ref.size ||
      ref.mime !== receipt.mime
    )
      throw new Error("receipt_invalid");
  }
  if (receiptReferences(backup.ledger).some((receipt) => !ids.has(receipt.id)))
    throw new Error("receipt_missing");
  return backup;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

const DraftBlobSchema = z
  .instanceof(Blob)
  .refine(
    (blob) => allowedTypes.has(blob.type) && blob.size <= 10 * 1024 * 1024,
  );
const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    DraftBlobSchema,
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z
      .custom<Record<string, unknown>>(
        (value) =>
          value !== null &&
          typeof value === "object" &&
          (Object.getPrototypeOf(value) === Object.prototype ||
            Object.getPrototypeOf(value) === null),
      )
      .pipe(z.record(z.string(), JsonValueSchema)),
  ]),
);

const FileEnvelopeSchema = z
  .object({
    __bariFile: z.literal(1),
    name: z.string().max(300),
    lastModified: z.number().finite(),
    blob: DraftBlobSchema,
  })
  .strict();

function packDraft(value: unknown): unknown {
  if (typeof File !== "undefined" && value instanceof File)
    return {
      __bariFile: 1,
      name: value.name,
      lastModified: value.lastModified,
      blob: value,
    };
  if (value instanceof Blob) return value;
  if (Array.isArray(value)) return value.map(packDraft);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, packDraft(item)]),
    );
  return value;
}

function unpackDraft(value: unknown): unknown {
  if (value instanceof Blob) return value;
  if (Array.isArray(value)) return value.map(unpackDraft);
  if (value !== null && typeof value === "object") {
    if ("__bariFile" in value) {
      const file = FileEnvelopeSchema.parse(value);
      return new File([file.blob], file.name, {
        type: file.blob.type,
        lastModified: file.lastModified,
      });
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, unpackDraft(item)]),
    );
  }
  return value;
}

// Keep the original anonymous database intact for explicit legacy recovery.
export const repository = new LedgerRepository();
export function getScopedRepository(mode: WorkspaceMode = "real") {
  return new LedgerRepository(getWorkspaceDatabase(mode));
}
export const readLedger = (mode: WorkspaceMode = "real") =>
  getScopedRepository(mode).read(mode);
export const saveLedger = (
  change: LedgerChange,
  mode: WorkspaceMode = "real",
  files: ReceiptInput[] = [],
) => getScopedRepository(mode).save(change, mode, files);
export const exportBackup = (mode: WorkspaceMode = "real") =>
  createWorkspaceStorage(mode).exportBackup();
export const importBackup = (
  text: string,
  options: { mode?: WorkspaceMode; replace: true },
) => getScopedRepository(options.mode ?? "real").importBackup(text, options);
export const getReceipt = (id: string, mode: WorkspaceMode = "real") =>
  createWorkspaceStorage(mode).getReceipt(id);

function storeDraft(
  database: LedgerDatabase,
  mode: WorkspaceMode,
  key: string,
  value: unknown,
) {
  const parsed = JsonValueSchema.parse(value);
  return database.drafts.put({
    id: `${mode}:${key}`,
    workspace: mode,
    value: packDraft(parsed),
    updatedAt: now(),
  });
}
async function loadDraft<T>(
  database: LedgerDatabase,
  mode: WorkspaceMode,
  key: string,
): Promise<T | null> {
  const row = await database.drafts.get(`${mode}:${key}`);
  return row ? (unpackDraft(JsonValueSchema.parse(row.value)) as T) : null;
}

export function createWorkspaceStorage(mode: WorkspaceMode = "real") {
  const repository = getScopedRepository(mode);
  const database = repository.database;
  const checkAccount = () => {
    if (mode === "real" && getActiveOwner() !== database.ownerId)
      throw new Error("account_changed");
  };
  return {
    readDraft: <T = unknown>(key: string) => loadDraft<T>(database, mode, key),
    saveDraft: (key: string, value: unknown) =>
      storeDraft(database, mode, key, value),
    removeDraft: (key: string) => database.drafts.delete(`${mode}:${key}`),
    getReceipt: async (id: string) => {
      checkAccount();
      const receipt = await repository.getReceipt(id, mode);
      checkAccount();
      return receipt;
    },
    exportBackup: async () => {
      checkAccount();
      const text = await repository.exportBackup(mode);
      checkAccount();
      return text;
    },
    importBackup: (text: string, options: { replace: true }) =>
      repository.importBackup(text, { ...options, mode }),
    mergeBackup: async (
      text: string,
      options: Omit<BackupMergeOptions, "mode">,
    ) => {
      checkAccount();
      const result = await repository.mergeBackup(text, { ...options, mode });
      checkAccount();
      return result;
    },
  };
}

export async function saveDraft(
  key: string,
  value: unknown,
  mode: WorkspaceMode = "real",
) {
  const database = getWorkspaceDatabase(mode);
  await storeDraft(database, mode, key, value);
}
export async function readDraft<T = unknown>(
  key: string,
  mode: WorkspaceMode = "real",
): Promise<T | null> {
  const database = getWorkspaceDatabase(mode);
  return loadDraft<T>(database, mode, key);
}
export async function removeDraft(key: string, mode: WorkspaceMode = "real") {
  const database = getWorkspaceDatabase(mode);
  await database.drafts.delete(`${mode}:${key}`);
}
