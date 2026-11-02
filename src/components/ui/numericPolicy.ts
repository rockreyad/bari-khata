export type NumericKind = "decimal" | "integer" | "phone" | "expression";

export function acceptsNumericInput(value: string, kind: NumericKind) {
  if (kind === "integer") return /^\d*$/.test(value);
  if (kind === "phone") return /^\+?[\d\s()-]*$/.test(value);
  if (kind === "expression") return /^[\d+\-*/×✕÷−–().,\s৳]*$/.test(value);
  return /^\d*(?:\.\d*)?$/.test(value);
}
