import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function checkRelease(packageFile, lockFile, tag, policy) {
  const version = packageFile.version;
  if (typeof version !== "string" || !versionPattern.test(version))
    throw new Error("package.json version must use A.B.C, for example 1.2.3.");
  if (
    lockFile.version !== version ||
    lockFile.packages?.[""]?.version !== version
  )
    throw new Error("package.json and package-lock.json versions must match.");
  if (tag !== undefined && tag !== `v${version}`)
    throw new Error(`Release tag must be v${version}; received ${tag}.`);
  if (policy !== undefined) {
    const minimum = policy.minimumSupportedVersion;
    if (typeof minimum !== "string" || !versionPattern.test(minimum))
      throw new Error(
        "release-policy.json minimumSupportedVersion must use A.B.C.",
      );
    const parts = minimum.split(".").map(Number);
    const current = version.split(".").map(Number);
    if (
      !parts.every(Number.isSafeInteger) ||
      parts.some(
        (value, index) =>
          parts
            .slice(0, index)
            .every((part, previous) => part === current[previous]) &&
          value > current[index],
      )
    )
      throw new Error(
        "The minimum supported version cannot exceed this release.",
      );
  }
  return version;
}

export function checkBackendMinimum(policy, sql) {
  const matches = [
    ...sql.matchAll(
      /(?:create|create\s+or\s+replace)\s+function\s+private\.minimum_supported_client_version\(\)[\s\S]*?select\s+'([^']+)'::text/gi,
    ),
  ];
  if (matches.at(-1)?.[1] !== policy.minimumSupportedVersion)
    throw new Error(
      "release-policy.json and the backend minimum client version must match.",
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const read = (file) =>
      JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
    const version = checkRelease(
      read("package.json"),
      read("package-lock.json"),
      process.argv[2],
      read("release-policy.json"),
    );
    const migrations = new URL("../supabase/migrations/", import.meta.url);
    checkBackendMinimum(
      read("release-policy.json"),
      readdirSync(migrations)
        .filter((file) => file.endsWith(".sql"))
        .sort()
        .map((file) => readFileSync(new URL(file, migrations), "utf8"))
        .join("\n"),
    );
    console.log(`Release version verified: ${version}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
