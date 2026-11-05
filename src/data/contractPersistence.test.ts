import { migrateArchitecture } from "../domain/architectureMigration";
import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { LedgerDatabase } from "./database";
import { LedgerRepository } from "./repository";
import { ContractSchema, LedgerSchema } from "../domain/model";
import { saveContractChange } from "../domain/contracts";
it("reopens and restores contract history while refusing a save or backup that drops its audit trail", async () => {
  const db = new LedgerDatabase(`contract-persistence-${crypto.randomUUID()}`);
  const restoreDb = new LedgerDatabase(
    `contract-restore-${crypto.randomUUID()}`,
  );
  try {
    const repo = new LedgerRepository(db);
    const original = saveContractChange(
      LedgerSchema.parse({
        people: [{ id: "worker", name: "শাহ আলম", kind: "worker" }],
      }),
      ContractSchema.parse({
        id: "c",
        scope: "house",
        personId: "worker",
        total: 60000000,
        rate: 60000000,
        agreedOn: "2026-11-01",
      }),
      "চুক্তি করেছি",
      "2026-11-01T03:00:00Z",
    );
    await repo.ensure("real", original);
    const changed = saveContractChange(
      original,
      { ...original.contracts[0], total: 65000000, rate: 65000000 },
      "সিঁড়ির কাজ যোগ হয়েছে",
      "2026-11-02T03:00:00Z",
    );
    await repo.save(changed);
    db.close();
    await db.open();
    expect((await repo.read("real"))?.ledger.contracts[0].activity).toEqual(
      changed.contracts[0].activity,
    );
    const backup = await repo.exportBackup("real");
    const restore = new LedgerRepository(restoreDb);
    await restore.ensure("real", LedgerSchema.parse({}));
    await restore.importBackup(backup, { replace: true });
    expect((await restore.read("real"))?.ledger).toEqual(
      migrateArchitecture(changed).ledger,
    );
    const stripped = structuredClone(changed);
    stripped.contracts[0].activity = [];
    await expect(repo.save(stripped)).rejects.toThrow(
      "contract_history_would_be_lost",
    );
    const corrupt = JSON.parse(backup);
    delete corrupt.integrity;
    corrupt.ledger.contracts[0].activity = [];
    await expect(
      repo.importBackup(JSON.stringify(corrupt), { replace: true }),
    ).rejects.toThrow("contract_history_would_be_lost");
    expect((await repo.read("real"))?.ledger).toEqual(changed);
  } finally {
    await db.delete();
    await restoreDb.delete();
  }
});
