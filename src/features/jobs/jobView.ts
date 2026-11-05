import type {
  Contract,
  ContractStatus,
  Entry,
  Ledger,
} from "../../domain/model";
import { adjustmentBalanceDelta } from "../../domain/adjustmentMath";
import { cashObligationParts } from "../../domain/cashObligations";
import {
  contractEarnings,
  unresolvedContractAdjustmentIds,
} from "../../domain/contractObligations";

const transactionDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Dhaka",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function jobName(
  job: Pick<Contract, "title">,
  t: (text: string) => string,
) {
  if (job.title === "মোট মজুরির চুক্তি") return t("কাজের হিসাব");
  return job.title || t("কাজ");
}

export function recentJobs(jobs: Contract[], entries: Entry[]) {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const transactions = new Map<string, { at: number; addedAt: number }>();
  for (const entry of entries) {
    if (entry.voided || !entry.contractId) continue;
    const job = byId.get(entry.contractId);
    if (!job || entry.personId !== job.personId) continue;
    const addedAt = Date.parse(entry.createdAt) || 0;
    let date = entry.date;
    if (!date && addedAt) {
      const parts = transactionDay.formatToParts(new Date(addedAt));
      date = ["year", "month", "day"]
        .map((type) => parts.find((part) => part.type === type)!.value)
        .join("-");
    }
    const at = Date.parse(date || "") || 0;
    const previous = transactions.get(job.id);
    if (
      !previous ||
      at > previous.at ||
      (at === previous.at && addedAt > previous.addedAt)
    )
      transactions.set(job.id, { at, addedAt });
  }
  const statusRank = (job: Contract) =>
    job.status === "ongoing" ? 0 : job.status === "done" ? 2 : 1;
  const stamp = (job: Contract) => {
    let latest = 0;
    for (const events of [job.activity, job.history])
      for (const event of events)
        latest = Math.max(latest, Date.parse(event.at) || 0);
    return latest || Date.parse(job.agreedOn ?? "") || 0;
  };
  return jobs
    .map((job, index) => ({
      job,
      index,
      at: stamp(job),
      transaction: transactions.get(job.id),
    }))
    .sort(
      (a, b) =>
        statusRank(a.job) - statusRank(b.job) ||
        Number(Boolean(b.transaction)) - Number(Boolean(a.transaction)) ||
        (a.transaction && b.transaction
          ? b.transaction.at - a.transaction.at ||
            b.transaction.addedAt - a.transaction.addedAt
          : b.at - a.at) ||
        a.index - b.index,
    )
    .map((row) => row.job);
}

