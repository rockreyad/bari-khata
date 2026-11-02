import { expect, it } from "vitest";
import { parseAmount } from "../domain/ledger";
import { parseMoneyText } from "../domain/money";
import { evaluateMoneyExpression } from "../components/ui/calculator";
import { formatMoney } from "./formatMoney";

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
