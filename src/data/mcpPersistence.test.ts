import { migrateArchitecture } from "../domain/architectureMigration";
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LedgerSchema, type Ledger } from "../domain/model.js";
import { preservesMcpProvenance } from "../domain/mcpProvenance.js";
import { applyMcpCommand } from "../application/mcpCommands.js";
import { LedgerDatabase, type ReceiptRow } from "./database.js";
import {
  LedgerRepository,
  parseBackup,
  receiptReferences,
  validateLedger,
} from "./repository.js";
import {
  synchronizeWorkspace,
  createTransport,
  type CloudSnapshot,
  type CloudTransport,
} from "./sync.js";

const databases: LedgerDatabase[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) await database.delete();
});
const context = {
  now: "2026-11-02T10:00:00.000Z",
  actor: { connectionId: "assistant-one", name: "আমার সহকারী" },
  source: {
    origin: "image" as const,
    sourceEventId: "invoice-message-1",
    assetDigests: ["synthetic-asset-digest"],
  },
};
const receipt = {
  id: "mcp-receipt",
  name: "cement.png",
  mime: "image/png",
  size: 4,
};
const bytes = Uint8Array.from([1, 2, 3, 4]);
function repository() {
  const database = new LedgerDatabase(`mcp-persistence-${crypto.randomUUID()}`);
  databases.push(database);
  return new LedgerRepository(database);
}
function fixture(withReceipt = false) {
  const initial = LedgerSchema.parse({
    people: [{ id: "shop", name: "দোকান", kind: "shop" }],
    works: [{ id: "roof", name: "ছাদ" }],
  });
  return applyMcpCommand(
    initial,
    {
      type: "create_purchase",
      person_id: "shop",
      work_id: "roof",
      date: "2026-11-02",
      lines: [
        { label: "সিমেন্ট", cost_type: "material", amount_paisa: 6000000 },
      ],
      payment_state: "partial",
      payment: { amount_paisa: 2000000, method: "cash" },
      receipt_ids: withReceipt ? [receipt.id] : [],
    },
    { ...context, receipts: withReceipt ? [receipt] : [] },
  ).ledger;
}
function edited(ledger: Ledger) {
  return applyMcpCommand(
    ledger,
    {
      type: "update_entry",
      entry_id: ledger.entries[0].id,
      expected_updated_at: ledger.entries[0].updatedAt,
      reason: "বিলের অঙ্ক ঠিক করেছি",
      changes: {
        lines: [
          { label: "সিমেন্ট", cost_type: "material", amount_paisa: 5600000 },
        ],
      },
    },
    {
      ...context,
      now: "2026-11-02T11:00:00.000Z",
      source: { origin: "text", sourceEventId: "correction-message-2" },
    },
  ).ledger;
}

describe("MCP provenance in offline storage and backups", () => {
  it("keeps actor, evidence and revision provenance after save, reopen and full backup restore", async () => {
    const source = repository();
    await source.ensure("real", LedgerSchema.parse({}));
    const first = fixture(true);
    await source.save(first, "real", [
      {
        id: receipt.id,
        entryId: first.entries[0].id,
        name: receipt.name,
        file: new Blob([bytes], { type: receipt.mime }),
      },
    ]);
    const changed = edited(first);
    await source.save(changed);
    source.database.close();
    await source.database.open();
    expect((await source.read())!.ledger).toEqual(changed);
    const backup = await source.exportBackup();
    const parsed = parseBackup(backup);
    expect(parsed.ledger.entries[0].provenance).toMatchObject({
      origin: "text",
      connectionId: "assistant-one",
      sourceEventId: "correction-message-2",
    });
    expect(
      parsed.ledger.entries[0].revisions[0].before.provenance,
    ).toMatchObject({ origin: "image", sourceEventId: "invoice-message-1" });
    const target = repository();
    await target.ensure("real", LedgerSchema.parse({}));
    await target.importBackup(backup, { replace: true });
    expect((await target.read())!.ledger).toEqual(
      migrateArchitecture(changed).ledger,
    );
    expect(
      new Uint8Array(
        await (await target.getReceipt(receipt.id))!.blob.arrayBuffer(),
      ),
    ).toEqual(bytes);
  });
  it("rejects ordinary saves and restores that strip current or historical evidence before changing any stored data", async () => {
    const source = repository();
    const changed = edited(fixture());
    await source.ensure("real", changed);
    const before = await source.read();
    const outbox = await source.database.outbox.toArray();
    const recoveries = await source.database.recoveries.count();
    const stripped = structuredClone(changed);
    delete stripped.entries[0].provenance;
    expect(preservesMcpProvenance(changed, stripped)).toBe(false);
    await expect(source.save(stripped)).rejects.toThrow(
      "mcp_provenance_would_be_lost",
    );
    const backup = JSON.parse(await source.exportBackup());
    delete backup.integrity;
    delete backup.ledger.entries[0].revisions[0].before.provenance;
    await expect(
      source.importBackup(JSON.stringify(backup), { replace: true }),
    ).rejects.toThrow("mcp_provenance_would_be_lost");
    expect(await source.read()).toEqual(before);
    expect(await source.database.outbox.toArray()).toEqual(outbox);
    expect(await source.database.recoveries.count()).toBe(recoveries);
  });
  it("does not accept moving current provenance into a revision while clearing it from the active entry", () => {
    const before = fixture();
    const after = edited(before);
    delete after.entries[0].provenance;
    expect(after.entries[0].revisions[0].before.provenance).toEqual(
      before.entries[0].provenance,
    );
    expect(preservesMcpProvenance(before, after)).toBe(false);
  });
  it.each(["initial", "confirmed"] as const)(
    "retains the local ledger and records conflict when a cloud %s copy drops provenance",
    async (phase) => {
      const source = repository();
      const local = fixture();
      await source.ensure("real", local);
      await source.database.workspaces.update("real", {
        cloudRevision: 1,
        ownerId: "synthetic-owner",
      });
      const remote = structuredClone(local);
      delete remote.entries[0].provenance;
      let loads = 0;
      const transport: CloudTransport = {
        ownerId: "synthetic-owner",
        save: async () => {
          throw new Error("unexpected_upload");
        },
        load: async () => {
          loads++;
          return phase === "confirmed" && loads === 1
            ? { revision: 1, document: local, updatedAt: null }
            : { revision: 2, document: remote, updatedAt: null };
        },
      };
      expect(await synchronizeWorkspace(transport, source)).toMatchObject({
        status: "conflict",
      });
      expect((await source.read())!.ledger).toEqual(local);
      expect((await source.database.conflicts.get("real"))!.ledger).toEqual(
        remote,
      );
    },
  );
});

