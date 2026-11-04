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
import { reconciledTotals } from "./adjustmentMath.js";
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
    ...reconciledTotals(scoped, {
      personId: person.id,
      account,
      ...(workId ? { workId } : {}),
    }),
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
  if (cash) return true;
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

export function contactSummary(
  ledger: Ledger,
  person: Person,
  workId?: string,
) {
  const summary = personSummary(ledger, person.id, workId);
  const accounts = (["materials", "labour", "other"] as const).map((account) =>
    reconciledTotals(ledger, {
      personId: person.id,
      account,
      ...(workId ? { workId } : {}),
    }),
  );
  const payable = accounts.reduce(
    (sum, account) => sum + account.reconciledPayable,
    0,
  );
  const advance = accounts.reduce(
    (sum, account) => sum + account.reconciledAdvance,
    0,
  );
  return {
    ...summary,
    reconciledPayable: payable,
    reconciledAdvance: advance,
    reconciledBalance: payable,
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
