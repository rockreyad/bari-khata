import type { Account, Entry, Ledger } from "./model.js";

const isCost = (entry: Entry) =>
  entry.kind === "expense" || entry.kind === "expense_credit";

export function effectiveAccounts(ledger: Pick<Ledger, "people" | "entries">) {
  const accounts = new Map<string, Account>(
    ledger.entries.map((entry) => [entry.id, entry.account]),
  );
  const own = ledger.entries.filter((entry) => entry.personId);
  // A payment stays a transport payment if its original bill is later cancelled.
  const transportBills = new Set(
    own
      .filter(
        (entry) =>
          isCost(entry) &&
          entry.lines.length > 0 &&
          entry.lines.every((line) => line.costType === "transport"),
      )
      .map((entry) => entry.id),
  );
  const buckets = new Map<string, boolean>();
  const bucketKey = (entry: Entry, workId: string) =>
    JSON.stringify([entry.personId, entry.account, workId]);
  for (const entry of own) {
    if (entry.voided || entry.balanceImpact === "historical" || !isCost(entry))
      continue;
    for (const line of entry.lines) {
      const key = bucketKey(entry, line.workId);
      buckets.set(
        key,
        (buckets.get(key) ?? true) && line.costType === "transport",
      );
    }
  }
  for (const entry of own) {
    if (entry.account !== "materials") continue;
    const transportCash =
      !isCost(entry) &&
      (entry.relatedEntryId
        ? transportBills.has(entry.relatedEntryId)
        : entry.allocations.length > 0 &&
          entry.allocations.every(
            (part) => buckets.get(bucketKey(entry, part.workId)) === true,
          ));
    if (transportBills.has(entry.id) || transportCash)
      accounts.set(entry.id, "other");
  }
  return accounts;
}
