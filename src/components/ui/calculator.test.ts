import { describe, expect, it } from "vitest";
import { CalculatorError, evaluateMoneyExpression } from "./calculator";

describe("embedded money calculator", () => {
  it("supports Bengali digits, precedence, parentheses and grouped currency", () => {
    expect(evaluateMoneyExpression("৳১,৫০০ + ২৫০ × ২")).toEqual({
      poisha: 200000,
      value: "2000",
    });
    expect(evaluateMoneyExpression("(৫৭০০ × ২২) − ১০০০০")).toEqual({
      poisha: 11540000,
      value: "115400",
    });
    expect(evaluateMoneyExpression("750÷3+50")).toEqual({
      poisha: 30000,
      value: "300",
    });
    expect(evaluateMoneyExpression("-(5-10)+2").value).toBe("7");
    expect(evaluateMoneyExpression("৳১,২৩,৪৫৬.৭৮ + ৳1,234,567.22")).toEqual({
      poisha: 135802400,
      value: "1358024",
    });
    expect(evaluateMoneyExpression(" 162 + ( 93,000.50 / 2 ) ")).toEqual({
      poisha: 4666225,
      value: "46662.25",
    });
  });
  it("keeps decimal arithmetic exact until final poisha rounding", () => {
    expect(evaluateMoneyExpression("0.1 + 0.2")).toEqual({
      poisha: 30,
      value: "0.3",
    });
    expect(evaluateMoneyExpression("1/3*3")).toEqual({
      poisha: 100,
      value: "1",
    });
    expect(evaluateMoneyExpression("1/6")).toEqual({
      poisha: 17,
      value: "0.17",
    });
    expect(evaluateMoneyExpression("1.005")).toEqual({
      poisha: 101,
      value: "1.01",
    });
    expect(evaluateMoneyExpression(".5+.25")).toEqual({
      poisha: 75,
      value: "0.75",
    });
    expect(evaluateMoneyExpression("1-1")).toEqual({ poisha: 0, value: "0" });
  });
  it("rejects incomplete, executable and ambiguous input instead of applying it", () => {
    for (const expression of [
      "",
      "500+",
      "(5+2",
      "5++*2",
      "2(3+1)",
      "1..2",
      "Math.max(1,2)",
      "alert(1)",
      "1e8",
      "1 2",
      "1 .5",
      "1. 5",
      "1,5",
      "১,৫ + ১০",
      "1,,234",
      "12,34",
      "1৳2",
      "৳৳100",
      "100 + ৳",
    ]) {
      expect(() => evaluateMoneyExpression(expression)).toThrow(
        CalculatorError,
      );
    }
  });
  it("rejects division by zero, negative final money, overflow and excessive work", () => {
    expect(() => evaluateMoneyExpression("100/(5-5)")).toThrow("zero");
    expect(() => evaluateMoneyExpression("50-100")).toThrow("negative");
    expect(() => evaluateMoneyExpression("90071992547409.92")).toThrow("large");
    expect(() => evaluateMoneyExpression("1+".repeat(200) + "1")).toThrow(
      "large",
    );
    expect(evaluateMoneyExpression("90071992547409.91").poisha).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });
});
