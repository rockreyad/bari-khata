import "fake-indexeddb/auto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEmptyLedger } from "../domain/demo";

const api = vi.hoisted(() => ({
  createClient: vi.fn(),
  rpc: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: api.createClient }));
const owner = "22222222-2222-4222-8222-222222222222";
let database: import("./database").LedgerDatabase;
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.test");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public-test-key");
  vi.stubGlobal("navigator", { onLine: true });
  api.createClient.mockReset();
  api.rpc.mockReset();
  api.getSession.mockReset().mockResolvedValue({
    data: { session: { user: { id: owner }, access_token: "test-session" } },
    error: null,
  });
  api.createClient.mockReturnValue({
    rpc: api.rpc,
    auth: { getSession: api.getSession },
  });
  const data = await import("./database");
  data.setActiveOwner(owner);
  database = data.getAccountDatabase(owner);
});
afterEach(async () => {
  (await import("../lib/localWriteBarrier")).setFinancialWritesAllowed(true);
  (await import("./database")).setActiveOwner(null);
  await database.delete();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("sends the built version from both browser Supabase clients", async () => {
  const { APP_VERSION } = await import("../lib/appVersion");
  const { LedgerRepository } = await import("./repository");
  const { getCloudClient, syncLedger } = await import("./sync");
  const repo = new LedgerRepository(database);
  await repo.ensure("real", createEmptyLedger());
  api.rpc.mockResolvedValue({
    data: { revision: 0, document: null, updatedAt: null },
    error: null,
  });
  getCloudClient();
  await syncLedger(repo);
  expect(api.createClient).toHaveBeenCalledTimes(2);
  for (const call of api.createClient.mock.calls)
    expect(call[2].global.headers["x-bari-client-version"]).toBe(APP_VERSION);
  expect(api.createClient.mock.calls[1][2].global.headers.Authorization).toBe(
    "Bearer test-session",
  );
});

it("preserves the frozen outbox and local ledger on PT426, then blocks further financial commits", async () => {
  const { LedgerRepository } = await import("./repository");
  const { createTransport, synchronizeWorkspace } = await import("./sync");
  const { getReleaseState } = await import("../lib/releasePolicy");
  const repo = new LedgerRepository(database);
  await repo.ensure("real", createEmptyLedger());
  await repo.save((ledger) => ({
    ...ledger,
    project: { ...ledger.project, name: "ফোনের হিসাব" },
  }));
  api.rpc.mockImplementation(async (name: string) =>
    name === "load_ledger_snapshot"
      ? { data: { revision: 0, document: null, updatedAt: null }, error: null }
      : {
          data: null,
          error: {
            code: "PT426",
            message: "client_update_required",
            details: '{"minimumSupportedVersion":"0.1.5"}',
          },
        },
  );
  const transport = createTransport(
    { rpc: api.rpc } as unknown as SupabaseClient,
    owner,
  );
  await expect(synchronizeWorkspace(transport, repo)).rejects.toThrow(
    "client_update_required",
  );
  expect(getReleaseState().required).toBe(true);
  expect((await repo.read())?.ledger.project.name).toBe("ফোনের হিসাব");
  expect((await repo.read())?.pending).toBe(true);
  const outbox = await database.outbox.toArray();
  expect(outbox).toHaveLength(1);
  await expect(synchronizeWorkspace(transport, repo)).rejects.toThrow(
    "client_update_required",
  );
  expect(await database.outbox.toArray()).toEqual(outbox);
});

it("keeps reads, exports and drafts available while save, restore, merge and conflict choice are blocked", async () => {
  const { LedgerRepository, createWorkspaceStorage } =
    await import("./repository");
  const { resolveCloudConflict } = await import("./sync");
  const { setFinancialWritesAllowed } =
    await import("../lib/localWriteBarrier");
  const repo = new LedgerRepository(database);
  const ledger = createEmptyLedger();
  await repo.ensure("real", ledger);
  await repo.save(ledger);
  const backup = await repo.exportBackup();
  const row = (await repo.read())!;
  await database.conflicts.put({
    id: "real",
    ownerId: owner,
    revision: 2,
    ledger,
    updatedAt: new Date().toISOString(),
  });
  await database.outbox.put({
    id: crypto.randomUUID(),
    workspace: "real",
    ownerId: owner,
    baseRevision: 0,
    generation: row.generation,
    ledger,
    createdAt: new Date().toISOString(),
  });
  const frozen = await database.outbox.toArray();
  setFinancialWritesAllowed(false);
  await expect(repo.save(ledger)).rejects.toThrow("client_update_required");
  await expect(repo.importBackup(backup, { replace: true })).rejects.toThrow(
    "client_update_required",
  );
  await expect(
    repo.mergeBackup(backup, {
      confirmed: true,
      expectedLedger: ledger,
      decisions: {},
      at: new Date().toISOString(),
    }),
  ).rejects.toThrow("client_update_required");
  await expect(
    repo.rollbackArchitectureMigration("any", {
      ledger,
      generation: row.generation,
    }),
  ).rejects.toThrow("client_update_required");
  await expect(resolveCloudConflict("use-cloud")).rejects.toThrow(
    "client_update_required",
  );
  expect(await repo.read()).toEqual(row);
  expect(await database.outbox.toArray()).toEqual(frozen);
  expect(await database.conflicts.count()).toBe(1);
  await expect(repo.exportBackup()).resolves.toBeTypeOf("string");
  const storage = createWorkspaceStorage();
  await storage.saveDraft("entry", { text: "অসমাপ্ত লেখা" });
  expect(await storage.readDraft("entry")).toEqual({ text: "অসমাপ্ত লেখা" });
  await storage.removeDraft("entry");
});

it("waits for a conflict's local commit without waiting for its subsequent cloud request", async () => {
  const { LedgerRepository } = await import("./repository");
  const { resolveCloudConflict } = await import("./sync");
  const { waitForLocalWrites } = await import("../lib/localWriteBarrier");
  const repo = new LedgerRepository(database);
  const ledger = createEmptyLedger();
  await repo.ensure("real", ledger);
  await database.conflicts.put({
    id: "real",
    ownerId: owner,
    revision: 2,
    ledger,
    updatedAt: new Date().toISOString(),
  });
  const session = {
    data: { session: { user: { id: owner }, access_token: "test-session" } },
    error: null,
  };
  let finishSync!: (value: typeof session) => void;
  api.getSession
    .mockReset()
    .mockResolvedValueOnce(session)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSync = resolve;
        }),
    );
  api.rpc.mockImplementation(async (name: string) =>
    name === "load_ledger_snapshot"
      ? {
          data: {
            revision: 2,
            document: ledger,
            updatedAt: new Date().toISOString(),
          },
          error: null,
        }
      : {
          data: {
            status: "saved",
            revision: 3,
            updatedAt: new Date().toISOString(),
          },
          error: null,
        },
  );
  const syncing = resolveCloudConflict("keep-local");
  await vi.waitFor(() => expect(finishSync).toBeTypeOf("function"));
  expect(await database.conflicts.count()).toBe(0);
  await expect(waitForLocalWrites()).resolves.toBeUndefined();
  finishSync(session);
  await expect(syncing).resolves.toHaveProperty("status");
});
