import { describe, expect, it } from "vitest";
import { parseAmount } from "./ledger";
import { parseMoneyText, poishaDecimal } from "./money";
import { MoneySchema } from "./model";

describe("exact monetary input", () => {
  it.each([
    ["162.25", 16225],
    ["১৬২.২৫", 16225],
    ["1৬2.2৫", 16225],
    ["0.01", 1],
    ["০.০১", 1],
    ["৳ ১,২৫,৪০০.৫০", 12540050],
    ["1,234,567.89৳", 123456789],
    ["12,34,567.89", 123456789],
    ["90,071,992,547,409.91", Number.MAX_SAFE_INTEGER],
  ])("parses %s into integer paisa", (text, amount) => {
    expect(parseAmount(text)).toBe(amount);
  });

  it.each([
    "1,5",
    "1,6,2",
    "1 2",
    "1,2345",
    "1,23,45",
    "1.001",
    "1.",
    ".5",
    "-1",
    "1e3",
    "Infinity",
    "৳৳12",
    "1৳2",
    "",
    "৯০,০৭১,৯৯২,৫৪৭,৪০৯.৯২",
  ])("rejects ambiguous or unsafe input %s", (text) => {
    expect(() => parseAmount(text)).toThrow();
  });

  it("allows signed source currency only when explicitly requested", () => {
    expect(parseMoneyText("-1,234.50৳", { signed: true })).toBe(-123450);
    expect(parseMoneyText("৳-১,২৩৪.৫০", { signed: true })).toBe(-123450);
    expect(() => parseMoneyText("--1", { signed: true })).toThrow();
  });

  it("round-trips every paisa without floating division at the safe integer boundary", () => {
    for (const amount of [
      0,
      1,
      10,
      100,
      16225,
      Number.MAX_SAFE_INTEGER - 1,
      Number.MAX_SAFE_INTEGER,
    ]) {
      expect(parseAmount(poishaDecimal(amount))).toBe(amount);
      expect(MoneySchema.parse(amount)).toBe(amount);
    }
    expect(poishaDecimal(Number.MAX_SAFE_INTEGER)).toBe("90071992547409.91");
    expect(poishaDecimal(-16225)).toBe("-162.25");
    expect(() => poishaDecimal(1.5)).toThrow();
    expect(() => poishaDecimal(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });

  it("rejects formatted strings in stored money instead of guessing their unit", () => {
    for (const value of ["16200", "১৬২০০", "162.00", "৳১৬২", NaN, Infinity])
      expect(MoneySchema.safeParse(value).success).toBe(false);
  });
});
