import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import { EntrySchema, LedgerSchema, type Ledger } from "../domain/model";
import { appendBalanceAdjustment } from "../domain/balanceAdjustments";
import { setEntryVoided } from "../domain/ledger";
import { applyMcpCommand } from "../application/mcpCommands";
import { LedgerDatabase } from "./database";
import { LedgerRepository, parseBackup } from "./repository";
import { planBackupMerge } from "./backupMerge";
import { synchronizeWorkspace, type CloudSnapshot } from "./sync";

const databases: LedgerDatabase[] = [];
const at = "2026-11-03T10:00:00.000Z";
const mergeOptions = (expectedLedger: Ledger) => ({
  confirmed: true as const,
  expectedLedger,
  decisions: {},
  at: "2026-11-03T11:00:00.000Z",
});
const initial = () =>
  LedgerSchema.parse({
    works: [{ id: "roof", name: "নমুনা ছাদ" }],
    people: [{ id: "shop", name: "নমুনা দোকান", kind: "shop" }],
    entries: [
      {
        id: "bill",
        kind: "expense",
        account: "materials",
        personId: "shop",
        lines: [
          {
            id: "cement",
            workId: "roof",
            amount: 100000,
            costType: "material",
          },
        ],
      },
      {
        id: "paid",
        kind: "payment",
        account: "materials",
        personId: "shop",
        paymentParts: [{ method: "cash", amount: 30000 }],
        allocations: [{ workId: "roof", amount: 30000 }],
      },
    ],
  });
const adjusted = (ledger = initial()) =>
  appendBalanceAdjustment(
    ledger,
    {
      target: "person",
      basis: "balance",
      personId: "shop",
      account: "materials",
      workId: "roof",
      expectedBefore: 70000,
      after: 50000,
      reason: "নমুনা আগের হিসাব ঠিক করেছি",
      date: "2026-11-03",
    },
    at,
  );
function repository() {
  const db = new LedgerDatabase(`adjustment-${crypto.randomUUID()}`);
  databases.push(db);
  return new LedgerRepository(db);
}
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});

it("keeps paid/cost correction metadata and a work-only adjustment separate from the original cash events", async () => {
  const source = repository();
  const before = initial();
  const corrections = [
    EntrySchema.parse({
      id: "paid-correction",
      kind: "adjustment",
      personId: "shop",
      account: "materials",
      adjustment: {
        target: "person",
        basis: "paid",
        account: "materials",
        delta: 20000,
        before: 30000,
        after: 50000,
        workId: null,
      },
      note: "নমুনা মোট দেওয়া ঠিক করেছি",
      createdAt: at,
      updatedAt: at,
    }),
    EntrySchema.parse({
      id: "cost-correction",
      kind: "adjustment",
      personId: "shop",
      account: "materials",
      adjustment: {
        target: "person",
        basis: "cost",
        account: "materials",
        delta: -10000,
        before: 100000,
        after: 90000,
        workId: null,
      },
      note: "নমুনা মোট খরচ ঠিক করেছি",
      createdAt: at,
      updatedAt: at,
    }),
    EntrySchema.parse({
      id: "work-correction",
      kind: "adjustment",
      personId: null,
      account: "other",
      adjustment: {
        target: "work",
        basis: "paid",
        account: null,
        delta: 10000,
        before: 30000,
        after: 40000,
        workId: "roof",
      },
      note: "নমুনা খাতায় মোট দেওয়া ঠিক করেছি",
      createdAt: at,
      updatedAt: at,
    }),
  ];
  await source.ensure("real", before);
  const ledger = LedgerSchema.parse({
    ...before,
    entries: [...before.entries, ...corrections],
  });
  await source.save(ledger);
  source.database.close();
  await source.database.open();
  const backup = await source.exportBackup();
  expect(parseBackup(backup).ledger.entries).toEqual(ledger.entries);
  expect(ledger.entries.slice(0, 2)).toEqual(before.entries);
  const target = repository();
  const empty = LedgerSchema.parse({});
  await target.ensure("real", empty);
  expect(await target.mergeBackup(backup, mergeOptions(empty))).toEqual({
    changed: true,
  });
  expect((await target.read())!.ledger).toEqual(ledger);
  expect(await target.mergeBackup(backup, mergeOptions(ledger))).toEqual({
    changed: false,
  });
  expect(await target.database.recoveries.count()).toBe(1);
});

it("round-trips noncash adjustments and audited void/restore through IndexedDB and backup merge without duplicating them", async () => {
  const source = repository();
  const before = initial();
  await source.ensure("real", before);
  const withAdjustment = adjusted(before);
  await source.save(withAdjustment);
  const adjustment = withAdjustment.entries.at(-1)!;
  const voided = setEntryVoided(withAdjustment, adjustment.id, true);
  await source.save(voided);
  const restored = setEntryVoided(voided, adjustment.id, false);
  await source.save(restored);
  source.database.close();
  await source.database.open();
  expect((await source.read())!.ledger).toEqual(restored);
  expect(restored.entries.slice(0, 2)).toEqual(before.entries);
  expect(adjustment).toMatchObject({
    kind: "adjustment",
    adjustment: { before: 70000, after: 50000, delta: -20000, workId: "roof" },
    lines: [],
    paymentParts: [],
    allocations: [],
    receipts: [],
  });
  const backup = await source.exportBackup();
  expect(parseBackup(backup).ledger).toEqual(restored);
  const target = repository();
  await target.ensure("real", LedgerSchema.parse({}));
  await target.importBackup(backup, { replace: true });
  expect((await target.read())!.ledger).toEqual(restored);
  expect(await target.mergeBackup(backup, mergeOptions(restored))).toEqual({
    changed: false,
  });
  expect(await target.database.recoveries.count()).toBe(1);
  expect(
    (await target.read())!.ledger.entries.filter(
      (entry) => entry.id === adjustment.id,
    ),
  ).toHaveLength(1);
});

