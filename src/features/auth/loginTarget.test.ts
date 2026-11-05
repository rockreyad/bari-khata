import { describe, expect, it } from "vitest";
import { loginTarget } from "./loginTarget";

describe("login return path", () => {
  it.each([
    "/",
    "/sectors/door?tab=labour",
    "/settings/account",
    "/works?status=done#list",
  ])("keeps the requested app page %s", (path) =>
    expect(loginTarget(path)).toBe(path),
  );
  it.each([
    undefined,
    null,
    1,
    "https://outside.test",
    "//outside.test",
    "/\\outside.test",
    "/LOGIN/pin",
    "/%4Cogin/pin",
    "/REGISTER/resend",
    "/login",
    "/login/pin",
    "/login/pin?from=/works",
    "/register",
    "/register/resend",
    "/auth/confirm",
    "/sectors/../login/pin",
    "/%6cogin/pin",
    "/sectors\n/door",
    "/%ZZ",
  ])("rejects external, invalid or looping login destinations %s", (path) => {
    expect(loginTarget(path)).toBe("/");
  });
});
