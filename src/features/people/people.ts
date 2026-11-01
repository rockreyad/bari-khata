import type { Ledger, Person } from "../../domain/model";
import { personSummary } from "../../domain/ledger";

export function phoneLink(value: string): string | null {
  const clean = value
    .trim()
    .replace(/[০-৯]/g, (digit) => String("০১২৩৪৫৬৭৮৯".indexOf(digit)))
    .replace(/[\s().-]/g, "");
  if (!/^\+?\d{7,15}$/.test(clean)) return null;
  const number = /^01[3-9]\d{8}$/.test(clean)
    ? `+88${clean}`
    : /^8801[3-9]\d{8}$/.test(clean)
      ? `+${clean}`
      : clean;
  return `tel:${number}`;
}

export { personKind } from "../../domain/contacts";

export function contactSummary(
  ledger: Ledger,
  personId: string,
  workId?: string,
) {
  const summary = personSummary(ledger, personId, workId);
  const historicalCount = summary.entries.filter(
    (entry) => entry.balanceImpact === "historical",
  ).length;
  const currentCount = summary.entries.length - historicalCount;
  const latestDate =
    summary.entries
      .map((entry) => entry.date)
      .filter((date): date is string => Boolean(date))
      .sort()
      .at(-1) ?? null;
  return { ...summary, historicalCount, currentCount, latestDate };
}

export function matchesContact(
  person: Pick<Person, "name" | "role" | "phone">,
  query: string,
) {
  const normalize = (value: string) =>
    value
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[০-৯]/g, (digit) => String("০১২৩৪৫৬৭৮৯".indexOf(digit)));
  const haystack = normalize(`${person.name} ${person.role} ${person.phone}`);
  return normalize(query)
    .trim()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}
