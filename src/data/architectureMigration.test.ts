import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { ContractSchema } from "../domain/model";
import { createEmptyLedger } from "../domain/demo";
import { legacyArchitectureFixture } from "../domain/testing/legacyArchitecture";
import { migrateArchitecture } from "../domain/architectureMigration";
import {
  LedgerDatabase,
  architectureMigrationKey,
  validateMigrationReceipts,
  type ReceiptRow,
  type WorkspaceRow,
} from "./database";
import { LedgerRepository, parseBackup } from "./repository";
import { synchronizeWorkspace } from "./sync";

const databases: Dexie[] = [];
const at = "2026-11-05T00:00:00.000Z";
const owner = "00000000-0000-4000-8000-000000000001";
async function oldDatabase(ledger = legacyArchitectureFixture()) {
  const name = `architecture-v1-${crypto.randomUUID()}`;
  const old = new Dexie(name);
  old.version(1).stores({
    workspaces: "id",
    receipts: "key, workspace, entryId, uploadedFor",
    outbox: "id, workspace, createdAt",
    conflicts: "id",
    drafts: "id, workspace",
    recoveries: "id, workspace, createdAt",
  });
  await old.open();
  const row: WorkspaceRow = {
    id: "real",
    ledger,
    generation: 3,
    cloudRevision: 5,
    ownerId: owner,
    pending: false,
    lastSyncedAt: at,
    updatedAt: at,
  };
  await old.table("workspaces").put(row);
  databases.push(old);
  return { old, row, name };
}
function repository() {
  const database = new LedgerDatabase(
    `architecture-new-${crypto.randomUUID()}`,
  );
  databases.push(database);
  return new LedgerRepository(database);
}
afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    await Dexie.delete(database.name);
  }
});

describe("migration receipt validation", () => {
  function fixture(
    blob: Blob = new File([new Uint8Array([8, 9, 10])], "নমুনা.png", {
      type: "image/png",
    }),
  ) {
    const ledger = legacyArchitectureFixture();
    ledger.entries[0].receipts = [
      {
        id: "photo",
        name: "নমুনা.png",
        mime: "image/png",
        size: 3,
      },
    ];
    const receipt: ReceiptRow = {
      key: "real:photo",
      id: "photo",
      workspace: "real",
      entryId: "bill",
      name: "নমুনা.png",
      mime: "image/png",
      blob,
      createdAt: at,
      uploadedFor: owner,
    };
    return { ledger, receipt };
  }

  it("accepts a native camera or file-picker File without changing it", async () => {
    const { ledger, receipt } = fixture();
    expect(Object.prototype.toString.call(receipt.blob)).toBe("[object File]");
    expect(() =>
      validateMigrationReceipts([receipt], "real", ledger),
    ).not.toThrow();
    expect((receipt.blob as File).name).toBe("নমুনা.png");
    expect(new Uint8Array(await receipt.blob.arrayBuffer())).toEqual(
      new Uint8Array([8, 9, 10]),
    );
  });

  it.each(["Blob", "File"])(
    "rejects an object pretending to be a %s",
    (tag) => {
      const { ledger, receipt } = fixture();
      receipt.blob = {
        [Symbol.toStringTag]: tag,
        size: 3,
        type: "image/png",
        arrayBuffer: async () => new ArrayBuffer(3),
        slice: () => new Blob(),
      } as unknown as Blob;
      expect(() =>
        validateMigrationReceipts([receipt], "real", ledger),
      ).toThrow();
    },
  );

  it.each([
    ["entry", { entryId: "another-entry" }],
    ["workspace", { workspace: "demo" }],
    ["key", { key: "real:another-photo" }],
    ["MIME", { mime: "image/jpeg" }],
    [
      "size",
      {
        blob: new File(["different size"], "নমুনা.png", { type: "image/png" }),
      },
    ],
  ] as const)("rejects File receipt %s mismatches", (_, changes) => {
    const { ledger, receipt } = fixture();
    expect(() =>
      validateMigrationReceipts([{ ...receipt, ...changes }], "real", ledger),
    ).toThrow();
  });

  it("rejects duplicate receipt keys", () => {
    const { ledger, receipt } = fixture();
    expect(() =>
      validateMigrationReceipts([receipt, receipt], "real", ledger),
    ).toThrow();
  });
});

