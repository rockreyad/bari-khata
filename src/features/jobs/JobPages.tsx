import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocation, useParams, useSearchParams } from "react-router";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CaretDownIcon,
  CoinsIcon,
  HardHatIcon,
  FunnelSimpleIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  DotsThreeIcon,
  PlusIcon,
  WalletIcon,
  SquaresFourIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEntityRemoval } from "../../components/EntityRemoval";
import { AppMenu } from "../../components/ui/AppMenu";
import { useNotebook } from "../../app/NotebookProvider";
import { jobDetailUrl, jobReturn } from "../../app/jobRoutes";
import { useLanguageContext } from "../../context/LanguageProvider";
import { AppSelect } from "../../components/ui/AppSelect";
import { FormError } from "../../components/ui/FormError";
import { EntryList } from "../../components/ui/EntryList";
import { LoadMore } from "../../components/ui/LoadMore";
import {
  contractAppliesToWork,
  saveContractChange,
} from "../../domain/contracts";
import { latinDigits } from "../../lib/numerals";
import { useComposedSearch } from "../../lib/useComposedSearch";
import { sortHistory } from "../history/history";
import { ContractCard, ContractHistory } from "../works/ContractCard";
import { JobTile } from "./JobPreview";
import {
  jobName,
  recentJobs,
  jobBalances,
  jobStatusKey,
  jobStatusNames,
  readJobStatus,
  type JobStatus,
} from "./jobView";
import "./jobs.css";

