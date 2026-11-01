export function normalizeBangladeshPhone(input: string): string {
  const digits = input
    .trim()
    .replace(/[০-৯]/g, (digit) => String("০১২৩৪৫৬৭৮৯".indexOf(digit)))
    .replace(/[\s()-]/g, "");
  const normalized = digits.startsWith("01")
    ? `+88${digits}`
    : digits.startsWith("8801")
      ? `+${digits}`
      : digits;
  if (!/^\+8801[3-9]\d{8}$/.test(normalized)) throw new Error("invalid_phone");
  return normalized;
}
