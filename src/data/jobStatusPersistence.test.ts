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
import { ContractSchema, LedgerSchema, type Ledger } from "../domain/model";
import { saveContractChange } from "../domain/contracts";
import { createEmptyLedger } from "../domain/demo";
import {
  legacyJobStatusLedger,
  withoutJobStatus,
} from "../domain/testing/legacyJobStatus";

const databases: LedgerDatabase[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) await database.delete();
});
function repository() {
  const database = new LedgerDatabase(`job-status-${crypto.randomUUID()}`);
  databases.push(database);
  return new LedgerRepository(database);
}
const done = (ledger: Ledger) =>
  saveContractChange(
    ledger,
    ContractSchema.parse({ ...ledger.contracts[0], status: "done" }),
    "কাজ শেষ হয়েছে",
    "2026-11-02T00:00:00Z",
  );

it("rehydrates old disk/backup status as unknown, then saves an audited status without rewriting financial data", async () => {
  const raw = legacyJobStatusLedger();
  const source = repository();
  await source.ensure("real", LedgerSchema.parse(raw));
  for (const contract of raw.contracts) {
    const record = await source.database.ledgerEntities
      .where("[workspace+collection+id]")
      .equals(["real", "contracts", contract.id])
      .first();
    await source.database.ledgerEntities.update(record!.key, {
      value: contract,
    });
  }
  source.database.close();
  await source.database.open();
  const opened = (await source.read())!.ledger;
  expect(opened.contracts[0].status).toBeNull();
  expect(withoutJobStatus(opened)).toEqual(raw);
  const backup = JSON.parse(await source.exportBackup());
  backup.ledger = raw;
  const target = repository();
  await target.ensure("real", createEmptyLedger());
  await target.importBackup(JSON.stringify(backup), { replace: true });
  expect(withoutJobStatus((await target.read())!.ledger)).toEqual(
    withoutJobStatus(migrateArchitecture(raw).ledger),
  );
  const updated = done(opened);
  await source.save(updated);
  expect((await source.read())!.ledger).toEqual(updated);
  expect(updated.entries).toEqual(opened.entries);
  expect(updated.contracts[0].total).toBe(opened.contracts[0].total);
  const before = await source.read();
  const outbox = await source.database.outbox.toArray();
  const recoveries = await source.database.recoveries.toArray();
  await expect(
    source.importBackup(JSON.stringify(backup), { replace: true }),
  ).rejects.toThrow("contract_history_would_be_lost");
  expect(await source.read()).toEqual(before);
  expect(await source.database.outbox.toArray()).toEqual(outbox);
  expect(await source.database.recoveries.toArray()).toEqual(recoveries);
  const currentBackup = JSON.parse(await source.exportBackup());
  for (const contract of currentBackup.ledger.contracts) {
    for (const event of contract.activity) {
      if (event.before?.status === null) delete event.before.status;
      if (event.after.status === null) delete event.after.status;
    }
  }
  await source.importBackup(JSON.stringify(currentBackup), { replace: true });
  expect((await source.read())!.ledger.contracts[0]).toEqual(
    updated.contracts[0],
  );
});

it("refuses unaudited status changes before altering saved ledger state", async () => {
  const source = repository();
  const initial = LedgerSchema.parse({
    ...legacyJobStatusLedger(),
    contracts: legacyJobStatusLedger().contracts.map((contract) => ({
      ...contract,
      activity: [],
    })),
  });
  await source.ensure("real", initial);
  const changed = LedgerSchema.parse({
    ...initial,
    contracts: initial.contracts.map((contract) => ({
      ...contract,
      status: "ongoing",
    })),
  });
  const before = await source.read();
  await expect(source.save(changed)).rejects.toThrow(
    "contract_history_would_be_lost",
  );
  expect(await source.read()).toEqual(before);
});

it("keeps an audited completion when a newer cloud copy drops the status event", async () => {
  const source = repository();
  const initial = LedgerSchema.parse(legacyJobStatusLedger());
  const updated = done(initial);
  await source.ensure("real", initial);
  await source.save(updated);
  let cloud: CloudSnapshot = { revision: 0, document: null, updatedAt: null };
  let writes = 0;
  const transport: CloudTransport = {
    ownerId: "synthetic-status-owner",
    load: async () => cloud,
    save: async (operation) => {
      writes++;
      cloud = {
        revision: cloud.revision + 1,
        document: operation.ledger,
        updatedAt: "2026-11-02T00:00:00Z",
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
  cloud = { revision: 2, document: initial, updatedAt: "2026-11-03T00:00:00Z" };
  expect(await synchronizeWorkspace(transport, source)).toMatchObject({
    status: "conflict",
  });
  expect((await source.read())!.ledger.contracts[0].status).toBe("done");
  expect((await source.read())!.ledger.contracts[0].activity).toEqual(
    updated.contracts[0].activity,
  );
  expect(
    (await source.database.conflicts.get("real"))!.ledger.contracts[0].status,
  ).toBeNull();
  expect(writes).toBe(1);
});
