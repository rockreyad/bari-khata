import { latinDigits } from "./numerals.js";

export const normalizeLabel = (value: string) =>
  latinDigits(value.normalize("NFKC"))
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
