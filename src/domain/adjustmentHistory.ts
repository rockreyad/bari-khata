import { EntryCoreSchema, type Entry, type Ledger } from "./model.js";

const equal = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

function immutableCore(entry: Entry | Entry["revisions"][number]["before"]) {
  const {
    updatedAt: _updatedAt,
    voided: _voided,
    provenance: _provenance,
    ...core
  } = EntryCoreSchema.parse(entry);
  return core;
}

function hasAdjustment(entry: Entry) {
  return (
    entry.kind === "adjustment" ||
    entry.revisions.some((revision) => revision.before.kind === "adjustment")
  );
}

export function balanceAdjustmentHistoryIsValid(
  ledger: Pick<Ledger, "entries">,
) {
  return ledger.entries.every((entry) => {
    if (!hasAdjustment(entry)) return true;
    const snapshots = [
      ...entry.revisions.map((revision) => revision.before),
      EntryCoreSchema.parse(entry),
    ];
    const first = snapshots[0];
    if (
      first.voided ||
      snapshots.some((snapshot) => snapshot.kind !== "adjustment")
    )
      return false;
    const original = immutableCore(first);
    if (snapshots.some((snapshot) => !equal(immutableCore(snapshot), original)))
      return false;
    return entry.revisions.every((revision, index) => {
      const after = snapshots[index + 1];
      return (
        after.voided !== revision.before.voided &&
        after.updatedAt === revision.at &&
        (index === 0 ||
          Date.parse(revision.at) >= Date.parse(entry.revisions[index - 1].at))
      );
    });
  });
}

export function preservesBalanceAdjustments(
  before: Pick<Ledger, "entries">,
  after: Pick<Ledger, "entries">,
) {
  if (!balanceAdjustmentHistoryIsValid(after)) return false;
  const previous = new Map(before.entries.map((entry) => [entry.id, entry]));
  const next = new Map(after.entries.map((entry) => [entry.id, entry]));
  if (
    after.entries.some(
      (entry) =>
        hasAdjustment(entry) &&
        previous.has(entry.id) &&
        !hasAdjustment(previous.get(entry.id)!),
    )
  )
    return false;
  return before.entries.every((entry) => {
    if (!hasAdjustment(entry)) return true;
    const replacement = next.get(entry.id);
    const appended = replacement?.revisions[entry.revisions.length];
    return Boolean(
      replacement &&
      equal(immutableCore(entry), immutableCore(replacement)) &&
      entry.revisions.every((revision, index) =>
        equal(revision, replacement.revisions[index]),
      ) &&
      (appended
        ? equal(appended.before, EntryCoreSchema.parse(entry))
        : equal(
            EntryCoreSchema.parse(replacement),
            EntryCoreSchema.parse(entry),
          )),
    );
  });
}
