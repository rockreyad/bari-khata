import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, expect, it } from "vitest";
import { migrateArchitecture } from "../domain/architectureMigration";
import { legacyArchitectureFixture } from "../domain/testing/legacyArchitecture";
import {
  LedgerDatabase,
  getAccountDatabase,
  setActiveOwner,
  type WorkspaceRow,
} from "./database";
import {
  createWorkspaceStorage,
  LedgerRepository,
  parseBackup,
} from "./repository";

const databases: Dexie[] = [];
const ledger = () => migrateArchitecture(legacyArchitectureFixture()).ledger;
const owner = "00000000-0000-4000-8000-000000000001";
function repository() {
  const db = new LedgerDatabase(`entities-${crypto.randomUUID()}`);
  databases.push(db);
  return new LedgerRepository(db);
}
afterEach(async () => {
  setActiveOwner(null);
  for (const db of databases.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

it("stores active facts by entity, preserves order and removes whole-ledger JSON from workspace metadata", async () => {
  const repo = repository(),
    original = ledger();
  await repo.ensure("real", original);
  expect(await repo.database.workspaces.get("real")).not.toHaveProperty(
    "ledger",
  );
  expect(await repo.database.workspaces.get("real")).toHaveProperty(
    "storageVersion",
    3,
  );
  const entry = await repo.database.ledgerEntities
    .where("[workspace+collection+id]")
    .equals(["real", "entries", "paid"])
    .first();
  expect(entry?.value).toEqual(original.entries[1]);
  await repo.save((current) => ({
    ...current,
    people: current.people.map((person) =>
      person.id === "p" ? { ...person, name: "নমুনা বদলানো নাম" } : person,
    ),
  }));
  expect(await repo.database.ledgerEntities.get(entry!.key)).toEqual(entry);
  repo.database.close();
  await repo.database.open();
  expect((await repo.read())?.ledger.entries).toEqual(original.entries);
  expect((await repo.read())?.ledger.people[0].name).toBe("নমুনা বদলানো নাম");
});

it("copies an exact v2 snapshot before splitting records and preserves original generation, revision and pending request bytes", async () => {
  const name = `v2-entities-${crypto.randomUUID()}`;
  const old = new Dexie(name);
  databases.push(old);
  old.version(1).stores({
    workspaces: "id",
    receipts: "key, workspace, entryId, uploadedFor",
    outbox: "id, workspace, createdAt",
    conflicts: "id",
    drafts: "id, workspace",
    recoveries: "id, workspace, createdAt",
  });
  old.version(2).stores({ migrations: "id, workspace, createdAt" });
  const before: WorkspaceRow = {
    id: "real",
    ledger: ledger(),
    generation: 7,
    cloudRevision: 3,
    ownerId: owner,
    pending: false,
    lastSyncedAt: null,
    updatedAt: "2026-11-05T00:00:00.000Z",
  };
  await old.table("workspaces").put(before);
  const frozen = {
    id: "frozen",
    workspace: "real",
    ownerId: owner,
    generation: 7,
    baseRevision: 3,
    ledger: before.ledger,
    createdAt: before.updatedAt,
  };
  await old.table("outbox").put(frozen);
  old.close();
  const db = new LedgerDatabase(name, owner);
  databases.push(db);
  const repo = new LedgerRepository(db);
  expect(await repo.read()).toEqual(before);
  expect((await db.migrations.get("storage:real:3"))?.before).toEqual(before);
  expect(await db.outbox.get("frozen")).toEqual(frozen);
  expect(await db.workspaces.get("real")).not.toHaveProperty("ledger");
  db.close();
  await db.open();
  expect(await db.migrations.count()).toBe(1);
});

it("rejects missing records, malformed headers and valid-schema value corruption without resetting the source", async () => {
  const repo = repository();
  await repo.ensure("real", ledger());
  const header = (await repo.database.ledgerHeaders.get("real"))!;
  await repo.database.ledgerHeaders.update("real", { checksum: "broken" });
  await expect(repo.read()).rejects.toThrow();
  await repo.database.ledgerHeaders.put(header);
  const row = (await repo.database.ledgerEntities
    .where("[workspace+collection+id]")
    .equals(["real", "entries", "paid"])
    .first())!;
  const changed = structuredClone(row.value) as { note: string };
  changed.note = "বদলে যাওয়া মূল তথ্য";
  await repo.database.ledgerEntities.update(row.key, { value: changed });
  await expect(repo.read()).rejects.toThrow("ledger_entity_checksum_mismatch");
  expect((await repo.database.ledgerEntities.get(row.key))?.value).toEqual(
    changed,
  );
  await repo.database.ledgerEntities.delete(row.key);
  await expect(repo.read()).rejects.toThrow("ledger_entities_incomplete");
  await expect(repo.ensure("real", ledger())).rejects.toThrow();
});

it("rejects an internally valid edited financial backup before changing the normalized ledger", async () => {
  const repo = repository();
  await repo.ensure("real", ledger());
  const backup = JSON.parse(await repo.exportBackup());
  const before = await repo.read();
  backup.ledger.entries[0].lines[0].amount += 100;
  expect(
    parseBackup(JSON.stringify(backup)).ledger.entries[0].lines[0].amount,
  ).toBe(10100);
  await expect(
    repo.importBackup(JSON.stringify(backup), { replace: true }),
  ).rejects.toThrow("backup_checksum_mismatch");
  expect(await repo.read()).toEqual(before);
});

it("retains semantic migration reports in backup and restore without creating a settlement", async () => {
  const source = repository();
  await source.ensure("real", ledger());
  const backup = await source.exportBackup();
  expect(
    parseBackup(backup).migrationReviews?.[0].issues.some(
      (issue) => issue.code === "unclassified_cash",
    ),
  ).toBe(true);
  const target = repository();
  await target.importBackup(backup, { replace: true });
  expect((await target.migrationReview()).sources.length).toBeGreaterThan(0);
  expect((await target.read())?.ledger.paymentAllocations).toEqual([]);
  expect(parseBackup(await target.exportBackup()).migrationReviews).toEqual(
    parseBackup(backup).migrationReviews,
  );
});

it("lists only the active account draft keys without exposing or rewriting their values", async () => {
  setActiveOwner(owner);
  const db = getAccountDatabase(owner);
  databases.push(db);
  const storage = createWorkspaceStorage("real");
  await storage.saveDraft("quick-v2:purchase", { note: "অসমাপ্ত নমুনা" });
  expect(await storage.listDraftKeys()).toEqual(["quick-v2:purchase"]);
  expect(await storage.readDraft("quick-v2:purchase")).toEqual({
    note: "অসমাপ্ত নমুনা",
  });
  setActiveOwner("00000000-0000-4000-8000-000000000002");
  await expect(storage.listDraftKeys()).rejects.toThrow("account_changed");
});

it("upgrades known pre-checksum v3 data by validating and archiving raw records without clearing drafts or frozen requests", async () => {
  const source = repository();
  await source.ensure("real", ledger());
  const metadata = (await source.database.workspaces.get("real"))!;
  const header = {
    ...(await source.database.ledgerHeaders.get("real"))!,
  } as Record<string, unknown>;
  delete header.checksum;
  const entities = await source.database.ledgerEntities.toArray();
  const name = `pre-checksum-${crypto.randomUUID()}`,
    old = new Dexie(name);
  databases.push(old);
  old.version(1).stores({
    workspaces: "id",
    receipts: "key, workspace, entryId, uploadedFor",
    outbox: "id, workspace, createdAt",
    conflicts: "id",
    drafts: "id, workspace",
    recoveries: "id, workspace, createdAt",
  });
  old.version(2).stores({ migrations: "id, workspace, createdAt" });
  old.version(3).stores({
    ledgerHeaders: "id",
    ledgerEntities:
      "key, workspace, [workspace+collection], [workspace+collection+id]",
  });
  await old.table("workspaces").put(metadata);
  await old.table("ledgerHeaders").put(header);
  await old.table("ledgerEntities").bulkPut(entities);
  const draft = {
    id: "real:quick-v2:expense",
    workspace: "real",
    value: { note: "অসমাপ্ত নমুনা" },
    updatedAt: "2026-11-05T00:00:00.000Z",
  };
  const frozen = {
    id: "frozen",
    workspace: "real",
    ownerId: owner,
    generation: 0,
    baseRevision: 0,
    ledger: ledger(),
    createdAt: draft.updatedAt,
  };
  await old.table("drafts").put(draft);
  await old.table("outbox").put(frozen);
  old.close();
  const db = new LedgerDatabase(name);
  databases.push(db);
  const repo = new LedgerRepository(db);
  expect((await repo.read())?.ledger).toEqual(ledger());
  expect(db.verno).toBe(4);
  expect((await db.ledgerHeaders.get("real"))?.checksum).toMatch(
    /^[0-9a-f]{64}$/,
  );
  const recovery = (await db.storageRecoveries.get("integrity:real:4"))!;
  expect(recovery.header).toEqual(header);
  expect(recovery.entities).toEqual(entities);
  expect(await db.drafts.get(draft.id)).toEqual(draft);
  expect(await db.outbox.get(frozen.id)).toEqual(frozen);
  expect(await db.migrationReviews.count()).toBe(0);
  db.close();
  await db.open();
  expect(await db.storageRecoveries.count()).toBe(1);
});

it("rejects a same-size changed receipt from a checksummed backup before changing the ledger or blobs", async () => {
  const repo = repository(),
    original = ledger();
  const file = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
  original.entries[0].receipts = [
    { id: "voucher", name: "নমুনা.png", mime: file.type, size: file.size },
  ];
  await repo.ensure("real", original);
  await repo.save(original, "real", [{ id: "voucher", entryId: "bill", file }]);
  const text = await repo.exportBackup(),
    corrupt = JSON.parse(text),
    before = await repo.read();
  corrupt.receipts[0].base64 = "AQIE";
  await expect(
    repo.importBackup(JSON.stringify(corrupt), { replace: true }),
  ).rejects.toThrow("receipt_checksum_mismatch");
  expect(await repo.read()).toEqual(before);
  expect(
    new Uint8Array(
      await (await repo.getReceipt("voucher"))!.blob.arrayBuffer(),
    ),
  ).toEqual(new Uint8Array([1, 2, 3]));
});
