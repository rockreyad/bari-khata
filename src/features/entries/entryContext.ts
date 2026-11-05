import type { AddOptions } from "../../app/NotebookProvider";
import type { CostType, Ledger } from "../../domain/model";
import { contactPaymentAccount, personKind } from "../../domain/contacts";
import { QuickDraftSchema, quickWageAmount } from "./quickEntry";
import { applicableContracts } from "../../domain/contracts";
import { moneyInputValue } from "../../lib/numericFields";
import {
  hasPaymentWriting,
  inferPaymentJob,
  paymentPurpose,
  preferredPaymentJob,
} from "./paymentIntent";
export { partyAccountBalance } from "../../domain/ledger";
export function applicableQuickContracts(
  ledger: Ledger,
  personId: string,
  workId?: string,
) {
  if (ledger.people.find((person) => person.id === personId)?.archivedAt)
    return [];
  if (workId && ledger.works.find((work) => work.id === workId)?.archivedAt)
    return [];
  return applicableContracts(ledger, personId, workId).filter(
    (job) => !job.archivedAt,
  );
}
import { defaultTaxonomy } from "../../domain/importWallet";
import { todayDhaka } from "../../lib/display";

const normalize = (value: string) =>
  value.normalize("NFKC").trim().toLocaleLowerCase();
