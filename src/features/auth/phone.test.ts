import { describe, expect, it } from "vitest";
import { normalizeBangladeshPhone } from "./phone";

describe("Bangladesh phone numbers", () => {
  it.each([
    "01712345678",
    "+8801712345678",
    "8801712345678",
    "০১৭১২৩৪৫৬৭৮",
    " +880 (1712) 345-678 ",
  ])("normalizes %s", (value) =>
    expect(normalizeBangladeshPhone(value)).toBe("+8801712345678"),
  );
  it.each([
    "+14155552671",
    "01112345678",
    "017123",
    "017123456789",
    "not a phone",
  ])("rejects %s", (value) =>
    expect(() => normalizeBangladeshPhone(value)).toThrow("invalid_phone"),
  );
});
