import { afterEach, expect, it, vi } from "vitest";
import { parseAmount } from "../domain/ledger";
import { parseMoneyText } from "../domain/money";
import { evaluateMoneyExpression } from "../components/ui/calculator";
import { formatMoney } from "./formatMoney";
import { localizedDigits } from "./numerals";

afterEach(() => vi.restoreAllMocks());

it("localizes only the display digits and preserves the exact stored paisa", () => {
  expect(formatMoney(16225, "bn")).toBe("৳\u202f১৬২.২৫");
  expect(formatMoney(16225, "en")).toBe("৳\u202f162.25");
  expect(formatMoney(0, "bn")).toBe("৳\u202f০");
  expect(formatMoney(-16225, "bn")).toBe("৳\u202f-১৬২.২৫");
  for (const language of ["bn", "en"] as const)
    for (const amount of [1, 10, 125050, 123456789, Number.MAX_SAFE_INTEGER])
      expect(parseAmount(formatMoney(amount, language))).toBe(amount);
  expect(formatMoney(Number.MAX_SAFE_INTEGER, "en")).toContain(".91");
  expect(formatMoney(Number.MAX_SAFE_INTEGER, "bn")).toContain(".৯১");
});

it.each(["bn", "en"] as const)(
  "keeps the currency symbol attached with narrow nonbreaking spacing in exact and compact %s values",
  (language) => {
    for (const amount of [0, 1, 16225, 125000000, -16225]) {
      for (const compact of [false, true]) {
        const shown = formatMoney(amount, language, compact);
        expect(shown.startsWith("৳\u202f")).toBe(true);
        expect(shown).not.toMatch(/^৳\u00a0/u);
        expect(shown.match(/৳/g)).toHaveLength(1);
        expect(shown.slice(2)).not.toMatch(/^\s/);
      }
    }
  },
);

it.each(["bn", "en"] as const)(
  "keeps selected %s digits when Intl returns the other numbering script",
  (language) => {
    const cases = [
      0,
      1,
      16225,
      -16225,
      123456789,
      Number.MAX_SAFE_INTEGER,
      -Number.MAX_SAFE_INTEGER,
    ].flatMap((amount) =>
      [false, true].map((compact) => ({
        amount,
        compact,
        expected: formatMoney(amount, language, compact),
      })),
    );
    const nativeFormat = Object.getOwnPropertyDescriptor(
      Intl.NumberFormat.prototype,
      "format",
    )!.get!;
    vi.spyOn(
      Intl.NumberFormat.prototype as unknown as { format: unknown },
      "format",
      "get",
    ).mockImplementation(function (this: Intl.NumberFormat) {
      const format = nativeFormat.call(this) as Intl.NumberFormat["format"];
      return (value: number | bigint) =>
        localizedDigits(format(value), language === "bn" ? "en" : "bn");
    });
    for (const { amount, compact, expected } of cases) {
      const shown = formatMoney(amount, language, compact);
      expect(shown).toBe(expected);
      expect(shown).not.toMatch(language === "bn" ? /[0-9]/ : /[০-৯]/);
      if (!compact)
        expect(parseMoneyText(shown, { signed: true })).toBe(amount);
    }
  },
);

it.each(["bn", "en"] as const)(
  "keeps copied spaced %s amounts usable in the calculator and signed amount parser",
  (language) => {
    expect(
      evaluateMoneyExpression(
        `${formatMoney(125050, language)} + ${formatMoney(9950, language)}`,
      ),
    ).toEqual({ value: "1350", poisha: 135000 });
    expect(
      parseMoneyText(formatMoney(-16225, language), { signed: true }),
    ).toBe(-16225);
  },
);
