import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, expect, it } from "vitest";
import { ContractSchema, EntrySchema, LedgerSchema } from "../domain/model";
import {
  architectureReconciliation,
  migrateArchitecture,
} from "../domain/architectureMigration";
import { legacyArchitectureFixture } from "../domain/testing/legacyArchitecture";
import { LedgerDatabase } from "./database";
import { LedgerRepository, parseBackup } from "./repository";
import { ledgerCollections } from "./entityStorage";
import { synchronizeWorkspace } from "./sync";

const databases: Dexie[] = [];
const at = "2026-11-06T00:00:00.000Z";
const owner = "00000000-0000-4000-8000-000000000001";
afterEach(async () => {
  for (const db of databases.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

function oldLedger() {
  const ledger = migrateArchitecture(legacyArchitectureFixture()).ledger;
  ledger.contracts = [
    ContractSchema.parse({
      id: "contract",
      personId: "p",
      workId: "w",
      total: 10000,
    }),
  ];
  ledger.entries[0].contractId = "contract";
  ledger.entries[1].contractId = "contract";
  const bill = ledger.entries[0];
  const { revisions: _revisions, ...snapshot } = EntrySchema.parse(bill);
  bill.revisions = [{ at, before: { ...snapshot, note: "নমুনা আগের লেখা" } }];
  const reference = (value: object) =>
    Object.fromEntries(
      Object.entries(value).flatMap(([key, data]) => [
        [key, data],
        ...(key === "contractId"
          ? [
              [
                "milestoneId",
                "id" in value && value.id === "bill" ? "retired" : null,
              ],
            ]
          : []),
      ]),
    );
  const { entries, paymentAllocations, ...rest } = ledger;
  return {
    ...rest,
    milestones: [
      {
        id: "retired",
        contractId: "contract",
        title: "নমুনা পুরোনো ধাপ",
        amount: 10000,
        dueOn: null,
        status: "done",
      },
    ],
    paymentAllocations,
    entries: entries.map((entry) => ({
      ...reference(entry),
      revisions: entry.revisions.map((revision) => ({
        ...revision,
        before: reference(revision.before),
      })),
    })),
  };
}

async function checksum(value: unknown) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function oldDatabase(version = 4) {
  const db = new Dexie(`retired-work-${crypto.randomUUID()}`);
  databases.push(db);
  db.version(version).stores({
    workspaces: "id",
    receipts: "key, workspace, entryId, uploadedFor",
    outbox: "id, workspace, createdAt",
    conflicts: "id",
    drafts: "id, workspace",
    recoveries: "id, workspace, createdAt",
    migrations: "id, workspace, createdAt",
    ledgerHeaders: "id",
    migrationReviews: "id, workspace",
    storageRecoveries: "id, workspace, createdAt",
    ledgerEntities:
      "key, workspace, [workspace+collection], [workspace+collection+id]",
  });
  const original = oldLedger();
  const collections = [...ledgerCollections, "milestones"] as const;
  const metadata = {
    id: "real",
    storageVersion: 3,
    generation: 4,
    cloudRevision: 8,
    ownerId: owner,
    pending: true,
    lastSyncedAt: at,
    updatedAt: at,
  };
  await db.table("workspaces").put(metadata);
  await db.table("ledgerHeaders").put({
    id: "real",
    schemaVersion: 1,
    architectureVersion: 2,
    isDemo: false,
    project: original.project,
    collections: Object.fromEntries(
      collections.map((name) => [name, original[name]!.length]),
    ),
    checksum: await checksum(original),
    optionalCollections: ["milestones", "paymentAllocations"],
  });
  for (const collection of collections) {
    for (const [position, value] of original[collection]!.entries()) {
      await db.table("ledgerEntities").put({
        key: JSON.stringify(["real", collection, value.id]),
        workspace: "real",
        collection,
        id: value.id,
        position,
        value,
      });
    }
  }
  const pending = {
    id: "pending",
    workspace: "real",
    ownerId: owner,
    generation: 4,
    baseRevision: 8,
    ledger: original,
    createdAt: at,
  };
  const draft = {
    id: "unfinished",
    workspace: "real",
    value: { note: "নমুনা অসমাপ্ত লেখা", amount: "120", milestoneId: null },
    updatedAt: at,
  };
  await db.table("outbox").put(pending);
  await db.table("drafts").put(draft);
  return { db, original, pending, draft, metadata };
}

it("verifies and upgrades old entity storage while preserving money, revisions, pending operations and unfinished writing", async () => {
  const { db: old, original, pending, draft } = await oldDatabase();
  old.close();
  const db = new LedgerDatabase(old.name, owner);
  databases.push(db);
  const repo = new LedgerRepository(db);
  const current = (await repo.read())!;
  expect(current.ledger).toEqual(LedgerSchema.parse(original));
  expect(JSON.stringify(current.ledger)).not.toMatch(/milestone/);
  expect(architectureReconciliation(current.ledger)).toEqual(
    architectureReconciliation(LedgerSchema.parse(original)),
  );
  expect(current).toMatchObject({
    generation: 4,
    cloudRevision: 8,
    pending: true,
  });
  expect(await db.outbox.get("pending")).toEqual(pending);
  expect(await db.drafts.get("unfinished")).toEqual(draft);
  expect(await db.storageRecoveries.get("work-metadata:real:5")).toBeTruthy();
  expect(await db.ledgerHeaders.get("real")).not.toHaveProperty(
    "collections.milestones",
  );
  db.close();
  await db.open();
  expect((await repo.read())?.ledger).toEqual(current.ledger);
  const exported = JSON.parse(await repo.exportBackup());
  expect(JSON.stringify(exported.ledger)).not.toMatch(/milestone/);
  let revision = 8;
  let document = LedgerSchema.parse(original);
  const sent: unknown[] = [];
  expect(
    await synchronizeWorkspace(
      {
        ownerId: owner,
        load: async () => ({ revision, document, updatedAt: at }),
        save: async (operation) => {
          sent.push(operation.ledger);
          expect(operation.baseRevision).toBe(revision);
          document = LedgerSchema.parse(operation.ledger);
          return { status: "saved", revision: ++revision, updatedAt: at };
        },
      },
      repo,
    ),
  ).toMatchObject({ status: "synced" });
  expect(sent).toEqual([original]);
  expect((await repo.read())?.ledger).toEqual(current.ledger);
  expect(await db.outbox.count()).toBe(0);
  expect(await db.conflicts.count()).toBe(0);
});

it("aborts the upgrade if a checksum-protected financial record changed", async () => {
  const { db: old, metadata } = await oldDatabase();
  const row = await old
    .table("ledgerEntities")
    .where("[workspace+collection+id]")
    .equals(["real", "entries", "bill"])
    .first();
  row.value.lines[0].amount += 1;
  await old.table("ledgerEntities").put(row);
  old.close();
  const db = new LedgerDatabase(old.name, owner);
  databases.push(db);
  await expect(db.open()).rejects.toThrow("ledger_entity_checksum_mismatch");
  const inspect = new Dexie(old.name);
  databases.push(inspect);
  await inspect.open();
  expect(await inspect.table("workspaces").get("real")).toEqual(metadata);
  expect(
    (await inspect.table("ledgerHeaders").get("real")).collections,
  ).toHaveProperty("milestones");
});

it("does not turn an already synced account into a new write or a conflict", async () => {
  const { db: old, metadata, original } = await oldDatabase();
  await old.table("workspaces").put({ ...metadata, pending: false });
  await old.table("outbox").clear();
  old.close();
  const db = new LedgerDatabase(old.name, owner);
  databases.push(db);
  const repo = new LedgerRepository(db);
  expect(await repo.read()).toMatchObject({
    generation: 4,
    cloudRevision: 8,
    pending: false,
  });
  expect(
    await synchronizeWorkspace(
      {
        ownerId: owner,
        load: async () => ({
          revision: 8,
          document: LedgerSchema.parse(original),
          updatedAt: at,
        }),
        save: async () => {
          throw new Error("unexpected_metadata_only_write");
        },
      },
      repo,
    ),
  ).toMatchObject({ status: "synced" });
  expect(await db.conflicts.count()).toBe(0);
});

it("requires the existing v4 checksum instead of treating a missing hash as older storage", async () => {
  const { db: old } = await oldDatabase();
  const header = await old.table("ledgerHeaders").get("real");
  delete header.checksum;
  await old.table("ledgerHeaders").put(header);
  old.close();
  const db = new LedgerDatabase(old.name, owner);
  databases.push(db);
  await expect(db.open()).rejects.toThrow();
});

it("accepts known v3 storage without a checksum and archives the original before normalization", async () => {
  const { db: old, original, metadata } = await oldDatabase(3);
  const header = await old.table("ledgerHeaders").get("real");
  delete header.checksum;
  await old.table("ledgerHeaders").put(header);
  old.close();
  const db = new LedgerDatabase(old.name, owner);
  databases.push(db);
  const repo = new LedgerRepository(db);
  expect(await repo.read()).toMatchObject({
    generation: metadata.generation,
    pending: metadata.pending,
    cloudRevision: metadata.cloudRevision,
    ledger: LedgerSchema.parse(original),
  });
  expect((await db.storageRecoveries.get("integrity:real:4"))?.header).toEqual(
    header,
  );
  expect((await db.ledgerHeaders.get("real"))?.checksum).toMatch(
    /^[0-9a-f]{64}$/,
  );
});

it("imports checksum-protected old backups and rejects tampering before replacing financial data", async () => {
  const original = oldLedger();
  const backup = {
    format: "bari-khata-backup",
    version: 1,
    exportedAt: at,
    ledger: original,
    receipts: [],
    integrity: {
      algorithm: "SHA-256",
      ledger: await checksum(original),
      receipts: [],
    },
  };
  const db = new LedgerDatabase(`retired-backup-${crypto.randomUUID()}`);
  databases.push(db);
  const repo = new LedgerRepository(db);
  await repo.importBackup(JSON.stringify(backup), { replace: true });
  const before = await repo.read();
  expect(before?.ledger).toEqual(LedgerSchema.parse(original));
  const bill = backup.ledger.entries[0] as unknown as {
    lines: { amount: number }[];
  };
  bill.lines[0].amount += 1;
  await expect(
    repo.importBackup(JSON.stringify(backup), { replace: true }),
  ).rejects.toThrow("backup_checksum_mismatch");
  expect(await repo.read()).toEqual(before);
});

it("validates old metadata and financial records before removing retired fields", () => {
  for (const change of [
    (ledger: ReturnType<typeof oldLedger>) => {
      ledger.milestones[0].amount = -1;
    },
    (ledger: ReturnType<typeof oldLedger>) => {
      ledger.milestones[0].contractId = "missing";
    },
    (ledger: ReturnType<typeof oldLedger>) => {
      const bill = ledger.entries[0] as unknown as {
        lines: { amount: number }[];
      };
      bill.lines[0].amount = 0.5;
    },
  ]) {
    const ledger = oldLedger();
    change(ledger);
    expect(() =>
      parseBackup(
        JSON.stringify({
          format: "bari-khata-backup",
          version: 1,
          exportedAt: at,
          ledger,
          receipts: [],
        }),
      ),
    ).toThrow();
  }
});
