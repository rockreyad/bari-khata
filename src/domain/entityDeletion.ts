import { LedgerSchema, type Ledger } from "./model";

export type RemovableKind = "work" | "person" | "contract";
const entityKey = {
  work: "works",
  person: "people",
  contract: "contracts",
} as const;

export function removableEntity(
  ledger: Ledger,
  kind: RemovableKind,
  id: string,
) {
  return ledger[entityKey[kind]].find((entity) => entity.id === id);
}

export function setEntityRemoved(
  ledger: Ledger,
  kind: RemovableKind,
  id: string,
  archived: boolean,
  expectedName?: string,
  at = new Date().toISOString(),
): Ledger {
  const current = LedgerSchema.parse(ledger);
  const key = entityKey[kind];
  const entity = current[key].find((record) => record.id === id);
  if (!entity) throw new Error("নামটি পাওয়া যায়নি।");
  const name = "name" in entity ? entity.name : entity.title;
  if (expectedName !== undefined && name !== expectedName)
    throw new Error("নাম বদলেছে। আবার দেখে নিশ্চিত করুন।");
  if (Boolean(entity.archivedAt) === archived) return current;
  const next = {
    ...entity,
    archivedAt: archived ? at : null,
    removalHistory: [
      ...entity.removalHistory,
      { id: crypto.randomUUID(), at, archived },
    ],
  };
  return LedgerSchema.parse({
    ...current,
    [key]: current[key].map((record) => (record.id === id ? next : record)),
  });
}

export function preservesRemovalHistory(before: Ledger, after: Ledger) {
  return (["works", "people", "contracts"] as const).every((key) =>
    before[key].every((entity) => {
      const next = after[key].find((record) => record.id === entity.id);
      if (!next) return !entity.removalHistory.length && !entity.archivedAt;
      if (
        entity.archivedAt !== next.archivedAt &&
        next.removalHistory.length <= entity.removalHistory.length
      )
        return false;
      return entity.removalHistory.every((event, index) => {
        const candidate = next.removalHistory[index];
        return (
          candidate &&
          event.id === candidate.id &&
          event.at === candidate.at &&
          event.archived === candidate.archived
        );
      });
    }),
  );
}