export function JobsPage() {
  const { ledger, go, entity, base } = useNotebook();
  const { t, formatDigits, number } = useLanguageContext();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const personId = ledger.people.some(
    (person) => person.id === params.get("person"),
  )
    ? params.get("person")!
    : "";
  const workId = ledger.works.some((work) => work.id === params.get("work"))
    ? params.get("work")!
    : "";
  const query = (params.get("q") ?? "").slice(0, 200);
  const searchInput = useComposedSearch(query, (value) =>
    update("q", value.slice(0, 200)),
  );
  const normalized = latinDigits(query).trim().toLocaleLowerCase();
  const status = ["planned", "ongoing", "done", "unknown"].includes(
    params.get("status") ?? "",
  )
    ? params.get("status")!
    : "all";
  const balance = ["due", "settled", "overpaid"].includes(
    params.get("balance") ?? "",
  )
    ? params.get("balance")!
    : "all";
  const scope = JSON.stringify([personId, workId, query, status, balance]);
  const [window, setWindow] = useState({ scope, count: 12 });
  const count = window.scope === scope ? window.count : 12;
  const [peopleDisclosure, setPeopleDisclosure] = useState<boolean | null>(
    null,
  );
  const peopleFiltersOpen = peopleDisclosure ?? Boolean(personId || workId);
  useEffect(() => {
    setWindow((current) =>
      current.scope === scope ? current : { scope, count: 12 },
    );
  }, [scope]);
  const peopleById = useMemo(
    () => new Map(ledger.people.map((person) => [person.id, person.name])),
    [ledger.people],
  );
  const jobPeople = useMemo(
    () => new Set(ledger.contracts.map((job) => job.personId)),
    [ledger.contracts],
  );
  const balances = useMemo(() => jobBalances(ledger), [ledger]);
  const scoped = useMemo(
    () =>
      recentJobs(
        ledger.contracts.filter((job) => !job.archivedAt),
        ledger.entries,
      ).filter(
        (job) =>
          (!personId || job.personId === personId) &&
          (!workId || contractAppliesToWork(job, workId)) &&
          (!normalized ||
            latinDigits(
              [jobName(job, t), peopleById.get(job.personId)]
                .filter(Boolean)
                .join(" "),
            )
              .toLocaleLowerCase()
              .includes(normalized)),
      ),
    [
      ledger.contracts,
      ledger.entries,
      personId,
      workId,
      normalized,
      peopleById,
      t,
    ],
  );
  const jobs = scoped.filter(
    (job) =>
      (status === "all" || jobStatusKey(job) === status) &&
      (balance === "all" ||
        (balances.get(job.id)?.commitmentValid &&
          balances.get(job.id)?.commitmentState === balance)),
  );
  const counts = scoped.reduce(
    (result, job) => ({
      all: result.all + 1,
      ongoing: result.ongoing + Number(job.status === "ongoing"),
      due:
        result.due +
        Number(
          balances.get(job.id)?.commitmentValid &&
            balances.get(job.id)?.commitmentState === "due",
        ),
    }),
    { all: 0, ongoing: 0, due: 0 },
  );
  const filtered = Boolean(
    personId || workId || query || status !== "all" || balance !== "all",
  );
  function update(key: string, value: string) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        applyCommittedQuery(next);
        if (value && (key === "q" || value !== "all")) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  }
  function applyCommittedQuery(next: URLSearchParams) {
    const value = searchInput.getCommittedQuery().slice(0, 200);
    if (value) next.set("q", value);
    else next.delete("q");
  }
  function insight(value: "all" | "ongoing" | "due") {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        applyCommittedQuery(next);
        next.delete("status");
        next.delete("balance");
        if (value === "ongoing") next.set("status", "ongoing");
        if (value === "due") next.set("balance", "due");
        return next;
      },
      { replace: true },
    );
  }
  function reset() {
    searchInput.clear();
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const key of ["person", "work", "q", "status", "balance"])
          next.delete(key);
        return next;
      },
      { replace: true },
    );
  }
  function origin() {
    const next = new URLSearchParams(params);
    applyCommittedQuery(next);
    return location.pathname + (next.size ? `?${next}` : "");
  }
  return (
    <div className="jobs-page page-flow">
      <header className="page-heading jobs-heading">
        <div>
          <p className="eyebrow">{t("কাজের হিসাব")}</p>
          <h1>{t("কাজ")}</h1>
        </div>
        <button
          type="button"
          className="primary-button job-create"
          onClick={() =>
            entity(
              "contract",
              undefined,
              workId || undefined,
              personId || undefined,
            )
          }
        >
          <PlusIcon size={19} />
          {t("কাজ যোগ করি")}
        </button>
      </header>
      <section className="jobs-insights" aria-label={t("কাজের খবর")}>
        {(
          [
            ["all", "সব কাজ", SquaresFourIcon],
            ["ongoing", "চলছে", HardHatIcon],
            ["due", "বাকি আছে", CoinsIcon],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            className={`job-insight job-insight-${key}`}
            aria-pressed={
              key === "all"
                ? status === "all" && balance === "all"
                : key === "ongoing"
                  ? status === "ongoing" && balance === "all"
                  : balance === "due" && status === "all"
            }
            onClick={() => insight(key)}
          >
            <span>
              <Icon size={18} weight="duotone" />
              {t(label)}
            </span>
            <strong>{number(counts[key])}</strong>
          </button>
        ))}
      </section>
      <section className="jobs-tools" aria-label={t("কাজ বেছে দেখি")}>
        <label className="history-search jobs-search">
          <MagnifyingGlassIcon size={20} />
          <input
            aria-label={t("কাজ খুঁজুন")}
            placeholder={t("কাজের নাম খুঁজুন")}
            {...searchInput.inputProps}
          />
        </label>
        <div
          className="jobs-balance-filters"
          role="group"
          aria-label={t("টাকার অবস্থা")}
        >
          {(
            [
              ["all", "সব"],
              ["due", "বাকি আছে"],
              ["settled", "বাকি নেই"],
              ["overpaid", "বেশি দিয়েছি"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`jobs-balance-filter-${key}`}
              aria-pressed={balance === key}
              onClick={() => update("balance", key)}
            >
              {t(label)}
            </button>
          ))}
        </div>
        <div className="jobs-filter-row">
          <label className="jobs-status-filter">
            <span>{t("কাজের অবস্থা")}</span>
            <AppSelect
              aria-label={t("কাজের অবস্থা")}
              className={
                status === "all"
                  ? undefined
                  : `jobs-status-choice job-status-${status}`
              }
              value={status}
              onChange={(event) => update("status", event.target.value)}
            >
              <option value="all">{t("সব অবস্থা")}</option>
              {Object.entries(jobStatusNames).map(([value, label]) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
            </AppSelect>
          </label>
          <button
            type="button"
            className="jobs-people-toggle"
            aria-label={t("কর্মী ও খাতা")}
            aria-expanded={peopleFiltersOpen}
            aria-controls="jobs-people-filters"
            onClick={() => setPeopleDisclosure(!peopleFiltersOpen)}
          >
            <FunnelSimpleIcon size={17} />
            {t("কর্মী ও খাতা")}
            {personId || workId ? (
              <span className="jobs-filter-count" aria-hidden="true">
                {number(Number(Boolean(personId)) + Number(Boolean(workId)))}
              </span>
            ) : null}
            <CaretDownIcon size={15} />
          </button>
        </div>
        {peopleFiltersOpen ? (
          <div className="jobs-filters" id="jobs-people-filters">
            <label>
              <span>{t("কর্মী")}</span>
              <AppSelect
                aria-label={t("কর্মী")}
                value={personId}
                onChange={(event) => update("person", event.target.value)}
              >
                <option value="">{t("সব কর্মী")}</option>
                {ledger.people
                  .filter(
                    (person) =>
                      !person.archivedAt &&
                      (person.id === personId || jobPeople.has(person.id)),
                  )
                  .map((person) => (
                    <option key={person.id} value={person.id}>
                      {formatDigits(person.name)}
                    </option>
                  ))}
              </AppSelect>
            </label>
            <label>
              <span>{t("খাতা")}</span>
              <AppSelect
                aria-label={t("খাতা")}
                value={workId}
                onChange={(event) => update("work", event.target.value)}
              >
                <option value="">{t("সব খাতা")}</option>
                {ledger.works
                  .filter((work) => !work.archivedAt)
                  .map((work) => (
                    <option key={work.id} value={work.id}>
                      {formatDigits(work.name)}
                    </option>
                  ))}
              </AppSelect>
            </label>
          </div>
        ) : null}
      </section>
      <div className="jobs-results-heading">
        <span aria-live="polite">
          {t("{{count}}টি কাজ", { count: number(jobs.length) })}
        </span>
        {filtered ? (
          <button type="button" className="text-button" onClick={reset}>
            <XIcon size={15} />
            {t("বাছাই মুছি")}
          </button>
        ) : null}
      </div>
      {jobs.length ? (
        <div className="jobs-grid">
          {jobs.slice(0, count).map((job) => (
            <JobTile
              key={job.id}
              ledger={ledger}
              job={job}
              balance={balances.get(job.id)}
              showWorker={!personId}
              onOpen={() => go(jobDetailUrl(job.id, origin(), base))}
            />
          ))}
        </div>
      ) : (
        <div className="jobs-empty">
          <HardHatIcon size={30} weight="duotone" />
          <h2>{t("কোনো কাজ পাওয়া যায়নি")}</h2>
          <p>{t("কাজের নাম বা বাছাই বদলে দেখুন।")}</p>
        </div>
      )}
      <LoadMore
        hasMore={count < jobs.length}
        onLoadMore={() => setWindow({ scope, count: count + 12 })}
      />
    </div>
  );
}

export function JobPage() {
  const { ledger, go, add, entity, detail, save, base } = useNotebook();
  const { t, formatDigits } = useLanguageContext();
  const { jobId } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "history" ? "history" : "transactions";
  const transactionsTab = useRef<HTMLButtonElement>(null);
  const historyTab = useRef<HTMLButtonElement>(null);
  const [window, setWindow] = useState({ jobId, count: 12 });
  const count = window.jobId === jobId ? window.count : 12;
  const [statusEditor, setStatusEditor] = useState<{
    jobId: string;
    status: JobStatus;
    reason: string;
    error: string;
    errorOccurrence?: number;
  } | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const statusLock = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const job = ledger.contracts.find((contract) => contract.id === jobId);
  const removal = useEntityRemoval(
    "contract",
    jobId,
    job ? jobName(job, t) : undefined,
  );
  if (!job)
    return (
      <div className="jobs-empty">
        <h1>{t("কাজটি পাওয়া যায়নি")}</h1>
        <button
          type="button"
          className="text-button"
          onClick={() =>
            go(jobReturn(params.get("back"), base), { replace: true })
          }
        >
          {t("ফিরুন")}
          <ArrowRightIcon size={16} />
        </button>
      </div>
    );
  const worker = ledger.people.find((person) => person.id === job.personId);
  const entries = sortHistory(
    ledger.entries.filter(
      (entry) => entry.contractId === job.id && entry.personId === job.personId,
    ),
  );
  function changeTab(next: "transactions" | "history") {
    setParams(
      (previous) => {
        const changed = new URLSearchParams(previous);
        if (next === "history") changed.set("tab", next);
        else changed.delete("tab");
        return changed;
      },
      { replace: true, preventScrollReset: true },
    );
  }
  const currentStatus = jobStatusKey(job);
  const editor = statusEditor?.jobId === job.id ? statusEditor : null;
  async function updateStatus(event: FormEvent) {
    event.preventDefault();
    if (!editor || statusLock.current || editor.status === job!.status) return;
    if (!editor.reason.trim()) {
      setStatusEditor({
        ...editor,
        error: t("কেন বদলালেন, ছোট করে লিখুন।"),
        errorOccurrence: (editor.errorOccurrence ?? 0) + 1,
      });
      return;
    }
    statusLock.current = true;
    setSavingStatus(true);
    try {
      await save((current) => {
        const latest = current.contracts.find(
          (value) => value.id === editor.jobId,
        );
        if (!latest) throw new Error(t("কাজটি পাওয়া যায়নি"));
        return saveContractChange(
          current,
          { ...latest, status: editor.status },
          editor.reason,
        );
      });
      if (mounted.current)
        setStatusEditor((value) =>
          value?.jobId === editor.jobId ? null : value,
        );
    } catch (cause) {
      if (mounted.current)
        setStatusEditor((value) =>
          value?.jobId === editor.jobId
            ? {
                ...value,
                errorOccurrence: (value.errorOccurrence ?? 0) + 1,
                error:
                  cause instanceof Error &&
                  cause.message === "client_update_required"
                    ? t(
                        "নতুন হিসাব রাখার আগে অ্যাপ আপডেট করুন। আপনার লেখা অক্ষত আছে।",
                      )
                    : cause instanceof Error &&
                        /[\u0980-\u09ff]/.test(cause.message)
                      ? t(cause.message)
                      : t("অবস্থা রাখা যায়নি। আবার চেষ্টা করুন।"),
              }
            : value,
        );
    } finally {
      statusLock.current = false;
      if (mounted.current) setSavingStatus(false);
    }
  }
  return (
    <div className="job-page page-flow">
      <button
        type="button"
        className="back-link"
        onClick={() =>
          go(
            jobReturn(
              params.get("back"),
              base,
              `/parties/${encodeURIComponent(job.personId)}`,
            ),
            { replace: true },
          )
        }
      >
        <ArrowLeftIcon size={17} />
        {t("ফিরুন")}
      </button>
      <header className="job-page-heading">
        <h1>{formatDigits(jobName(job, t))}</h1>
        <AppMenu
          trigger={
            <button
              type="button"
              className="icon-button"
              aria-label={t("কাজের আরও কাজ")}
              ref={removal.triggerRef}
            >
              <DotsThreeIcon size={23} />
            </button>
          }
          items={[
            {
              label: t("কাজ বদলাই"),
              icon: <PencilSimpleIcon size={18} />,
              disabled: removal.archived,
              onSelect: () => entity("contract", job.id),
            },
            { ...removal.menuItem, separatorBefore: true },
          ]}
        />
        <div className="job-heading-meta">
          {worker ? (
            <button
              type="button"
              className="text-button job-worker-link"
              onClick={() => go(`/parties/${encodeURIComponent(worker.id)}`)}
            >
              <span>{formatDigits(worker.name)}</span>
              <ArrowRightIcon size={14} />
            </button>
          ) : null}
          <button
            type="button"
            className={`job-status-control job-status job-status-${currentStatus}`}
            aria-label={t("কাজের অবস্থা বদলাই")}
            aria-expanded={Boolean(editor)}
            aria-controls="job-status-editor"
            disabled={savingStatus || removal.archived}
            onClick={() =>
              setStatusEditor(
                editor
                  ? null
                  : {
                      jobId: job.id,
                      status: job.status,
                      reason: "",
                      error: "",
                    },
              )
            }
          >
            <i />
            {t(jobStatusNames[currentStatus])}
            <CaretDownIcon size={15} />
          </button>
        </div>
      </header>
      {removal.notice}
      {removal.dialog}
      {editor ? (
        <form
          id="job-status-editor"
          className="job-status-editor"
          onSubmit={(event) => void updateStatus(event)}
        >
          <FormError
            id="job-status-error"
            message={editor.error}
            occurrence={editor.errorOccurrence}
          />
          <div className="jobs-filters">
            <label>
              <span>{t("কাজের অবস্থা")}</span>
              <AppSelect
                aria-label={t("কাজের অবস্থা")}
                className={`jobs-status-choice job-status-${editor.status ?? "unknown"}`}
                value={editor.status ?? "unknown"}
                disabled={savingStatus}
                onChange={(event) =>
                  setStatusEditor({
                    ...editor,
                    status: readJobStatus(event.target.value),
                    error: "",
                  })
                }
              >
                {Object.entries(jobStatusNames).map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </AppSelect>
            </label>
            <label>
              <span>{t("কেন বদলালেন")}</span>
              <input
                aria-label={t("কেন বদলালেন")}
                aria-invalid={Boolean(editor.error) && !editor.reason.trim()}
                aria-describedby={editor.error ? "job-status-error" : undefined}
                value={editor.reason}
                maxLength={2000}
                disabled={savingStatus}
                placeholder={t("যেমন: আজ কাজ শেষ হয়েছে")}
                onChange={(event) =>
                  setStatusEditor({
                    ...editor,
                    reason: event.target.value,
                    error: "",
                  })
                }
              />
            </label>
          </div>
          <div className="job-status-actions">
            <button
              type="button"
              className="text-button"
              disabled={savingStatus}
              onClick={() => setStatusEditor(null)}
            >
              {t("বন্ধ করি")}
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={savingStatus || editor.status === job.status}
            >
              {t(savingStatus ? "রাখছি…" : "রাখুন")}
            </button>
          </div>
        </form>
      ) : null}
      <ContractCard
        ledger={ledger}
        contract={job}
        showHeading={false}
        showHistory={false}
      />
      <button
        type="button"
        className="primary-button job-pay"
        disabled={removal.archived || Boolean(worker?.archivedAt)}
        onClick={() =>
          add({
            kind: "payment",
            account: "labour",
            personId: job.personId,
            workId: job.workId ?? undefined,
            contractId: job.id,
          })
        }
      >
        <WalletIcon size={21} weight="duotone" />
        {t("টাকা দিই")}
      </button>
      <div
        className="job-detail-tabs"
        role="tablist"
        aria-label={t("কাজের বিস্তারিত")}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const next =
            event.key === "Home"
              ? "transactions"
              : event.key === "End"
                ? "history"
                : tab === "transactions"
                  ? "history"
                  : "transactions";
          changeTab(next);
          (next === "history" ? historyTab : transactionsTab).current?.focus();
        }}
      >
        <button
          id="job-transactions-tab"
          ref={transactionsTab}
          tabIndex={tab === "transactions" ? 0 : -1}
          type="button"
          role="tab"
          aria-selected={tab === "transactions"}
          aria-controls="job-detail-panel"
          onClick={() => changeTab("transactions")}
        >
          {t("লেনদেন")}
        </button>
        <button
          id="job-history-tab"
          ref={historyTab}
          tabIndex={tab === "history" ? 0 : -1}
          type="button"
          role="tab"
          aria-selected={tab === "history"}
          aria-controls="job-detail-panel"
          onClick={() => changeTab("history")}
        >
          {t("পরিবর্তন")}
        </button>
      </div>
      <section
        id="job-detail-panel"
        className="job-detail-panel"
        role="tabpanel"
        aria-labelledby={
          tab === "history" ? "job-history-tab" : "job-transactions-tab"
        }
      >
        {tab === "history" ? (
          <ContractHistory
            key={job.id}
            ledger={ledger}
            contract={job}
            alwaysOpen
          />
        ) : (
          <>
            <EntryList
              ledger={ledger}
              entries={entries.slice(0, count)}
              onEntry={detail}
              showKind
              grouped
            />
            <LoadMore
              hasMore={count < entries.length}
              onLoadMore={() => setWindow({ jobId, count: count + 12 })}
            />
            {!entries.length ? (
              <p className="job-first-payment">
                {t("টাকা দিলে এই কাজের হিসাব এখানেই পাবেন।")}
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
