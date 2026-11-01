import { useCallback, useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { createDemoLedger, createEmptyLedger } from "../domain/demo";
import {
  getActiveOwner,
  getWorkspaceDatabase,
  type WorkspaceMode,
} from "./database";
import {
  LedgerRepository,
  type LedgerChange,
  type ReceiptInput,
} from "./repository";
import { syncLedger, type SyncResult } from "./sync";

export function useLedger(mode: WorkspaceMode) {
  const ownerId = getActiveOwner();
  const database = useMemo(() => getWorkspaceDatabase(mode), [mode, ownerId]);
  const repository = useMemo(() => new LedgerRepository(database), [database]);
  const [initError, setInitError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  const state = useLiveQuery(async () => {
    try {
      return { row: await repository.read(mode), error: null };
    } catch {
      return { row: null, error: "local_data_invalid" };
    }
  }, [mode, repository]);
  const conflict = useLiveQuery(
    () => (mode === "real" ? database.conflicts.get("real") : undefined),
    [mode, database],
  );

  useEffect(() => {
    let alive = true;
    setInitError(null);
    repository
      .ensure(mode, mode === "demo" ? createDemoLedger() : createEmptyLedger())
      .catch(() => {
        if (alive) setInitError("local_data_unavailable");
      });
    if (typeof navigator !== "undefined" && navigator.storage?.persist)
      void navigator.storage.persist().catch(() => {});
    return () => {
      alive = false;
    };
  }, [mode, repository]);

  const sync = useCallback(async () => {
    if (mode === "demo") return { status: "local-only" } as SyncResult;
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await syncLedger(repository);
      setSyncResult(result);
      return result;
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "sync_failed");
      throw error;
    } finally {
      setSyncing(false);
    }
  }, [mode, repository]);

  useEffect(() => {
    if (mode !== "real" || !state?.row) return;
    const attempt = () => {
      if (document.visibilityState === "visible") void sync().catch(() => {});
    };
    attempt();
    window.addEventListener("online", attempt);
    document.addEventListener("visibilitychange", attempt);
    return () => {
      window.removeEventListener("online", attempt);
      document.removeEventListener("visibilitychange", attempt);
    };
  }, [mode, Boolean(state?.row), sync]);

  const save = useCallback(
    async (change: LedgerChange, files: ReceiptInput[] = []) => {
      await repository.save(change, mode, files);
      if (mode === "real") void sync().catch(() => {});
    },
    [mode, repository, sync],
  );

  return {
    ledger:
      mode === "real" && state?.row?.ownerId !== ownerId
        ? null
        : (state?.row?.ledger ?? null),
    loading: !initError && !state?.error && !state?.row,
    error: initError ?? state?.error ?? null,
    save,
    pending: state?.row?.pending ?? false,
    lastSyncedAt: state?.row?.lastSyncedAt ?? null,
    syncing,
    syncError,
    syncResult,
    sync,
    conflict: conflict ?? null,
  };
}