export function entryContext(ledger: Ledger, options: AddOptions) {
  const person = ledger.people.find((p) => p.id === options.personId);
  const kind = options.kind ?? "expense";
  const account =
    kind === "wage"
      ? "labour"
      : (options.account ??
        (options.costType
          ? options.costType === "labour"
            ? "labour"
            : options.costType === "material"
              ? "materials"
              : "other"
          : person
            ? contactPaymentAccount(ledger, person)
            : "materials"));
  const costType =
    (kind === "wage" ? "labour" : options.costType) ??
    (account === "labour"
      ? "labour"
      : account === "materials"
        ? "material"
        : person && personKind(person) === "driver"
          ? "transport"
          : "other");
  const requestedJob = ledger.contracts.find(
    (contract) =>
      !contract.archivedAt &&
      contract.id === options.contractId &&
      contract.personId === person?.id &&
      account === "labour",
  );
  const defaultJob =
    person &&
    kind === "payment" &&
    options.contractId === undefined &&
    options.purpose !== "charge" &&
    options.purpose !== "wage"
      ? preferredPaymentJob(
          ledger,
          person.id,
          account,
          options.workId !== undefined
            ? applicableQuickContracts(ledger, person.id, options.workId)
            : ledger.contracts,
          false,
        )
      : undefined;
  let workId =
    options.workId ??
    (requestedJob?.scope === "work"
      ? (requestedJob.workId ?? "")
      : defaultJob?.scope === "work"
        ? (defaultJob.workId ?? "")
        : "");
  if (!workId && person) {
    const contracts = ledger.contracts.filter(
      (c) =>
        !c.archivedAt &&
        c.personId === person.id &&
        (!requestedJob || c.id === requestedJob.id),
    );
    const works = new Set([
      ...(person.workIds ?? []),
      ...contracts.flatMap((c) =>
        c.scope === "work" && c.workId ? [c.workId] : [],
      ),
      ...ledger.entries
        .filter(
          (e) =>
            e.personId === person.id &&
            e.account === account &&
            !e.voided &&
            (!e.contractId ||
              !ledger.contracts.find((job) => job.id === e.contractId)
                ?.archivedAt) &&
            (!requestedJob || e.contractId === requestedJob.id),
        )
        .flatMap((e) => [...e.lines, ...e.allocations].map((l) => l.workId)),
    ]);
    const available = [...works].filter((id) =>
      ledger.works.some((work) => work.id === id && !work.archivedAt),
    );
    if (available.length === 1) workId = available[0];
  }
  const work = ledger.works.find((w) => w.id === workId);
  const knownGroups = [
    ...ledger.materialGroups,
    ...defaultTaxonomy().materialGroups.filter(
      (g) =>
        !ledger.materialGroups.some(
          (own) => own.id === g.id || normalize(own.name) === normalize(g.name),
        ),
    ),
  ];
  const matching =
    work && costType === "material"
      ? knownGroups.filter((group) =>
          [group.name, ...group.aliases].some((name) => {
            const value = normalize(name);
            return (
              value &&
              (normalize(work.name) === value ||
                normalize(work.name) === `${value} কেনা` ||
                work.id === `wallet-${group.id}`)
            );
          }),
        )
      : [];
  const group = matching.length === 1 ? matching[0] : undefined;
  const groupItems = group
    ? ledger.items.filter((item) => item.materialGroupId === group.id)
    : [];
  const units = new Set(groupItems.map((item) => item.unit).filter(Boolean));
  const unit =
    units.size === 1
      ? [...units][0]
      : group && /cement|সিমেন্ট/.test(`${group.id} ${group.name}`)
        ? "বস্তা"
        : "";
  const contracts = person
    ? applicableQuickContracts(ledger, person.id, workId || undefined)
    : [];
  const requestedContract = contracts.find(
    (contract) => contract.id === options.contractId,
  );
  const contractId =
    account === "labour"
      ? options.contractId !== undefined
        ? (requestedContract?.id ??
          (ledger.contracts.some(
            (job) =>
              job.id === options.contractId &&
              job.archivedAt &&
              job.personId === person?.id,
          )
            ? options.contractId
            : ""))
        : kind === "payment" &&
            person &&
            options.purpose !== "charge" &&
            options.purpose !== "wage"
          ? (preferredPaymentJob(ledger, person!.id, account, contracts)?.id ??
            "")
          : ""
      : "";
  return QuickDraftSchema.parse({
    id: crypto.randomUUID(),
    paymentId: crypto.randomUUID(),
    refundId: crypto.randomUUID(),
    personNewId: crypto.randomUUID(),
    paymentPurposeNewId: crypto.randomUUID(),
    kind,
    purpose:
      kind === "payment"
        ? paymentPurpose(
            ledger,
            { personId: person?.id ?? "", account, contractId },
            options.purpose,
          )
        : (options.purpose ?? "settle"),
    workId,
    personId: person?.id ?? "",
    account,
    costType,
    contractId,
    milestoneId:
      ledger.milestones?.find(
        (row) =>
          row.id === options.milestoneId && row.contractId === contractId,
      )?.id ?? "",
    date: todayDhaka(),
    payment: kind === "wage" ? "due" : "full",
    rows: [
      {
        id: crypto.randomUUID(),
        label: group?.name ?? "",
        groupId: group
          ? ledger.materialGroups.some((g) => g.id === group.id)
            ? group.id
            : "__new__"
          : "",
        groupName: group?.name ?? "",
        unit,
      },
    ],
  });
}

export function restoreEntryContext(
  saved: ReturnType<typeof entryContext>,
  context: ReturnType<typeof entryContext>,
) {
  if (
    saved.workId !== context.workId ||
    saved.costType !== context.costType ||
    saved.rows.length !== 1
  )
    return saved;
  const row = saved.rows[0];
  if (
    [
      row.label,
      row.amount,
      row.groupId,
      row.brand,
      row.usage,
      row.quantity,
      row.unit,
    ].some((value) => value.trim())
  )
    return saved;
  return {
    ...saved,
    rows: [{ ...context.rows[0], id: row.id }],
    paymentPurposeNewId:
      saved.paymentPurposeNewId || context.paymentPurposeNewId,
  };
}

