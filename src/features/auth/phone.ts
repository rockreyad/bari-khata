import { latinDigits } from "../../lib/numerals.js";

function compactPhone(input: string) {
  return latinDigits(input.trim()).replace(/[\s()-]/g, "");
}

export function nationalPhoneInput(input: string): string {
  const value = compactPhone(input);
  if (value.startsWith("00880")) return value.slice(5);
  if (value.startsWith("+880")) return value.slice(4);
  if (value.startsWith("880")) return value.slice(3);
  return value;
}

export function normalizeBangladeshPhone(input: string): string {
  const value = nationalPhoneInput(input);
  const national = value.startsWith("0") ? value.slice(1) : value;
  if (!/^1[3-9]\d{8}$/.test(national)) throw new Error("invalid_phone");
  return `+880${national}`;
}
