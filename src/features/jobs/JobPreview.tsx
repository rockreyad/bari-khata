import { ArrowRightIcon, HardHatIcon, PlusIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import { useLocation } from "react-router";
import { jobDetailUrl } from "../../app/jobRoutes";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import type { Contract, Ledger } from "../../domain/model";
import {
  jobName,
  recentJobs,
  jobBalances,
  jobStatusKey,
  jobStatusNames,
  type JobBalance,
} from "./jobView";
import "./jobs.css";

export function JobTile({
  ledger,
  job,
  showWorker = false,
  onOpen,
  balance,
}: {
  ledger: Ledger;
  job: Contract;
  showWorker?: boolean;
  onOpen: () => void;
  balance?: JobBalance;
}) {
  const { t, money, formatDigits } = useLanguageContext();
  const summary = useMemo(
    () => balance ?? jobBalances(ledger).get(job.id)!,
    [balance, ledger, job.id],
  );
  const remaining = summary.extra > 0 ? summary.extra : summary.remaining;
  const showCredit =
    !summary.balanceAmbiguous &&
    summary.extra > 0 &&
    (summary.earned > 0 || summary.extra !== summary.netPaid);
  const showBalance =
    !summary.valid ||
    summary.balanceAmbiguous ||
    summary.remaining > 0 ||
    showCredit ||
    summary.earned > 0;
  const status = jobStatusKey(job);
  const worker = ledger.people.find((person) => person.id === job.personId);
  return (
    <button
      type="button"
      className={`job-snap-card job-payment-${summary.balanceAmbiguous ? "review" : summary.state}`}
      onClick={onOpen}
    >
      <span className="job-tile-heading">
        <span className="job-tile-mark">
          <HardHatIcon size={21} weight="duotone" />
        </span>
        <span className={`job-status job-status-${status}`}>
          <i />
          {t(jobStatusNames[status])}
        </span>
      </span>
      <strong className="job-tile-name" title={formatDigits(jobName(job, t))}>
        {formatDigits(jobName(job, t))}
      </strong>
      {showWorker && worker ? (
        <span className="job-tile-worker">{formatDigits(worker.name)}</span>
      ) : null}
      <span className="job-tile-amounts" data-balance={showBalance}>
        <span>
          <small>{t("মোট")}</small>
          <strong>{money(job.total)}</strong>
        </span>
        <span className="job-tile-paid">
          <small>{t("দিয়েছি")}</small>
          <strong>{money(summary.netPaid)}</strong>
        </span>
        {summary.balanceAmbiguous ? (
          <span className="job-tile-balance">
            <small>{t("বাকি")}</small>
            <strong>{t("বাকি মেলানো বাকি")}</strong>
          </span>
        ) : summary.earned > 0 && summary.state === "settled" ? (
          <span className="job-tile-settled">{t("বাকি নেই")}</span>
        ) : showBalance ? (
          <span className="job-tile-balance">
            <small>
              {t(
                showCredit
                  ? summary.earned >= job.total && job.total > 0
                    ? "বেশি দিয়েছি"
                    : "জমা আছে"
                  : "দিতে বাকি",
              )}
            </small>
            <strong>
              {summary.valid ? money(remaining) : t("টাকার অঙ্ক বেশি হয়েছে।")}
            </strong>
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function JobPreview({
  ledger,
  contracts,
  personId,
  workId,
  allowCreate = true,
}: {
  ledger: Ledger;
  contracts: Contract[];
  personId?: string;
  workId?: string;
  allowCreate?: boolean;
}) {
  contracts = contracts.filter((job) => !job.archivedAt);
  const { entity, go, base } = useNotebook();
  const { t } = useLanguageContext();
  const location = useLocation();
  const balances = useMemo(() => jobBalances(ledger), [ledger]);
  const origin = location.pathname + location.search;
  if (!contracts.length && !allowCreate) return null;
  const params = new URLSearchParams();
  if (personId) params.set("person", personId);
  if (workId) params.set("work", workId);
  const allPath = `/works${params.size ? `?${params}` : ""}`;
  return (
    <section className="job-preview" aria-label={t("কাজ")}>
      <header className="job-section-heading">
        <h2>{t("কাজ")}</h2>
        <div>
          {allowCreate ? (
            <button
              type="button"
              className="text-button"
              onClick={() => entity("contract", undefined, workId, personId)}
            >
              <PlusIcon size={17} />
              {t("কাজ যোগ করি")}
            </button>
          ) : null}
          <button
            type="button"
            className="text-button"
            onClick={() => go(allPath)}
          >
            {t("সব কাজ")}
            <ArrowRightIcon size={16} />
          </button>
        </div>
      </header>
      {contracts.length ? (
        <div className="job-preview-track" aria-label={t("কাজের তালিকা")}>
          {recentJobs(contracts, ledger.entries)
            .slice(0, 4)
            .map((job) => (
              <JobTile
                key={job.id}
                ledger={ledger}
                job={job}
                showWorker={Boolean(workId) && !personId}
                balance={balances.get(job.id)}
                onOpen={() => go(jobDetailUrl(job.id, origin, base))}
              />
            ))}
        </div>
      ) : (
        <p className="job-preview-empty">{t("এখনও কোনো কাজ রাখা হয়নি।")}</p>
      )}
    </section>
  );
}