export const jobStatusNames = {
  planned: "শুরু হয়নি",
  ongoing: "চলছে",
  done: "শেষ",
  unknown: "অবস্থা লেখা নেই",
} as const;
export function jobStatusKey(job: Pick<Contract, "status">) {
  return job.status ?? "unknown";
}
export type JobStatus = ContractStatus | null;
export function readJobStatus(value: string): JobStatus {
  return value === "planned" || value === "ongoing" || value === "done"
    ? value
    : null;
}
export type JobBalance = {
  earned: number;
  earnedFromCompletion: boolean;
  netPaid: number;
  remaining: number;
  remainingCommitment: number;
  unearnedCommitment: number;
  extra: number;
  state: "due" | "settled" | "overpaid";
  balanceAmbiguous: boolean;
  valid: boolean;
};
export function jobBalances(ledger: Ledger): Map<string, JobBalance> {
  const jobs = new Map(ledger.contracts.map((job) => [job.id, job]));
  const earnings = contractEarnings(ledger);
  const paid = new Map<string, bigint>();
  const settled = new Map<string, bigint>();
  const billed = new Map<string, bigint>();
  const adjustments = new Map<string, bigint>();
  const commitmentAdjustments = new Map<string, bigint>();
  const unresolved = unresolvedContractAdjustmentIds(ledger);
  const unresolvedJobs = new Set(
    ledger.entries
      .filter((entry) => unresolved.has(entry.id))
      .map((entry) => entry.contractId),
  );
  for (const entry of ledger.entries) {
    if (
      entry.voided ||
      entry.balanceImpact === "historical" ||
      !entry.contractId
    )
      continue;
    const job = jobs.get(entry.contractId);
    if (!job || entry.personId !== job.personId) continue;
    if (entry.kind === "adjustment") {
      commitmentAdjustments.set(
        job.id,
        (commitmentAdjustments.get(job.id) ?? 0n) +
          BigInt(adjustmentBalanceDelta(entry)),
      );
      if (unresolved.has(entry.id)) continue;
      adjustments.set(
        job.id,
        (adjustments.get(job.id) ?? 0n) + BigInt(adjustmentBalanceDelta(entry)),
      );
      continue;
    }
    if (entry.kind === "expense" || entry.kind === "expense_credit") {
      const amount = entry.lines.reduce(
        (sum, line) => sum + BigInt(line.amount),
        0n,
      );
      billed.set(
        job.id,
        (billed.get(job.id) ?? 0n) +
          (entry.kind === "expense_credit" ? -amount : amount),
      );
      continue;
    }
    const amount = entry.paymentParts.reduce(
      (sum, part) => sum + BigInt(part.amount),
      0n,
    );
    paid.set(
      job.id,
      (paid.get(job.id) ?? 0n) + (entry.kind === "refund" ? -amount : amount),
    );
    const obligation = cashObligationParts(ledger, entry).reduce(
      (sum, part) => sum + BigInt(part.amount),
      0n,
    );
    settled.set(
      job.id,
      (settled.get(job.id) ?? 0n) +
        obligation * (entry.kind === "refund" ? -1n : 1n),
    );
  }
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  return new Map(
    ledger.contracts.map((job) => {
      const net = paid.get(job.id) ?? 0n;
      const agreed = BigInt(job.total),
        cost = billed.get(job.id) ?? 0n;
      const obligationPaid = settled.get(job.id) ?? 0n;
      const earned = earnings.get(job.id)!.earned;
      const difference =
        earned + (adjustments.get(job.id) ?? 0n) - obligationPaid;
      const committed =
        (agreed > cost ? agreed : cost) +
        (commitmentAdjustments.get(job.id) ?? 0n) -
        obligationPaid;
      const remaining = difference > 0n ? difference : 0n;
      const extra = difference < 0n ? -difference : 0n;
      return [
        job.id,
        {
          earned: Number(earned),
          earnedFromCompletion: earnings.get(job.id)!.fromCompletion,
          netPaid: Number(net),
          remaining: Number(remaining),
          remainingCommitment: Number(committed > 0n ? committed : 0n),
          unearnedCommitment: Number(agreed > earned ? agreed - earned : 0n),
          extra: Number(extra),
          state:
            difference > 0n ? "due" : difference < 0n ? "overpaid" : "settled",
          balanceAmbiguous: unresolvedJobs.has(job.id),
          valid:
            !unresolvedJobs.has(job.id) &&
            net >= -maximum &&
            net <= maximum &&
            remaining <= maximum &&
            extra <= maximum,
        },
      ];
    }),
  );
}

export function jobBalanceTotals(ledger: Ledger, contracts: Contract[]) {
  const balances = jobBalances(ledger);
  let remaining = 0n,
    extra = 0n;
  for (const contract of contracts) {
    if (contract.archivedAt) continue;
    const balance = balances.get(contract.id);
    if (!balance?.valid) return { remaining: 0, extra: 0, valid: false };
    remaining += BigInt(balance.remaining);
    extra += BigInt(balance.extra);
  }
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  return {
    remaining: remaining <= maximum ? Number(remaining) : 0,
    extra: extra <= maximum ? Number(extra) : 0,
    valid: remaining <= maximum && extra <= maximum,
  };
}
