import { EntryCoreSchema, type Entry } from "../../domain/model";
export type EntrySnapshot = Omit<Entry, "revisions">;
export type AuditField = keyof EntrySnapshot;
export type AuditChange = {
  field: AuditField;
  before: unknown;
  after: unknown;
};
export type EntryAuditEvent = {
  id: string;
  at: string;
  kind: "created" | "changed" | "voided" | "restored";
  before: EntrySnapshot | null;
  after: EntrySnapshot;
  changes: AuditChange[];
};
export function snapshotTotal(entry: EntrySnapshot) {
  return entry.kind === "expense" || entry.kind === "expense_credit"
    ? entry.lines.reduce((sum, line) => sum + line.amount, 0)
    : entry.paymentParts.reduce((sum, part) => sum + part.amount, 0);
}
export function diffSnapshots(
  before: EntrySnapshot,
  after: EntrySnapshot,
): AuditChange[] {
  return (Object.keys(after) as AuditField[])
    .filter(
      (field) =>
        field !== "updatedAt" &&
        field !== "id" &&
        JSON.stringify(before[field]) !== JSON.stringify(after[field]),
    )
    .map((field) => ({ field, before: before[field], after: after[field] }));
}
export function entryAudit(entry: Entry): EntryAuditEvent[] {
  const current = EntryCoreSchema.parse(entry);
  const first = entry.revisions[0]?.before ?? current;
  const events: EntryAuditEvent[] = [
    {
      id: `${entry.id}:created`,
      at: first.createdAt,
      kind: "created",
      before: null,
      after: first,
      changes: [],
    },
  ];
  entry.revisions.forEach((revision, index) => {
    const after = entry.revisions[index + 1]?.before ?? current;
    const kind =
      revision.before.voided !== after.voided
        ? after.voided
          ? "voided"
          : "restored"
        : "changed";
    events.push({
      id: `${entry.id}:${index}`,
      at: revision.at,
      kind,
      before: revision.before,
      after,
      changes: diffSnapshots(revision.before, after),
    });
  });
  return events;
}
