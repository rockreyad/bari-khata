import { migrateArchitecture } from "./architectureMigration";
import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { LedgerDatabase } from "../data/database";
import { LedgerRepository } from "../data/repository";
import { ContractSchema, LedgerSchema, type Ledger } from "./model";
import {
  contractChanges,
  preservesContractHistory,
  saveContractChange,
} from "./contracts";
import { contractSummary } from "./ledger";

function fixture(total = 8700000, calculatedTotal = 8730800) {
  return saveContractChange(
    LedgerSchema.parse({
      works: [{ id: "work", name: "নির্মাণের কাজ" }],
      people: [{ id: "worker", name: "মিস্ত্রি", kind: "worker" }],
    }),
    ContractSchema.parse({
      id: "agreement",
      workId: "work",
      personId: "worker",
      basis: "sqft",
      quantity: "৩৭৯৬",
      rate: 2300,
      calculatedTotal,
      total,
    }),
    "চুক্তি করেছি",
    "2026-11-01T03:00:00Z",
  );
}

it("keeps the exact quantity/rate calculation and separately agreed total in audited terms", () => {
  const ledger = fixture();
  const agreement = ledger.contracts[0];
  expect(agreement).toMatchObject({
    quantity: "3796",
    rate: 2300,
    calculatedTotal: 8730800,
    total: 8700000,
  });
  expect(agreement.activity[0].after).toMatchObject({
    calculatedTotal: 8730800,
    total: 8700000,
  });
  expect(contractSummary(ledger, agreement.id)).toMatchObject({
    agreed: 8700000,
    remaining: 8700000,
  });
  const updated = saveContractChange(
    ledger,
    { ...agreement, total: 8500000 },
    "আরও কিছু টাকা কমিয়েছেন",
    "2026-11-02T03:00:00Z",
  );
  expect(updated.contracts[0].activity[1].before).toMatchObject({
    total: 8700000,
    calculatedTotal: 8730800,
  });
  expect(contractSummary(updated, agreement.id).remaining).toBe(8500000);
  expect(preservesContractHistory(ledger, updated)).toBe(true);
});

it("rejects fabricated calculations and a missing calculation on newly negotiated history", () => {
  const ledger = fixture();
  for (const calculatedTotal of [
    0,
    8730801,
    12.5,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    expect(
      ContractSchema.safeParse({ ...ledger.contracts[0], calculatedTotal })
        .success,
    ).toBe(false);
  }
  const stripped = JSON.parse(JSON.stringify(ledger)) as Ledger;
  delete stripped.contracts[0].calculatedTotal;
  delete stripped.contracts[0].activity[0].after.calculatedTotal;
  expect(LedgerSchema.safeParse(stripped).success).toBe(false);
  const wrongBefore = JSON.parse(
    JSON.stringify(
      saveContractChange(
        ledger,
        { ...ledger.contracts[0], total: 8500000 },
        "কমিয়েছেন",
      ),
    ),
  ) as Ledger;
  wrongBefore.contracts[0].activity[1].before!.calculatedTotal = 1;
  expect(LedgerSchema.safeParse(wrongBefore).success).toBe(false);
});

it("keeps legacy rate-based agreements and accepts an audited transition to explicitly negotiated terms", () => {
  const legacy = fixture(8730800);
  delete legacy.contracts[0].calculatedTotal;
  delete legacy.contracts[0].activity[0].after.calculatedTotal;
  expect(LedgerSchema.parse(legacy)).toEqual(legacy);
  const updated = saveContractChange(
    legacy,
    { ...legacy.contracts[0], calculatedTotal: 8730800, total: 8700000 },
    "শেষে টাকা ঠিক করেছেন",
  );
  expect(
    updated.contracts[0].activity[1].before?.calculatedTotal,
  ).toBeUndefined();
  expect(updated.contracts[0].activity[1].after.calculatedTotal).toBe(8730800);
  expect(preservesContractHistory(legacy, updated)).toBe(true);
  expect(
    contractChanges(legacy.contracts[0], {
      ...legacy.contracts[0],
      calculatedTotal: null,
    }),
  ).toEqual([]);
});

it("round-trips agreed terms through IndexedDB and backups and rejects old-client metadata loss even when money matches", async () => {
  const database = new LedgerDatabase(`agreed-total-${crypto.randomUUID()}`);
  const restoreDatabase = new LedgerDatabase(
    `agreed-restore-${crypto.randomUUID()}`,
  );
  try {
    const repository = new LedgerRepository(database);
    const original = fixture(8730800);
    await repository.ensure("real", original);
    const oldClient = JSON.parse(JSON.stringify(original)) as Ledger;
    delete oldClient.contracts[0].calculatedTotal;
    delete oldClient.contracts[0].activity[0].after.calculatedTotal;
    expect(LedgerSchema.safeParse(oldClient).success).toBe(true);
    expect(preservesContractHistory(original, oldClient)).toBe(false);
    await expect(repository.save(oldClient)).rejects.toThrow(
      "contract_history_would_be_lost",
    );
    const changed = saveContractChange(
      original,
      { ...original.contracts[0], total: 8500000 },
      "চূড়ান্ত টাকা",
      "2026-11-02T03:00:00Z",
    );
    await repository.save(changed);
    database.close();
    await database.open();
    expect((await repository.read())!.ledger).toEqual(changed);
    const backup = await repository.exportBackup();
    const restore = new LedgerRepository(restoreDatabase);
    await restore.ensure("real", LedgerSchema.parse({}));
    await restore.importBackup(backup, { replace: true });
    expect((await restore.read())!.ledger).toEqual(
      migrateArchitecture(changed).ledger,
    );
    const damaged = JSON.parse(backup);
    damaged.ledger.contracts[0].calculatedTotal = 100;
    await expect(
      restore.importBackup(JSON.stringify(damaged), { replace: true }),
    ).rejects.toThrow();
    expect((await restore.read())!.ledger).toEqual(
      migrateArchitecture(changed).ledger,
    );
  } finally {
    await database.delete();
    await restoreDatabase.delete();
  }
});
