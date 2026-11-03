import {
  EntryCoreSchema,
  LedgerSchema,
  type Entry,
  type Ledger,
} from "../domain/model";

const collections = [
  "works",
  "people",
  "materialGroups",
  "items",
  "paymentPurposes",
  "contracts",
  "entries",
] as const;
export type BackupCollection = (typeof collections)[number] | "project";
export type BackupDecision = "current" | "backup";
export type BackupDecisions = Record<string, BackupDecision>;
export type BackupDifference = {
  key: string;
  collection: BackupCollection;
  id: string;
  label: string;
};
const equal = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
function sameImportedEntry(current: Entry, incoming: Entry) {
  const currentCore = { ...EntryCoreSchema.parse(current), updatedAt: "" };
  const incomingCore = { ...EntryCoreSchema.parse(incoming), updatedAt: "" };
  return (
    equal(currentCore, incomingCore) &&
    incoming.revisions.every((revision, index) =>
      equal(revision, current.revisions[index]),
    )
  );
}

export function preservesBackupPersonWorkLinks(
  before: Pick<Ledger, "people">,
  after: Pick<Ledger, "people">,
) {
  const people = new Map(after.people.map((person) => [person.id, person]));
  return before.people.every((person) => {
    if (
      !("workIds" in person) ||
      !Array.isArray(person.workIds) ||
      !person.workIds.length
    )
      return true;
    const next = people.get(person.id);
    return Boolean(
      next &&
      Object.hasOwn(next, "workIds") &&
      "workIds" in next &&
      Array.isArray(next.workIds),
    );
  });
}

export function planBackupMerge(
  currentValue: Ledger,
  incomingValue: Ledger,
  decisions: BackupDecisions = {},
  at = new Date().toISOString(),
) {
  const current = LedgerSchema.parse(currentValue);
  const incoming = LedgerSchema.parse(incomingValue);
  if (current.isDemo !== incoming.isDemo)
    throw new Error("workspace_mode_mismatch");
  let added = 0;
  let unchanged = 0;
  let updated = 0;
  let kept = 0;
  const differences: BackupDifference[] = [];
  const candidate = structuredClone(current);
  let historyConflict = false;
  for (const collection of collections) {
    const records = current[collection] as { id: string }[];
    const existing = new Map(records.map((record) => [record.id, record]));
    const replacements = new Map<string, unknown>();
    const additions: unknown[] = [];
    for (const record of incoming[collection]) {
      const previous = existing.get(record.id);
      if (!previous) {
        additions.push(record);
        added++;
      } else if (
        equal(previous, record) ||
        (collection === "entries" &&
          sameImportedEntry(previous as Entry, record as Entry))
      ) {
        unchanged++;
      } else {
        const key = `${collection}:${record.id}`;
        const label =
          "name" in record
            ? record.name
            : "title" in record
              ? record.title
              : record.lines
                  .map((line) => line.label)
                  .filter(Boolean)
                  .join(", ") ||
                record.note ||
                record.date ||
                record.id;
        differences.push({ key, collection, id: record.id, label });
        if (decisions[key] === "backup") {
          let replacement = record;
          if (collection === "entries") {
            const oldEntry = previous as Entry;
            const newEntry = record as Entry;
            const prefix = oldEntry.revisions.every((revision, index) =>
              equal(revision, newEntry.revisions[index]),
            );
            const appended = newEntry.revisions[oldEntry.revisions.length];
            if (
              !prefix ||
              (appended &&
                !equal(appended.before, EntryCoreSchema.parse(oldEntry)))
            ) {
              historyConflict = true;
            } else if (
              !appended &&
              !equal(
                EntryCoreSchema.parse(oldEntry),
                EntryCoreSchema.parse(newEntry),
              )
            ) {
              replacement = {
                ...newEntry,
                updatedAt: at,
                revisions: [
                  ...newEntry.revisions,
                  { at, before: EntryCoreSchema.parse(oldEntry) },
                ],
              };
            }
          }
          replacements.set(record.id, replacement);
          updated++;
        } else if (decisions[key] === "current") {
          kept++;
        }
      }
    }
    Object.assign(candidate, {
      [collection]: [
        ...records.map((record) => replacements.get(record.id) ?? record),
        ...additions,
      ],
    });
  }
  if (!equal(current.project, incoming.project)) {
    if (!collections.some((collection) => current[collection].length)) {
      candidate.project = incoming.project;
    } else {
      differences.push({
        key: "project",
        collection: "project",
        id: incoming.project.id,
        label: incoming.project.name,
      });
      if (decisions.project === "backup") {
        candidate.project = incoming.project;
        updated++;
      } else if (decisions.project === "current") kept++;
    }
  }
  const unresolved = differences.filter(
    (difference) => !decisions[difference.key],
  );
  const parsed = LedgerSchema.safeParse(candidate);
  return {
    ledger: !historyConflict && parsed.success ? parsed.data : null,
    differences,
    unresolved,
    added,
    unchanged,
    updated,
    kept,
    historyConflict,
  };
}

export function sameBackupLedger(left: Ledger, right: Ledger) {
  return equal(LedgerSchema.parse(left), LedgerSchema.parse(right));
}
