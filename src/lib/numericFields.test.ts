import { describe, expect, it } from "vitest";
import { parseAmount } from "../domain/ledger";
import {
  contractQuantity,
  contractTotal,
  moneyInputValue,
  numericDraftText,
} from "./numericFields";

describe("canonical numeric form values", () => {
  it("restores Bengali and mixed draft digits as ASCII without translating human text", () => {
    const field = numericDraftText();
    expect(field.parse(undefined)).toBe("");
    expect(field.parse("৯3,০০০.২৫")).toBe("93,000.25");
    expect(field.parse("১.৫")).toBe("1.5");
  });
  it.each([
    0,
    1,
    10,
    100,
    16200,
    9300000,
    Number.MAX_SAFE_INTEGER - 1,
    Number.MAX_SAFE_INTEGER,
  ])(
    "round-trips %i integer paisa exactly through an editable decimal",
    (value) => {
      expect(parseAmount(moneyInputValue(value))).toBe(value);
    },
  );
  it("never supplies a rounded editable value for an unsafe preview", () => {
    expect(moneyInputValue(Number.MAX_SAFE_INTEGER + 1)).toBe("");
    expect(moneyInputValue(NaN)).toBe("");
    expect(moneyInputValue(-1)).toBe("");
    expect(moneyInputValue(Number.MAX_SAFE_INTEGER)).toBe("90071992547409.91");
  });
});

describe("contract quantities and money", () => {
  it.each(["5700", "৫৭০০", "5,700", "৫,৭০০"])(
    "calculates %s sqft at 22 taka without changing the unit",
    (quantity) => {
      expect(contractQuantity(quantity)).toBe("5700");
      expect(contractTotal(quantity, "২২")).toBe(12540000);
    },
  );
  it("keeps precise fractional quantities and rejects ambiguous separators rather than dropping them", () => {
    expect(contractQuantity("১,২৩,৪৫৬.১২৫০")).toBe("123456.1250");
    expect(contractTotal("৮", "2,000")).toBe(1600000);
    expect(contractTotal("1.5", "0.01")).toBe(2);
    expect(contractTotal("0.5", "0.01")).toBe(1);
    for (const quantity of ["1,5", "1,6,2", "1 2", "1.2.3", "-1", "1.00001"])
      expect(contractTotal(quantity, "100")).toBe(0);
  });
  it("preserves the maximum safe penny and refuses a contract multiplication beyond it", () => {
    expect(contractTotal("1", "90071992547409.91")).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(contractTotal("2", "90071992547409.91")).toBe(0);
  });
});