it("rejects old-client removal or same-ID rewrites before changing the ledger or recovery data", async () => {
  const source = repository();
  await source.ensure("real", initial());
  const oldBackup = await source.exportBackup();
  const ledger = adjusted();
  await source.save(ledger);
  const saved = await source.read();
  await expect(source.save(initial())).rejects.toThrow(
    "balance_adjustment_would_be_lost",
  );
  await expect(
    source.importBackup(oldBackup, { replace: true }),
  ).rejects.toThrow("balance_adjustment_would_be_lost");
  expect(await source.mergeBackup(oldBackup, mergeOptions(ledger))).toEqual({
    changed: false,
  });
  const backup = JSON.parse(await source.exportBackup());
  const entry = backup.ledger.entries.at(-1);
  entry.adjustment.after = 40000;
  entry.adjustment.delta = -30000;
  expect(
    planBackupMerge(ledger, parseBackup(JSON.stringify(backup)).ledger, {
      [`entries:${entry.id}`]: "backup",
    }),
  ).toMatchObject({ ledger: null, historyConflict: true });
  await expect(
    source.mergeBackup(JSON.stringify(backup), {
      ...mergeOptions(ledger),
      decisions: { [`entries:${entry.id}`]: "backup" },
    }),
  ).rejects.toThrow();
  expect(await source.read()).toEqual(saved);
  expect(await source.database.recoveries.count()).toBe(0);
  expect(await source.database.outbox.count()).toBe(0);
});

it("refuses malformed adjustment snapshots and unaudited voiding during backup restore atomically", async () => {
  const source = repository();
  const ledger = adjusted();
  await source.ensure("real", ledger);
  const backup = JSON.parse(await source.exportBackup());
  const voided = setEntryVoided(ledger, ledger.entries.at(-1)!.id, true);
  backup.ledger = voided;
  backup.ledger.entries.at(-1).revisions[0].before.adjustment.delta = 1;
  const before = await source.read();
  await expect(
    source.importBackup(JSON.stringify(backup), { replace: true }),
  ).rejects.toThrow();
  const unaudited = structuredClone(ledger);
  unaudited.entries.at(-1)!.voided = true;
  await expect(source.save(unaudited)).rejects.toThrow(
    "balance_adjustment_history_invalid",
  );
  expect(await source.read()).toEqual(before);
  expect(await source.database.recoveries.count()).toBe(0);
});

it("keeps adjustments in sync transport and records a conflict if a newer cloud copy drops one", async () => {
  const source = repository();
  const ledger = adjusted();
  await source.ensure("real", initial());
  await source.save(ledger);
  let cloud: CloudSnapshot = { revision: 0, document: null, updatedAt: null };
  const transport = {
    ownerId: "synthetic-adjustment-owner",
    load: async () => cloud,
    save: async (operation: { ledger: Ledger }) => {
      cloud = {
        revision: cloud.revision + 1,
        document: operation.ledger,
        updatedAt: at,
      };
      return {
        status: "saved" as const,
        revision: cloud.revision,
        updatedAt: at,
      };
    },
  };
  expect(await synchronizeWorkspace(transport, source)).toMatchObject({
    status: "synced",
  });
  expect(cloud.document).toEqual(ledger);
  cloud = { revision: 2, document: initial(), updatedAt: at };
  expect(await synchronizeWorkspace(transport, source)).toEqual({
    status: "conflict",
  });
  expect((await source.read())!.ledger).toEqual(ledger);
  expect((await source.database.conflicts.get("real"))!.ledger).toEqual(
    initial(),
  );
});

it("preserves adjustment history during unrelated MCP writes and audited MCP void/restore", async () => {
  const source = repository();
  const ledger = adjusted();
  await source.ensure("real", ledger);
  const context = {
    now: "2026-11-03T12:00:00.000Z",
    actor: { connectionId: "synthetic-assistant", name: "নমুনা সহকারী" },
    source: { origin: "text" as const, sourceEventId: "synthetic-void" },
  };
  const result = applyMcpCommand(
    ledger,
    {
      type: "void_entry",
      entry_id: ledger.entries.at(-1)!.id,
      expected_updated_at: at,
      reason: "নমুনা ভুল সমন্বয় বাতিল করেছি",
    },
    context,
  );
  expect(result.amountPaisa).toBe(20000);
  await source.save(result.ledger);
  expect(
    (await source.read())!.ledger.entries.at(-1)!.revisions[0].before,
  ).toMatchObject({
    adjustment: ledger.entries.at(-1)!.adjustment,
    voided: false,
  });
  const changed = applyMcpCommand(
    result.ledger,
    {
      type: "create_work",
      name: "নমুনা নতুন কাজ",
    },
    { ...context, now: "2026-11-03T12:01:00.000Z" },
  ).ledger;
  await source.save(changed);
  expect((await source.read())!.ledger.entries).toEqual(result.ledger.entries);
  const restored = applyMcpCommand(
    changed,
    {
      type: "restore_entry",
      entry_id: ledger.entries.at(-1)!.id,
      expected_updated_at: result.ledger.entries.at(-1)!.updatedAt,
      reason: "নমুনা সমন্বয় আবার চালু করেছি",
    },
    { ...context, now: "2026-11-03T12:02:00.000Z" },
  ).ledger;
  await source.save(restored);
  expect((await source.read())!.ledger.entries.at(-1)).toMatchObject({
    voided: false,
    adjustment: ledger.entries.at(-1)!.adjustment,
  });
  expect(restored.entries.at(-1)!.revisions).toHaveLength(2);
});
