import type { Account, Entry, Ledger } from "./model.js";
import { effectiveAccounts } from "./effectiveAccounts.js";

export type AdjustmentBasis = "paid" | "cost" | "balance";
export type FinancialScope = {
  personId?: string;
  account?: Account | null;
  workId?: string;
  contractId?: string;
};
export function adjustmentBalanceDelta(
  entry: Pick<Entry, "kind" | "adjustment">,
): number {
  if (entry.kind !== "adjustment" || !entry.adjustment) return 0;
  return entry.adjustment.basis === "paid"
    ? -entry.adjustment.delta
    : entry.adjustment.delta;
}
const maximum = BigInt(Number.MAX_SAFE_INTEGER);
const positive = (value: bigint) => (value > 0n ? value : 0n);
const exact = (value: bigint) => {
  if (value < -maximum || value > maximum)
    throw new Error("balance_adjustment_out_of_range");
  return Number(value);
};
type Bucket = {
  party: string;
  account: Account;
  contractId: string | null;
  cost: bigint;
  paid: bigint;
  refunds: bigint;
  adjustment: bigint;
};

function computeReconciliation(ledger: Ledger, scope: FinancialScope = {}) {
  const accounts = effectiveAccounts(ledger);
  const buckets = new Map<string, Bucket>();
  const key = (party: string, account: Account, contractId: string | null) =>
    JSON.stringify([party, account, contractId]);
  const bucket = (
    party: string,
    account: Account,
    contractId: string | null,
  ) => {
    const id = key(party, account, contractId);
    let result = buckets.get(id);
    if (!result) {
      result = {
        party,
        account,
        contractId,
        cost: 0n,
        paid: 0n,
        refunds: 0n,
        adjustment: 0n,
      };
      buckets.set(id, result);
    }
    return result;
  };
  let actualCost = 0n,
    actualPaid = 0n,
    actualRefunds = 0n;
  for (const entry of ledger.entries) {
    if (
      entry.voided ||
      entry.kind === "adjustment" ||
      (scope.personId && entry.personId !== scope.personId) ||
      (scope.contractId && entry.contractId !== scope.contractId)
    )
      continue;
    const account = accounts.get(entry.id) ?? entry.account;
    if (scope.account && account !== scope.account) continue;
    const cost = entry.kind === "expense" || entry.kind === "expense_credit";
    const parts = cost ? entry.lines : entry.allocations;
    const amount = parts
      .filter((part) => !scope.workId || part.workId === scope.workId)
      .reduce((sum, part) => sum + BigInt(part.amount), 0n);
    if (!amount) continue;
    if (cost) actualCost += entry.kind === "expense_credit" ? -amount : amount;
    if (entry.balanceImpact === "historical") continue;
    const row = bucket(
      entry.personId ?? `anonymous:${entry.relatedEntryId ?? entry.id}`,
      account,
      entry.contractId,
    );
    if (cost) row.cost += entry.kind === "expense_credit" ? -amount : amount;
    else if (entry.kind === "payment") {
      row.paid += amount;
      actualPaid += amount;
    } else {
      row.refunds += amount;
      actualRefunds += amount;
    }
  }
  const jobs = new Map(
    ledger.contracts
      .filter(
        (job) =>
          (!scope.personId || job.personId === scope.personId) &&
          (!scope.account || scope.account === "labour") &&
          (!scope.contractId || job.id === scope.contractId) &&
          (!scope.workId ||
            (job.scope === "work" && job.workId === scope.workId)),
      )
      .map((job) => [job.id, job]),
  );
  for (const job of jobs.values()) bucket(job.personId, "labour", job.id);
  const jobPeople = new Set([...jobs.values()].map((job) => job.personId));
  const balanceAmbiguous = [...buckets.values()].some(
    (row) =>
      row.account === "labour" &&
      !row.contractId &&
      row.cost - row.paid + row.refunds > 0n &&
      (row.party.startsWith("anonymous:")
        ? jobs.size > 0
        : jobPeople.has(row.party)),
  );
  let costCorrection = 0n,
    paidCorrection = 0n,
    balanceCorrection = 0n,
    owedCorrection = 0n;
  let pool = 0n,
    unallocatedWorkBalanceCorrection = 0n;
  let unallocatedWorkOwedCorrection = 0n;
  const personPools = new Map<string, bigint>();
  for (const entry of ledger.entries) {
    const change = entry.adjustment;
    if (entry.voided || entry.kind !== "adjustment" || !change) continue;
    if (
      scope.personId &&
      (change.target !== "person" || entry.personId !== scope.personId)
    )
      continue;
    if (scope.account && change.account !== scope.account) continue;
    if (scope.contractId && entry.contractId !== scope.contractId) continue;
    if (scope.workId && change.workId !== scope.workId) continue;
    const delta = BigInt(change.delta),
      owed = BigInt(adjustmentBalanceDelta(entry));
    if (change.basis === "cost") costCorrection += delta;
    else if (change.basis === "paid") paidCorrection += delta;
    else balanceCorrection += delta;
    owedCorrection += owed;
    if (change.target === "work") {
      if (change.basis === "balance") {
        unallocatedWorkBalanceCorrection += owed;
        if (scope.workId) pool += owed;
      } else unallocatedWorkOwedCorrection += owed;
    } else if (entry.contractId && entry.personId)
      bucket(entry.personId, entry.account, entry.contractId).adjustment +=
        owed;
    else if (scope.personId && scope.account) pool += owed;
    else if (change.target === "person" && entry.personId) {
      const group = JSON.stringify([entry.personId, entry.account]);
      personPools.set(group, (personPools.get(group) ?? 0n) + owed);
    }
  }
  let grossPayable = 0n,
    grossAdvance = 0n,
    payable = 0n,
    advance = 0n;
  const people = new Map<string, { payable: bigint; advance: bigint }>();
  const payableGroups = new Map<string, bigint>();
  for (const row of buckets.values()) {
    const job = row.contractId ? jobs.get(row.contractId) : null;
    const agreed = BigInt(job?.total ?? 0);
    const base =
      (job && agreed > row.cost ? agreed : row.cost) - row.paid + row.refunds;
    grossPayable += positive(base);
    grossAdvance += positive(-base);
    const adjusted = base + row.adjustment;
    const group = JSON.stringify([row.party, row.account]);
    const aggregate = people.get(group) ?? { payable: 0n, advance: 0n };
    aggregate.payable += positive(adjusted);
    aggregate.advance += positive(-adjusted);
    people.set(group, aggregate);
  }
  for (const [group, aggregate] of people) {
    if (personPools.has(group)) {
      const corrected =
        aggregate.payable - aggregate.advance + personPools.get(group)!;
      payable += positive(corrected);
      advance += positive(-corrected);
      payableGroups.set(group, positive(corrected));
    } else {
      payable += aggregate.payable;
      advance += aggregate.advance;
      payableGroups.set(group, aggregate.payable);
    }
    personPools.delete(group);
  }
  for (const [group, owed] of personPools) {
    payable += positive(owed);
    advance += positive(-owed);
    payableGroups.set(group, positive(owed));
  }
  const corrected = payable + pool;
  const signedPersonScope = Boolean(scope.personId && scope.account);
  const balance =
    scope.contractId || signedPersonScope ? corrected - advance : corrected;
  const result = {
    actualCost,
    actualPaid,
    actualRefunds,
    actualNetPaid: actualPaid - actualRefunds,
    costCorrection,
    paidCorrection,
    balanceCorrection,
    owedCorrection,
    grossPayable,
    grossAdvance,
    reconciledCost: actualCost + costCorrection,
    reconciledNetPaid: actualPaid - actualRefunds + paidCorrection,
    reconciledBalance: balance,
    reconciledPayable: positive(balance),
    reconciledAdvance:
      scope.contractId || signedPersonScope
        ? positive(-balance)
        : advance + positive(-corrected),
    unallocatedWorkBalanceCorrection,
    unallocatedWorkOwedCorrection,
  };
  return {
    totals: {
      ...(Object.fromEntries(
        Object.entries(result).map(([name, value]) => [name, exact(value)]),
      ) as { [K in keyof typeof result]: number }),
      balanceAmbiguous,
    },
    payableGroups,
  };
}

