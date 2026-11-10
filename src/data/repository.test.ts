import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyLedger, createDemoLedger } from "../domain/demo";
import { validateLedger } from "../domain/model";
import { getAccountDatabase, setActiveOwner, LedgerDatabase } from "./database";
import {
  LedgerRepository,
  parseBackup,
  readDraft,
  removeDraft,
  saveDraft,
} from "./repository";

const databases: LedgerDatabase[] = [];
function makeRepository() {
  const database = new LedgerDatabase(`test-${crypto.randomUUID()}`);
  databases.push(database);
  return new LedgerRepository(database);
}

afterEach(async () => {
  setActiveOwner(null);
  for (const database of databases.splice(0)) await database.delete();
});

describe("offline ledger persistence", () => {
  it("isolates demo data, serializes simultaneous edits and survives reopening", async () => {
    const repo = makeRepository();
    await repo.ensure("real", createEmptyLedger());
    await repo.ensure("demo", createDemoLedger());
    await Promise.all(
      ["one", "two"].map((id) =>
        repo.save((ledger) =>
          validateLedger({
            ...ledger,
            works: [...ledger.works, { id, name: id }],
          }),
        ),
      ),
    );
    const saved = await repo.read("real");
    expect(saved?.ledger.works.map((work) => work.id)).toEqual(["one", "two"]);
    expect(saved?.generation).toBe(2);
    expect(saved?.pending).toBe(true);
    expect((await repo.read("demo"))?.ledger.isDemo).toBe(true);
    repo.database.close();
    await repo.database.open();
    expect((await repo.read("real"))?.ledger.works).toHaveLength(2);
  });

  it("rejects a corrupt persisted ledger without resetting the user data", async () => {
    const repo = makeRepository();
    await repo.ensure("real", createEmptyLedger());
    const row = (await repo.read("real"))!;
    await repo.database.workspaces.put({
      ...row,
      ledger: { ...row.ledger, entries: [{ id: "broken" }] } as never,
    });
    await expect(repo.read("real")).rejects.toThrow();
    await expect(repo.ensure("real", createEmptyLedger())).rejects.toThrow();
    expect(
      (await repo.database.workspaces.get("real"))?.ledger?.entries,
    ).toHaveLength(1);
  });

  it("round-trips voucher bytes and refuses a backup with missing vouchers before writing", async () => {
    const repo = makeRepository();
    const initial = createEmptyLedger();
    await repo.ensure("real", initial);
    const file = new Blob([new Uint8Array([1, 2, 3, 4])], {
      type: "image/png",
    });
    const ledger = validateLedger({
      ...initial,
      works: [{ id: "tiles", name: "টাইলসের কাজ" }],
      entries: [
        {
          id: "bill",
          kind: "expense",
          account: "materials",
          lines: [
            { id: "line", workId: "tiles", amount: 150000, label: "আঠা" },
          ],
          receipts: [
            { id: "photo", name: "voucher.png", mime: "image/png", size: 4 },
          ],
        },
      ],
    });
    await repo.save(ledger, "real", [
      { id: "photo", entryId: "bill", file, name: "voucher.png" },
    ]);
    const backup = await repo.exportBackup();
    const target = makeRepository();
    await target.ensure("real", createEmptyLedger());
    await target.importBackup(backup, { replace: true });
    expect((await target.read())?.ledger).toEqual(ledger);
    expect(
      new Uint8Array(
        await (await target.getReceipt("photo"))!.blob.arrayBuffer(),
      ),
    ).toEqual(new Uint8Array([1, 2, 3, 4]));
    const corrupt = JSON.parse(backup);
    corrupt.receipts = [];
    expect(() => parseBackup(JSON.stringify(corrupt))).toThrow(
      "receipt_missing",
    );
    await expect(
      target.importBackup(JSON.stringify(corrupt), { replace: true }),
    ).rejects.toThrow();
    expect((await target.read())?.ledger).toEqual(ledger);
  });

  it("refuses orphan voucher metadata and demo backups in the real ledger", async () => {
    const repo = makeRepository();
    await repo.ensure("real", createEmptyLedger());
    await repo.ensure("demo", createDemoLedger());
    const demoBackup = await repo.exportBackup("demo");
    await expect(
      repo.importBackup(demoBackup, { replace: true }),
    ).rejects.toThrow("workspace_mode_mismatch");
    await expect(
      repo.save((ledger) =>
        validateLedger({
          ...ledger,
          works: [{ id: "w", name: "কাজ" }],
          entries: [
            {
              id: "e",
              kind: "expense",
              lines: [{ id: "l", workId: "w", amount: 1 }],
              receipts: [
                { id: "missing", name: "m.png", mime: "image/png", size: 1 },
              ],
            },
          ],
        }),
      ),
    ).rejects.toThrow("receipt_missing");
    expect((await repo.read())?.ledger.entries).toHaveLength(0);
    expect(() =>
      parseBackup(
        JSON.stringify({
          format: "bari-khata-backup",
          version: 1,
          exportedAt: new Date().toISOString(),
          ledger: {},
          receipts: [],
        }),
      ),
    ).toThrow();
  });

  it.each(["Blob", "bytes"])(
    "preserves File and Blob vouchers in a reopened draft stored as %s",
    async (representation) => {
      const ownerId = crypto.randomUUID();
      setActiveOwner(ownerId);
      const db = getAccountDatabase(ownerId);
      databases.push(db);
      const key = `test-draft-${crypto.randomUUID()}`;
      const file = new File([new Uint8Array([8, 9, 10])], "my-voucher.png", {
        type: "image/png",
        lastModified: 123456,
      });
      const plain = new Blob(["sample"], { type: "application/pdf" });
      const put = vi.spyOn(db.drafts, "put");
      if (representation === "bytes") {
        const cause = new DOMException(
          "Error preparing Blob/File data to be stored in object store",
          "UnknownError",
        );
        put.mockRejectedValueOnce(new Error("IndexedDB put", { cause }));
      }
      await saveDraft(key, {
        draft: { amount: "1500" },
        files: [
          { id: "photo", file },
          { id: "pdf", file: plain },
        ],
      });
      expect(put).toHaveBeenCalledTimes(representation === "bytes" ? 2 : 1);
      put.mockRestore();
      if (representation === "bytes")
        expect((await db.drafts.get(`real:${key}`))?.value).toMatchObject({
          files: [
            { file: { __bariFile: 1, blob: { __bariBlobBytes: 1 } } },
            { file: { __bariBlobBytes: 1 } },
          ],
        });
      db.close();
      await db.open();
      const restored = await readDraft<{
        draft: { amount: string };
        files: [{ id: string; file: File }, { id: string; file: Blob }];
      }>(key);
      expect(restored?.draft.amount).toBe("1500");
      expect(restored?.files[0].file).toBeInstanceOf(File);
      expect(restored?.files[0].file.name).toBe("my-voucher.png");
      expect(restored?.files[0].file.type).toBe("image/png");
      expect(restored?.files[0].file.lastModified).toBe(123456);
      expect(
        new Uint8Array(await restored!.files[0].file.arrayBuffer()),
      ).toEqual(new Uint8Array([8, 9, 10]));
      expect(restored?.files[1].file).toBeInstanceOf(Blob);
      expect(restored?.files[1].file.type).toBe("application/pdf");
      expect(await restored?.files[1].file.text()).toBe("sample");
      await expect(
        saveDraft(key, {
          files: [{ file: new Blob(["bad"], { type: "text/html" }) }],
        }),
      ).rejects.toThrow();
      expect(
        (await readDraft<{ files: { file: File }[] }>(key))?.files[0].file.name,
      ).toBe("my-voucher.png");
      await removeDraft(key);
    },
  );

  it("preserves write order during delayed Blob conversion", async () => {
    const ownerId = crypto.randomUUID();
    setActiveOwner(ownerId);
    const db = getAccountDatabase(ownerId);
    databases.push(db);
    const key = "same-draft";
    const file = new Blob(["receipt"], { type: "application/pdf" });
    const bytes = await file.arrayBuffer();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let finishConversion!: (buffer: ArrayBuffer) => void;
    const conversion = new Promise<ArrayBuffer>((resolve) => {
      finishConversion = resolve;
    });
    vi.spyOn(file, "arrayBuffer").mockImplementationOnce(() => {
      markStarted();
      return conversion;
    });
    vi.spyOn(db.drafts, "put").mockImplementationOnce(async () => {
      await db.drafts.get(`real:${key}`);
      throw new DOMException(
        "Error preparing Blob/File data to be stored in object store",
        "UnknownError",
      );
    });
    const older = saveDraft(key, { file });
    await started;
    const newer = saveDraft(key, { note: "newer" });
    finishConversion(bytes);
    await Promise.all([older, newer]);
    expect(await readDraft(key)).toEqual({ note: "newer" });
    await removeDraft(key);
  });

  it("includes historical voucher bytes when the active entry no longer contains the photo", async () => {
    const repo = makeRepository();
    const base = createEmptyLedger();
    await repo.ensure("real", base);
    const file = new Blob([new Uint8Array([5, 6])], { type: "image/png" });
    const first = validateLedger({
      ...base,
      works: [{ id: "w", name: "কাজ" }],
      entries: [
        {
          id: "bill",
          kind: "expense",
          lines: [{ id: "line", workId: "w", amount: 100 }],
          receipts: [
            { id: "old-photo", name: "old.png", mime: "image/png", size: 2 },
          ],
        },
      ],
    });
    await repo.save(first, "real", [
      { id: "old-photo", entryId: "bill", file, name: "old.png" },
    ]);
    const before = { ...first.entries[0] };
    const { revisions: _revisions, ...core } = before;
    const edited = validateLedger({
      ...first,
      entries: [
        {
          ...before,
          receipts: [],
          revisions: [{ at: new Date().toISOString(), before: core }],
        },
      ],
    });
    await repo.save(edited);
    const backup = parseBackup(await repo.exportBackup());
    expect(backup.receipts.map((receipt) => receipt.id)).toEqual(["old-photo"]);
    const target = makeRepository();
    await target.importBackup(JSON.stringify(backup), { replace: true });
    expect((await target.getReceipt("old-photo"))?.blob.size).toBe(2);
  });
});

