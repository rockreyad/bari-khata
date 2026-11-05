import { migrateArchitecture } from "../domain/architectureMigration";
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { LedgerSchema, type Ledger } from "../domain/model";
import { summarize } from "../domain/ledger";
import { cashSummary } from "../domain/cashSummary";
import { LedgerDatabase, setActiveOwner } from "./database";
import { LedgerRepository, parseBackup } from "./repository";
import { planBackupMerge, preservesBackupPersonWorkLinks } from "./backupMerge";

const at = "2026-11-03T14:00:00.000Z";
const databases: LedgerDatabase[] = [];
function ledger() {
  return LedgerSchema.parse({
    works: [{ id: "house", name: "বাড়ির কাজ" }],
    people: [{ id: "shop", name: "দোকান", kind: "shop" }],
    entries: [
      {
        id: "bill",
        kind: "expense",
        personId: "shop",
        lines: [
          { id: "line", workId: "house", label: "মাল", amount: 444891600 },
        ],
      },
      {
        id: "paid",
        kind: "payment",
        personId: "shop",
        allocations: [{ workId: "house", amount: 510000000 }],
        paymentParts: [{ amount: 510000000 }],
      },
    ],
  });
}
function text(value: Ledger) {
  return JSON.stringify({
    format: "bari-khata-backup",
    version: 1,
    exportedAt: at,
    ledger: value,
    receipts: [],
  });
}
async function repository(
  initial: Ledger = LedgerSchema.parse({}),
  owner: string | null = null,
) {
  const database = new LedgerDatabase(
    `backup-merge-${crypto.randomUUID()}`,
    owner,
  );
  databases.push(database);
  const repo = new LedgerRepository(database);
  await repo.ensure("real", initial);
  return repo;
}
function options(expectedLedger: Ledger, decisions = {}) {
  return { expectedLedger, decisions, confirmed: true as const, at };
}
afterEach(async () => {
  setActiveOwner(null);
  for (const database of databases.splice(0)) await database.delete();
});

