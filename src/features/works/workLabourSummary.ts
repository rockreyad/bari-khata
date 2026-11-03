import { cashSummary } from "../../domain/cashSummary";
import { reconciledTotals } from "../../domain/adjustmentMath";
import type { Ledger } from "../../domain/model";

type LabourAmounts = {
  actualRefunds: number;
  actualNetPaid: number;
  paidCorrection: number;
  reconciledNetPaid: number;
};
export type WorkLabourSummary =
  | ({ valid: true } & LabourAmounts)
  | ({ valid: false } & {
      [K in keyof LabourAmounts]: null;
    });

const invalid = (): WorkLabourSummary => ({
  valid: false,
  actualRefunds: null,
  actualNetPaid: null,
  paidCorrection: null,
  reconciledNetPaid: null,
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
    return {
      valid: true,
      actualRefunds: cash.refunds,
      actualNetPaid: cash.netPaid,
      paidCorrection: reconciled.paidCorrection,
      reconciledNetPaid: reconciled.reconciledNetPaid,
    };
  } catch {
    return invalid();
  }
}
