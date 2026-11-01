import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { createDemoLedger, createEmptyLedger } from "../domain/demo";
import { validateLedger, type Ledger } from "../domain/model";
import { synchronizeWorkspace, type CloudTransport } from "./sync";
import {
  getAccountDatabase,
  getWorkspaceDatabase,
  setActiveOwner,
  type LedgerDatabase,
} from "./database";
import {
  createWorkspaceStorage,
  getScopedRepository,
  getReceipt,
  readDraft,
  saveDraft,
  saveLedger,
} from "./repository";

const databases: LedgerDatabase[] = [];
const account = () => {
  const id = crypto.randomUUID();
  databases.push(getAccountDatabase(id));
  return id;
};
afterEach(async () => {
  setActiveOwner(null);
  for (const database of databases.splice(0)) await database.delete();
});

describe("local account isolation", () => {
  it("keeps ledger, voucher, draft, outbox and backup recovery private to each account", async () => {
    const first = account();
    const second = account();
    setActiveOwner(first);
    const firstRepo = getScopedRepository();
    await firstRepo.ensure("real", createEmptyLedger());
    const file = new Blob(["owner voucher"], { type: "image/png" });
    const ledger = validateLedger({
      ...createEmptyLedger(),
      works: [{ id: "w", name: "Private work" }],
      entries: [
        {
          id: "e",
          kind: "expense",
          lines: [{ id: "l", workId: "w", amount: 150000 }],
          receipts: [
            {
              id: "receipt",
              name: "receipt.png",
              mime: "image/png",
              size: file.size,
            },
          ],
        },
      ],
    });
    await saveLedger(ledger, "real", [{ id: "receipt", entryId: "e", file }]);
    await saveDraft("entry", { note: "private draft" });
    const backup = await firstRepo.exportBackup();
    await firstRepo.importBackup(backup, { replace: true });
    await firstRepo.database.outbox.put({
      id: "operation",
      workspace: "real",
      ownerId: first,
      generation: 1,
      baseRevision: 0,
      ledger,
      createdAt: new Date().toISOString(),
    });
    setActiveOwner(second);
    const secondRepo = getScopedRepository();
    await secondRepo.ensure("real", createEmptyLedger());
    expect(secondRepo.database.name).not.toBe(firstRepo.database.name);
    expect((await secondRepo.read())?.ledger.entries).toHaveLength(0);
    expect(await getReceipt("receipt")).toBeNull();
    expect(await readDraft("entry")).toBeNull();
    expect(await secondRepo.database.outbox.count()).toBe(0);
    expect(await secondRepo.database.recoveries.count()).toBe(0);
    expect(
      JSON.parse(await secondRepo.exportBackup()).ledger.works,
    ).toHaveLength(0);
    setActiveOwner(first);
    expect((await getScopedRepository().read())?.ledger.entries).toHaveLength(
      1,
    );
    expect(await readDraft("entry")).toEqual({ note: "private draft" });
    expect(await firstRepo.database.recoveries.count()).toBe(1);
    expect(await firstRepo.database.outbox.count()).toBe(1);
  });

  it("finishes an operation against its captured database after an account switch", async () => {
    const first = account();
    const second = account();
    setActiveOwner(first);
    const firstRepo = getScopedRepository();
    await firstRepo.ensure("real", createEmptyLedger());
    const saving = saveLedger((ledger) =>
      validateLedger({
        ...ledger,
        project: { ...ledger.project, name: "First owner" },
      }),
    );
    const draftSaving = saveDraft("pending", { note: "first owner" });
    setActiveOwner(second);
    const secondRepo = getScopedRepository();
    await secondRepo.ensure("real", createEmptyLedger());
    await Promise.all([saving, draftSaving]);
    expect((await firstRepo.read())?.ledger.project.name).toBe("First owner");
    expect((await secondRepo.read())?.ledger.project.name).not.toBe(
      "First owner",
    );
    expect(await readDraft("pending")).toBeNull();
    setActiveOwner(null);
    expect(() => getScopedRepository()).toThrow("authentication_required");
    expect(() => getWorkspaceDatabase("real")).toThrow(
      "authentication_required",
    );
    expect((await firstRepo.read())?.ledger.project.name).toBe("First owner");
  });

  it("keeps a form's later cleanup bound to its original account", async () => {
    const first = account();
    const second = account();
    setActiveOwner(first);
    const storage = createWorkspaceStorage();
    await storage.saveDraft("entry", { note: "first" });
    setActiveOwner(second);
    await saveDraft("entry", { note: "second" });
    await storage.removeDraft("entry");
    expect(await storage.readDraft("entry")).toBeNull();
    expect(await readDraft("entry")).toEqual({ note: "second" });
  });

  it("does not return a pending export or voucher after the account changes", async () => {
    const first = account();
    const second = account();
    setActiveOwner(first);
    await getScopedRepository().ensure("real", createEmptyLedger());
    const storage = createWorkspaceStorage();
    const exporting = storage.exportBackup();
    const receipt = storage.getReceipt("missing");
    setActiveOwner(second);
    await Promise.all([
      expect(exporting).rejects.toThrow("account_changed"),
      expect(receipt).rejects.toThrow("account_changed"),
    ]);
  });

  it("keeps an in-flight cloud sync bound to its original owner's database", async () => {
    const first = account();
    const second = account();
    const documents = new Map<string, Ledger>();
    const revisions = new Map<string, number>();
    let release!: () => void;
    let notifyStarted!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    let firstRead = true;
    const transport = (ownerId: string): CloudTransport => ({
      ownerId,
      load: async () => {
        if (ownerId === first && firstRead) {
          firstRead = false;
          notifyStarted();
          await paused;
        }
        return {
          document: documents.get(ownerId) ?? null,
          revision: revisions.get(ownerId) ?? 0,
          updatedAt: null,
        };
      },
      save: async (operation) => {
        expect(operation.ownerId).toBe(ownerId);
        documents.set(ownerId, structuredClone(operation.ledger));
        const revision = (revisions.get(ownerId) ?? 0) + 1;
        revisions.set(ownerId, revision);
        return {
          status: "saved",
          revision,
          updatedAt: new Date().toISOString(),
        };
      },
    });
    setActiveOwner(first);
    const firstRepo = getScopedRepository();
    await firstRepo.ensure("real", createEmptyLedger());
    await firstRepo.save((ledger) =>
      validateLedger({
        ...ledger,
        project: { ...ledger.project, name: "First account" },
      }),
    );
    const firstSync = synchronizeWorkspace(transport(first), firstRepo);
    await started;
    setActiveOwner(second);
    const secondRepo = getScopedRepository();
    await secondRepo.ensure("real", createEmptyLedger());
    await secondRepo.save((ledger) =>
      validateLedger({
        ...ledger,
        project: { ...ledger.project, name: "Second account" },
      }),
    );
    await synchronizeWorkspace(transport(second), secondRepo);
    release();
    await firstSync;
    expect(documents.get(first)?.project.name).toBe("First account");
    expect(documents.get(second)?.project.name).toBe("Second account");
    expect((await firstRepo.read())?.ownerId).toBe(first);
    expect((await secondRepo.read())?.ownerId).toBe(second);
    expect((await secondRepo.read())?.ledger.project.name).toBe(
      "Second account",
    );
    expect(await firstRepo.database.outbox.count()).toBe(0);
    expect(await secondRepo.database.outbox.count()).toBe(0);
  });

  it("keeps the public sample independent from private accounts", async () => {
    const demoRepo = getScopedRepository("demo");
    await demoRepo.ensure("demo", createDemoLedger());
    const name = (await demoRepo.read("demo"))!.ledger.project.name;
    setActiveOwner(account());
    const real = getScopedRepository();
    await real.ensure("real", createEmptyLedger());
    await real.save((ledger) =>
      validateLedger({
        ...ledger,
        project: { ...ledger.project, name: "Private" },
      }),
    );
    expect((await demoRepo.read("demo"))?.ledger.project.name).toBe(name);
  });
});
