import type { Ledger, Person } from "./model.js";

export function personWorks(ledger: Ledger, person: Person) {
  const ids = new Set(person.workIds ?? []);
  for (const contract of ledger.contracts)
    if (contract.personId === person.id && contract.workId)
      ids.add(contract.workId);
  for (const entry of ledger.entries)
    if (entry.personId === person.id) {
      for (const part of [...entry.lines, ...entry.allocations])
        ids.add(part.workId);
      if (entry.kind === "adjustment" && entry.adjustment?.workId)
        ids.add(entry.adjustment.workId);
    }
  return ledger.works.filter((work) => ids.has(work.id));
}

export function preservesPersonWorkLinks(before: Ledger, after: Ledger) {
  const people = new Map(after.people.map((person) => [person.id, person]));
  return before.people.every(
    (person) =>
      person.workIds === undefined ||
      people.get(person.id)?.workIds !== undefined,
  );
}
