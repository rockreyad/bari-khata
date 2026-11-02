import { latinDigits } from "../lib/numerals.js";

export function parseMoneyText(
  value: string,
  options: { signed?: boolean } = {},
): number {
  let text = latinDigits(value).trim();
  if (!text || text.length > 128) throw new Error("Invalid amount");
  const symbols = [...text].filter((char) => char === "৳").length;
  if (symbols > 1) throw new Error("Invalid amount");
  if (symbols === 1) {
    const index = text.indexOf("৳");
    if (
      index !== 0 &&
      index !== text.length - 1 &&
      !(index === 1 && text.startsWith("-"))
    )
      throw new Error("Invalid amount");
    text = text.replace("৳", "").trim();
  }
  const negative = text.startsWith("-");
  if (negative) {
    if (!options.signed) throw new Error("Invalid amount");
    text = text.slice(1).trimStart();
  }
  const parts = text.split(".");
  if (parts.length > 2) throw new Error("Invalid amount");
  const [whole, decimal = ""] = parts;
  const validWhole =
    /^\d+$/.test(whole) ||
    /^\d{1,3}(?:,\d{3})+$/.test(whole) ||
    /^\d{1,2}(?:,\d{2})*,\d{3}$/.test(whole);
  if (!validWhole || (parts.length === 2 && !/^\d{1,2}$/.test(decimal)))
    throw new Error("Invalid amount");
  const amount =
    BigInt(whole.replaceAll(",", "")) * 100n + BigInt(decimal.padEnd(2, "0"));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Amount is too large");
  return Number(negative ? -amount : amount);
}

export function poishaDecimal(poisha: number): string {
  if (!Number.isSafeInteger(poisha)) throw new Error("Invalid stored amount");
  const absolute = BigInt(Math.abs(poisha));
  const tail = String(absolute % 100n)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return `${poisha < 0 ? "-" : ""}${absolute / 100n}${tail ? `.${tail}` : ""}`;
}
