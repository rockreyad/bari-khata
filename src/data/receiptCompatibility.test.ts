import "fake-indexeddb/auto";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createEmptyLedger } from "../domain/demo";
import { LedgerSchema } from "../domain/model";
import { NEW_RECEIPT_MAX_BYTES } from "../lib/attachmentLimits";
import { LedgerDatabase, setActiveOwner } from "./database";
import {
  createWorkspaceStorage,
  getScopedRepository,
  LedgerRepository,
  type ReceiptInput,
} from "./repository";
import { synchronizeWorkspace, type CloudTransport } from "./sync";

const databases: LedgerDatabase[] = [];
afterEach(async () => {
  setActiveOwner(null);
  for (const database of databases.splice(0)) await database.delete();
});

async function digest(file: Blob) {
  return createHash("sha256")
    .update(new Uint8Array(await file.arrayBuffer()))
    .digest("hex");
}

it("keeps a pre-upgrade voucher above 5 MiB through draft reopen, save, sync retry and backup restore", async () => {
  const owner = crypto.randomUUID();
  setActiveOwner(owner);
  const source = getScopedRepository();
  databases.push(source.database);
  const storage = createWorkspaceStorage();
  const bytes = new Uint8Array(5 * 1024 * 1024 + 1);
  bytes.set(new TextEncoder().encode("%PDF-1.7"));
  bytes[bytes.length - 1] = 42;
  const file = new File([bytes], "sample-legacy-voucher.pdf", {
    type: "application/pdf",
    lastModified: 123456,
  });
  expect(file.size).toBeGreaterThan(NEW_RECEIPT_MAX_BYTES);
  const receipt: ReceiptInput = {
    id: "legacy-voucher",
    entryId: "bill",
    name: file.name,
    file,
  };
  await source.ensure("real", createEmptyLedger());
  await storage.saveDraft("sample-legacy-upload", { files: [receipt] });
  source.database.close();
  await source.database.open();
  const restoredDraft = await storage.readDraft<{ files: ReceiptInput[] }>(
    "sample-legacy-upload",
  );
  const restoredFile = restoredDraft!.files[0].file as File;
  expect(restoredFile.name).toBe(file.name);
  expect(restoredFile.lastModified).toBe(file.lastModified);
  expect(await digest(restoredFile)).toBe(await digest(file));
  const ledger = LedgerSchema.parse({
    ...createEmptyLedger(),
    works: [{ id: "roof", name: "নমুনা ছাদ" }],
    entries: [
      {
        id: "bill",
        kind: "expense",
        lines: [
          { id: "line", workId: "roof", label: "নমুনা মাল", amount: 10000 },
        ],
        receipts: [
          {
            id: receipt.id,
            name: file.name,
            mime: file.type,
            size: file.size,
          },
        ],
      },
    ],
  });
  await source.save(ledger, "real", restoredDraft!.files);
  source.database.close();
  await source.database.open();
  expect((await source.read())!.ledger).toEqual(ledger);
  expect(await digest((await source.getReceipt(receipt.id))!.blob)).toBe(
    await digest(file),
  );

  await source.database.workspaces.update("real", {
    pending: false,
    cloudRevision: 1,
  });
  const uploadReceipt = vi
    .fn<NonNullable<CloudTransport["uploadReceipt"]>>()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(undefined);
  const transport: CloudTransport = {
    ownerId: owner,
    load: async () => ({ revision: 1, document: ledger, updatedAt: null }),
    save: async () => {
      throw new Error("unexpected_ledger_write");
    },
    uploadReceipt,
  };
  expect(await synchronizeWorkspace(transport, source)).toEqual({
    status: "synced",
    pendingReceipts: 1,
  });
  expect((await source.getReceipt(receipt.id))!.uploadedFor).toBeNull();
  expect(await digest((await source.getReceipt(receipt.id))!.blob)).toBe(
    await digest(file),
  );
  expect(await synchronizeWorkspace(transport, source)).toEqual({
    status: "synced",
    pendingReceipts: 0,
  });
  expect(uploadReceipt).toHaveBeenCalledTimes(2);
  for (const [attempt] of uploadReceipt.mock.calls)
    expect(await digest(attempt.blob)).toBe(await digest(file));

  const backup = await source.exportBackup();
  const target = new LedgerRepository(
    new LedgerDatabase(`receipt-restore-${crypto.randomUUID()}`),
  );
  databases.push(target.database);
  await target.importBackup(backup, { replace: true });
  target.database.close();
  await target.database.open();
  expect((await target.read())!.ledger).toEqual(ledger);
  expect((await target.getReceipt(receipt.id))!.blob.size).toBe(file.size);
  expect(await digest((await target.getReceipt(receipt.id))!.blob)).toBe(
    await digest(file),
  );
});
