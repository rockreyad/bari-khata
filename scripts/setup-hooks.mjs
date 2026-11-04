import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

export function setupHooks({
  root = projectRoot,
  runGit = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8" }),
} = {}) {
  const current = runGit(["config", "--get", "core.hooksPath"]);
  if (current.error) throw current.error;
  if (current.status !== 0 && current.status !== 1)
    throw new Error("Git-এর hooks সেটিং পড়া যায়নি।");
  const common = runGit(["rev-parse", "--git-common-dir"]);
  if (common.error) throw common.error;
  if (common.status !== 0 || !common.stdout?.trim())
    throw new Error("এই repository-র Git directory পাওয়া যায়নি।");
  const commonDir = path.resolve(root, common.stdout.trim());
  const hooksPath = path.join(commonDir, "bari-khata-hooks");
  const templateDir = path.join(root, ".githooks");
  const previous =
    current.status === 0 ? (current.stdout?.trim() ?? "") : undefined;
  const legacyPath = previous && path.resolve(root, previous) === templateDir;
  if (
    previous !== undefined &&
    (!previous || (path.resolve(root, previous) !== hooksPath && !legacyPath))
  )
    throw new Error(
      `core.hooksPath আগে থেকেই ${previous || '""'} আছে। আগের hook অক্ষত রাখতে সেটি বদলানো হয়নি।`,
    );
  const defaultHooks = path.join(commonDir, "hooks");
  if (
    existsSync(defaultHooks) &&
    readdirSync(defaultHooks).some((name) => !name.endsWith(".sample"))
  )
    throw new Error(
      `${defaultHooks}-এ আগের hook আছে। অক্ষত রাখতে সেটিং বদলানো হয়নি।`,
    );
  if (
    legacyPath &&
    readdirSync(templateDir).some((name) => name !== "pre-push")
  )
    throw new Error(".githooks-এ অন্য hook আছে। সেটিং বদলানো হয়নি।");
  const source = readFileSync(path.join(templateDir, "pre-push"));
  if (existsSync(hooksPath) && lstatSync(hooksPath).isSymbolicLink())
    throw new Error("স্থায়ী hooks directory একটি link; সেটি বদলানো হয়নি।");
  const installedHook = path.join(hooksPath, "pre-push");
  if (existsSync(installedHook)) {
    if (
      lstatSync(installedHook).isSymbolicLink() ||
      !readFileSync(installedHook).equals(source)
    )
      throw new Error("স্থায়ী directory-তে আলাদা pre-push আছে। বদলানো হয়নি।");
  } else {
    mkdirSync(hooksPath, { recursive: true });
    writeFileSync(installedHook, source, { mode: 0o755, flag: "wx" });
  }
  chmodSync(installedHook, 0o755);
  if (previous === hooksPath) return hooksPath;
  const installed = runGit(["config", "--local", "core.hooksPath", hooksPath]);
  if (installed.error) throw installed.error;
  if (installed.status !== 0)
    throw new Error("এই repository-তে hooks সেট করা যায়নি।");
  return hooksPath;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    setupHooks();
    console.log(
      "এই clone-এ main push ও পুরোনো release tag বদলানো বন্ধ করা হয়েছে।",
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
