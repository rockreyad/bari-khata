import type { Contract, ContractStatus, Ledger } from "../../domain/model";

export function jobName(
  job: Pick<Contract, "title">,
  t: (text: string) => string,
) {
  if (job.title === "মোট মজুরির চুক্তি") return t("কাজের হিসাব");
  return job.title || t("কাজ");
}

export function recentJobs(jobs: Contract[]) {
  const stamp = (job: Contract) => {
    let latest = 0;
    for (const events of [job.activity, job.history])
      for (const event of events)
        latest = Math.max(latest, Date.parse(event.at) || 0);
    return latest || Date.parse(job.agreedOn ?? "") || 0;
  };
  return jobs
    .map((job, index) => ({ job, index, at: stamp(job) }))
    .sort((a, b) => b.at - a.at || a.index - b.index)
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
  netPaid: number;
  remaining: number;
  extra: number;
  state: "due" | "settled" | "overpaid";
  valid: boolean;
};
export function jobBalances(ledger: Ledger): Map<string, JobBalance> {
  const jobs = new Map(ledger.contracts.map((job) => [job.id, job]));
  const paid = new Map<string, bigint>();
  for (const entry of ledger.entries) {
    if (
      entry.voided ||
      entry.balanceImpact === "historical" ||
      !entry.contractId ||
      (entry.kind !== "payment" && entry.kind !== "refund")
    )
      continue;
    const job = jobs.get(entry.contractId);
    if (!job || entry.personId !== job.personId) continue;
    const amount = entry.paymentParts.reduce(
      (sum, part) => sum + BigInt(part.amount),
      0n,
    );
    paid.set(
      job.id,
      (paid.get(job.id) ?? 0n) + (entry.kind === "refund" ? -amount : amount),
    );
  }
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  return new Map(
    ledger.contracts.map((job) => {
      const net = paid.get(job.id) ?? 0n;
      const difference = BigInt(job.total) - net;
      const remaining = difference > 0n ? difference : 0n;
      const extra = difference < 0n ? -difference : 0n;
      return [
        job.id,
        {
          netPaid: Number(net),
          remaining: Number(remaining),
          extra: Number(extra),
          state:
            difference > 0n ? "due" : difference < 0n ? "overpaid" : "settled",
          valid:
            net >= -maximum &&
            net <= maximum &&
            remaining <= maximum &&
            extra <= maximum,
        },
      ];
    }),
  );
}
