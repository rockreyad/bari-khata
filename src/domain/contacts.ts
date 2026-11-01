import type {
  Account,
  ContactAction,
  Entry,
  Ledger,
  Person,
  PersonKind,
} from "./model";
import { personSummary } from "./ledger";

export function personKind(person: Person): PersonKind {
  if (person.kind) return person.kind;
  const description = `${person.role} ${person.name}`;
  if (
    /দোকান|স্টোর|হার্ডওয়্যার|ট্রেড|সাপ্লাই|এন্টারপ্রাইজ|shop|store|trading|enterprise|supplier|hardware/i.test(
      description,
    )
  )
    return "shop";
  if (/চালক|ড্রাইভার|ভ্যান|driver|transport|truck|van/i.test(description))
    return "driver";
  if (
    /মিস্ত্রি|মিস্রি|মিস্তিরি|শ্রমিক|ঠিকাদার|লেবার|contractor|worker|electrician|plumber|mistri/i.test(
      description,
    )
  )
    return "worker";
  return "other";
}
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
    const pureBuckets = new Map<string, boolean>();
    for (const entry of own) {
      if (entry.kind !== "expense" && entry.kind !== "expense_credit") continue;
      for (const line of entry.lines) {
        const key = JSON.stringify([entry.account, line.workId]);
        pureBuckets.set(
          key,
          (pureBuckets.get(key) ?? true) && line.costType === "transport",
        );
      }
    }
    const legacyTransportCash = (entry: Entry) =>
      !entry.relatedEntryId &&
      entry.account === "materials" &&
      (entry.kind === "payment" || entry.kind === "refund") &&
      entry.allocations.length > 0 &&
      entry.allocations.every(
        (part) =>
          pureBuckets.get(JSON.stringify([entry.account, part.workId])) ===
          true,
      );
    return {
      ...ledger,
      entries: own.filter(
        (entry) =>
          ((entry.kind === "payment" || entry.kind === "refund") &&
            entry.account === "other" &&
            (!entry.relatedEntryId ||
              transportBills.has(entry.relatedEntryId))) ||
          transportBills.has(entry.id) ||
          legacyTransportCash(entry) ||
          Boolean(
            entry.relatedEntryId && transportBills.has(entry.relatedEntryId),
          ),
      ),
    };
  }
  return {
    ...ledger,
    entries: own.filter((entry) => entry.account === account),
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
