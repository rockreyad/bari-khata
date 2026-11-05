import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { migrateArchitecture } from "../src/domain/architectureMigration.ts";
import {
  parseBackup,
  receiptReferences,
  verifyBackupIntegrity,
} from "../src/data/repository.ts";

const fingerprint = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export async function prepareArchitectureMigration(source: string, at: string) {
  if (Buffer.byteLength(source, "utf8") > 100 * 1024 * 1024)
    throw new Error("backup_too_large");
  const value: unknown = JSON.parse(source);
  const portable =
    value !== null && typeof value === "object" && "format" in value;
  const original = portable ? parseBackup(source) : null;
  if (original) await verifyBackupIntegrity(original);
  const migrated = migrateArchitecture(original?.ledger ?? value);
  if (!original && receiptReferences(migrated.ledger).length)
    throw new Error("full_backup_with_receipts_required");
  const repeated = migrateArchitecture(migrated.ledger);
  if (
    repeated.changed ||
    JSON.stringify(repeated.ledger) !== JSON.stringify(migrated.ledger)
  )
    throw new Error("migration_not_idempotent");
  const receipts = original?.receipts ?? [];
  const reviews = [
    ...(original?.migrationReviews ?? []),
    migrated.report.review!,
  ];
  const backup = {
    format: "bari-khata-backup" as const,
    version: 1 as const,
    exportedAt: at,
    ledger: migrated.ledger,
    receipts,
    migrationReviews: [
      ...new Map(
        reviews.map((review) => [JSON.stringify(review), review]),
      ).values(),
    ],
    integrity: {
      algorithm: "SHA-256" as const,
      ledger: fingerprint(JSON.stringify(migrated.ledger)),
      receipts: receipts.map((receipt) => ({
        id: receipt.id,
        checksum: fingerprint(receipt.base64),
      })),
    },
  };
  await verifyBackupIntegrity(parseBackup(JSON.stringify(backup)));
  return {
    backup,
    report: {
      sourceChecksum: fingerprint(source),
      ...migrated.report,
      receiptBlobs: receipts.length,
      idempotent: true,
      readyForRelease:
        !migrated.report.review?.issues.some(
          (issue) => issue.severity === "review",
        ) && migrated.report.duplicatePartyCandidates.length === 0,
    },
  };
}

export async function runArchitectureMigration(
  inputPath: string,
  projectRoot = fileURLToPath(new URL("../", import.meta.url)),
) {
  const privateRoot = await realpath(resolve(projectRoot, "private"));
  const sourcePath = await realpath(resolve(projectRoot, inputPath));
  const sourceRelative = relative(privateRoot, sourcePath);
  if (
    isAbsolute(sourceRelative) ||
    sourceRelative === ".." ||
    sourceRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  )
    throw new Error("source_must_be_inside_private");
  const info = await stat(sourcePath);
  if (!info.isFile() || info.size > 100 * 1024 * 1024)
    throw new Error("backup_too_large");
  const source = await readFile(sourcePath, "utf8");
  const sourceHash = fingerprint(source);
  const parent = join(privateRoot, "architecture-migration");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  if ((await realpath(parent)) !== parent)
    throw new Error("migration_output_symlink");
  const output = join(parent, sourceHash);
  let at = new Date().toISOString();
  let existing = false;
  try {
    const manifest = JSON.parse(
      await readFile(join(output, "manifest.json"), "utf8"),
    ) as { createdAt?: unknown };
    if (
      typeof manifest.createdAt !== "string" ||
      !Number.isFinite(Date.parse(manifest.createdAt))
    )
      throw new Error("migration_manifest_invalid");
    at = manifest.createdAt;
    existing = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const result = await prepareArchitectureMigration(source, at);
  const artifacts: Record<string, string> = {
    "source.json": source,
    "backup.json": JSON.stringify(result.backup, null, 2) + "\n",
    "report.json": JSON.stringify(result.report, null, 2) + "\n",
  };
  artifacts["manifest.json"] =
    JSON.stringify(
      {
        version: 1,
        createdAt: at,
        sourceChecksum: sourceHash,
        files: Object.fromEntries(
          Object.entries(artifacts).map(([name, text]) => [
            name,
            fingerprint(text),
          ]),
        ),
      },
      null,
      2,
    ) + "\n";
  if (existing) {
    if ((await realpath(output)) !== output)
      throw new Error("migration_output_symlink");
    for (const [name, content] of Object.entries(artifacts))
      if ((await readFile(join(output, name), "utf8")) !== content)
        throw new Error("migration_output_changed");
  } else {
    const staging = await mkdtemp(join(parent, ".prepare-"));
    for (const [name, content] of Object.entries(artifacts))
      await writeFile(join(staging, name), content, {
        flag: "wx",
        mode: 0o600,
      });
    await rename(staging, output);
  }
  return {
    output,
    repeated: existing,
    readyForRelease: result.report.readyForRelease,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const input = process.argv[2];
  if (!input || process.argv.length !== 3) {
    console.error(
      "ব্যবহার: node --import tsx scripts/migrate-architecture.ts private/source-backup.json",
    );
    process.exitCode = 1;
  } else {
    try {
      const result = await runArchitectureMigration(input);
      console.log(JSON.stringify(result));
      if (!result.readyForRelease) process.exitCode = 2;
    } catch (error) {
      console.error(
        "রূপান্তর থেমেছে; মূল ফাইল বদলায়নি।",
        error instanceof Error && /^[a-z_]+$/.test(error.message)
          ? error.message
          : "input_or_output_invalid",
      );
      process.exitCode = 1;
    }
  }
}