describe("historical MCP receipt references", () => {
  it("recognizes an identical immutable cloud receipt after restore without replacing its bytes", async () => {
    const upload = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "already exists" } });
    const download = vi.fn().mockResolvedValue({
      data: new Blob([bytes], { type: receipt.mime }),
      error: null,
    });
    const client = {
      storage: { from: () => ({ upload, download }) },
    } as unknown as SupabaseClient;
    const transport = createTransport(client, "owner-one");
    const restored: ReceiptRow = {
      id: receipt.id,
      key: `real:${receipt.id}`,
      entryId: "bill",
      workspace: "real",
      name: receipt.name,
      mime: receipt.mime,
      blob: new Blob([bytes], { type: receipt.mime }),
      createdAt: context.now,
      uploadedFor: null,
    };
    await expect(transport.uploadReceipt!(restored)).resolves.toBeUndefined();
    expect(upload).toHaveBeenCalledWith(
      `owner-one/${receipt.id}`,
      restored.blob,
      { contentType: receipt.mime, upsert: false },
    );
    download.mockResolvedValue({
      data: new Blob([Uint8Array.from([9, 8, 7, 6])], { type: receipt.mime }),
      error: null,
    });
    await expect(transport.uploadReceipt!(restored)).rejects.toThrow(
      "receipt_sync_failed",
    );
    expect(upload).toHaveBeenCalledTimes(2);
  });
  it("downloads a detached receipt still needed by revision history and includes its bytes in backup and restore", async () => {
    const source = repository();
    await source.ensure("real", LedgerSchema.parse({}));
    const first = fixture(true);
    const detached = applyMcpCommand(
      first,
      {
        type: "detach_receipt",
        entry_id: first.entries[0].id,
        expected_updated_at: context.now,
        receipt_id: receipt.id,
        reason: "আগের ভাউচার ইতিহাসে রাখি",
      },
      { ...context, now: "2026-11-02T11:00:00.000Z" },
    ).ledger;
    expect(detached.entries[0].receipts).toEqual([]);
    expect(receiptReferences(detached)).toMatchObject([
      { id: receipt.id, entryId: first.entries[0].id },
    ]);
    let downloads = 0;
    const snapshot: CloudSnapshot = {
      revision: 1,
      document: migrateArchitecture(detached).ledger,
      updatedAt: context.now,
    };
    const transport: CloudTransport = {
      ownerId: "synthetic-owner",
      load: async () => snapshot,
      save: async () => {
        throw new Error("unexpected_upload");
      },
      downloadReceipt: async (id) => {
        expect(id).toBe(receipt.id);
        downloads++;
        return new Blob([bytes], { type: receipt.mime });
      },
    };
    expect(await synchronizeWorkspace(transport, source)).toMatchObject({
      status: "synced",
      pendingReceipts: 0,
    });
    expect(downloads).toBe(1);
    const backup = await source.exportBackup();
    expect(parseBackup(backup).receipts).toHaveLength(1);
    const target = repository();
    await target.ensure("real", LedgerSchema.parse({}));
    await target.importBackup(backup, { replace: true });
    expect((await target.read())!.ledger).toEqual(
      migrateArchitecture(detached).ledger,
    );
    expect(
      new Uint8Array(
        await (await target.getReceipt(receipt.id))!.blob.arrayBuffer(),
      ),
    ).toEqual(bytes);
    const missing = JSON.parse(backup);
    missing.receipts = [];
    expect(() => parseBackup(JSON.stringify(missing))).toThrow(
      "receipt_missing",
    );
  });
  it("rejects reuse of a detached receipt ID on a different entry before writing the candidate snapshot", async () => {
    const first = fixture(true);
    const detached = applyMcpCommand(
      first,
      {
        type: "detach_receipt",
        entry_id: first.entries[0].id,
        expected_updated_at: context.now,
        receipt_id: receipt.id,
        reason: "ভাউচার আলাদা করি",
      },
      context,
    ).ledger;
    const invalid = structuredClone(detached);
    invalid.entries[1].receipts = [receipt];
    expect(() => validateLedger(invalid)).toThrow("receipt_metadata_mismatch");
    const source = repository();
    await source.ensure("real", LedgerSchema.parse({}));
    await expect(source.save(invalid)).rejects.toThrow(
      "receipt_metadata_mismatch",
    );
    expect((await source.read())!.ledger.entries).toEqual([]);
  });
});
