import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
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

describe("hook installation preserves existing configuration", () => {
  it("sets only this repository when no hooks path is configured", () => {
    const git = vi
      .fn()
      .mockReturnValueOnce({ status: 1, stdout: "" })
      .mockReturnValueOnce({ status: 0, stdout: "" });
    setupHooks(git);
    expect(git.mock.calls).toEqual([
      [["config", "--get", "core.hooksPath"]],
      [["config", "--local", "core.hooksPath", ".githooks"]],
    ]);
  });

  it("accepts an already-installed guard without another write", () => {
    const git = vi.fn().mockReturnValue({ status: 0, stdout: ".githooks\n" });
    setupHooks(git);
    expect(git).toHaveBeenCalledOnce();
  });

  it.each([".husky", "/custom/hooks", ""])(
    "does not overwrite an existing hooks path: %s",
    (path) => {
      const git = vi.fn().mockReturnValue({ status: 0, stdout: path });
      expect(() => setupHooks(git)).toThrow("বদলানো হয়নি");
      expect(git).toHaveBeenCalledOnce();
    },
  );

  it("fails closed if reading or writing git configuration fails", () => {
    const unreadable = vi.fn().mockReturnValue({ status: 128, stdout: "" });
    expect(() => setupHooks(unreadable)).toThrow("পড়া যায়নি");
    expect(unreadable).toHaveBeenCalledOnce();
    const unwritable = vi
      .fn()
      .mockReturnValueOnce({ status: 1, stdout: "" })
      .mockReturnValueOnce({ status: 128, stdout: "" });
    expect(() => setupHooks(unwritable)).toThrow("সেট করা যায়নি");
  });
});
