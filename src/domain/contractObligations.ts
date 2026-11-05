import type { Ledger } from "./model.js";

export function contractEarnings(ledger: Ledger) {
  const earnings = new Map(
    ledger.contracts.map((contract) => [
      contract.id,
      { billed: 0n, earned: 0n, fromCompletion: false, hasBill: false },
    ]),
  );
  const contracts = new Map(ledger.contracts.map((row) => [row.id, row]));
  for (const entry of ledger.entries) {
    if (
      !entry.contractId ||
      (entry.kind !== "expense" && entry.kind !== "expense_credit")
    )
      continue;
    const contract = contracts.get(entry.contractId);
    const row = earnings.get(entry.contractId);
    if (!contract || !row || entry.personId !== contract.personId) continue;
    // Cancelling or retaining an old bill must not revive the agreement as a second bill.
    row.hasBill = true;
    if (entry.voided || entry.balanceImpact === "historical") continue;
    const amount = entry.lines.reduce(
      (sum, line) => sum + BigInt(line.amount),
      0n,
    );
    row.billed += entry.kind === "expense_credit" ? -amount : amount;
  }
  for (const contract of ledger.contracts) {
    const row = earnings.get(contract.id)!;
    row.fromCompletion = contract.status === "done" && !row.hasBill;
    row.earned = row.fromCompletion ? BigInt(contract.total) : row.billed;
  }
  return earnings;
}

export function unresolvedContractAdjustmentIds(ledger: Ledger): Set<string> {
  // Later bills or revised promises cannot establish what an old correction meant.
  return new Set(
    ledger.entries
      .filter(
        (entry) =>
          !entry.voided &&
          entry.kind === "adjustment" &&
          entry.contractId &&
          entry.adjustment?.basis === "balance" &&
          entry.adjustment.calculationVersion !== 2,
      )
      .map((entry) => entry.id),
  );
}
