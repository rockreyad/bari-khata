import { poishaDecimal } from "../domain/money";
import { localizedDigits } from "./numerals";

const grouped = {
  bn: new Intl.NumberFormat("bn-BD", { maximumFractionDigits: 0 }),
  en: new Intl.NumberFormat("en-BD", { maximumFractionDigits: 0 }),
};
const shortened = {
  bn: new Intl.NumberFormat("bn-BD", {
    notation: "compact",
    maximumFractionDigits: 1,
  }),
  en: new Intl.NumberFormat("en-BD", {
    notation: "compact",
    maximumFractionDigits: 1,
  }),
};
const taka = "৳\u202f";
export function formatMoney(
  poisha: number,
  language: "bn" | "en",
  compact = false,
): string {
  const exact = poishaDecimal(poisha);
  // Intl locale data can fall back to another digit script on the device.
  if (compact)
    return localizedDigits(
      `${taka}${shortened[language].format(poisha / 100)}`,
      language,
    );
  const negative = exact.startsWith("-");
  const [whole, tail] = exact.replace(/^-/, "").split(".");
  return localizedDigits(
    `${taka}${negative ? "-" : ""}${grouped[language].format(BigInt(whole))}${tail ? `.${tail}` : ""}`,
    language,
  );
}
