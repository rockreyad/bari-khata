import { effectiveAccounts } from "../../domain/effectiveAccounts";
import type { Account, Ledger } from "../../domain/model";

export function contactActionAccount(
  ledger: Ledger,
  personId: string,
  requested?: Account,
): Account | "" {
  if (requested) return requested;
  const effective = effectiveAccounts(ledger);
  const used = new Set<Account>(
    ledger.entries
      .filter((entry) => entry.personId === personId && !entry.voided)
      .map((entry) => effective.get(entry.id) ?? entry.account),
  );
  if (ledger.contracts.some((job) => job.personId === personId))
    used.add("labour");
  return used.size === 1 ? [...used][0] : "";
}
