import type { Ledger } from "./model.js";

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
