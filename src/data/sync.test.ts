import { legacyArchitectureFixture } from "../domain/testing/legacyArchitecture";
import { migrateArchitecture } from "../domain/architectureMigration";
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyLedger } from "../domain/demo";
import { ContractSchema, validateLedger, type Ledger } from "../domain/model";
import { saveContractChange } from "../domain/contracts";
import { LedgerDatabase, type OutboxRow } from "./database";
import { LedgerRepository } from "./repository";
import {
  synchronizeWorkspace,
  type CloudSnapshot,
  type CloudTransport,
  type SaveResult,
} from "./sync";

const databases: LedgerDatabase[] = [];
async function makeRepository() {
  const database = new LedgerDatabase(`sync-test-${crypto.randomUUID()}`);
  databases.push(database);
  const repo = new LedgerRepository(database);
  await repo.ensure("real", createEmptyLedger());
  return repo;
}
afterEach(async () => {
  for (const database of databases.splice(0)) await database.delete();
});

function memoryCloud(
  initial: CloudSnapshot = { revision: 0, document: null, updatedAt: null },
) {
  let snapshot = initial;
  const operations = new Map<string, SaveResult>();
  let writes = 0;
  const transport: CloudTransport = {
    ownerId: "owner-one",
    load: async () => snapshot,
    async save(operation: OutboxRow) {
      const previous = operations.get(operation.id);
      if (previous) return previous;
      if (operation.baseRevision !== snapshot.revision)
        return {
          status: "conflict",
          revision: snapshot.revision,
          document: snapshot.document!,
          updatedAt: snapshot.updatedAt,
        };
      writes++;
      snapshot = {
        revision: snapshot.revision + 1,
        document: structuredClone(operation.ledger),
        updatedAt: new Date().toISOString(),
      };
      const result: SaveResult = {
        status: "saved",
        revision: snapshot.revision,
        updatedAt: snapshot.updatedAt!,
      };
      operations.set(operation.id, result);
      return result;
    },
  };
  return { transport, snapshot: () => snapshot, writes: () => writes };
}

describe("recoverable cloud synchronization", () => {
  it("retries a saved request after a dropped response without duplicates or a false conflict", async () => {
    const repo = await makeRepository();
    await repo.save((ledger) =>
      validateLedger({ ...ledger, works: [{ id: "tiles", name: "টাইলস" }] }),
    );
    const cloud = memoryCloud();
    const save = cloud.transport.save;
    let dropResponse = true;
    cloud.transport.save = async (operation) => {
      const result = await save(operation);
      if (dropResponse) {
        dropResponse = false;
        throw new Error("connection_lost");
      }
      return result;
    };
    await expect(synchronizeWorkspace(cloud.transport, repo)).rejects.toThrow(
      "connection_lost",
    );
    expect(await repo.database.outbox.count()).toBe(1);
    expect((await repo.read())?.pending).toBe(true);
    expect((await synchronizeWorkspace(cloud.transport, repo)).status).toBe(
      "synced",
    );
    expect(cloud.writes()).toBe(1);
    expect((await repo.read())?.pending).toBe(false);
    expect(await repo.database.outbox.count()).toBe(0);
  });

  it("keeps edits made during a request and sends a newer snapshot afterwards", async () => {
    const repo = await makeRepository();
    await repo.save((ledger) =>
      validateLedger({ ...ledger, works: [{ id: "first", name: "প্রথম" }] }),
    );
    const cloud = memoryCloud();
    const save = cloud.transport.save;
    let edit = true;
    cloud.transport.save = async (operation) => {
      if (edit) {
        edit = false;
        await repo.save((ledger) =>
          validateLedger({
            ...ledger,
            works: [...ledger.works, { id: "second", name: "দ্বিতীয়" }],
          }),
        );
      }
      return save(operation);
    };
    await synchronizeWorkspace(cloud.transport, repo);
    expect(cloud.writes()).toBe(2);
    expect(cloud.snapshot().document?.works).toHaveLength(2);
    expect((await repo.read())?.pending).toBe(false);
  });

  it("records an explicit conflict and preserves local edits", async () => {
    const repo = await makeRepository();
    await repo.save((ledger) =>
      validateLedger({
        ...ledger,
        project: { ...ledger.project, name: "ফোনের খাতা" },
      }),
    );
    const remote: Ledger = validateLedger({
      ...createEmptyLedger(),
      project: { id: "my-home", name: "অন্য ডিভাইস", currency: "BDT" },
    });
    const cloud = memoryCloud({
      revision: 3,
      document: remote,
      updatedAt: new Date().toISOString(),
    });
    expect((await synchronizeWorkspace(cloud.transport, repo)).status).toBe(
      "conflict",
    );
    expect((await repo.read())?.ledger.project.name).toBe("ফোনের খাতা");
    expect(
      (await repo.database.conflicts.get("real"))?.ledger.project.name,
    ).toBe("অন্য ডিভাইস");
    expect(cloud.writes()).toBe(0);
  });

  it("keeps corrupt or mismatched vouchers pending while syncing the remaining ones", async () => {
    const repo = await makeRepository();
    const file = new Blob(["%PDF-sample"], { type: "application/pdf" });
    const receipts = ["broken", "mismatched", "healthy"].map((id) => ({
      id,
      name: `${id}.pdf`,
      mime: file.type,
      size: file.size,
    }));
    await repo.save(
      (ledger) =>
        validateLedger({
          ...ledger,
          works: [{ id: "roof", name: "নমুনা ছাদ" }],
          entries: [
            {
              id: "bill",
              kind: "expense",
              lines: [
                { id: "line", workId: "roof", label: "নমুনা মাল", amount: 100 },
              ],
              receipts,
            },
          ],
        }),
      "real",
      receipts.map(({ id, name }) => ({ id, name, entryId: "bill", file })),
    );
    await repo.database.receipts.update("real:broken", {
      blob: new Blob(["sample"], { type: "text/html" }),
    });
    await repo.database.receipts.update("real:mismatched", {
      blob: new Blob(["short"], { type: file.type }),
    });
    const cloud = memoryCloud();
    const uploadReceipt = vi.fn();
    const downloadReceipt = vi.fn();
    const transport = { ...cloud.transport, uploadReceipt, downloadReceipt };
    await expect(synchronizeWorkspace(transport, repo)).resolves.toEqual({
      status: "synced",
      pendingReceipts: 2,
    });
    expect(uploadReceipt).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "healthy" }),
    );
    expect(downloadReceipt).not.toHaveBeenCalled();
    expect(await repo.getReceipt("healthy")).toMatchObject({
      uploadedFor: transport.ownerId,
    });
    expect(
      (await repo.database.receipts.get("real:broken"))?.uploadedFor,
    ).toBeNull();
    expect(
      (await repo.database.receipts.get("real:mismatched"))?.uploadedFor,
    ).toBeNull();
  });

  it("refuses to upload a bound ledger to another account", async () => {
    const repo = await makeRepository();
    await repo.database.workspaces.update("real", {
      ownerId: "original-owner",
    });
    const cloud = memoryCloud();
    await expect(synchronizeWorkspace(cloud.transport, repo)).rejects.toThrow(
      "owner_mismatch",
    );
    expect(cloud.writes()).toBe(0);
  });

  it("pulls a newer cloud edit after recovering an older acknowledged request", async () => {
    const repo = await makeRepository();
    await repo.save((ledger) =>
      validateLedger({
        ...ledger,
        project: { ...ledger.project, name: "First edit" },
      }),
    );
    const cloud = memoryCloud();
    const save = cloud.transport.save;
    let drop = true;
    cloud.transport.save = async (operation) => {
      const result = await save(operation);
      if (drop) {
        drop = false;
        throw new Error("lost_response");
      }
      return result;
    };
    await expect(synchronizeWorkspace(cloud.transport, repo)).rejects.toThrow();
    const later = validateLedger({
      ...createEmptyLedger(),
      project: { id: "my-home", name: "Later edit", currency: "BDT" },
    });
    await save({
      id: crypto.randomUUID(),
      workspace: "real",
      ownerId: "owner-one",
      generation: 1,
      baseRevision: 1,
      ledger: later,
      createdAt: new Date().toISOString(),
    });
    await synchronizeWorkspace(cloud.transport, repo);
    expect((await repo.read())?.ledger.project.name).toBe("Later edit");
    expect((await repo.read())?.cloudRevision).toBe(2);
    expect(cloud.writes()).toBe(2);
  });
});

