import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setupHooks } from "./setup-hooks.mjs";

const hook = fileURLToPath(new URL("../.githooks/pre-push", import.meta.url));
const zero = "0".repeat(40);
const oldSha = "a".repeat(40);
const newSha = "b".repeat(40);
const run = (input: string) =>
  spawnSync("/bin/sh", [hook], { input, encoding: "utf8" });
const ref = (
  local: string,
  localSha: string,
  remote: string,
  remoteSha: string,
) => `${local} ${localSha} ${remote} ${remoteSha}\n`;

describe("local main and release tag push guard", () => {
  it.each([
    ["refs/heads/main", newSha, oldSha],
    ["refs/heads/feature", newSha, oldSha],
    ["(delete)", zero, oldSha],
    ["refs/heads/main", newSha, zero],
  ])(
    "blocks every push destination main, including %s",
    (local, sha, remoteSha) => {
      const result = run(ref(local, sha, "refs/heads/main", remoteSha));
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("pull request");
    },
  );

  it("allows feature branches and checks every ref in a combined push", () => {
    const feature = ref(
      "refs/heads/rockreyad/update",
      newSha,
      "refs/heads/rockreyad/update",
      zero,
    );
    expect(run(feature).status).toBe(0);
    expect(
      run(feature + ref("HEAD", newSha, "refs/heads/main", oldSha)).status,
    ).toBe(1);
  });

  it("allows a new version tag but rejects moving or deleting an existing one", () => {
    const tag = "refs/tags/v0.1.1";
    expect(run(ref(tag, newSha, tag, zero)).status).toBe(0);
    expect(run(ref(tag, newSha, tag, oldSha)).status).toBe(1);
    expect(run(ref("(delete)", zero, tag, oldSha)).status).toBe(1);
    expect(run(ref(tag, oldSha, tag, oldSha)).status).toBe(0);
  });

  it("protects tags with SHA-256 object ids and leaves other tags alone", () => {
    const tag = "refs/tags/v1.0.0";
    expect(run(ref(tag, "b".repeat(64), tag, "0".repeat(64))).status).toBe(0);
    expect(run(ref(tag, "b".repeat(64), tag, "a".repeat(64))).status).toBe(1);
    expect(
      run(ref("(delete)", zero, "refs/tags/test-fixture", oldSha)).status,
    ).toBe(0);
  });
});

function fixture(
  run: (root: string, git: ReturnType<typeof gitRunner>) => void,
) {
  const root = mkdtempSync(path.join(tmpdir(), "bari-hook-install-"));
  const git = gitRunner(root);
  try {
    expect(git(["init", "-q", "--initial-branch=main"]).status).toBe(0);
    mkdirSync(path.join(root, ".githooks"));
    writeFileSync(path.join(root, ".githooks/pre-push"), readFileSync(hook));
    run(root, git);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
function gitRunner(root: string) {
  return (args: string[]) =>
    spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: "Hook test",
        GIT_AUTHOR_EMAIL: "hook@example.invalid",
        GIT_COMMITTER_NAME: "Hook test",
        GIT_COMMITTER_EMAIL: "hook@example.invalid",
      },
    });
}

describe("stable hook installation", () => {
  it("keeps main protected after checkout removes the feature branch template", () => {
    fixture((root, git) => {
      expect(git(["commit", "--allow-empty", "-qm", "initial"]).status).toBe(0);
      expect(git(["checkout", "-qb", "rockreyad/hook-fixture"]).status).toBe(0);
      expect(git(["add", ".githooks/pre-push"]).status).toBe(0);
      expect(git(["commit", "-qm", "guard template"]).status).toBe(0);
      const stable = setupHooks({ root, runGit: git });
      expect(path.isAbsolute(stable)).toBe(true);
      expect(stable).toBe(path.join(root, ".git/bari-khata-hooks"));
      expect(
        git(["config", "--local", "--get", "core.hooksPath"]).stdout.trim(),
      ).toBe(stable);
      expect(statSync(path.join(stable, "pre-push")).mode & 0o777).toBe(0o755);
      expect(git(["checkout", "-q", "main"]).status).toBe(0);
      expect(existsSync(path.join(root, ".githooks/pre-push"))).toBe(false);
      const result = spawnSync(path.join(stable, "pre-push"), [], {
        input: ref("HEAD", newSha, "refs/heads/main", oldSha),
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("pull request");
      const localRemote = path.join(root, "test-remote.git");
      expect(git(["init", "--bare", "-q", localRemote]).status).toBe(0);
      const push = git(["push", localRemote, "HEAD:refs/heads/main"]);
      expect(push.status).not.toBe(0);
      expect(push.stderr).toContain("main-এ সরাসরি push বন্ধ");
      expect(
        git([
          "--git-dir",
          localRemote,
          "show-ref",
          "--verify",
          "refs/heads/main",
        ]).status,
      ).not.toBe(0);
    });
  });

  it("migrates our old .githooks configuration and can be installed again", () => {
    fixture((root, git) => {
      expect(
        git(["config", "--local", "core.hooksPath", ".githooks"]).status,
      ).toBe(0);
      const stable = setupHooks({ root, runGit: git });
      expect(setupHooks({ root, runGit: git })).toBe(stable);
      expect(readFileSync(path.join(stable, "pre-push"))).toEqual(
        readFileSync(hook),
      );
    });
  });

  it.each([".husky", "/custom/hooks", ""])(
    "preserves an existing configured path: %s",
    (customPath) => {
      fixture((root, git) => {
        expect(
          git(["config", "--local", "core.hooksPath", customPath]).status,
        ).toBe(0);
        expect(() => setupHooks({ root, runGit: git })).toThrow("বদলানো হয়নি");
        expect(git(["config", "--get", "core.hooksPath"]).stdout.trim()).toBe(
          customPath,
        );
        expect(existsSync(path.join(root, ".git/bari-khata-hooks"))).toBe(
          false,
        );
      });
    },
  );

  it.each(["pre-push", "pre-commit"])(
    "leaves an existing default %s and its configuration intact",
    (name) => {
      fixture((root, git) => {
        const existing = path.join(root, ".git/hooks", name);
        writeFileSync(existing, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
        expect(() => setupHooks({ root, runGit: git })).toThrow(
          "আগের hook আছে",
        );
        expect(readFileSync(existing, "utf8")).toBe("#!/bin/sh\nexit 0\n");
        expect(git(["config", "--get", "core.hooksPath"]).status).toBe(1);
      });
    },
  );

  it("never overwrites a different hook in the stable directory", () => {
    fixture((root, git) => {
      const stable = path.join(root, ".git/bari-khata-hooks");
      mkdirSync(stable);
      writeFileSync(path.join(stable, "pre-push"), "existing custom hook");
      expect(() => setupHooks({ root, runGit: git })).toThrow(
        "আলাদা pre-push আছে",
      );
      expect(readFileSync(path.join(stable, "pre-push"), "utf8")).toBe(
        "existing custom hook",
      );
      expect(git(["config", "--get", "core.hooksPath"]).status).toBe(1);
    });
  });

  it("does not migrate a legacy path containing other hooks", () => {
    fixture((root, git) => {
      git(["config", "--local", "core.hooksPath", ".githooks"]);
      writeFileSync(
        path.join(root, ".githooks/pre-commit"),
        "existing custom hook",
      );
      expect(() => setupHooks({ root, runGit: git })).toThrow("অন্য hook আছে");
      expect(git(["config", "--get", "core.hooksPath"]).stdout.trim()).toBe(
        ".githooks",
      );
    });
  });
});
