import {
  createClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { z } from "zod";
import { AUTH_STORAGE_KEY, lockAccount } from "./authSession";
import type { Ledger } from "../domain/model";
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

function createTransport(
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
      const result = await cloud.storage
        .from("bari-receipts")
        .upload(`${ownerId}/${receipt.id}`, receipt.blob, {
          contentType: receipt.mime,
          upsert: true,
        });
      if (result.error) throw new Error("receipt_sync_failed");
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
    if (cloud.revision !== row.cloudRevision) {
      if (row.pending || (row.generation > 0 && row.cloudRevision === 0)) {
        await recordConflict(repo, transport, cloud);
        return { status: "conflict" };
      }
      if (cloud.document) {
        const document = validateLedger(cloud.document);
        await repo.database.transaction(
          "rw",
          repo.database.workspaces,
          async () => {
            const current = await repo.read("real");
            if (!current) throw new Error("workspace_missing");
            if (current.generation !== row!.generation || current.pending)
              throw new Error("local_changed_during_sync");
            await repo.database.workspaces.put({
              ...current,
              ledger: document,
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
        repo.database.workspaces,
        repo.database.outbox,
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
      repo.database.workspaces,
      repo.database.outbox,
      repo.database.conflicts,
      async () => {
        const current = await repo.read("real");
        if (!current) throw new Error("workspace_missing");
        await repo.database.workspaces.put({
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
  if (confirmed.revision !== latest.cloudRevision) {
    if (latest.pending) {
      await recordConflict(repo, transport, confirmed);
      return { status: "conflict" };
    }
    if (!confirmed.document || confirmed.document.isDemo)
      throw new Error("invalid_cloud_document");
    const document = validateLedger(confirmed.document);
    const generation = latest.generation;
    await repo.database.transaction(
      "rw",
      repo.database.workspaces,
      async () => {
        const current = await repo.read("real");
        if (!current || current.generation !== generation || current.pending)
          throw new Error("local_changed_during_sync");
        await repo.database.workspaces.put({
          ...current,
          ledger: document,
          cloudRevision: confirmed.revision,
          ownerId: transport.ownerId,
          lastSyncedAt: confirmed.updatedAt,
          updatedAt: new Date().toISOString(),
        });
      },
    );
    latest = (await repo.read("real"))!;
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
    db.workspaces,
    db.conflicts,
    db.outbox,
    db.recoveries,
    db.receipts,
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
      await db.workspaces.put({
        ...current,
        ledger:
          choice === "use-cloud"
            ? validateLedger(conflict.ledger)
            : current.ledger,
        cloudRevision: conflict.revision,
        ownerId: session.user.id,
        pending: choice === "keep-local",
        generation: current.generation + 1,
        updatedAt: new Date().toISOString(),
      });
      await db.outbox.where("workspace").equals("real").delete();
      await db.conflicts.delete("real");
    },
  );
  return syncLedger(repository);
}