export function reconciledTotals(ledger: Ledger, scope: FinancialScope = {}) {
  return computeReconciliation(ledger, scope).totals;
}

export function reconciledPayableGroups(ledger: Ledger) {
  const { totals, payableGroups } = computeReconciliation(ledger);
  return {
    total: totals.reconciledPayable,
    groups: [...payableGroups].flatMap(([key, amount]) => {
      if (amount <= 0n) return [];
      const [party, account] = JSON.parse(key) as [string, Account];
      return [{ party, account, amount: exact(amount) }];
    }),
  };
}

export function assertSafeReconciliations(ledger: Ledger) {
  const changes = ledger.entries.filter(
    (entry) => !entry.voided && entry.kind === "adjustment" && entry.adjustment,
  );
  if (!changes.length) return;
  const id = (scope: FinancialScope) =>
    scope.contractId
      ? JSON.stringify(["job", scope.contractId])
      : scope.personId
        ? JSON.stringify([
            "person",
            scope.personId,
            scope.account,
            scope.workId ?? null,
          ])
        : scope.workId
          ? JSON.stringify(["work", scope.workId])
          : "all";
  const bounds = new Map<string, bigint>();
  const add = (scope: FinancialScope, amount: bigint) =>
    bounds.set(id(scope), (bounds.get(id(scope)) ?? 0n) + amount);
  const accounts = effectiveAccounts(ledger);
  for (const job of ledger.contracts) {
    const amount = BigInt(job.total);
    add({}, amount);
    add({ personId: job.personId, account: "labour" }, amount);
    add({ contractId: job.id }, amount);
    if (job.scope === "work" && job.workId) {
      add({ workId: job.workId }, amount);
      add(
        { personId: job.personId, account: "labour", workId: job.workId },
        amount,
      );
    }
  }
  for (const entry of ledger.entries) {
    if (entry.voided) continue;
    const account = accounts.get(entry.id) ?? entry.account;
    const rawParts =
      entry.kind === "expense" || entry.kind === "expense_credit"
        ? entry.lines
        : entry.allocations;
    const parts =
      entry.kind === "adjustment" && entry.adjustment
        ? [
            {
              workId: entry.adjustment.workId,
              amount: Math.abs(entry.adjustment.delta),
            },
          ]
        : rawParts;
    for (const part of parts) {
      const amount = BigInt(part.amount);
      add({}, amount);
      if (entry.personId) {
        add({ personId: entry.personId, account }, amount);
        if (part.workId)
          add(
            { personId: entry.personId, account, workId: part.workId },
            amount,
          );
      }
      if (part.workId) add({ workId: part.workId }, amount);
      if (entry.contractId) add({ contractId: entry.contractId }, amount);
    }
  }
  // Ordinary totals have a safe absolute bound, so validation stays linear for large backups.
  const scopes = new Map<string, FinancialScope>([["all", {}]]);
  for (const entry of changes) {
    const change = entry.adjustment!;
    const scope =
      change.target === "work"
        ? { workId: change.workId! }
        : {
            personId: entry.personId!,
            account: entry.account,
            ...(change.workId ? { workId: change.workId } : {}),
            ...(entry.contractId ? { contractId: entry.contractId } : {}),
          };
    scopes.set(id(scope), scope);
  }
  for (const [key, scope] of scopes)
    if ((bounds.get(key) ?? 0n) > maximum) reconciledTotals(ledger, scope);
}
