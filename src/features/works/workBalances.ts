import { effectiveAccounts } from "../../domain/effectiveAccounts";
import type { Account, Ledger } from "../../domain/model";
import {
  adjustmentBalanceDelta,
  reconciledTotals,
} from "../../domain/adjustmentMath";

type Bucket = {
  personId: string | null;
  account: Account;
  contractId: string | null;
  billed: bigint;
  adjustment: bigint;
  paid: bigint;
  refunds: bigint;
};
type SharedCommitment = {
  id: string;
  archived: boolean;
  remaining: number;
  billPayableForWork: number;
};
type Amounts = {
  paid: number;
  refunds: number;
  netPaid: number;
  billPayable: number;
  // These overlap the known bill balance; neither can be added to billPayable.
  workCommitmentOutstanding: number;
  unassignedAdvance: number;
  sharedOutstanding: number;
  actualCost: number;
  actualPaid: number;
  actualRefunds: number;
  actualNetPaid: number;
  costCorrection: number;
  paidCorrection: number;
  balanceCorrection: number;
  owedCorrection: number;
  reconciledCost: number;
  reconciledNetPaid: number;
  reconciledBalance: number;
  reconciledAdvance: number;
  unallocatedWorkOwedCorrection: number;
  unallocatedWorkBalanceCorrection: number;
};
export type WorkBalances =
  | ({
      valid: true;
      additionalCommitment: number | null;
      scopedOutstanding: number | null;
      totalOutstanding: number | null;
      reconciledPayable: number | null;
      byAccount: Record<Account, number | null>;
      sharedCommitments: SharedCommitment[];
      ambiguousLabourPersonIds: (string | null)[];
    } & Amounts)
  | ({
      valid: false;
      additionalCommitment: null;
      scopedOutstanding: null;
      totalOutstanding: null;
      reconciledPayable: null;
      byAccount: Record<Account, null>;
      sharedCommitments: [];
      ambiguousLabourPersonIds: [];
    } & { [K in keyof Amounts]: null });

const positive = (value: bigint) => (value > 0n ? value : 0n);
const invalid = (): WorkBalances => ({
  valid: false,
  paid: null,
  refunds: null,
  netPaid: null,
  billPayable: null,
  workCommitmentOutstanding: null,
  unassignedAdvance: null,
  sharedOutstanding: null,
  actualCost: null,
  actualPaid: null,
  actualRefunds: null,
  actualNetPaid: null,
  costCorrection: null,
  paidCorrection: null,
  balanceCorrection: null,
  owedCorrection: null,
  reconciledCost: null,
  reconciledNetPaid: null,
  reconciledBalance: null,
  reconciledAdvance: null,
  reconciledPayable: null,
  unallocatedWorkOwedCorrection: null,
  unallocatedWorkBalanceCorrection: null,
  additionalCommitment: null,
  scopedOutstanding: null,
  totalOutstanding: null,
  byAccount: { materials: null, labour: null, other: null },
  sharedCommitments: [],
  ambiguousLabourPersonIds: [],
});

