import { latinDigits } from "../../lib/numerals";
export type CalculatorFailure =
  "empty" | "syntax" | "zero" | "negative" | "large";
export class CalculatorError extends Error {
  constructor(public code: CalculatorFailure) {
    super(code);
  }
}
type Fraction = { n: bigint; d: bigint };
const cap = 10n ** 120n;
const gcd = (left: bigint, right: bigint): bigint => {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
};
function fraction(n: bigint, d = 1n): Fraction {
  if (!d) throw new CalculatorError("zero");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  if (n > cap || n < -cap || d > cap) throw new CalculatorError("large");
  const divisor = gcd(n, d);
  return { n: n / divisor, d: d / divisor };
}
export function normalizeExpression(expression: string) {
  return latinDigits(expression)
    .replace(/[×✕xX]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/[−–]/g, "-")
    .trim();
}
function arithmeticSource(expression: string) {
  if (/[\d.,]\s+[\d.,]/.test(expression)) throw new CalculatorError("syntax");
  const compact = expression.replace(/\s/g, "");
  for (let index = 0; index < compact.length; index++) {
    if (compact[index] !== "৳") continue;
    if (
      (index > 0 && !/[+\-*/(]/.test(compact[index - 1])) ||
      !/[\d.]/.test(compact[index + 1] ?? "")
    )
      throw new CalculatorError("syntax");
  }
  return compact
    .replaceAll("৳", "")
    .replace(/[\d,]+(?:\.\d*)?|\.\d+/g, (literal) => {
      if (!literal.includes(",")) return literal;
      const [whole] = literal.split(".");
      if (
        !/^\d{1,3}(?:,\d{3})+$/.test(whole) &&
        !/^\d{1,2}(?:,\d{2})*,\d{3}$/.test(whole)
      )
        throw new CalculatorError("syntax");
      return literal.replaceAll(",", "");
    });
}
export function evaluateMoneyExpression(expression: string): {
  poisha: number;
  value: string;
} {
  const source = arithmeticSource(normalizeExpression(expression));
  if (!source) throw new CalculatorError("empty");
  if (source.length > 240) throw new CalculatorError("large");
  if (/[^0-9.+\-*/()]/.test(source)) throw new CalculatorError("syntax");
  let position = 0;
  let operations = 0;
  const operation = () => {
    if (++operations > 100) throw new CalculatorError("large");
  };
  const factor = (): Fraction => {
    operation();
    if (source[position] === "+") {
      position++;
      return factor();
    }
    if (source[position] === "-") {
      position++;
      const result = factor();
      return fraction(-result.n, result.d);
    }
    if (source[position] === "(") {
      position++;
      const result = expressionValue();
      if (source[position++] !== ")") throw new CalculatorError("syntax");
      return result;
    }
    const literal = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(
      source.slice(position),
    )?.[0];
    if (!literal) throw new CalculatorError("syntax");
    position += literal.length;
    const [whole = "0", decimal = ""] = literal.split(".");
    if (whole.length > 24 || decimal.length > 12)
      throw new CalculatorError("large");
    return fraction(
      BigInt((whole || "0") + decimal),
      10n ** BigInt(decimal.length),
    );
  };
  const term = (): Fraction => {
    let result = factor();
    while (source[position] === "*" || source[position] === "/") {
      const operator = source[position++];
      operation();
      const next = factor();
      result =
        operator === "*"
          ? fraction(result.n * next.n, result.d * next.d)
          : fraction(result.n * next.d, result.d * next.n);
    }
    return result;
  };
  const expressionValue = (): Fraction => {
    let result = term();
    while (source[position] === "+" || source[position] === "-") {
      const operator = source[position++];
      operation();
      const next = term();
      result = fraction(
        result.n * next.d + (operator === "+" ? 1n : -1n) * next.n * result.d,
        result.d * next.d,
      );
    }
    return result;
  };
  const result = expressionValue();
  if (position !== source.length) throw new CalculatorError("syntax");
  if (result.n < 0n) throw new CalculatorError("negative");
  const scaled = result.n * 100n;
  const poisha = (scaled + result.d / 2n) / result.d;
  if (poisha > BigInt(Number.MAX_SAFE_INTEGER))
    throw new CalculatorError("large");
  const tail = (poisha % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return {
    poisha: Number(poisha),
    value: `${poisha / 100n}${tail ? `.${tail}` : ""}`,
  };
}