describe("restoring work history", () => {
  it("rejects an old backup before changing the ledger, vouchers, outbox or recovery copies", async () => {
    const { saveWorkChange } = await import("../domain/workActivity");
    const repo = makeRepository();
    const original = validateLedger({
      ...createEmptyLedger(),
      works: [{ id: "work", name: "টাইলস", status: "planned" }],
      entries: [
        {
          id: "bill",
          kind: "expense",
          lines: [{ id: "line", workId: "work", amount: 10000 }],
          receipts: [
            { id: "photo", name: "old.png", mime: "image/png", size: 3 },
          ],
        },
      ],
    });
    await repo.ensure("real", createEmptyLedger());
    await repo.save(original, "real", [
      {
        id: "photo",
        entryId: "bill",
        name: "old.png",
        file: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      },
    ]);
    const oldBackup = await repo.exportBackup();
    let changed = saveWorkChange(
      original,
      { ...original.works[0], status: "ongoing", startedOn: "2026-11-01" },
      "2026-11-01T09:00:00.000Z",
    );
    changed = validateLedger({
      ...changed,
      entries: [
        {
          ...changed.entries[0],
          receipts: [
            ...changed.entries[0].receipts,
            { id: "new-photo", name: "new.png", mime: "image/png", size: 2 },
          ],
        },
      ],
    });
    await repo.save(changed, "real", [
      {
        id: "new-photo",
        entryId: "bill",
        name: "new.png",
        file: new Blob([new Uint8Array([9, 8])], { type: "image/png" }),
      },
    ]);
    const before = await repo.read();
    const outbox = await repo.database.outbox.toArray();
    const recoveries = await repo.database.recoveries.count();
    await expect(
      repo.importBackup(oldBackup, { replace: true }),
    ).rejects.toThrow("work_history_would_be_lost");
    expect(await repo.read()).toEqual(before);
    expect(await repo.database.outbox.toArray()).toEqual(outbox);
    expect(await repo.database.recoveries.count()).toBe(recoveries);
    expect(
      new Uint8Array(
        await (await repo.getReceipt("new-photo"))!.blob.arrayBuffer(),
      ),
    ).toEqual(new Uint8Array([9, 8]));
    expect(
      new Uint8Array(
        await (await repo.getReceipt("photo"))!.blob.arrayBuffer(),
      ),
    ).toEqual(new Uint8Array([1, 2, 3]));
    const currentBackup = await repo.exportBackup();
    await repo.importBackup(currentBackup, { replace: true });
    expect((await repo.read())?.ledger.works[0].activity).toEqual(
      changed.works[0].activity,
    );
  });
});

