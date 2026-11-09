import type {
  AddOptions,
  NotebookContextValue,
} from "../../app/NotebookContext";
import {
  contactEntryPolicy,
  getContactEntryDefaults,
} from "../../domain/contactEntryPolicy";
import {
  allowedContactActions,
  contactPaymentAccount,
  personKind,
} from "../../domain/contacts";
import { contractAppliesToWork } from "../../domain/contracts";
import {
  AccountSchema,
  type ContactAction,
  type Ledger,
  type Person,
} from "../../domain/model";

export const contactActionLabels: Record<ContactAction, string> = {
  payment: "টাকা দিই",
  purchase: "মাল কিনলাম",
  transport: "আনার খরচ লিখি",
  return: "মাল ফেরত দিই",
};

type ContactActionContext = {
  workId?: string;
  account?: string;
  contractId?: string;
  back: string;
};
type ContactActionTarget = { path: string } | { options: AddOptions };

export function contactActionPlan(
  ledger: Ledger,
  person: Person,
  context: ContactActionContext,
) {
  const actions = person.archivedAt ? [] : allowedContactActions(person);
  const kind = personKind(person);
  const priority: ContactAction[] =
    kind === "shop"
      ? ["purchase", "payment", "transport", "return"]
      : ["payment", "purchase", "transport", "return"];
  const primary = priority.find((action) => actions.includes(action));
  const workId = ledger.works.some((work) => work.id === context.workId)
    ? context.workId
    : undefined;
  const target = (action: ContactAction): ContactActionTarget | null => {
    if (!actions.includes(action)) return null;
    if (action === "payment") {
      const policy = contactEntryPolicy(person);
      const chargeType =
        kind !== "shop" &&
        (kind === "worker" || policy.defaultAccount === "labour")
          ? (policy.chargeCostTypes.find((type) => type === "labour") ??
            policy.chargeCostTypes[0])
          : kind === "driver"
            ? (policy.chargeCostTypes.find((type) => type === "transport") ??
              policy.chargeCostTypes[0])
            : undefined;
      const defaults = getContactEntryDefaults(ledger, person, {
        workId,
        account: chargeType
          ? chargeType === "labour"
            ? "labour"
            : "other"
          : contactPaymentAccount(ledger, person),
        contractId: context.contractId,
      });
      const query = new URLSearchParams({
        person: person.id,
        account: defaults.account,
        back: context.back,
        purpose: chargeType ? "payment" : "party-payment",
      });
      if (defaults.workId) query.set("work", defaults.workId);
      const contract = ledger.contracts.find(
        (row) => row.id === defaults.contractId,
      );
      if (
        defaults.account === "labour" &&
        contract &&
        (!defaults.workId || contractAppliesToWork(contract, defaults.workId))
      )
        query.set("contract", contract.id);
      if (!chargeType) {
        query.set("dueWork", workId || "all");
        query.set(
          "dueAccount",
          AccountSchema.safeParse(context.account).data ?? "all",
        );
      }
      return { path: `${chargeType ? "/write/payment" : "/write"}?${query}` };
    }
    const defaults = getContactEntryDefaults(ledger, person, {
      workId,
      account: action === "transport" ? "other" : "materials",
    });
    return {
      options: {
        kind: action === "return" ? "return" : "expense",
        personId: person.id,
        workId: defaults.workId || undefined,
        account: defaults.account,
        ...(action === "return"
          ? {}
          : { costType: action === "transport" ? "transport" : "material" }),
      },
    };
  };
  return { actions, primary, target };
}

export function openContactAction(
  plan: ReturnType<typeof contactActionPlan>,
  action: ContactAction,
  navigation: Pick<NotebookContextValue, "go" | "add">,
) {
  const target = plan.target(action);
  if (!target) return;
  if ("path" in target) navigation.go(target.path);
  else navigation.add(target.options);
}