describe("durable architecture conversion", () => {
  it.each([
    [
      "Blob",
      () => new Blob([new Uint8Array([8, 9, 10])], { type: "image/png" }),
    ],
    [
      "File",
      () =>
        new File([new Uint8Array([8, 9, 10])], "নমুনা.png", {
          type: "image/png",
        }),
    ],
  ] as const)(
    "upgrades a v1 database atomically with a %s attachment, exact preimage and reconciliation while keeping drafts and frozen requests",
    async (_, createFile) => {
      const { old, row, name } = await oldDatabase();
      const file = createFile();
      const receipt = {
        key: "real:photo",
        id: "photo",
        workspace: "real",
        entryId: "bill",
        name: "নমুনা.png",
        mime: file.type,
        blob: file,
        createdAt: at,
        uploadedFor: owner,
      };
      await old.table("receipts").put(receipt);
      const frozen = {
        id: "frozen",
        workspace: "real",
        ownerId: owner,
        generation: 3,
        baseRevision: 5,
        ledger: row.ledger,
        createdAt: at,
      };
      await old.table("outbox").put(frozen);
      const draft = {
        id: "entry-form",
        workspace: "real",
        value: { note: "অসমাপ্ত নমুনা লেখা", file },
        updatedAt: at,
      };
      await old.table("drafts").put(draft);
      const savedDraft = await old.table("drafts").get("entry-form");
      old.close();
      const upgraded = new LedgerDatabase(name, owner);
      databases.push(upgraded);
      const repo = new LedgerRepository(upgraded);
      const saved = (await repo.read())!;
      expect(saved.ledger.architectureVersion).toBe(2);
      expect(saved.ledger.entries).toEqual(row.ledger.entries);
      expect(saved).toMatchObject({
        generation: 4,
        cloudRevision: 5,
        pending: true,
        ownerId: owner,
      });
      const migration = (await upgraded.migrations.get(
        architectureMigrationKey("real"),
      ))!;
      expect(migration.before).toEqual(row);
      expect(migration.report.before).toEqual(migration.report.after);
      expect(
        new Uint8Array(await migration.receipts[0].blob.arrayBuffer()),
      ).toEqual(new Uint8Array([8, 9, 10]));
      expect(await upgraded.outbox.get("frozen")).toEqual(frozen);
      expect(await upgraded.drafts.get("entry-form")).toEqual(savedDraft);
      upgraded.close();
      await upgraded.open();
      expect(await upgraded.migrations.count()).toBe(2);
      expect((await repo.read())?.generation).toBe(4);
      const reopenedReceipt = (await upgraded.receipts.get("real:photo"))!;
      expect(reopenedReceipt.name).toBe(receipt.name);
      expect(new Uint8Array(await reopenedReceipt.blob.arrayBuffer())).toEqual(
        new Uint8Array([8, 9, 10]),
      );
    },
  );

  it("aborts the entire version upgrade on invalid financial data and leaves v1 bytes accessible", async () => {
    const { old, row, name } = await oldDatabase();
    const corrupt = structuredClone(row);
    corrupt.id = "demo";
    corrupt.ledger.isDemo = true;
    corrupt.ledger.entries[0].lines[0].amount = 0.5;
    await old.table("workspaces").put(corrupt);
    old.close();
    const upgraded = new LedgerDatabase(name, owner);
    databases.push(upgraded);
    await expect(upgraded.open()).rejects.toThrow();
    const unchanged = new Dexie(name);
    databases.push(unchanged);
    await unchanged.open();
    expect(unchanged.verno).toBe(1);
    expect(await unchanged.table("workspaces").get("real")).toEqual(row);
    expect(
      (await unchanged.table("workspaces").get("demo")).ledger.entries[0]
        .lines[0].amount,
    ).toBe(0.5);
    expect(unchanged.tables.some((table) => table.name === "migrations")).toBe(
      false,
    );
  });

  it("supports local rollback only before further changes, synchronization or unresolved frozen work", async () => {
    const { old, row, name } = await oldDatabase();
    old.close();
    const upgraded = new LedgerDatabase(name, owner);
    databases.push(upgraded);
    const repo = new LedgerRepository(upgraded);
    const current = (await repo.read())!;
    const id = architectureMigrationKey("real");
    await upgraded.outbox.add({
      id: "pending",
      workspace: "real",
      ownerId: owner,
      generation: current.generation,
      baseRevision: 5,
      ledger: current.ledger,
      createdAt: at,
    });
    await expect(
      repo.rollbackArchitectureMigration(id, current),
    ).rejects.toThrow("architecture_rollback_sync_pending");
    await upgraded.outbox.clear();
    await upgraded.workspaces.update("real", { cloudRevision: 6 });
    await expect(
      repo.rollbackArchitectureMigration(id, current),
    ).rejects.toThrow("architecture_rollback_already_synced");
    await upgraded.workspaces.update("real", { cloudRevision: 5 });
    await repo.rollbackArchitectureMigration(id, current);
    expect((await repo.read())?.ledger).toEqual(row.ledger);
    expect((await upgraded.migrations.get(id))?.status).toBe("rolled-back");
    expect(await upgraded.migrations.count()).toBe(2);

    const second = repository();
    await second.ensure("real", legacyArchitectureFixture());
    await second.migrateWorkspace();
    const beforeEdit = (await second.read())!;
    await second.save((ledger) => ({
      ...ledger,
      project: { ...ledger.project, name: "পরে বদলানো নমুনা নাম" },
    }));
    await expect(
      second.rollbackArchitectureMigration(id, beforeEdit),
    ).rejects.toThrow("architecture_rollback_has_later_changes");
    expect((await second.read())?.ledger.project.name).toBe(
      "পরে বদলানো নমুনা নাম",
    );
  });

  it("imports an old backup through conversion, preserves attachments, and rejects future or contradictory records before writing", async () => {
    const source = repository();
    const original = legacyArchitectureFixture();
    const file = new Blob([new Uint8Array([2, 4, 6])], { type: "image/png" });
    original.entries[0].receipts = [
      {
        id: "old-receipt",
        name: "নমুনা.png",
        mime: file.type,
        size: file.size,
      },
    ];
    await source.ensure("real", original);
    await source.save(original, "real", [
      { id: "old-receipt", entryId: "bill", file },
    ]);
    const backup = await source.exportBackup();
    const target = repository();
    await target.ensure("real", createEmptyLedger());
    await target.importBackup(backup, { replace: true });
    const saved = (await target.read())!;
    expect(saved.ledger).toEqual(migrateArchitecture(original).ledger);
    expect(await target.database.migrations.count()).toBe(1);
    const migration = (await target.database.migrations.toArray())[0];
    expect(
      new Uint8Array(await migration.receipts[0].blob.arrayBuffer()),
    ).toEqual(new Uint8Array([2, 4, 6]));
    const copy = parseBackup(await target.exportBackup());
    expect(copy.ledger).toEqual(saved.ledger);
    const future = JSON.parse(backup);
    future.ledger.architectureVersion = 3;
    await expect(
      target.importBackup(JSON.stringify(future), { replace: true }),
    ).rejects.toThrow();
    const corrupt = JSON.parse(backup);
    corrupt.ledger.entries[0].personId = "missing";
    await expect(
      target.importBackup(JSON.stringify(corrupt), { replace: true }),
    ).rejects.toThrow();
    expect((await target.read())?.ledger).toEqual(saved.ledger);
  });

  it("converts a legacy cloud snapshot on first pull and persists the enrichment with a new CAS request", async () => {
    const repo = repository();
    await repo.ensure("real", createEmptyLedger());
    let document = legacyArchitectureFixture();
    let revision = 7;
    const saves: { revision: number; version?: number }[] = [];
    const result = await synchronizeWorkspace(
      {
        ownerId: owner,
        load: async () => ({ revision, document, updatedAt: at }),
        save: async (operation) => {
          saves.push({
            revision: operation.baseRevision,
            version: operation.ledger.architectureVersion,
          });
          document = operation.ledger;
          revision++;
          return { status: "saved", revision, updatedAt: at };
        },
      },
      repo,
    );
    expect(result.status).toBe("synced");
    expect(saves).toEqual([{ revision: 7, version: 2 }]);
    expect((await repo.read())?.pending).toBe(false);
    expect((await repo.read())?.ledger.entries).toEqual(
      legacyArchitectureFixture().entries,
    );
    expect(await repo.database.migrations.count()).toBe(1);
    expect(
      (await repo.database.migrations.toArray())[0].before.ledger
        .architectureVersion,
    ).toBeUndefined();
  });

  it("replays frozen legacy JSON unchanged before sending the migrated generation", async () => {
    const { old, row, name } = await oldDatabase();
    const frozen = {
      id: crypto.randomUUID(),
      workspace: "real",
      ownerId: owner,
      generation: row.generation,
      baseRevision: row.cloudRevision,
      ledger: row.ledger,
      createdAt: at,
    };
    await old.table("outbox").add(frozen);
    old.close();
    const upgraded = new LedgerDatabase(name, owner);
    databases.push(upgraded);
    const repo = new LedgerRepository(upgraded);
    let cloud = row.ledger;
    let revision = 5;
    const requests: unknown[] = [];
    await synchronizeWorkspace(
      {
        ownerId: owner,
        load: async () => ({ revision, document: cloud, updatedAt: at }),
        save: async (operation) => {
          requests.push(structuredClone(operation));
          expect(operation.baseRevision).toBe(revision);
          cloud = operation.ledger;
          revision++;
          return { status: "saved", revision, updatedAt: at };
        },
      },
      repo,
    );
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(frozen);
    expect((requests[1] as typeof frozen).ledger.architectureVersion).toBe(2);
    expect((await repo.read())?.cloudRevision).toBe(7);
    expect(await upgraded.outbox.count()).toBe(0);
  });

  it("preserves allocation history in save, restore and cloud conflict paths", async () => {
    const repo = repository();
    const ledger = migrateArchitecture(legacyArchitectureFixture()).ledger;
    ledger.paymentAllocations = [
      {
        id: "a",
        paymentId: "paid",
        billId: "bill",
        amount: 1000,
        createdAt: at,
      },
    ];
    await repo.ensure("real", ledger);
    const older = { ...ledger, paymentAllocations: [] };
    await expect(repo.save(older)).rejects.toThrow(
      "architecture_data_would_be_lost",
    );
    const text = JSON.stringify({
      format: "bari-khata-backup",
      version: 1,
      exportedAt: at,
      ledger: older,
      receipts: [],
    });
    await expect(repo.importBackup(text, { replace: true })).rejects.toThrow(
      "architecture_data_would_be_lost",
    );
    const result = await synchronizeWorkspace(
      {
        ownerId: owner,
        load: async () => ({ revision: 1, document: older, updatedAt: at }),
        save: async () => {
          throw new Error("unexpected write");
        },
      },
      repo,
    );
    expect(result.status).toBe("conflict");
    expect((await repo.read())?.ledger).toEqual(ledger);
  });
  it("round-trips roles and allocation cancellation and refuses history removal in reviewed merges", async () => {
    const ledger = migrateArchitecture(legacyArchitectureFixture()).ledger;
    ledger.people[0].roles = ["craftsperson", "supplier"];
    ledger.contracts = [
      ContractSchema.parse({
        id: "c",
        scope: "work",
        workId: "w",
        personId: "p",
        title: "নমুনা চুক্তি",
        basis: "fixed",
        quantity: "1",
        rate: 10000,
        total: 10000,
      }),
    ];
    ledger.paymentAllocations = [
      {
        id: "a",
        paymentId: "paid",
        billId: "bill",
        amount: 1000,
        createdAt: at,
      },
    ];
    const source = repository();
    await source.ensure("real", ledger);
    const target = repository();
    await target.ensure("real", createEmptyLedger());
    await target.importBackup(await source.exportBackup(), { replace: true });
    expect((await target.read())?.ledger).toEqual(ledger);
    const cancelled = structuredClone(ledger);
    cancelled.paymentAllocations![0] = {
      ...cancelled.paymentAllocations![0],
      cancelledAt: "2026-11-05T01:00:00.000Z",
      cancellationReason: "নমুনা ভুল বিলের যোগ বাতিল",
    };
    await source.save(cancelled);
    const backup = await source.exportBackup();
    const mergeOptions = {
      expectedLedger: ledger,
      decisions: { "paymentAllocations:a": "backup" as const },
      confirmed: true as const,
      at,
    };
    await target.mergeBackup(backup, mergeOptions);
    expect((await target.read())?.ledger).toEqual(cancelled);
    await expect(target.save(ledger)).rejects.toThrow(
      "architecture_data_would_be_lost",
    );
    const stripped = { ...cancelled, paymentAllocations: [] };
    const text = JSON.stringify({
      format: "bari-khata-backup",
      version: 1,
      exportedAt: at,
      ledger: stripped,
      receipts: [],
    });
    await expect(target.importBackup(text, { replace: true })).rejects.toThrow(
      "architecture_data_would_be_lost",
    );
    expect((await target.read())?.ledger).toEqual(cancelled);
  });
});
