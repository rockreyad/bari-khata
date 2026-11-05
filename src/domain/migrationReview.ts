import { z } from "zod";
import { unresolvedContractAdjustmentIds } from "./contractObligations.js";
import {
  LedgerSchema,
  MoneySchema,
  SignedMoneySchema,
  type Ledger,
} from "./model.js";
import { contractSummary } from "./ledger.js";
import { legacyCommitmentTotals, reconciledTotals } from "./adjustmentMath.js";

export const MigrationIssueSchema = z.object({
  id: z.string().min(1).max(400),
  code: z.enum([
    "unclassified_cash",
    "historical_balance_unknown",
    "contract_commitment_bridge",
    "legacy_adjustment_review",
  ]),
  entityIds: z.array(z.string().min(1).max(160)).max(100000),
  severity: z.enum(["review", "information"]),
});
export const ContractBalanceBridgeSchema = z.object({
  contractId: z.string().min(1).max(160),
  agreed: MoneySchema,
  earned: SignedMoneySchema,
  cashNetPaid: SignedMoneySchema,
  legacyPayable: MoneySchema,
  legacyAdvance: MoneySchema,
  earnedPayable: MoneySchema,
  earnedAdvance: MoneySchema,
  unearnedCommitment: MoneySchema,
});
export const MigrationReviewSchema = z.object({
  version: z.literal(1),
  issues: z.array(MigrationIssueSchema).max(200000),
  contracts: z.array(ContractBalanceBridgeSchema).max(10000),
  legacyPayable: MoneySchema,
  earnedPayable: MoneySchema,
  legacyAdvance: MoneySchema,
  earnedAdvance: MoneySchema,
});
export type MigrationReview = z.infer<typeof MigrationReviewSchema>;
export type MigrationIssue = z.infer<typeof MigrationIssueSchema>;

export function createMigrationReview(value: Ledger): MigrationReview {
  const ledger = LedgerSchema.parse(value);
  const allocated = new Set(
    (ledger.paymentAllocations ?? [])
      .filter((row) => !row.cancelledAt)
      .map((row) => row.paymentId),
  );
  const issues: MigrationIssue[] = [];
  for (const entry of ledger.entries) {
    if (
      (entry.kind === "payment" || entry.kind === "refund") &&
      !entry.paymentContext &&
      !entry.relatedEntryId &&
      !allocated.has(entry.id)
    )
      issues.push({
        id: `cash:${entry.id}`,
        code: "unclassified_cash",
        entityIds: [entry.id],
        severity: "review",
      });
    if (entry.balanceImpact === "historical")
      issues.push({
        id: `historical:${entry.id}`,
        code: "historical_balance_unknown",
        entityIds: [entry.id],
        severity: "review",
      });
  }
  for (const id of unresolvedContractAdjustmentIds(ledger))
    issues.push({
      id: `adjustment:${id}`,
      code: "legacy_adjustment_review",
      entityIds: [id],
      severity: "review",
    });
  const contracts = ledger.contracts.map((contract) => {
    const scope = { contractId: contract.id };
    const old = legacyCommitmentTotals(ledger, scope);
    const current = reconciledTotals(ledger, scope);
    const summary = contractSummary(ledger, contract.id);
    if (
      old.reconciledPayable !== current.reconciledPayable ||
      old.reconciledAdvance !== current.reconciledAdvance
    )
      issues.push({
        id: `contract:${contract.id}`,
        code: "contract_commitment_bridge",
        entityIds: [contract.id],
        severity: "information",
      });
    return {
      contractId: contract.id,
      agreed: contract.total,
      earned: summary.billed,
      cashNetPaid: summary.netPaid,
      legacyPayable: old.reconciledPayable,
      legacyAdvance: old.reconciledAdvance,
      earnedPayable: current.reconciledPayable,
      earnedAdvance: current.reconciledAdvance,
      unearnedCommitment: Math.max(0, contract.total - summary.billed),
    };
  });
  const old = legacyCommitmentTotals(ledger),
    current = reconciledTotals(ledger);
  return MigrationReviewSchema.parse({
    version: 1,
    issues,
    contracts,
    legacyPayable: old.reconciledPayable,
    earnedPayable: current.reconciledPayable,
    legacyAdvance: old.reconciledAdvance,
    earnedAdvance: current.reconciledAdvance,
  });
}
