import { migrateArchitecture } from "../domain/architectureMigration";
import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import { LedgerDatabase } from "./database";
import { LedgerRepository } from "./repository";
import {
  synchronizeWorkspace,
  type CloudSnapshot,
  type CloudTransport,
} from "./sync";
import { LedgerSchema } from "../domain/model";
import { setEntityRemoved } from "../domain/entityDeletion";

const databases: LedgerDatabase[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) await database.delete();
});
function repository() {
  const database = new LedgerDatabase(`removal-${crypto.randomUUID()}`);
  databases.push(database);
  return new LedgerRepository(database);
}
function fixture() {
  return LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
    people: [{ id: "shop", name: "দরজার দোকান", kind: "shop" }],
    entries: [
      {
        id: "purchase",
        kind: "expense",
        personId: "shop",
        lines: [{ id: "line", workId: "door", label: "দরজা", amount: 9300000 }],
      },
    ],
  });
}

it("keeps removed identities, money and recovery history after reopening IndexedDB and restoring a backup", async () => {
  const source = repository();
  const original = fixture();
  await source.ensure("real", original);
  const beforeRemoval = await source.exportBackup();
  const removed = setEntityRemoved(
    original,
    "person",
    "shop",
    true,
    "দরজার দোকান",
  );
  await source.save(removed);
  source.database.close();
  await source.database.open();
  expect((await source.read())!.ledger).toEqual(removed);
  expect(removed.entries).toEqual(original.entries);
  const target = repository();
  await target.ensure("real", LedgerSchema.parse({}));
  await target.importBackup(await source.exportBackup(), { replace: true });
  expect((await target.read())!.ledger.people[0]).toEqual(
    migrateArchitecture(removed).ledger.people[0],
  );
  const snapshot = await source.read();
  const outbox = await source.database.outbox.toArray();
  await expect(
    source.importBackup(beforeRemoval, { replace: true }),
  ).rejects.toThrow("removal_history_would_be_lost");
  expect(await source.read()).toEqual(snapshot);
  expect(await source.database.outbox.toArray()).toEqual(outbox);
  const restored = setEntityRemoved(removed, "person", "shop", false);
  await source.save(restored);
  expect((await source.read())!.ledger.people[0].archivedAt).toBeNull();
  expect((await source.read())!.ledger.people[0].removalHistory).toHaveLength(
    2,
  );
  expect(restored.entries).toEqual(original.entries);
});

it("refuses a silent archive-history drop during ordinary save", async () => {
  const source = repository();
  const original = fixture();
  await source.ensure("real", original);
  await source.save(setEntityRemoved(original, "work", "door", true));
  const before = await source.read();
  await expect(source.save(original)).rejects.toThrow(
    "removal_history_would_be_lost",
  );
  expect(await source.read()).toEqual(before);
});

it("asks to resolve a newer cloud copy that would silently revive a removed record", async () => {
  const source = repository();
  const original = fixture();
  await source.ensure("real", original);
  const removed = setEntityRemoved(original, "person", "shop", true);
  await source.save(removed);
  let cloud: CloudSnapshot = { revision: 0, document: null, updatedAt: null };
  const transport: CloudTransport = {
    ownerId: "synthetic-archive-owner",
    load: async () => cloud,
    save: async (operation) => {
      cloud = {
        revision: cloud.revision + 1,
        document: operation.ledger,
        updatedAt: new Date().toISOString(),
      };
      return {
        status: "saved",
        revision: cloud.revision,
        updatedAt: cloud.updatedAt!,
      };
    },
  };
  expect(await synchronizeWorkspace(transport, source)).toMatchObject({
    status: "synced",
  });
  cloud = {
    revision: 2,
    document: original,
    updatedAt: new Date().toISOString(),
  };
  expect(await synchronizeWorkspace(transport, source)).toMatchObject({
    status: "conflict",
  });
  expect((await source.read())!.ledger).toEqual(removed);
});
