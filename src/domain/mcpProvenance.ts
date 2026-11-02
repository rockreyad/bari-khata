import type { Ledger } from "./model.js";

export function preservesMcpProvenance(before: Ledger, after: Ledger): boolean {
  const entries = new Map(after.entries.map((entry) => [entry.id, entry]));
  return before.entries.every((entry) => {
    if (
      !entry.provenance &&
      !entry.revisions.some((revision) => revision.before.provenance)
    )
      return true;
    const next = entries.get(entry.id);
    if (!next) return false;
    if (entry.provenance) {
      if (!next.provenance) return false;
      if (
        JSON.stringify(entry.provenance) !== JSON.stringify(next.provenance) &&
        JSON.stringify(
          next.revisions[entry.revisions.length]?.before.provenance,
        ) !== JSON.stringify(entry.provenance)
      )
        return false;
    }
    return entry.revisions.every(
      (revision, index) =>
        !revision.before.provenance ||
        JSON.stringify(revision.before.provenance) ===
          JSON.stringify(next.revisions[index]?.before.provenance),
    );
  });
}
