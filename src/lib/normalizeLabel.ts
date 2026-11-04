import { latinDigits } from "./numerals";

export const normalizeLabel = (value: string) =>
  latinDigits(value.normalize("NFKC"))
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
