import { migrateArchitecture } from "../domain/architectureMigration";
import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import { LedgerSchema } from "../domain/model";
import { LedgerDatabase } from "./database";
import { LedgerRepository } from "./repository";
import { synchronizeWorkspace } from "./sync";

const databases: LedgerDatabase[] = [];
const fixture = () =>
  LedgerSchema.parse({
    works: [
      { id: "bathroom", name: "বাথরুম" },
      { id: "electric", name: "ইলেকট্রিক" },
    ],
    people: [
      {
        id: "worker",
        name: "মোরশেদ",
        kind: "worker",
        role: "ইঞ্জিনিয়ার",
        workIds: ["bathroom", "electric"],
      },
    ],
  });
function repository() {
  const database = new LedgerDatabase(`person-links-${crypto.randomUUID()}`);
  databases.push(database);
  return new LedgerRepository(database);
}
afterEach(async () => {
  for (const database of databases.splice(0)) await database.delete();
});

it("keeps custom role and multiple notebooks through IndexedDB reopen and backup restore", async () => {
  const repo = repository();
  const ledger = fixture();
  await repo.ensure("real", ledger);
  repo.database.close();
  await repo.database.open();
  expect((await repo.read())?.ledger.people[0]).toEqual(ledger.people[0]);
  const backup = await repo.exportBackup();
  const restored = repository();
  await restored.ensure("real", LedgerSchema.parse({}));
  await restored.importBackup(backup, { replace: true });
  expect((await restored.read())?.ledger.people[0]).toEqual(
    migrateArchitecture(ledger).ledger.people[0],
  );
  expect((await restored.read())?.ledger.entries).toEqual([]);
  expect((await restored.read())?.ledger.contracts).toEqual([]);

  const corrupt = JSON.parse(backup);
  corrupt.ledger.people[0].workIds = ["unknown"];
  await expect(
    restored.importBackup(JSON.stringify(corrupt), { replace: true }),
  ).rejects.toThrow();
  expect((await restored.read())?.ledger.people[0]).toEqual(
    migrateArchitecture(ledger).ledger.people[0],
  );
});

it("rejects silently omitted links on local save and old backups, while allowing explicit clearing", async () => {
  const repo = repository();
  await repo.ensure("real", fixture());
  const omitted = fixture();
  delete omitted.people[0].workIds;
  await expect(repo.save(omitted)).rejects.toThrow(
    "person_work_links_would_be_lost",
  );
  const backup = JSON.parse(await repo.exportBackup());
  delete backup.ledger.people[0].workIds;
  await expect(
    repo.importBackup(JSON.stringify(backup), { replace: true }),
  ).rejects.toThrow("person_work_links_would_be_lost");
  const cleared = fixture();
  cleared.people[0].workIds = [];
  await repo.save(cleared);
  expect((await repo.read())?.ledger.people[0].workIds).toEqual([]);
});

it("keeps the local links and creates a conflict if a newer cloud copy strips them", async () => {
  const repo = repository();
  await repo.ensure("real", fixture());
  const omitted = fixture();
  delete omitted.people[0].workIds;
  const result = await synchronizeWorkspace(
    {
      ownerId: "owner-one",
      load: async () => ({ revision: 1, document: omitted, updatedAt: null }),
      save: async () => {
        throw new Error("Unexpected cloud write");
      },
    },
    repo,
  );
  expect(result.status).toBe("conflict");
  expect((await repo.read())?.ledger.people[0].workIds).toEqual([
    "bathroom",
    "electric",
  ]);
  expect(await repo.database.conflicts.get("real")).toBeTruthy();
});

it("keeps notebook links during reviewed backup merging and requires explicit clearing", async () => {
  const repo = repository();
  const current = fixture();
  await repo.ensure("real", current);
  const copy = JSON.parse(await repo.exportBackup());
  delete copy.ledger.people[0].workIds;
  const options = {
    expectedLedger: current,
    decisions: { "people:worker": "backup" as const },
    confirmed: true as const,
    at: "2026-11-03T14:00:00.000Z",
  };
  await expect(repo.mergeBackup(JSON.stringify(copy), options)).rejects.toThrow(
    "person_work_links_would_be_lost",
  );
  expect((await repo.read())?.ledger.people[0].workIds).toEqual([
    "bathroom",
    "electric",
  ]);
  expect(await repo.database.recoveries.count()).toBe(0);
  copy.ledger.people[0].workIds = [];
  expect(await repo.mergeBackup(JSON.stringify(copy), options)).toEqual({
    changed: true,
  });
  expect((await repo.read())?.ledger.people[0].workIds).toEqual([]);
  expect((await repo.read())?.ledger.entries).toEqual([]);
  expect((await repo.read())?.ledger.contracts).toEqual([]);
  const cleared = (await repo.read())!.ledger;
  delete copy.ledger.people[0].workIds;
  await expect(
    repo.mergeBackup(JSON.stringify(copy), {
      ...options,
      expectedLedger: cleared,
    }),
  ).rejects.toThrow("person_work_links_would_be_lost");
});