it.each(["initial", "confirmed"] as const)(
  "preserves contract audit history when a newer cloud %s response drops it",
  async (phase) => {
    const repo = await makeRepository();
    const initial = validateLedger({
      ...createEmptyLedger(),
      people: [{ id: "worker", name: "মিস্ত্রি", kind: "worker" }],
    });
    const local = saveContractChange(
      initial,
      ContractSchema.parse({
        id: "house",
        scope: "house",
        personId: "worker",
        total: 60000000,
      }),
    );
    await repo.save(local);
    const cloud = memoryCloud();
    await synchronizeWorkspace(cloud.transport, repo);
    const remote = validateLedger({
      ...local,
      contracts: local.contracts.map((contract) => ({
        ...contract,
        activity: [],
      })),
    });
    let loads = 0;
    const transport: CloudTransport = {
      ownerId: "owner-one",
      save: cloud.transport.save,
      load: async () => {
        loads++;
        return phase === "confirmed" && loads === 1
          ? { revision: 1, document: local, updatedAt: null }
          : { revision: 2, document: remote, updatedAt: null };
      },
    };
    expect(await synchronizeWorkspace(transport, repo)).toMatchObject({
      status: "conflict",
    });
    expect((await repo.read())?.ledger.contracts[0].activity).toEqual(
      local.contracts[0].activity,
    );
    expect(
      (await repo.database.conflicts.get("real"))?.ledger.contracts[0].activity,
    ).toEqual([]);
    expect(cloud.writes()).toBe(1);
  },
);

it.each(["initial", "confirmed"] as const)(
  "keeps newer local financial records when a restored cloud revision regresses during %s pull",
  async (phase) => {
    const repo = await makeRepository();
    const current = migrateArchitecture(legacyArchitectureFixture()).ledger;
    const row = (await repo.read())!;
    await repo.writeWorkspace({
      ...row,
      ledger: current,
      cloudRevision: 4,
      pending: false,
    });
    const old = structuredClone(current);
    old.entries[0].lines[0].amount = 9000;
    let loads = 0,
      saves = 0;
    const result = await synchronizeWorkspace(
      {
        ownerId: "owner-one",
        load: async () => {
          loads++;
          return phase === "confirmed" && loads === 1
            ? { revision: 4, document: current, updatedAt: null }
            : { revision: 3, document: old, updatedAt: null };
        },
        save: async () => {
          saves++;
          throw new Error("unexpected write");
        },
      },
      repo,
    );
    expect(result.status).toBe("conflict");
    expect(saves).toBe(0);
    expect((await repo.read())!.ledger).toEqual(current);
    expect((await repo.read())!.cloudRevision).toBe(4);
    expect((await repo.database.conflicts.get("real"))?.revision).toBe(3);
    expect((await repo.database.conflicts.get("real"))?.ledger).toEqual(old);
  },
);
