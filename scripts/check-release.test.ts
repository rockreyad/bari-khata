import { describe, expect, it } from "vitest";
import { checkRelease } from "./check-release.mjs";

const manifest = { version: "1.2.3" };
const lock = { version: "1.2.3", packages: { "": { version: "1.2.3" } } };

describe("release version consistency", () => {
  it("accepts matching app, lockfile and semantic release tag", () => {
    expect(checkRelease(manifest, lock, "v1.2.3")).toBe("1.2.3");
    expect(checkRelease(manifest, lock)).toBe("1.2.3");
    expect(
      checkRelease(
        { version: "0.0.0" },
        { version: "0.0.0", packages: { "": { version: "0.0.0" } } },
        "v0.0.0",
      ),
    ).toBe("0.0.0");
  });

  it.each(["1.2", "01.2.3", "1.2.3-beta", "v1.2.3", "1.2.3.4", "-1.2.3"])(
    "rejects a version outside the A.B.C release policy: %s",
    (version) => {
      expect(() => checkRelease({ version }, lock)).toThrow("A.B.C");
    },
  );

  it("rejects either stale copy of the lockfile version", () => {
    expect(() => checkRelease(manifest, { ...lock, version: "1.2.2" })).toThrow(
      "must match",
    );
    expect(() =>
      checkRelease(manifest, {
        ...lock,
        packages: { "": { version: "1.2.2" } },
      }),
    ).toThrow("must match");
  });

  it.each(["v1.2.2", "1.2.3", "v1.3.0", ""])(
    "refuses to label this app build with a different release tag: %s",
    (tag) => {
      expect(() => checkRelease(manifest, lock, tag)).toThrow("must be v1.2.3");
    },
  );
});