describe("restoring payment purposes", () => {
  it("refuses older backups before changing workspace/outbox/receipts/recovery", async () => {
    const repo = makeRepository();
    const original = validateLedger({
      ...createEmptyLedger(),
      works: [{ id: "w", name: "কাজ" }],
      people: [{ id: "p", name: "নাম" }],
    });
    await repo.ensure("real", original);
    const oldBackup = await repo.exportBackup();
    const changed = validateLedger({
      ...original,
      paymentPurposes: [{ id: "purpose", name: "আনার টাকা", account: "other" }],
      entries: [
        {
          id: "cash",
          kind: "payment",
          personId: "p",
          account: "other",
          paymentPurposeId: "purpose",
          allocations: [{ workId: "w", amount: 100 }],
          paymentParts: [{ amount: 100 }],
          receipts: [{ id: "r", name: "r.png", mime: "image/png", size: 1 }],
        },
      ],
    });
    await repo.save(changed, "real", [
      {
        id: "r",
        entryId: "cash",
        file: new Blob([new Uint8Array([7])], { type: "image/png" }),
        name: "r.png",
      },
    ]);
    const before = await repo.read(),
      outbox = await repo.database.outbox.toArray(),
      recoveries = await repo.database.recoveries.count();
    await expect(
      repo.importBackup(oldBackup, { replace: true }),
    ).rejects.toThrow("payment_purpose_would_be_lost");
    expect(await repo.read()).toEqual(before);
    expect(await repo.database.outbox.toArray()).toEqual(outbox);
    expect(await repo.database.recoveries.count()).toBe(recoveries);
    expect(
      new Uint8Array(await (await repo.getReceipt("r"))!.blob.arrayBuffer()),
    ).toEqual(new Uint8Array([7]));
    const currentBackup = await repo.exportBackup();
    await repo.importBackup(currentBackup, { replace: true });
    expect((await repo.read())?.ledger.paymentPurposes).toEqual(
      changed.paymentPurposes,
    );
  });
});
