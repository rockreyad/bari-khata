import type { AddOptions } from "../../app/NotebookProvider";
import type { Ledger } from "../../domain/model";
import { defaultContactAccount, personKind } from "../../domain/contacts";
import { QuickDraftSchema } from "./quickEntry";
import { defaultTaxonomy } from "../../domain/importWallet";
import { todayDhaka } from "../../lib/display";

const normalize = (value: string) =>
  value.normalize("NFKC").trim().toLocaleLowerCase();
export function entryContext(ledger: Ledger, options: AddOptions) {
  const person = ledger.people.find((p) => p.id === options.personId);
  const account =
    options.account ?? (person ? defaultContactAccount(person) : "materials");
  const costType =
    options.costType ??
    (account === "labour"
      ? "labour"
      : person && personKind(person) === "driver"
        ? "transport"
        : account === "other"
          ? "other"
          : "material");
  let workId = options.workId ?? "";
  if (!workId && person) {
    const contracts = ledger.contracts.filter((c) => c.personId === person.id);
    const works = new Set([
      ...contracts.map((c) => c.workId),
      ...ledger.entries
        .filter(
          (e) => e.personId === person.id && e.account === account && !e.voided,
        )
        .flatMap((e) => [...e.lines, ...e.allocations].map((l) => l.workId)),
    ]);
    if (works.size === 1) workId = [...works][0];
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
  const contracts = ledger.contracts.filter(
    (c) => c.workId === workId && c.personId === person?.id,
  );
  const contractId =
    account === "labour" && contracts.length === 1 ? contracts[0].id : "";
  return QuickDraftSchema.parse({
    id: crypto.randomUUID(),
    paymentId: crypto.randomUUID(),
    refundId: crypto.randomUUID(),
    personNewId: crypto.randomUUID(),
    paymentPurposeNewId: crypto.randomUUID(),
    kind: options.kind ?? "expense",
    workId,
    personId: person?.id ?? "",
    account,
    costType,
    contractId,
    date: todayDhaka(),
    rows: [
      {
        id: crypto.randomUUID(),
        label: costType === "labour" ? "মজুরি" : (group?.name ?? ""),
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
) {
  const person = ledger.people.find((p) => p.id === personId);
  if (!person)
    return {
      personId,
      contractId: "",
      paymentPurposeId: "",
      paymentPurposeName: "",
    };
  const context = entryContext(ledger, {
    kind: draft.kind,
    workId: draft.workId || undefined,
    personId,
    costType: draft.costType,
  });
  return {
    personId,
    account: context.account,
    workId: context.workId,
    contractId: context.contractId,
    paymentPurposeId: "",
    paymentPurposeName: "",
  };
}
