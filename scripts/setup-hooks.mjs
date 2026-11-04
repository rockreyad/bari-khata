import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const hooksPath = ".githooks";

export function setupHooks(
  runGit = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8" }),
) {
  const current = runGit(["config", "--get", "core.hooksPath"]);
  if (current.error) throw current.error;
  if (current.status !== 0 && current.status !== 1)
    throw new Error("Git-এর hooks সেটিং পড়া যায়নি।");
  const previous = current.stdout?.trim();
  if (current.status === 0 && previous !== hooksPath)
    throw new Error(
      `core.hooksPath আগে থেকেই ${previous || '""'} আছে। আগের hook অক্ষত রাখতে সেটি বদলানো হয়নি।`,
    );
  if (previous === hooksPath) return;
  const installed = runGit(["config", "--local", "core.hooksPath", hooksPath]);
  if (installed.error) throw installed.error;
  if (installed.status !== 0)
    throw new Error("এই repository-তে hooks সেট করা যায়নি।");
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
