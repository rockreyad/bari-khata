import { cashSummary } from "../../domain/cashSummary";
import { reconciledTotals } from "../../domain/adjustmentMath";
import { effectiveAccounts } from "../../domain/effectiveAccounts";
import type { Ledger } from "../../domain/model";

type LabourAmounts = {
  actualPaid: number;
  actualRefunds: number;
  actualNetPaid: number;
  paidCorrection: number;
  reconciledNetPaid: number;
  // Historical spending does not establish an earned bill or a payment.
  billTotal: number;
  historicalCost: number;
  recordedCost: number;
  costCorrection: number;
  reconciledCost: number;
  balanceCorrection: number;
  owedCorrection: number;
};
export type WorkLabourSummary =
  | ({ valid: true; hasHistorical: boolean } & LabourAmounts)
  | ({ valid: false; hasHistorical: false } & {
      [K in keyof LabourAmounts]: null;
    });

const invalid = (): WorkLabourSummary => ({
  valid: false,
  hasHistorical: false,
  actualPaid: null,
  actualRefunds: null,
  actualNetPaid: null,
  paidCorrection: null,
  reconciledNetPaid: null,
  billTotal: null,
  historicalCost: null,
  recordedCost: null,
  costCorrection: null,
  reconciledCost: null,
  balanceCorrection: null,
  owedCorrection: null,
});

export function workLabourSummary(
  ledger: Ledger,
  workId: string,
): WorkLabourSummary {
  if (!ledger.works.some((work) => work.id === workId)) return invalid();
  try {
    const scope = { workId, account: "labour" as const };
    const cash = cashSummary(ledger, scope);
    const reconciled = reconciledTotals(ledger, scope);
    const accounts = effectiveAccounts(ledger);
    let bill = 0n,
      historical = 0n,
      hasHistorical = false;
    for (const entry of ledger.entries) {
      if (
        entry.voided ||
        (accounts.get(entry.id) ?? entry.account) !== "labour" ||
        (entry.kind !== "expense" && entry.kind !== "expense_credit")
      )
        continue;
      const lines = entry.lines.filter((line) => line.workId === workId);
      if (!lines.length) continue;
      const amount =
        lines.reduce((sum, line) => sum + BigInt(line.amount), 0n) *
        (entry.kind === "expense_credit" ? -1n : 1n);
      if (entry.balanceImpact === "historical") {
        historical += amount;
        hasHistorical = true;
      } else bill += amount;
    }
    const maximum = BigInt(Number.MAX_SAFE_INTEGER);
    if (
      [bill, historical, bill + historical].some(
        (value) => value < -maximum || value > maximum,
      )
    )
      return invalid();
    return {
      valid: true,
      hasHistorical,
      actualPaid: cash.paid,
      actualRefunds: cash.refunds,
      actualNetPaid: cash.netPaid,
      paidCorrection: reconciled.paidCorrection,
      reconciledNetPaid: reconciled.reconciledNetPaid,
      billTotal: Number(bill),
      historicalCost: Number(historical),
      recordedCost: Number(bill + historical),
      costCorrection: reconciled.costCorrection,
      reconciledCost: reconciled.reconciledCost,
      balanceCorrection: reconciled.balanceCorrection,
      owedCorrection: reconciled.owedCorrection,
    };
  } catch {
    return invalid();
  }
}
