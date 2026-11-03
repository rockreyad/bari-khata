import type { Ledger } from "../../domain/model";

export function orderedWorks(ledger: Ledger) {
  const latest = new Map<string, string>();
  const costs = new Map<string, number>();
  for (const work of ledger.works)
    latest.set(work.id, work.activity.at(-1)?.at ?? "");
  for (const entry of ledger.entries) {
    for (const workId of new Set(
      [...entry.lines, ...entry.allocations].map((part) => part.workId),
    )) {
      const at = entry.updatedAt || entry.createdAt;
      if (at > (latest.get(workId) ?? "")) latest.set(workId, at);
    }
    if (entry.voided) continue;
    for (const line of entry.lines)
      costs.set(
        line.workId,
        (costs.get(line.workId) ?? 0) +
          line.amount * (entry.kind === "expense_credit" ? -1 : 1),
      );
  }
  const rank = { ongoing: 0, planned: 1, done: 2 };
  return ledger.works
    .filter((work) => !work.archivedAt)
    .map((work, index) => ({ work, index }))
    .sort(
      (a, b) =>
        rank[a.work.status] - rank[b.work.status] ||
        (latest.get(b.work.id) ?? "").localeCompare(
          latest.get(a.work.id) ?? "",
        ) ||
        (costs.get(b.work.id) ?? 0) - (costs.get(a.work.id) ?? 0) ||
        a.index - b.index,
    )
    .map(({ work }) => work);
}
