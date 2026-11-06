import { z } from "zod";
import {
  hasRetiredWorkMetadata,
  ledgerBeforeWorkMetadataRemoval,
  removeRetiredWorkMetadata,
} from "../domain/legacyWorkMetadata";
import {
  assertSupportedArchitecture,
  migrateArchitecture,
  preservesArchitecture,
  preservesImportedArchitecture,
} from "../domain/architectureMigration";
import Dexie from "dexie";
import {
  createMigrationReview,
  MigrationReviewSchema,
  type MigrationReview,
} from "../domain/migrationReview";
import { readEntityLedger, writeEntityLedger } from "./entityStorage";
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
import { preservesContactTypes } from "../domain/contactTypes";
import { preservesMcpProvenance } from "../domain/mcpProvenance.js";
import {
  balanceAdjustmentHistoryIsValid,
  preservesBalanceAdjustments,
} from "../domain/adjustmentHistory.js";
import {
  LedgerSchema,
  validateLedger as validateDomainLedger,
  type Ledger,
} from "../domain/model";
import {
  db,
  architectureMigrationKey,
  validateMigrationReceipts,
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
  hasRetiredWorkMetadata(value)
    ? removeRetiredWorkMetadata(value)
    : LedgerSchema.parse(value),
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
  migrationReviews: z.array(MigrationReviewSchema).max(10000).optional(),
  integrity: z
    .object({
      algorithm: z.literal("SHA-256"),
      ledger: z.string().regex(/^[0-9a-f]{64}$/),
      receipts: z
        .array(
          z.object({
            id: z.string().min(1).max(200),
            checksum: z.string().regex(/^[0-9a-f]{64}$/),
          }),
        )
        .max(100000),
    })
    .optional(),
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
async function backupFingerprint(text: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

const originalBackupLedgers = new WeakMap<
  LedgerBackup,
  { before: string; after: string }
>();

export async function verifyBackupIntegrity(backup: LedgerBackup) {
  if (!backup.integrity) return;
  const parsed = JSON.stringify(backup.ledger);
  const original = originalBackupLedgers.get(backup);
  const checked = original?.after === parsed ? original.before : parsed;
  if ((await backupFingerprint(checked)) !== backup.integrity.ledger)
    throw new Error("backup_checksum_mismatch");
  const records = new Map(
    backup.integrity.receipts.map((receipt) => [receipt.id, receipt.checksum]),
  );
  if (
    records.size !== backup.integrity.receipts.length ||
    records.size !== backup.receipts.length
  )
    throw new Error("receipt_checksum_mismatch");
  for (const receipt of backup.receipts)
    if (records.get(receipt.id) !== (await backupFingerprint(receipt.base64)))
      throw new Error("receipt_checksum_mismatch");
}

export function validateLedger(value: unknown): Ledger {
  assertSupportedArchitecture(value);
  LedgerDocumentShape.parse(value);
  const ledger = hasRetiredWorkMetadata(value)
    ? removeRetiredWorkMetadata(value)
    : validateDomainLedger(value);
  if (!balanceAdjustmentHistoryIsValid(ledger))
    throw new Error("balance_adjustment_history_invalid");
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
      this.database.workspaceTables(),
      async () => {
        const existing = await this.database.workspaces.get(mode);
        if (existing) return (await this.read(mode))!;
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
        await this.writeWorkspace(row);
        return row;
      },
    );
  }

  async read(mode: WorkspaceMode = "real"): Promise<WorkspaceRow | null> {
    return this.database.transaction(
      "r",
      this.database.workspaceTables(),
      async () => {
        const row = await this.database.workspaces.get(mode);
        if (!row) return null;
        if (row.storageVersion !== 3 || Object.hasOwn(row, "ledger"))
          throw new Error("workspace_storage_invalid");
        const ledger = await readEntityLedger(this.database, mode);
        const parsed = WorkspaceSchema.parse({ ...row, ledger });
        parsed.ledger = validateLedger(parsed.ledger);
        if (parsed.ledger.isDemo !== (mode === "demo"))
          throw new Error("workspace_mode_mismatch");
        if (this.database.ownerId && parsed.ownerId !== this.database.ownerId)
          throw new Error("owner_mismatch");
        return parsed;
      },
    );
  }

  async writeWorkspace(row: WorkspaceRow) {
    const parsed = WorkspaceSchema.parse(row);
    validateLedger(parsed.ledger);
    if (parsed.ledger.isDemo !== (parsed.id === "demo"))
      throw new Error("workspace_mode_mismatch");
    if (this.database.ownerId && parsed.ownerId !== this.database.ownerId)
      throw new Error("owner_mismatch");
    await this.database.transaction(
      "rw",
      this.database.workspaceTables(),
      async () => {
        await writeEntityLedger(this.database, parsed.id, parsed.ledger);
        const { ledger: _ledger, ...metadata } = parsed;
        await this.database.workspaces.put({ ...metadata, storageVersion: 3 });
      },
    );
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
      [...this.database.workspaceTables(), this.database.receipts],
      async () => {
        const current = await this.read(mode);
        if (!current) throw new Error("workspace_missing");
        const ledger = validateLedger(
          typeof change === "function"
            ? change(structuredClone(current.ledger))
            : change,
        );
        if (!preservesArchitecture(current.ledger, ledger))
          throw new Error("architecture_data_would_be_lost");
        if (!preservesRemovalHistory(current.ledger, ledger))
          throw new Error("removal_history_would_be_lost");
        if (!preservesContractHistory(current.ledger, ledger))
          throw new Error("contract_history_would_be_lost");
        if (!preservesPersonWorkLinks(current.ledger, ledger))
          throw new Error("person_work_links_would_be_lost");
        if (!preservesContactTypes(current.ledger, ledger))
          throw new Error("contact_type_would_be_lost");
        if (!preservesMcpProvenance(current.ledger, ledger))
          throw new Error("mcp_provenance_would_be_lost");
        if (!preservesBalanceAdjustments(current.ledger, ledger))
          throw new Error("balance_adjustment_would_be_lost");
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
        await this.writeWorkspace({
          ...current,
          ledger,
          generation: current.generation + 1,
          pending: mode === "real",
          updatedAt: now(),
        });
      },
    );
  }

  async migrateWorkspace(mode: WorkspaceMode = "real") {
    return this.database.transaction(
      "rw",
      [
        ...this.database.workspaceTables(),
        this.database.receipts,
        this.database.migrations,
      ],
      async () => {
        const current = await this.read(mode);
        if (!current) throw new Error("workspace_missing");
        const migration = migrateArchitecture(current.ledger);
        if (!migration.changed)
          return { changed: false, report: migration.report };
        const id = architectureMigrationKey(mode);
        const existing = await this.database.migrations.get(id);
        if (existing)
          throw new Error("architecture_migration_already_recorded");
        const at = now();
        const receipts = await this.database.receipts
          .where("workspace")
          .equals(mode)
          .toArray();
        validateMigrationReceipts(receipts, mode, migration.ledger);
        await this.database.migrations.add({
          id,
          workspace: mode,
          source: "local",
          before: current,
          receipts,
          afterLedger: migration.ledger,
          generationAfter: current.generation + 1,
          report: migration.report,
          status: "completed",
          createdAt: at,
        });
        await this.writeWorkspace({
          ...current,
          ledger: migration.ledger,
          generation: current.generation + 1,
          pending: current.pending || mode === "real",
          updatedAt: at,
        });
        return { changed: true, report: migration.report };
      },
    );
  }

  async recordIncomingMigration(
    document: Ledger,
    current: WorkspaceRow,
    source: "cloud" | "backup",
    sourceKey: string,
    sourceReceipts?: ReceiptRow[],
  ) {
    const migration = migrateArchitecture(document);
    if (migration.changed) {
      const id = `${architectureMigrationKey(current.id)}:${source}:${sourceKey}`;
      if (!(await this.database.migrations.get(id))) {
        const receipts =
          sourceReceipts ??
          (await this.database.receipts
            .where("workspace")
            .equals(current.id)
            .toArray());
        validateMigrationReceipts(receipts, current.id, migration.ledger);
        await this.database.migrations.add({
          id,
          workspace: current.id,
          source,
          before: {
            ...current,
            ledger: document,
            ...(source === "cloud"
              ? { cloudRevision: Number(sourceKey), pending: false }
              : {}),
          },
          receipts,
          afterLedger: migration.ledger,
          generationAfter: current.generation + 1,
          report: migration.report,
          status: "completed",
          createdAt: now(),
        });
      }
    }
    return migration;
  }

  async rollbackArchitectureMigration(
    id: string,
    expected: { ledger: Ledger; generation: number },
  ) {
    await this.database.transaction(
      "rw",
      [
        ...this.database.workspaceTables(),
        this.database.receipts,
        this.database.outbox,
        this.database.conflicts,
        this.database.migrations,
      ],
      async () => {
        const migration = await this.database.migrations.get(id);
        if (!migration || migration.status !== "completed")
          throw new Error("architecture_migration_missing");
        const current = await this.read(migration.workspace);
        if (
          !current ||
          current.generation !== expected.generation ||
          !sameBackupLedger(current.ledger, expected.ledger) ||
          current.generation !== migration.generationAfter ||
          !sameBackupLedger(current.ledger, migration.afterLedger)
        )
          throw new Error("architecture_rollback_has_later_changes");
        if (current.cloudRevision !== (migration.before.cloudRevision ?? 0))
          throw new Error("architecture_rollback_already_synced");
        if (
          (await this.database.outbox
            .where("workspace")
            .equals(current.id)
            .count()) ||
          (await this.database.conflicts.get(current.id))
        )
          throw new Error("architecture_rollback_sync_pending");
        const validatedBefore = validateLedger(migration.before.ledger);
        if (
          !sameBackupLedger(
            migrateArchitecture(migration.before.ledger).ledger,
            migration.afterLedger,
          )
        )
          throw new Error("architecture_migration_invalid");
        validateMigrationReceipts(
          migration.receipts,
          migration.workspace,
          validatedBefore,
        );
        const ledger = migration.before.ledger;
        // Cloud revisions are concurrency tokens; restoring a document cannot rewind them.
        await this.writeWorkspace({
          ...current,
          ledger,
          generation: current.generation + 1,
          pending: current.id === "real",
          updatedAt: now(),
        });
        await this.database.receipts.bulkPut(migration.receipts);
        await this.database.migrations.update(id, { status: "rolled-back" });
      },
    );
  }

  async migrationReview(mode: WorkspaceMode = "real") {
    const current = await this.read(mode);
    if (!current) throw new Error("workspace_missing");
    const source = await this.database.migrations
      .where("workspace")
      .equals(mode)
      .toArray();
    const restored = await this.database.migrationReviews
      .where("workspace")
      .equals(mode)
      .toArray();
    return {
      current: createMigrationReview(current.ledger),
      sources: [
        ...source.map(
          (row) =>
            row.report.review ??
            createMigrationReview(validateLedger(row.before.ledger)),
        ),
        ...restored.map((row) => MigrationReviewSchema.parse(row.report)),
      ],
    };
  }

  private async storeMigrationReviews(
    reports: MigrationReview[],
    mode: WorkspaceMode,
    sourceKey: string,
  ) {
    for (const [index, report] of reports.entries())
      await this.database.migrationReviews.put({
        id: `${mode}:${sourceKey}:${index}`,
        workspace: mode,
        report: MigrationReviewSchema.parse(report),
      });
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
      [
        ...this.database.workspaceTables(),
        this.database.receipts,
        this.database.migrations,
        this.database.migrationReviews,
      ],
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
        const sourceReviews = (
          await this.database.migrations
            .where("workspace")
            .equals(mode)
            .toArray()
        ).map(
          (migration) =>
            migration.report.review ??
            createMigrationReview(validateLedger(migration.before.ledger)),
        );
        const imported = (
          await this.database.migrationReviews
            .where("workspace")
            .equals(mode)
            .toArray()
        ).map((row) => MigrationReviewSchema.parse(row.report));
        const migrationReviews = [
          ...new Map(
            [
              createMigrationReview(row.ledger),
              ...sourceReviews,
              ...imported,
            ].map((report) => [JSON.stringify(report), report]),
          ).values(),
        ];
        return { ledger: row.ledger, receipts, migrationReviews };
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
      migrationReviews: snapshot.migrationReviews,
      integrity: {
        algorithm: "SHA-256",
        ledger: await backupFingerprint(JSON.stringify(snapshot.ledger)),
        receipts: await Promise.all(
          receipts.map(async (receipt) => ({
            id: receipt.id,
            checksum: await backupFingerprint(receipt.base64),
          })),
        ),
      },
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
    await verifyBackupIntegrity(backup);
    const sourceKey = await backupFingerprint(text);
    const originalLedger = backup.ledger;
    backup.ledger = migrateArchitecture(originalLedger).ledger;
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
      [
        ...this.database.workspaceTables(),
        this.database.receipts,
        this.database.outbox,
        this.database.conflicts,
        this.database.recoveries,
        this.database.migrations,
        this.database.migrationReviews,
      ],
      async () => {
        const current = await this.read(mode);
        if (
          current &&
          !preservesImportedArchitecture(
            current.ledger,
            originalLedger,
            backup.ledger,
          )
        )
          throw new Error("architecture_data_would_be_lost");
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
        if (current && !preservesContactTypes(current.ledger, backup.ledger))
          throw new Error("contact_type_would_be_lost");
        if (current && !preservesMcpProvenance(current.ledger, backup.ledger))
          throw new Error("mcp_provenance_would_be_lost");
        if (
          current &&
          !preservesBalanceAdjustments(current.ledger, backup.ledger)
        )
          throw new Error("balance_adjustment_would_be_lost");
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
        await this.recordIncomingMigration(
          originalLedger,
          current ?? {
            id: mode,
            ledger: originalLedger,
            generation: 0,
            cloudRevision: 0,
            ownerId: this.database.ownerId,
            pending: false,
            lastSyncedAt: null,
            updatedAt: now(),
          },
          "backup",
          sourceKey,
          receipts,
        );
        await this.storeMigrationReviews(
          backup.migrationReviews ?? [],
          mode,
          sourceKey,
        );
        // Keep old receipt blobs for the automatic recovery snapshot.
        await this.database.receipts.bulkPut(receipts);
        await this.database.outbox.where("workspace").equals(mode).delete();
        await this.database.conflicts.delete(mode);
        await this.writeWorkspace({
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
    await verifyBackupIntegrity(backup);
    const sourceKey = await backupFingerprint(text);
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
      [
        ...this.database.workspaceTables(),
        this.database.receipts,
        this.database.conflicts,
        this.database.recoveries,
        this.database.migrations,
        this.database.migrationReviews,
      ],
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
        if (!preservesArchitecture(current.ledger, ledger))
          throw new Error("architecture_data_would_be_lost");
        if (!preservesRemovalHistory(current.ledger, ledger))
          throw new Error("removal_history_would_be_lost");
        if (!preservesPaymentPurposes(current.ledger, ledger))
          throw new Error("payment_purpose_would_be_lost");
        if (!preservesContractHistory(current.ledger, ledger))
          throw new Error("contract_history_would_be_lost");
        if (!preservesWorkHistory(current.ledger, ledger))
          throw new Error("work_history_would_be_lost");
        if (!preservesPersonWorkLinks(current.ledger, ledger))
          throw new Error("person_work_links_would_be_lost");
        if (!preservesContactTypes(current.ledger, ledger))
          throw new Error("contact_type_would_be_lost");
        if (!preservesMcpProvenance(current.ledger, ledger))
          throw new Error("mcp_provenance_would_be_lost");
        if (!preservesBalanceAdjustments(current.ledger, ledger))
          throw new Error("balance_adjustment_would_be_lost");
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
        await this.storeMigrationReviews(
          backup.migrationReviews ?? [],
          mode,
          sourceKey,
        );
        if (sameBackupLedger(current.ledger, ledger) && !prepared.length)
          return { changed: false };
        await this.recordIncomingMigration(
          backup.ledger,
          current,
          "backup",
          sourceKey,
          backup.receipts.map((receipt) => ({
            ...receipt,
            key: receiptKey(mode, receipt.id),
            workspace: mode,
            blob: base64ToBlob(receipt.base64, receipt.mime),
            uploadedFor: null,
          })),
        );
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
        await this.writeWorkspace({
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
  const raw = JSON.parse(text);
  const backup = BackupSchema.parse(raw);
  if (hasRetiredWorkMetadata(raw.ledger)) {
    originalBackupLedgers.set(backup, {
      before: JSON.stringify(ledgerBeforeWorkMetadataRemoval(raw.ledger)),
      after: JSON.stringify(backup.ledger),
    });
  }
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
    listDraftKeys: async () => {
      checkAccount();
      const rows = await database.drafts
        .where("workspace")
        .equals(mode)
        .toArray();
      const prefix = `${mode}:`;
      const keys = rows
        .map((row) =>
          z
            .string()
            .min(prefix.length + 1)
            .max(1000)
            .parse(row.id),
        )
        .filter((id) => id.startsWith(prefix))
        .map((id) => id.slice(prefix.length));
      checkAccount();
      return keys;
    },
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
