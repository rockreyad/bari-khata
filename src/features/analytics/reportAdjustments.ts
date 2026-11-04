import type { Ledger } from "../../domain/model";
import type { CashScope } from "../../domain/cashSummary";
import { reconciledTotals } from "../../domain/balanceAdjustments";
import { filterHistory } from "../history/history";

export function reportAdjustments(ledger: Ledger, scope: CashScope = {}) {
  const entries = filterHistory(ledger, {
    from: scope.from,
    to: scope.to,
    query: scope.query,
  });
  return reconciledTotals(
    { ...ledger, entries },
    {
      personId: scope.personId,
      workId: scope.workId,
      account: scope.account,
    },
  );
}
