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
import {
  contactRoles,
  contactPresets,
  contactCanHaveAgreement,
} from "./contactTypes.js";
import { effectiveAccounts } from "./effectiveAccounts.js";
import { reconciledTotals } from "./adjustmentMath.js";
export { personKind } from "./contactKind.js";

export const roleActions: Record<PersonKind, ContactAction[]> = {
  worker: ["payment"],
  shop: ["payment", "purchase", "return"],
  driver: ["payment", "transport"],
  other: ["payment"],
};
export const contactActionChoices: ContactAction[] = [
  "payment",
  "purchase",
  "return",
  "transport",
];
export function availableContactActions(kind: PersonKind): ContactAction[] {
  return [...roleActions[kind]];
}
export function allowedContactActions(person: Person): ContactAction[] {
  const available = availablePartyActions(person);
  return [
    ...new Set(
      (person.quickActions ?? available).filter((action) =>
        available.includes(action),
      ),
    ),
  ];
}
export function availablePartyActions(person: Person): ContactAction[] {
  const roles = contactRoles(person);
  if (
    person.roles?.length === 0 ||
    person.roles?.includes("custom") ||
    person.contactType === "custom"
  )
    return [...contactActionChoices];
  return [
    ...new Set<ContactAction>([
      "payment",
      ...roles.flatMap(
        (role) =>
          contactPresets.find((preset) => preset.id === role)?.actions ?? [],
      ),
    ]),
  ];
}
export function canCreateContactJob(person: Person): boolean {
  return contactCanHaveAgreement(person);
}
export function defaultContactAccount(person: Person): Account {
  if (person.roles !== undefined) {
    const roles = contactRoles(person);
    const preset =
      contactPresets.find(
        (item) => item.id === person.contactType && roles.includes(item.id),
      ) ?? contactPresets.find((item) => item.id === roles[0]);
    return preset?.kind === "shop"
      ? "materials"
      : preset?.kind === "worker"
        ? "labour"
        : "other";
  }
  return personKind(person) === "worker"
    ? "labour"
    : personKind(person) === "driver"
      ? "other"
      : personKind(person) === "shop"
        ? "materials"
        : "other";
}
export function contactAccountLedger(
  ledger: Ledger,
  person: Person,
  account = defaultContactAccount(person),
): Ledger {
  const own = ledger.entries.filter((entry) => entry.personId === person.id);
  const effective = effectiveAccounts(ledger);
  return {
    ...ledger,
    entries: own.filter((entry) => effective.get(entry.id) === account),
    contracts:
      account === "labour"
        ? ledger.contracts.filter((row) => row.personId === person.id)
        : [],
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
    ...reconciledTotals(scoped, {
      personId: person.id,
      ...(workId ? { workId } : {}),
    }),
    historicalCount: summary.entries.filter(
      (entry) => entry.balanceImpact === "historical",
    ).length,
    account,
  };
}

export function canAssignContact(
  _person: Person,
  _account: Account,
  _costTypes: string[],
  _cash: boolean,
): boolean {
  // A description or shortcut preference cannot invalidate an explicit bill.
  return true;
}

export function contactSummary(
  ledger: Ledger,
  person: Person,
  workId?: string,
) {
  const summary = personSummary(ledger, person.id, workId);
  return {
    ...summary,
    historicalCount: summary.entries.filter(
      (entry) => entry.balanceImpact === "historical",
    ).length,
  };
}

export function contactPaymentAccount(ledger: Ledger, person: Person): Account {
  const accounts = effectiveAccounts(ledger);
  const used = new Set<Account>(
    ledger.entries
      .filter((entry) => entry.personId === person.id && !entry.voided)
      .map((entry) => accounts.get(entry.id) ?? entry.account),
  );
  if (ledger.contracts.some((job) => job.personId === person.id))
    used.add("labour");
  return used.size === 1 ? [...used][0] : defaultContactAccount(person);
}
