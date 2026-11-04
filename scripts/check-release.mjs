import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function checkRelease(packageFile, lockFile, tag) {
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
  return version;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const read = (file) =>
      JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
    const version = checkRelease(
      read("package.json"),
      read("package-lock.json"),
      process.argv[2],
    );
    console.log(`Release version verified: ${version}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
