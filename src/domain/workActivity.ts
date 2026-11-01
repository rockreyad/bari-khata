import {
  LedgerSchema,
  WorkSchema,
  WorkSnapshotSchema,
  type Ledger,
  type Work,
  type WorkSnapshot,
} from "./model";

export function workChanges(
  before: WorkSnapshot | null,
  after: WorkSnapshot,
): (keyof WorkSnapshot)[] {
  if (!before) return ["name"];
  return (
    Object.keys(WorkSnapshotSchema.shape) as (keyof WorkSnapshot)[]
  ).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}
export function saveWorkChange(
  ledger: Ledger,
  input: Work,
  at = new Date().toISOString(),
): Ledger {
  const next = WorkSchema.parse(input);
  const previous = ledger.works.find((work) => work.id === next.id);
  const before = previous ? WorkSnapshotSchema.parse(previous) : null;
  const after = WorkSnapshotSchema.parse(next);
  if (previous && !workChanges(before, after).length) return ledger;
  const replacement: Work = {
    ...next,
    activity: [
      ...(previous?.activity ?? []),
      { id: crypto.randomUUID(), at, before, after },
    ],
  };
  return LedgerSchema.parse({
    ...ledger,
    works: [...ledger.works.filter((work) => work.id !== next.id), replacement],
  });
}

export function preservesWorkHistory(before: Ledger, after: Ledger): boolean {
  return before.works.every((work) => {
    if (!work.activity.length) return true;
    const next = after.works.find((candidate) => candidate.id === work.id);
    return Boolean(
      next &&
      next.activity.length >= work.activity.length &&
      work.activity.every(
        (event, index) =>
          JSON.stringify(event) === JSON.stringify(next.activity[index]),
      ),
    );
  });
}
