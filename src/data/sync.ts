import {
  createClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { z } from "zod";
import { AUTH_STORAGE_KEY, lockAccount } from "./authSession";
import type { Ledger } from "../domain/model";
import { preservesArchitecture } from "../domain/architectureMigration";
import { preservesRemovalHistory } from "../domain/entityDeletion";
import { preservesContractHistory } from "../domain/contracts";
import { preservesWorkHistory } from "../domain/workActivity";
import { preservesPersonWorkLinks } from "../domain/personWorkLinks";
import { preservesContactTypes } from "../domain/contactTypes";
import { preservesMcpProvenance } from "../domain/mcpProvenance.js";
import { preservesBalanceAdjustments } from "../domain/adjustmentHistory.js";
import {
  getActiveOwner,
  receiptKey,
  type OutboxRow,
  type ReceiptRow,
} from "./database";
import {
  LedgerRepository,
  receiptReferences,
  getScopedRepository,
  validateLedger,
} from "./repository";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const isCloudConfigured = Boolean(
  url && key && !key.startsWith("sb_secret_"),
);
let client: SupabaseClient | null = null;

export function getCloudClient(): SupabaseClient | null {
  if (!isCloudConfigured) return null;
  client ??= createClient(url!, key!, {
    auth: {
      persistSession: true,
      storageKey: AUTH_STORAGE_KEY,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}

export async function signIn(email: string, password: string): Promise<void> {
  const cloud = getCloudClient();
  if (!cloud) throw new Error("cloud_not_configured");
  const result = await cloud.auth.signInWithPassword({ email, password });
  if (result.error)
    throw new Error(
      result.error.code === "email_not_confirmed"
        ? "email_not_confirmed"
        : "sign_in_failed",
    );
}

export async function signOut(): Promise<void> {
  lockAccount();
  const result = await getCloudClient()?.auth.signOut({ scope: "local" });
  if (result?.error) throw new Error("sign_out_failed");
}

export async function getCloudSession(): Promise<Session | null> {
  const ownerId = getActiveOwner();
  if (!ownerId) return null;
  const result = await getCloudClient()?.auth.getSession();
  if (result?.error) throw new Error("sign_in_required");
  const session = result?.data.session ?? null;
  if (session && session.user.id !== ownerId) throw new Error("owner_mismatch");
  return session;
}

export type CloudSnapshot = {
  revision: number;
  document: Ledger | null;
  updatedAt: string | null;
};
export type SaveResult =
  | { status: "saved"; revision: number; updatedAt: string }
  | {
      status: "conflict";
      revision: number;
      document: Ledger;
      updatedAt: string | null;
    };

export type CloudTransport = {
  ownerId: string;
  load: () => Promise<CloudSnapshot>;
  save: (operation: OutboxRow) => Promise<SaveResult>;
  uploadReceipt?: (receipt: ReceiptRow) => Promise<void>;
  downloadReceipt?: (id: string) => Promise<Blob>;
};

export type SyncResult = {
  status: "synced" | "conflict" | "local-only" | "offline" | "sign-in-required";
  pendingReceipts?: number;
};

const SnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  document: z.unknown().nullable(),
  updatedAt: z.string().nullable(),
});

export function createTransport(
  cloud: SupabaseClient,
  ownerId: string,
): CloudTransport {
  return {
    ownerId,
    async load() {
      const result = await cloud.rpc("load_ledger_snapshot");
      if (result.error) throw new Error("sync_failed");
      const parsed = SnapshotSchema.parse(result.data);
      return {
        ...parsed,
        document:
          parsed.document === null ? null : validateLedger(parsed.document),
      };
    },
    async save(operation) {
      const result = await cloud.rpc("save_ledger_snapshot", {
        p_request_id: operation.id,
        p_expected_revision: operation.baseRevision,
        p_document: operation.ledger,
      });
      if (result.error) throw new Error("sync_failed");
      const saved = z
        .object({
          status: z.enum(["saved", "conflict"]),
          revision: z.number().int().nonnegative(),
          updatedAt: z.string().nullable(),
          document: z.unknown().optional(),
        })
        .parse(result.data);
      if (saved.status === "conflict")
        return {
          status: "conflict",
          revision: saved.revision,
          document: validateLedger(saved.document),
          updatedAt: saved.updatedAt,
        };
      if (!saved.updatedAt) throw new Error("invalid_sync_response");
      return {
        status: "saved",
        revision: saved.revision,
        updatedAt: saved.updatedAt,
      };
    },
    async uploadReceipt(receipt) {
      const path = `${ownerId}/${receipt.id}`;
      const result = await cloud.storage
        .from("bari-receipts")
        .upload(path, receipt.blob, {
          contentType: receipt.mime,
          upsert: false,
        });
      if (!result.error) return;
      const existing = await cloud.storage.from("bari-receipts").download(path);
      if (
        existing.error ||
        !existing.data ||
        existing.data.size !== receipt.blob.size ||
        existing.data.type !== receipt.mime
      )
        throw new Error("receipt_sync_failed");
      const original = new Uint8Array(await existing.data.arrayBuffer());
      const local = new Uint8Array(await receipt.blob.arrayBuffer());
      if (original.some((byte, index) => byte !== local[index]))
        throw new Error("receipt_sync_failed");
    },
    async downloadReceipt(id) {
      const result = await cloud.storage
        .from("bari-receipts")
        .download(`${ownerId}/${id}`);
      if (result.error || !result.data)
        throw new Error("receipt_download_failed");
      return result.data;
    },
  };
}

function isEmptyArchitecture(ledger: Ledger) {
  return ![
    ledger.works,
    ledger.people,
    ledger.items,
    ledger.materialGroups,
    ledger.paymentPurposes,
    ledger.contracts,
    ledger.entries,
    ledger.milestones ?? [],
    ledger.paymentAllocations ?? [],
  ].some((records) => records.length);
}

async function recordConflict(
  repo: LedgerRepository,
  transport: CloudTransport,
  snapshot: CloudSnapshot,
) {
  if (!snapshot.document) throw new Error("invalid_cloud_document");
  const document = validateLedger(snapshot.document);
  if (document.isDemo) throw new Error("workspace_mode_mismatch");
  await repo.database.conflicts.put({
    id: "real",
    ledger: document,
    revision: snapshot.revision,
    ownerId: transport.ownerId,
    updatedAt: snapshot.updatedAt ?? new Date().toISOString(),
  });
}

export async function synchronizeWorkspace(
  transport: CloudTransport,
  repo = getScopedRepository("real"),
): Promise<SyncResult> {
  let row = await repo.read("real");
  if (!row) throw new Error("workspace_missing");
  if (row.ownerId && row.ownerId !== transport.ownerId)
    throw new Error("owner_mismatch");

  // Retry a frozen request before pulling: the server may have saved it before a dropped response.
  let frozen = await repo.database.outbox
    .where("workspace")
    .equals("real")
    .first();
  if (frozen && frozen.ownerId !== transport.ownerId)
    throw new Error("owner_mismatch");
  if (!frozen) {
    const cloud = await transport.load();
    if (cloud.document?.isDemo) throw new Error("workspace_mode_mismatch");
    if (cloud.revision < row.cloudRevision) {
      if (!cloud.document) throw new Error("cloud_revision_regressed");
      await recordConflict(repo, transport, cloud);
      return { status: "conflict" };
    }
    if (cloud.revision !== row.cloudRevision) {
      if (row.pending || (row.generation > 0 && row.cloudRevision === 0)) {
        await recordConflict(repo, transport, cloud);
        return { status: "conflict" };
      }
      if (cloud.document) {
        const document = validateLedger(cloud.document);
        if (
          (!isEmptyArchitecture(row.ledger) &&
            !preservesArchitecture(row.ledger, document)) ||
          !preservesContractHistory(row.ledger, document) ||
          !preservesWorkHistory(row.ledger, document) ||
          !preservesPersonWorkLinks(row.ledger, document) ||
          !preservesContactTypes(row.ledger, document) ||
          !preservesMcpProvenance(row.ledger, document) ||
          !preservesBalanceAdjustments(row.ledger, document) ||
          !preservesRemovalHistory(row.ledger, document)
        ) {
          await recordConflict(repo, transport, cloud);
          return { status: "conflict" };
        }
        await repo.database.transaction(
          "rw",
          [
            ...repo.database.workspaceTables(),
            repo.database.migrations,
            repo.database.receipts,
          ],
          async () => {
            const current = await repo.read("real");
            if (!current) throw new Error("workspace_missing");
            if (current.generation !== row!.generation || current.pending)
              throw new Error("local_changed_during_sync");
            const migration = await repo.recordIncomingMigration(
              document,
              current,
              "cloud",
              String(cloud.revision),
            );
            await repo.writeWorkspace({
              ...current,
              ledger: migration.ledger,
              generation: current.generation + (migration.changed ? 1 : 0),
              pending: migration.changed,
              ownerId: transport.ownerId,
              cloudRevision: cloud.revision,
              lastSyncedAt: cloud.updatedAt,
              updatedAt: new Date().toISOString(),
            });
          },
        );
      }
    }
    row = (await repo.read("real"))!;
  }

  for (let round = 0; round < 12; round++) {
    if (!frozen) {
      frozen = await repo.database.transaction(
        "rw",
        [...repo.database.workspaceTables(), repo.database.outbox],
        async () => {
          const current = await repo.read("real");
          if (!current?.pending) return undefined;
          const queued: OutboxRow = {
            id: crypto.randomUUID(),
            workspace: "real",
            ownerId: transport.ownerId,
            generation: current.generation,
            baseRevision: current.cloudRevision,
            ledger: current.ledger,
            createdAt: new Date().toISOString(),
          };
          await repo.database.outbox.add(queued);
          return queued;
        },
      );
    }
    if (!frozen) break;
    validateLedger(frozen.ledger);
    const response = await transport.save(frozen);
    if (response.status === "conflict") {
      await recordConflict(repo, transport, response);
      return { status: "conflict" };
    }
    const sent = frozen;
    await repo.database.transaction(
      "rw",
      [
        ...repo.database.workspaceTables(),
        repo.database.outbox,
        repo.database.conflicts,
      ],
      async () => {
        const current = await repo.read("real");
        if (!current) throw new Error("workspace_missing");
        await repo.writeWorkspace({
          ...current,
          cloudRevision: response.revision,
          ownerId: transport.ownerId,
          pending: current.generation !== sent.generation,
          lastSyncedAt: response.updatedAt,
        });
        await repo.database.outbox.delete(sent.id);
        await repo.database.conflicts.delete("real");
      },
    );
    frozen = undefined;
  }

  let latest = (await repo.read("real"))!;
  const confirmed = await transport.load();
  if (confirmed.revision < latest.cloudRevision) {
    if (!confirmed.document) throw new Error("cloud_revision_regressed");
    await recordConflict(repo, transport, confirmed);
    return { status: "conflict" };
  }
  if (confirmed.revision !== latest.cloudRevision) {
    if (latest.pending) {
      await recordConflict(repo, transport, confirmed);
      return { status: "conflict" };
    }
    if (!confirmed.document || confirmed.document.isDemo)
      throw new Error("invalid_cloud_document");
    const document = validateLedger(confirmed.document);
    if (
      (!isEmptyArchitecture(latest.ledger) &&
        !preservesArchitecture(latest.ledger, document)) ||
      !preservesContractHistory(latest.ledger, document) ||
      !preservesWorkHistory(latest.ledger, document) ||
      !preservesPersonWorkLinks(latest.ledger, document) ||
      !preservesContactTypes(latest.ledger, document) ||
      !preservesMcpProvenance(latest.ledger, document) ||
      !preservesBalanceAdjustments(latest.ledger, document) ||
      !preservesRemovalHistory(latest.ledger, document)
    ) {
      await recordConflict(repo, transport, confirmed);
      return { status: "conflict" };
    }
    const generation = latest.generation;
    await repo.database.transaction(
      "rw",
      [
        ...repo.database.workspaceTables(),
        repo.database.migrations,
        repo.database.receipts,
      ],
      async () => {
        const current = await repo.read("real");
        if (!current || current.generation !== generation || current.pending)
          throw new Error("local_changed_during_sync");
        const migration = await repo.recordIncomingMigration(
          document,
          current,
          "cloud",
          String(confirmed.revision),
        );
        await repo.writeWorkspace({
          ...current,
          ledger: migration.ledger,
          generation: current.generation + (migration.changed ? 1 : 0),
          pending: migration.changed,
          cloudRevision: confirmed.revision,
          ownerId: transport.ownerId,
          lastSyncedAt: confirmed.updatedAt,
          updatedAt: new Date().toISOString(),
        });
      },
    );
    latest = (await repo.read("real"))!;
    if (latest.pending) return synchronizeWorkspace(transport, repo);
  }
  if (!latest.ownerId)
    await repo.database.workspaces.update("real", {
      ownerId: transport.ownerId,
    });
  let pendingReceipts = 0;
  for (const ref of receiptReferences(latest.ledger)) {
    const receipt = await repo.getReceipt(ref.id, "real");
    if (
      receipt &&
      receipt.uploadedFor !== transport.ownerId &&
      transport.uploadReceipt
    ) {
      try {
        await transport.uploadReceipt(receipt);
        await repo.database.receipts.update(receipt.key, {
          uploadedFor: transport.ownerId,
        });
      } catch {
        pendingReceipts++;
      }
    } else if (!receipt && transport.downloadReceipt) {
      try {
        const blob = await transport.downloadReceipt(ref.id);
        if (blob.size !== ref.size || blob.type !== ref.mime)
          throw new Error("receipt_metadata_mismatch");
        await repo.database.receipts.put({
          key: receiptKey("real", ref.id),
          id: ref.id,
          workspace: "real",
          entryId: ref.entryId,
          name: ref.name,
          mime: ref.mime,
          blob,
          createdAt: new Date().toISOString(),
          uploadedFor: transport.ownerId,
        });
      } catch {
        pendingReceipts++;
      }
    }
  }
  return { status: "synced", pendingReceipts };
}

const running = new Map<string, Promise<SyncResult>>();
export async function syncLedger(
  scopedRepository?: LedgerRepository,
): Promise<SyncResult> {
  if (!isCloudConfigured) return { status: "local-only" };
  if (typeof navigator !== "undefined" && !navigator.onLine)
    return { status: "offline" };
  const repo = scopedRepository ?? getScopedRepository("real");
  const session = await getCloudSession();
  if (!session) return { status: "sign-in-required" };
  if (repo.database.ownerId !== session.user.id)
    throw new Error("owner_mismatch");
  const runningKey = repo.database.name;
  const previous = running.get(runningKey);
  if (previous) return previous;
  const scoped = createClient(url!, key!, {
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const request = synchronizeWorkspace(
    createTransport(scoped, session.user.id),
    repo,
  );
  running.set(runningKey, request);
  try {
    return await request;
  } finally {
    running.delete(runningKey);
  }
}

export async function resolveCloudConflict(
  choice: "keep-local" | "use-cloud",
): Promise<SyncResult> {
  const repository = getScopedRepository("real");
  const session = await getCloudSession();
  if (!session) throw new Error("sign_in_required");
  const db = repository.database;
  if (db.ownerId !== session.user.id) throw new Error("owner_mismatch");
  await db.transaction(
    "rw",
    [
      ...db.workspaceTables(),
      db.conflicts,
      db.outbox,
      db.recoveries,
      db.receipts,
      db.migrations,
    ],
    async () => {
      const conflict = await db.conflicts.get("real");
      const current = await repository.read("real");
      if (!conflict || !current) throw new Error("conflict_missing");
      if (
        conflict.ownerId !== session.user.id ||
        (current.ownerId && current.ownerId !== session.user.id)
      )
        throw new Error("owner_mismatch");
      if (choice === "use-cloud")
        await db.recoveries.add({
          id: crypto.randomUUID(),
          workspace: "real",
          ledger: current.ledger,
          receipts: await db.receipts
            .where("workspace")
            .equals("real")
            .toArray(),
          reason: "cloud-conflict",
          createdAt: new Date().toISOString(),
        });
      const incoming =
        choice === "use-cloud"
          ? await repository.recordIncomingMigration(
              validateLedger(conflict.ledger),
              current,
              "cloud",
              String(conflict.revision),
            )
          : null;
      if (incoming && !preservesArchitecture(current.ledger, incoming.ledger))
        throw new Error("architecture_data_would_be_lost");
      await repository.writeWorkspace({
        ...current,
        ledger: incoming?.ledger ?? current.ledger,
        cloudRevision: conflict.revision,
        ownerId: session.user.id,
        pending: choice === "keep-local" || Boolean(incoming?.changed),
        generation: current.generation + 1,
        updatedAt: new Date().toISOString(),
      });
      await db.outbox.where("workspace").equals("real").delete();
      await db.conflicts.delete("real");
    },
  );
  return syncLedger(repository);
}