export function workBalances(ledger: Ledger, workId: string): WorkBalances {
  if (!ledger.works.some((work) => work.id === workId)) return invalid();
  let reconciled: ReturnType<typeof reconciledTotals>;
  try {
    reconciled = reconciledTotals(ledger, { workId });
  } catch {
    return invalid();
  }
  const accounts = effectiveAccounts(ledger);
  const buckets = new Map<string, Bucket>();
  const shared = new Map<
    string,
    { billed: bigint; netPaid: bigint; adjustment: bigint }
  >();
  const sharedIds = new Set(
    ledger.contracts
      .filter((contract) => contract.scope === "house")
      .map((contract) => contract.id),
  );
  let paid = 0n,
    refunds = 0n;
  for (const entry of ledger.entries) {
    if (entry.voided || entry.balanceImpact === "historical") continue;
    if (
      entry.kind === "adjustment" &&
      (!entry.contractId || entry.adjustment?.target !== "person")
    )
      continue;
    const cost = entry.kind === "expense" || entry.kind === "expense_credit";
    const parts =
      entry.kind === "adjustment" && entry.adjustment
        ? [
            {
              workId: entry.adjustment.workId,
              amount: adjustmentBalanceDelta(entry),
            },
          ]
        : cost
          ? entry.lines
          : entry.allocations;
    if (entry.contractId && sharedIds.has(entry.contractId)) {
      const row = shared.get(entry.contractId) ?? {
        billed: 0n,
        netPaid: 0n,
        adjustment: 0n,
      };
      const amount = parts.reduce((sum, part) => sum + BigInt(part.amount), 0n);
      if (entry.kind === "adjustment") row.adjustment += amount;
      else if (cost)
        row.billed += entry.kind === "expense_credit" ? -amount : amount;
      else row.netPaid += entry.kind === "refund" ? -amount : amount;
      shared.set(entry.contractId, row);
    }
    for (const part of parts) {
      if (part.workId !== workId) continue;
      const account = accounts.get(entry.id) ?? entry.account;
      const party =
        entry.personId ?? `anonymous:${entry.relatedEntryId ?? entry.id}`;
      const key = JSON.stringify([party, account, entry.contractId]);
      const bucket = buckets.get(key) ?? {
        personId: entry.personId,
        account,
        contractId: entry.contractId,
        billed: 0n,
        adjustment: 0n,
        paid: 0n,
        refunds: 0n,
      };
      const amount = BigInt(part.amount);
      if (entry.kind === "adjustment") bucket.adjustment += amount;
      else if (cost)
        bucket.billed += entry.kind === "expense_credit" ? -amount : amount;
      else if (entry.kind === "payment") {
        bucket.paid += amount;
        paid += amount;
      } else {
        bucket.refunds += amount;
        refunds += amount;
      }
      buckets.set(key, bucket);
    }
  }
  const byAccount = { materials: 0n, labour: 0n, other: 0n };
  const byContract = new Map<string, Bucket>();
  let billPayable = 0n,
    unassignedAdvance = 0n;
  for (const bucket of buckets.values()) {
    const net = bucket.paid - bucket.refunds;
    const payable = positive(bucket.billed + bucket.adjustment - net);
    billPayable += payable;
    byAccount[bucket.account] += payable;
    if (bucket.contractId) byContract.set(bucket.contractId, bucket);
    else unassignedAdvance += positive(net - bucket.billed - bucket.adjustment);
  }
  const localContracts = ledger.contracts.filter(
    (contract) => contract.scope === "work" && contract.workId === workId,
  );
  const contractedPeople = new Set(
    localContracts.map((contract) => contract.personId),
  );
  const ambiguousLabourPersonIds = [
    ...new Set(
      [...buckets.values()]
        .filter(
          (bucket) =>
            bucket.account === "labour" &&
            !bucket.contractId &&
            positive(
              bucket.billed + bucket.adjustment - bucket.paid + bucket.refunds,
            ) > 0n &&
            (bucket.personId === null
              ? localContracts.length > 0
              : contractedPeople.has(bucket.personId)),
        )
        .map((bucket) => bucket.personId),
    ),
  ];
  let additionalCommitment = 0n,
    workCommitmentOutstanding = 0n;
  for (const contract of localContracts) {
    // Archiving hides a contract; it does not waive its agreed money.
    const bucket = byContract.get(contract.id);
    const billed = bucket?.billed ?? 0n;
    const net = (bucket?.paid ?? 0n) - (bucket?.refunds ?? 0n);
    const agreed = BigInt(contract.total);
    const adjustment = bucket?.adjustment ?? 0n;
    const outstanding = positive(
      (agreed > billed ? agreed : billed) + adjustment - net,
    );
    const extra = outstanding - positive(billed + adjustment - net);
    additionalCommitment += extra;
    workCommitmentOutstanding += outstanding;
    byAccount.labour += extra;
  }
  let sharedOutstanding = 0n;
  const sharedCommitments = ledger.contracts
    .filter((contract) => contract.scope === "house")
    .flatMap((contract) => {
      const global = shared.get(contract.id);
      const agreed = BigInt(contract.total);
      const billed = global?.billed ?? 0n;
      const remaining = positive(
        (agreed > billed ? agreed : billed) +
          (global?.adjustment ?? 0n) -
          (global?.netPaid ?? 0n),
      );
      if (!remaining) return [];
      sharedOutstanding += remaining;
      const bucket = byContract.get(contract.id);
      return [
        {
          id: contract.id,
          archived: Boolean(contract.archivedAt),
          remaining,
          billPayableForWork: positive(
            (bucket?.billed ?? 0n) +
              (bucket?.adjustment ?? 0n) -
              (bucket?.paid ?? 0n) +
              (bucket?.refunds ?? 0n),
          ),
        },
      ];
    });
  const scopedOutstanding = billPayable + additionalCommitment;
  const amounts = {
    paid,
    refunds,
    netPaid: paid - refunds,
    billPayable,
    workCommitmentOutstanding,
    unassignedAdvance,
    sharedOutstanding,
  };
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  if (
    [
      ...Object.values(amounts),
      ...Object.values(byAccount),
      additionalCommitment,
      scopedOutstanding,
      ...sharedCommitments.flatMap((row) => [
        row.remaining,
        row.billPayableForWork,
      ]),
    ].some((value) => value < -maximum || value > maximum)
  )
    return invalid();
  const ambiguous = ambiguousLabourPersonIds.length > 0;
  return {
    ...reconciled,
    valid: true,
    paid: Number(paid),
    refunds: Number(refunds),
    netPaid: Number(paid - refunds),
    billPayable: Number(billPayable),
    workCommitmentOutstanding: Number(workCommitmentOutstanding),
    unassignedAdvance: Number(unassignedAdvance),
    sharedOutstanding: Number(sharedOutstanding),
    additionalCommitment: ambiguous ? null : Number(additionalCommitment),
    scopedOutstanding: ambiguous ? null : Number(scopedOutstanding),
    totalOutstanding:
      ambiguous || sharedCommitments.length ? null : Number(scopedOutstanding),
    reconciledPayable: reconciled.balanceAmbiguous
      ? null
      : reconciled.reconciledPayable,
    byAccount: {
      materials: Number(byAccount.materials),
      labour: ambiguous ? null : Number(byAccount.labour),
      other: Number(byAccount.other),
    },
    sharedCommitments: sharedCommitments.map((row) => ({
      ...row,
      remaining: Number(row.remaining),
      billPayableForWork: Number(row.billPayableForWork),
    })),
    ambiguousLabourPersonIds,
  };
}
