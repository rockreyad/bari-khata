import { describe, expect, it } from "vitest";
import { nationalPhoneInput, normalizeBangladeshPhone } from "./phone";

describe("Bangladesh phone numbers", () => {
  it.each([
    "01712345678",
    "1712345678",
    "১৭১২৩৪৫৬৭৮",
    "008801712345678",
    "+88001712345678",
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
    "+880++1712345678",
    "001712345678",
    "1712345678abc",
    "88017123456789",
    "01212345678",
  ])("rejects %s", (value) =>
    expect(() => normalizeBangladeshPhone(value)).toThrow("invalid_phone"),
  );
});

it.each([
  ["০১৭১২৩৪৫৬৭৮", "01712345678"],
  ["1712345678", "1712345678"],
  ["+880 1712-345678", "1712345678"],
  ["00880 (1712) 345678", "1712345678"],
  ["8801712345678", "1712345678"],
])("keeps one country prefix for %s", (value, national) => {
  expect(nationalPhoneInput(value)).toBe(national);
});
