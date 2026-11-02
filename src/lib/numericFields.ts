import { poishaDecimal } from "../domain/money";
import { z } from "zod";
import { parseAmount } from "../domain/ledger";
import { latinDigits } from "./numerals";

export function numericDraftText(max = 60, defaultValue = "") {
  return z.string().max(max).default(defaultValue).transform(latinDigits);
}

export function moneyInputValue(poisha: number): string {
  if (!Number.isSafeInteger(poisha) || poisha < 0) return "";
  return poishaDecimal(poisha);
}

export function contractQuantity(value: string) {
  const input = latinDigits(value).trim();
  const [whole, fraction] = input.split(".");
  const validWhole =
    /^\d+$/.test(whole) ||
    /^\d{1,3}(?:,\d{3})+$/.test(whole) ||
    /^\d{1,2}(?:,\d{2})*,\d{3}$/.test(whole);
  if (
    !validWhole ||
    (fraction !== undefined && !/^\d{1,4}$/.test(fraction)) ||
    input.split(".").length > 2
  )
    return null;
  return input.replaceAll(",", "");
}

export function contractTotal(quantity: string, rate: string) {
  const canonical = contractQuantity(quantity);
  if (canonical === null) return 0;
  try {
    const [whole, fraction = ""] = canonical.split(".");
    const units = BigInt(whole + fraction);
    const denominator = 10n ** BigInt(fraction.length);
    const total =
      (units * BigInt(parseAmount(rate)) + denominator / 2n) / denominator;
    return total > 0n && total <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(total)
      : 0;
  } catch {
    return 0;
  }
}
