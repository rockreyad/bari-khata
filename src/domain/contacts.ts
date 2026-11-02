import type {
  Account,
  ContactAction,
  Entry,
  Ledger,
  Person,
  PersonKind,
} from "./model.js";
import { personSummary } from "./ledger.js";
import { personKind } from "./contactKind.js";
import { effectiveAccounts } from "./effectiveAccounts.js";
export { personKind } from "./contactKind.js";

export const roleActions: Record<PersonKind, ContactAction[]> = {
  worker: ["payment"],
  shop: ["payment", "purchase", "return"],
  driver: ["payment", "transport"],
  other: ["payment", "purchase", "transport"],
};
export function allowedContactActions(person: Person): ContactAction[] {
  const allowed = roleActions[personKind(person)];
  return [
    ...new Set(
      (person.quickActions ?? allowed).filter((action) =>
        allowed.includes(action),
      ),
    ),
  ];
}
export function defaultContactAccount(person: Person): Account {
  return personKind(person) === "worker"
    ? "labour"
    : personKind(person) === "driver"
      ? "other"
      : "materials";
}
export function contactAccountLedger(
  ledger: Ledger,
  person: Person,
  account = defaultContactAccount(person),
): Ledger {
  const own = ledger.entries.filter((entry) => entry.personId === person.id);
  const effective = effectiveAccounts(ledger);
  if (personKind(person) === "driver" && account === "other") {
    const transportBills = new Set(
      own
        .filter(
          (entry) =>
            (entry.kind === "expense" || entry.kind === "expense_credit") &&
            entry.lines.length > 0 &&
            entry.lines.every((line) => line.costType === "transport"),
        )
        .map((entry) => entry.id),
    );
    return {
      ...ledger,
      entries: own.filter(
        (entry) =>
          ((entry.kind === "payment" || entry.kind === "refund") &&
            effective.get(entry.id) === "other" &&
            (!entry.relatedEntryId ||
              transportBills.has(entry.relatedEntryId))) ||
          transportBills.has(entry.id),
      ),
    };
  }
  return {
    ...ledger,
    entries: own.filter((entry) => effective.get(entry.id) === account),
  };
}
export function sortContactEntries(
  entries: Entry[],
  ascending = false,
): Entry[] {
  return [...entries].sort((a, b) => {
    const dates = (a.date ?? "").localeCompare(b.date ?? "");
    const created = a.createdAt.localeCompare(b.createdAt);
    const order = dates || created || a.id.localeCompare(b.id);
    return ascending ? order : -order;
  });
}
export function contactAccountSummary(
  ledger: Ledger,
  person: Person,
  account = defaultContactAccount(person),
  workId?: string,
) {
  const scoped = contactAccountLedger(ledger, person, account);
  const summary = personSummary(scoped, person.id, workId);
  return {
    ...summary,
    historicalCount: summary.entries.filter(
      (entry) => entry.balanceImpact === "historical",
    ).length,
    account,
  };
}

export function canAssignContact(
  person: Person,
  account: Account,
  costTypes: string[],
  cash: boolean,
): boolean {
  const kind = personKind(person);
  if (kind === "worker")
    return (
      account === "labour" &&
      (cash || costTypes.every((type) => type === "labour"))
    );
  if (kind === "shop")
    return (
      account === "materials" &&
      (cash || costTypes.every((type) => type === "material"))
    );
  if (kind === "driver")
    return (
      account === "other" &&
      (cash || costTypes.every((type) => type === "transport"))
    );
  return true;
}