describe("reviewed backup merging", () => {
  it("retains explicitly selected person notebooks when importing a copy that predates those links", () => {
    const person = Object.assign(ledger().people[0], { workIds: ["house"] });
    const cleared = Object.assign(ledger().people[0], { workIds: [] });
    expect(
      preservesBackupPersonWorkLinks(
        { people: [cleared] },
        { people: [ledger().people[0]] },
      ),
    ).toBe(false);
    expect(
      preservesBackupPersonWorkLinks(
        { people: [cleared] },
        { people: [cleared] },
      ),
    ).toBe(true);
    expect(
      preservesBackupPersonWorkLinks(
        { people: [person] },
        { people: [ledger().people[0]] },
      ),
    ).toBe(false);
    expect(
      preservesBackupPersonWorkLinks({ people: [person] }, { people: [] }),
    ).toBe(false);
    expect(
      preservesBackupPersonWorkLinks(
        { people: [person] },
        { people: [Object.assign(ledger().people[0], { workIds: undefined })] },
      ),
    ).toBe(false);
    expect(
      preservesBackupPersonWorkLinks(
        { people: [person] },
        { people: [Object.assign(ledger().people[0], { workIds: [] })] },
      ),
    ).toBe(true);
    expect(
      preservesBackupPersonWorkLinks(
        { people: [person] },
        { people: [person] },
      ),
    ).toBe(true);
    expect(
      preservesBackupPersonWorkLinks(
        { people: ledger().people },
        { people: ledger().people },
      ),
    ).toBe(true);
  });

  it("binds a cross-account import to its current owner and leaves the source account intact", async () => {
    const firstOwner = "00000000-0000-4000-8000-000000000001";
    const secondOwner = "00000000-0000-4000-8000-000000000002";
    const source = await repository(ledger(), firstOwner);
    const backup = await source.exportBackup();
    const target = await repository(LedgerSchema.parse({}), secondOwner);
    const initial = (await target.read())!.ledger;
    setActiveOwner(secondOwner);
    await target.mergeBackup(backup, options(initial));
    expect((await target.read())!.ownerId).toBe(secondOwner);
    expect((await target.read())!.ledger).toEqual(
      migrateArchitecture((await source.read())!.ledger).ledger,
    );
    expect((await source.read())!.generation).toBe(0);
    setActiveOwner(firstOwner);
    await expect(
      target.mergeBackup(backup, options((await target.read())!.ledger)),
    ).rejects.toThrow("account_changed");
  });

  it("imports into another notebook, preserves separate bills/payments and is a no-op on repeat and reopen", async () => {
    const source = ledger();
    const repo = await repository();
    const initial = (await repo.read())!.ledger;
    expect(await repo.mergeBackup(text(source), options(initial))).toEqual({
      changed: true,
    });
    const saved = (await repo.read())!;
    expect(summarize(saved.ledger).cost).toBe(444891600);
    expect(cashSummary(saved.ledger).netPaid).toBe(510000000);
    expect(saved.ledger.entries).toHaveLength(2);
    const recoveries = await repo.database.recoveries.count();
    repo.database.close();
    await repo.database.open();
    expect(await repo.mergeBackup(text(source), options(saved.ledger))).toEqual(
      { changed: false },
    );
    expect((await repo.read())!.generation).toBe(saved.generation);
    expect(await repo.database.recoveries.count()).toBe(recoveries);
    expect(parseBackup(await repo.exportBackup()).ledger).toEqual(saved.ledger);
  });

  it("keeps local-only records and adds only stable IDs that are absent", async () => {
    const current = ledger();
    const incoming = LedgerSchema.parse({
      ...current,
      entries: [
        current.entries[0],
        {
          id: "extra",
          kind: "expense",
          lines: [{ id: "extra-line", workId: "house", amount: 100 }],
        },
      ],
    });
    const repo = await repository(current);
    await repo.mergeBackup(text(incoming), options(current));
    expect(
      (await repo.read())!.ledger.entries.map((entry) => entry.id),
    ).toEqual(["bill", "paid", "extra"]);
    expect(cashSummary((await repo.read())!.ledger).netPaid).toBe(510000000);
    expect(summarize((await repo.read())!.ledger).cost).toBe(444891700);
  });

  it("requires a decision for changed IDs, audits the selected update and skips its repeated import", async () => {
    const current = ledger();
    const incoming = LedgerSchema.parse({
      ...current,
      entries: current.entries.map((entry) =>
        entry.id === "bill"
          ? { ...entry, lines: [{ ...entry.lines[0], amount: 444900000 }] }
          : entry,
      ),
    });
    const repo = await repository(current);
    const plan = planBackupMerge(current, incoming, {}, at);
    expect(plan.unresolved.map((record) => record.key)).toEqual([
      "entries:bill",
    ]);
    await expect(
      repo.mergeBackup(text(incoming), options(current)),
    ).rejects.toThrow("backup_decisions_required");
    expect((await repo.read())!.generation).toBe(0);
    await repo.mergeBackup(
      text(incoming),
      options(current, { "entries:bill": "backup" }),
    );
    const saved = (await repo.read())!;
    expect(saved.ledger.entries[0].revisions[0].before.lines[0].amount).toBe(
      444891600,
    );
    expect(saved.ledger.entries[0].lines[0].amount).toBe(444900000);
    expect(saved.ledger.entries[1]).toEqual(current.entries[1]);
    expect(
      await repo.mergeBackup(text(incoming), options(saved.ledger)),
    ).toEqual({ changed: false });
    expect((await repo.read())!.generation).toBe(saved.generation);
  });

  it("can explicitly keep local changes without overwriting them", async () => {
    const current = ledger();
    const incoming = LedgerSchema.parse({
      ...current,
      people: [{ ...current.people[0], name: "ফাইলের দোকান" }],
    });
    const repo = await repository(current);
    expect(
      await repo.mergeBackup(
        text(incoming),
        options(current, { "people:shop": "current" }),
      ),
    ).toEqual({ changed: false });
    expect((await repo.read())!.ledger).toEqual(current);
    expect(await repo.database.recoveries.count()).toBe(0);
  });

  it("rejects a stale preview before changing data or recovery copies", async () => {
    const current = ledger();
    const repo = await repository(current);
    await repo.save({
      ...current,
      project: { ...current.project, name: "এখনকার নাম" },
    });
    await expect(
      repo.mergeBackup(text(current), options(current)),
    ).rejects.toThrow("backup_preview_changed");
    expect((await repo.read())!.ledger.project.name).toBe("এখনকার নাম");
    expect(await repo.database.recoveries.count()).toBe(0);
  });

  it("rejects contradictory linked selections before storing any row", async () => {
    const base = ledger();
    const current = LedgerSchema.parse({
      ...base,
      people: [
        ...base.people,
        { id: "other-shop", name: "অন্য দোকান", kind: "shop" },
      ],
      entries: [
        { ...base.entries[0], personId: "shop" },
        {
          ...base.entries[1],
          personId: "shop",
          relatedEntryId: "bill",
          allocations: [{ workId: "house", amount: 444891600 }],
          paymentParts: [{ amount: 444891600 }],
        },
      ],
    });
    const incoming = LedgerSchema.parse({
      ...current,
      entries: current.entries.map((entry) => ({
        ...entry,
        personId: "other-shop",
      })),
    });
    const repo = await repository(current);
    await expect(
      repo.mergeBackup(
        text(incoming),
        options(current, {
          "entries:bill": "backup",
          "entries:paid": "current",
        }),
      ),
    ).rejects.toThrow("backup_merge_invalid");
    expect((await repo.read())!.ledger).toEqual(current);
    expect(await repo.database.recoveries.count()).toBe(0);
  });

  it("rejects malformed amounts and demo data before writing", async () => {
    const current = ledger();
    const repo = await repository(current);
    const corrupt = JSON.parse(text(current));
    corrupt.ledger.entries[0].lines[0].amount = -1;
    await expect(
      repo.mergeBackup(JSON.stringify(corrupt), options(current)),
    ).rejects.toThrow();
    await expect(
      repo.mergeBackup(
        text(LedgerSchema.parse({ ...current, isDemo: true })),
        options(current),
      ),
    ).rejects.toThrow("workspace_mode_mismatch");
    expect((await repo.read())!.ledger).toEqual(current);
  });

  it("retains pending outbound work and refuses to replace an unresolved cloud conflict", async () => {
    const current = ledger();
    const repo = await repository(current);
    const queued = {
      id: "queued",
      workspace: "real" as const,
      ownerId: "owner",
      generation: 0,
      baseRevision: 0,
      ledger: current,
      createdAt: at,
    };
    await repo.database.outbox.put(queued);
    const incoming = LedgerSchema.parse({
      ...current,
      items: [{ id: "new-item", name: "নতুন মাল" }],
    });
    await repo.mergeBackup(text(incoming), options(current));
    expect(await repo.database.outbox.get("queued")).toEqual(queued);
    const saved = (await repo.read())!;
    const conflict = {
      id: "real" as const,
      ownerId: "owner",
      ledger: current,
      revision: 3,
      updatedAt: at,
    };
    await repo.database.conflicts.put(conflict);
    await expect(
      repo.mergeBackup(text(incoming), options(saved.ledger)),
    ).rejects.toThrow("backup_sync_conflict");
    expect(await repo.database.conflicts.get("real")).toEqual(conflict);
    expect((await repo.read())!.generation).toBe(saved.generation);
    expect(await repo.database.outbox.get("queued")).toEqual(queued);
  });

  it("round-trips vouchers, keeps recovery bytes and rejects same-ID content changes", async () => {
    const initial = LedgerSchema.parse({});
    const source = await repository(initial);
    const value = ledger();
    value.entries[0].receipts = [
      { id: "receipt", name: "receipt.png", mime: "image/png", size: 4 },
    ];
    await source.save(value, "real", [
      {
        id: "receipt",
        entryId: "bill",
        file: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }),
        name: "receipt.png",
      },
    ]);
    const backup = await source.exportBackup();
    const repo = await repository(initial);
    await repo.mergeBackup(backup, options(initial));
    expect(
      new Uint8Array(
        await (await repo.getReceipt("receipt"))!.blob.arrayBuffer(),
      ),
    ).toEqual(new Uint8Array([1, 2, 3, 4]));
    const corrupt = JSON.parse(backup);
    delete corrupt.integrity;
    corrupt.receipts[0].base64 = "BAQDBA==";
    const saved = (await repo.read())!;
    await expect(
      repo.mergeBackup(JSON.stringify(corrupt), options(saved.ledger)),
    ).rejects.toThrow("receipt_content_conflict");
    expect((await repo.read())!.generation).toBe(saved.generation);
    expect(await repo.database.recoveries.count()).toBe(1);
    expect(
      new Uint8Array(
        await (await repo.getReceipt("receipt"))!.blob.arrayBuffer(),
      ),
    ).toEqual(new Uint8Array([1, 2, 3, 4]));
  });
});