export function entryContactChange(
  ledger: Ledger,
  draft: ReturnType<typeof entryContext>,
  personId: string,
  explicitFinancialScope = false,
) {
  if (personId === draft.personId) return { personId };
  const keepFinancialScope = explicitFinancialScope || hasPaymentWriting(draft);
  const person = ledger.people.find((p) => p.id === personId);
  if (!person)
    return {
      personId,
      contractId: "",
      milestoneId: "",
      paymentPurposeId: keepFinancialScope ? draft.paymentPurposeId : "",
      paymentPurposeName: keepFinancialScope ? draft.paymentPurposeName : "",
    };
  const context = entryContext(ledger, {
    kind: draft.kind,
    workId: draft.workId || undefined,
    personId,
    ...(draft.kind !== "payment" || keepFinancialScope
      ? { account: draft.account, costType: draft.costType }
      : {}),
  });
  return {
    personId,
    kind: context.kind,
    payment: keepFinancialScope ? draft.payment : context.payment,
    amount:
      draft.amount.trim() ||
      (draft.rows.length === 1 ? draft.rows[0].amount : ""),
    account: context.account,
    costType: context.costType,
    purpose:
      keepFinancialScope || draft.purpose === "advance"
        ? draft.purpose
        : context.purpose,
    workId: keepFinancialScope ? draft.workId : context.workId,
    contractId: keepFinancialScope ? "" : context.contractId,
    milestoneId: "",
    paymentPurposeId: keepFinancialScope ? draft.paymentPurposeId : "",
    paymentPurposeName: keepFinancialScope ? draft.paymentPurposeName : "",
  };
}

export function entryWorkChange(
  ledger: Ledger,
  draft: ReturnType<typeof entryContext>,
  workId: string,
  explicitScope = false,
) {
  const contracts = applicableQuickContracts(
    ledger,
    draft.personId,
    workId || undefined,
  );
  const canDefaultJob =
    draft.kind === "payment" &&
    !explicitScope &&
    !hasPaymentWriting(draft) &&
    draft.purpose !== "wage";
  const chosen =
    contracts.find((contract) => contract.id === draft.contractId) ??
    (canDefaultJob
      ? preferredPaymentJob(ledger, draft.personId, draft.account, contracts)
      : draft.kind !== "payment" &&
          !explicitScope &&
          contracts.length === 1 &&
          inferPaymentJob(
            ledger,
            draft.personId,
            draft.account,
            contracts[0].id,
          )
        ? contracts[0]
        : undefined);
  const contractId =
    draft.account === "labour" && (draft.purpose !== "charge" || canDefaultJob)
      ? (chosen?.id ?? "")
      : "";
  return {
    workId,
    contractId,
    milestoneId: contractId === draft.contractId ? draft.milestoneId : "",
    purpose:
      draft.kind === "payment" &&
      !explicitScope &&
      !hasPaymentWriting(draft) &&
      draft.purpose !== "advance"
        ? paymentPurpose(ledger, { ...draft, contractId })
        : draft.purpose,
  };
}

export function changeEntryType(
  ledger: Ledger,
  draft: ReturnType<typeof entryContext>,
  costType: CostType,
) {
  const leavingWorker =
    costType !== "labour" &&
    (draft.kind === "wage" ||
      (draft.kind === "payment" && draft.account === "labour"));
  if (draft.costType === costType && !leavingWorker) return draft;
  const kind = leavingWorker ? ("expense" as const) : draft.kind;
  const account =
    costType === "labour"
      ? "labour"
      : costType === "material"
        ? "materials"
        : "other";
  const context = entryContext(ledger, {
    kind,
    personId: draft.personId || undefined,
    workId: draft.workId || undefined,
    costType,
    account,
  });
  return {
    ...draft,
    kind,
    purpose:
      kind === "payment" && draft.purpose === "wage"
        ? ("charge" as const)
        : draft.purpose,
    costType,
    account:
      costType === "labour"
        ? ("labour" as const)
        : costType === "material"
          ? ("materials" as const)
          : ("other" as const),
    personId: draft.personId,
    contractId: "",
    milestoneId: "",
    paymentPurposeId: "",
    paymentPurposeName: "",
    payment: draft.payment === "worker" ? ("full" as const) : draft.payment,
    rows: draft.rows.map((row) => ({
      ...context.rows[0],
      id: row.id,
      amount:
        leavingWorker && draft.rows.length === 1
          ? quickWageAmount(draft)
            ? moneyInputValue(quickWageAmount(draft))
            : draft.amount || row.amount
          : row.amount,
    })),
  };
}
