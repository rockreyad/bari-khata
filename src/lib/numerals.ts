export function latinDigits(value: string | number) {
  return String(value).replace(/[০-৯]/g, (digit) =>
    String("০১২৩৪৫৬৭৮৯".indexOf(digit)),
  );
}
export function localizedDigits(value: string | number, language: "bn" | "en") {
  const latin = latinDigits(value);
  return language === "bn"
    ? latin.replace(/\d/g, (digit) => "০১২৩৪৫৬৭৮৯"[Number(digit)])
    : latin;
}
