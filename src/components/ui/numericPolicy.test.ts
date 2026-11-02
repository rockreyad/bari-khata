import { describe, expect, it } from "vitest";
import { acceptsNumericInput } from "./numericPolicy";

describe("numeric entry policies", () => {
  it.each(["", ".", "0", "123", "12.", ".5", "123.45"])(
    "allows the decimal editing state %s",
    (value) => expect(acceptsNumericInput(value, "decimal")).toBe(true),
  );

  it.each(["-100", "1e3", "12a", "1,500", "1 2", "1.2.3", "+12"])(
    "rejects %s rather than reinterpreting its monetary value",
    (value) => expect(acceptsNumericInput(value, "decimal")).toBe(false),
  );

  it("keeps PIN and other integer fields limited to digits", () => {
    for (const value of ["", "0", "001318"])
      expect(acceptsNumericInput(value, "integer")).toBe(true);
    for (const value of ["1.5", "-1", "+1318", "1e3", "13 18", "a"])
      expect(acceptsNumericInput(value, "integer")).toBe(false);
  });

  it("permits telephone formatting without accepting letters or embedded plus signs", () => {
    for (const value of ["", "01712345678", "+880 (1712) 345-678"])
      expect(acceptsNumericInput(value, "phone")).toBe(true);
    for (const value of ["017abc45678", "1e3", "++88017", "880+17", "17.5"])
      expect(acceptsNumericInput(value, "phone")).toBe(false);
  });

  it("explicitly permits calculator arithmetic while leaving value validation to the evaluator", () => {
    for (const value of ["", "(5 + 2) × 3 ÷ 2 − 1", "৳1,500.25/2", "-2*5"])
      expect(acceptsNumericInput(value, "expression")).toBe(true);
    for (const value of ["1e3", "5x3", "Infinity", "alert(1)", "2^3", "2=3"])
      expect(acceptsNumericInput(value, "expression")).toBe(false);
  });
});
