import type { Account, CostType, Ledger, Person } from "./model.js";
import { contactPresets, contactRoles } from "./contactTypes.js";
import {
  allowedContactActions,
  canCreateContactJob,
  defaultContactAccount,
  personKind,
} from "./contacts.js";
import { partyLedger } from "./partyLedger.js";

const allAccounts: Account[] = ["materials", "labour", "other"];
const allCharges: CostType[] = [
  "labour",
  "transport",
  "unload",
  "rental",
  "other",
];

export function contactEntryPolicy(person: Person) {
  const roles = contactRoles(person);
  const neutral =
    roles.length === 0 ||
    (roles.includes("custom") &&
      (person.roles !== undefined ||
        person.contactType === "custom" ||
        personKind(person) === "other"));
  const presets = contactPresets.filter((preset) => roles.includes(preset.id));
  const actions = person.archivedAt ? [] : allowedContactActions(person);
  const payment = actions.includes("payment");
  const worker =
    presets.some((preset) => preset.kind === "worker") ||
    (person.roles === undefined && personKind(person) === "worker");
  const accounts = allAccounts.filter(
    (account) =>
      neutral ||
      (account === "materials" && roles.includes("supplier")) ||
      (account === "labour" && worker) ||
      (account === "other" && (worker || roles.includes("transport"))),
  );
  const chargeCostTypes = allCharges.filter(
    (type) =>
      (type === "transport" && actions.includes("transport")) ||
      (payment &&
        type !== "transport" &&
        (neutral ||
          (worker && ["labour", "unload", "rental", "other"].includes(type)))),
  );
  const preferredAccount = defaultContactAccount(person);
  return {
    actions,
    accounts,
    chargeCostTypes,
    agreement: canCreateContactJob(person),
    purchase:
      actions.includes("purchase") ||
      (neutral && payment && person.quickActions == null),
    reimbursement: payment,
    payment,
    defaultAccount: accounts.includes(preferredAccount)
      ? preferredAccount
      : (accounts[0] ?? "other"),
  };
}

export function canRecordContactCost(
  person: Person,
  input: {
    costType: CostType;
    account: Account;
    reimbursement?: boolean;
    contractId?: string | null;
  },
) {
  const policy = contactEntryPolicy(person);
  if (person.archivedAt) return false;
  if (input.contractId && !policy.agreement) return false;
  if (input.costType === "material")
    return (
      input.account === "materials" &&
      (input.reimbursement ? policy.reimbursement : policy.purchase)
    );
  return (
    policy.chargeCostTypes.includes(input.costType) &&
    input.account === (input.costType === "labour" ? "labour" : "other")
  );
}

export function canRecordContactCash(
  ledger: Ledger,
  person: Person,
  input: {
    account: Account;
    contractId?: string | null;
    context: "settlement" | "advance" | "receivable";
    amount: number;
    refund?: boolean;
    reimbursement?: boolean;
    workId?: string;
  },
) {
  const policy = contactEntryPolicy(person);
  if (person.archivedAt) return false;
  const sameScope = (entry: Ledger["entries"][number]) =>
    entry.personId === person.id &&
    !entry.voided &&
    entry.balanceImpact === "normal" &&
    entry.account === input.account &&
    entry.contractId === (input.contractId ?? null) &&
    (!input.workId ||
      [...entry.lines, ...entry.allocations].some(
        (part) => part.workId === input.workId,
      ));
  if (
    input.refund &&
    ledger.entries.some((entry) => sameScope(entry) && entry.kind === "payment")
  )
    return true;
  if (!policy.payment) return false;
  if (
    input.reimbursement &&
    input.account === "materials" &&
    input.context === "settlement"
  )
    return true;
  if (
    policy.accounts.includes(input.account) &&
    (!input.contractId || policy.agreement)
  )
    return true;
  if (input.context !== "settlement" || input.refund) return false;
  const outstanding = partyLedger(ledger, person.id, input.account)
    .bills.filter((bill) => sameScope(bill.entry))
    .flatMap((bill) =>
      bill.works.filter(
        (work) => !input.workId || work.workId === input.workId,
      ),
    )
    .reduce((sum, work) => sum + work.outstanding, 0);
  return input.amount > 0 && input.amount <= outstanding;
}

export function canRecordContactReturn(
  ledger: Ledger,
  person: Person,
  input: {
    account: Account;
    workId?: string;
    contractId?: string | null;
    sourceEntryId?: string | null;
  },
) {
  if (person.archivedAt) return false;
  const policy = contactEntryPolicy(person);
  return (
    (policy.actions.includes("return") &&
      policy.accounts.includes(input.account)) ||
    ledger.entries.some(
      (entry) =>
        entry.personId === person.id &&
        !entry.voided &&
        entry.balanceImpact === "normal" &&
        entry.kind === "expense" &&
        entry.account === input.account &&
        entry.contractId === (input.contractId ?? null) &&
        (!input.sourceEntryId || entry.id === input.sourceEntryId) &&
        (!input.workId ||
          entry.lines.some((line) => line.workId === input.workId)),
    )
  );
}

export function getContactEntryDefaults(
  ledger: Ledger,
  person: Person,
  requested: { workId?: string; account?: Account; contractId?: string } = {},
) {
  const policy = contactEntryPolicy(person);
  const workIds = (person.workIds ?? []).filter((id) =>
    ledger.works.some((work) => work.id === id && !work.archivedAt),
  );
  const contract = requested.contractId
    ? ledger.contracts.find(
        (row) =>
          row.id === requested.contractId &&
          row.personId === person.id &&
          !row.archivedAt,
      )
    : undefined;
  const workId =
    requested.workId ??
    (contract?.scope === "work"
      ? (contract.workId ?? "")
      : workIds.length === 1
        ? workIds[0]
        : "");
  return {
    workId,
    account: requested.account ?? policy.defaultAccount,
    contractId: contract?.id ?? "",
    workIds,
  };
}
