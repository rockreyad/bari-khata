import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LedgerSchema } from "../src/domain/model";
import {
  prepareArchitectureMigration,
  runArchitectureMigration,
} from "./migrate-architecture";

const sample = () =>
  LedgerSchema.parse({
    isDemo: true,
    works: [{ id: "sample-sector", name: "নমুনা সেক্টর" }],
    people: [
      {
        id: "sample-party",
        name: "নমুনা দোকান",
        kind: "shop",
        contactType: "supplier",
      },
    ],
    entries: [
      {
        id: "sample-bill",
        kind: "expense",
        account: "materials",
        personId: "sample-party",
        date: "2026-11-05",
        lines: [
          {
            id: "sample-line",
            workId: "sample-sector",
            label: "নমুনা মাল",
            amount: 10000,
          },
        ],
      },
    ],
  });
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(
    folders
      .splice(0)
      .map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

describe("developer architecture migration", () => {
  it("preserves financial facts and outputs a complete importable backup", async () => {
    const ledger = sample();
    const result = await prepareArchitectureMigration(
      JSON.stringify(ledger),
      "2026-11-05T00:00:00.000Z",
    );
    expect(result.backup.ledger.entries).toEqual(ledger.entries);
    expect(result.report.before).toEqual(result.report.after);
    expect(result.report.idempotent).toBe(true);
    const repeated = await prepareArchitectureMigration(
      JSON.stringify(result.backup),
      result.backup.exportedAt,
    );
    expect(repeated.backup).toEqual(result.backup);
  });
  it("rejects tampered backup money instead of recomputing its checksum", async () => {
    const prepared = await prepareArchitectureMigration(
      JSON.stringify(sample()),
      "2026-11-05T00:00:00.000Z",
    );
    prepared.backup.ledger.entries[0].lines[0].amount += 1;
    await expect(
      prepareArchitectureMigration(
        JSON.stringify(prepared.backup),
        prepared.backup.exportedAt,
      ),
    ).rejects.toThrow("backup_checksum_mismatch");
  });
  it("refuses a ledger-only file when receipt bytes would be missing", async () => {
    const ledger = sample();
    ledger.entries[0].receipts.push({
      id: "sample-receipt",
      name: "নমুনা.pdf",
      mime: "application/pdf",
      size: 4,
    });
    await expect(
      prepareArchitectureMigration(
        JSON.stringify(ledger),
        "2026-11-05T00:00:00.000Z",
      ),
    ).rejects.toThrow("full_backup_with_receipts_required");
  });
  it("keeps ambiguous historical cash for operator review without inventing allocations", async () => {
    const ledger = sample();
    ledger.entries.push({
      ...ledger.entries[0],
      id: "sample-payment",
      kind: "payment",
      lines: [],
      paymentParts: [{ method: "cash", amount: 5000 }],
      allocations: [{ workId: "sample-sector", amount: 5000 }],
    });
    const result = await prepareArchitectureMigration(
      JSON.stringify(ledger),
      "2026-11-05T00:00:00.000Z",
    );
    expect(result.report.readyForRelease).toBe(false);
    expect(result.report.ambiguousCashEntryIds).toEqual(["sample-payment"]);
    expect(result.backup.ledger.paymentAllocations).toEqual([]);
  });
  it("archives the exact source privately and verifies repeated output without overwriting it", async () => {
    const root = await mkdtemp(join(tmpdir(), "bari-migration-test-"));
    folders.push(root);
    await mkdir(join(root, "private"));
    const source = JSON.stringify(sample(), null, 3) + "\n";
    await writeFile(join(root, "private", "sample.json"), source);
    const first = await runArchitectureMigration("private/sample.json", root);
    expect(await readFile(join(first.output, "source.json"), "utf8")).toBe(
      source,
    );
    expect(await runArchitectureMigration("private/sample.json", root)).toEqual(
      { ...first, repeated: true },
    );
    await writeFile(join(first.output, "report.json"), "{}");
    await expect(
      runArchitectureMigration("private/sample.json", root),
    ).rejects.toThrow("migration_output_changed");
    expect(await readFile(join(root, "private", "sample.json"), "utf8")).toBe(
      source,
    );
  });
  it("rejects sources outside private", async () => {
    const root = await mkdtemp(join(tmpdir(), "bari-migration-test-"));
    folders.push(root);
    await mkdir(join(root, "private"));
    await writeFile(join(root, "sample.json"), JSON.stringify(sample()));
    await expect(runArchitectureMigration("sample.json", root)).rejects.toThrow(
      "source_must_be_inside_private",
    );
  });
});
