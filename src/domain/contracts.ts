import {
  ContractSchema,
  ContractSnapshotSchema,
  LedgerSchema,
  type Contract,
  type ContractActivity,
  type ContractSnapshot,
  type Ledger,
} from "./model";

export function contractAppliesToWork(
  contract: Pick<Contract, "scope" | "workId">,
  workId: string,
) {
  return contract.scope === "house" || contract.workId === workId;
}
export function applicableContracts(
  ledger: Ledger,
  personId: string,
  workId?: string,
) {
  return ledger.contracts.filter(
    (contract) =>
      contract.personId === personId &&
      (workId
        ? contractAppliesToWork(contract, workId)
        : contract.scope === "house"),
  );
}
export function contractChanges(
  before: ContractSnapshot | null,
  after: ContractSnapshot,
): (keyof ContractSnapshot)[] {
  return (
    Object.keys(ContractSnapshotSchema.shape) as (keyof ContractSnapshot)[]
  ).filter(
    (key) =>
      !before ||
      (key === "status"
        ? (before.status ?? null) !== (after.status ?? null)
        : JSON.stringify(before[key]) !== JSON.stringify(after[key])),
  );
}
export function saveContractChange(
  ledger: Ledger,
  input: Contract,
  reason = "",
  at = new Date().toISOString(),
): Ledger {
  const next = ContractSchema.parse(input);
  const previous = ledger.contracts.find((contract) => contract.id === next.id);
  const before = previous ? ContractSnapshotSchema.parse(previous) : null;
  const after = ContractSnapshotSchema.parse(next);
  if (previous && !contractChanges(before, after).length) return ledger;
  if (previous && !reason.trim())
    throw new Error("চুক্তি কেন বদলালেন, তা লিখুন।");
  if (
    previous &&
    ledger.entries.some((entry) => entry.contractId === previous.id) &&
    (previous.personId !== next.personId ||
      previous.scope !== next.scope ||
      previous.workId !== next.workId)
  )
    throw new Error(
      "এই চুক্তিতে লেনদেন আছে। অন্য নাম বা কাজের জন্য নতুন চুক্তি করুন।",
    );
  if (next.basis !== "fixed") {
    const [whole, fraction = ""] = next.quantity.split(".");
    if (!/^\d+(?:\.\d{1,4})?$/.test(next.quantity) || !next.rate)
      throw new Error("দিন বা পরিমাণ ও সঠিক মজুরি লিখুন।");
    const denominator = 10n ** BigInt(fraction.length);
    const total =
      (BigInt(whole + fraction) * BigInt(next.rate) + denominator / 2n) /
      denominator;
    if (total !== BigInt(next.total))
      throw new Error("পরিমাণ ও দর অনুযায়ী মোট মজুরি মিলছে না।");
  }
  const replacement = ContractSchema.parse({
    ...next,
    history: previous?.history ?? next.history,
    activity: [
      ...(previous?.activity ?? []),
      {
        id: crypto.randomUUID(),
        at,
        before,
        after,
        reason: reason.trim() || "চুক্তি করেছি",
      },
    ],
  });
  return LedgerSchema.parse({
    ...ledger,
    contracts: [
      ...ledger.contracts.filter((contract) => contract.id !== next.id),
      replacement,
    ],
  });
}
function comparableSnapshot(snapshot: ContractSnapshot | null) {
  if (!snapshot) return null;
  return Object.fromEntries(
    Object.entries({ ...snapshot, status: snapshot.status ?? null }).sort(
      ([left], [right]) => left.localeCompare(right),
    ),
  );
}
function comparableActivity(event: ContractActivity) {
  return Object.fromEntries(
    Object.entries({
      ...event,
      before: comparableSnapshot(event.before),
      after: comparableSnapshot(event.after),
    }).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function preservesContractHistory(before: Ledger, after: Ledger) {
  return before.contracts.every((contract) => {
    const next = after.contracts.find(
      (candidate) => candidate.id === contract.id,
    );
    if (!next) return !contract.activity.length && !contract.history.length;
    const appended = next.activity[contract.activity.length];
    if (
      appended &&
      JSON.stringify(comparableSnapshot(appended.before)) !==
        JSON.stringify(
          comparableSnapshot(ContractSnapshotSchema.parse(contract)),
        )
    )
      return false;
    if (
      contractChanges(
        ContractSnapshotSchema.parse(contract),
        ContractSnapshotSchema.parse(next),
      ).length &&
      next.activity.length <= contract.activity.length
    )
      return false;
    return (
      contract.history.every(
        (event, index) =>
          JSON.stringify(event) === JSON.stringify(next.history[index]),
      ) &&
      contract.activity.every(
        (event, index) =>
          JSON.stringify(comparableActivity(event)) ===
          JSON.stringify(
            next.activity[index]
              ? comparableActivity(next.activity[index])
              : undefined,
          ),
      )
    );
  });
}
