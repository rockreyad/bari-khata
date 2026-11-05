import { latinDigits } from "../../lib/numerals";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useParams, useSearchParams } from "react-router";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ClockCounterClockwiseIcon,
  DotsThreeIcon,
  FolderOpenIcon,
  PlusIcon,
  CalendarDotsIcon,
  CaretLeftIcon,
  CaretRightIcon,
  ListBulletsIcon,
  PackageIcon,
  HardHatIcon,
  TruckIcon,
  SquaresFourIcon,
  MagnifyingGlassIcon,
  XIcon,
  ArrowUpRightIcon,
} from "@phosphor-icons/react";
import { useEntityRemoval } from "../../components/EntityRemoval";
import { useNotebook } from "../../app/NotebookProvider";
import { jobDetailUrl } from "../../app/jobRoutes";
import { useLanguageContext } from "../../context/LanguageProvider";
import { summarize } from "../../domain/ledger";
import { contractAppliesToWork } from "../../domain/contracts";
import { JobPreview } from "../jobs/JobPreview";
import type { Ledger, Work, WorkSnapshot } from "../../domain/model";
import { workChanges } from "../../domain/workActivity";
import {
  WorkMark,
  workColorChoices,
  workIconChoices,
} from "../../components/ui/Icons";
import { EntryList } from "../../components/ui/EntryList";
import {
  recentWorkEntries,
  workEntryAmount,
  workTabEntries,
  type WorkTab,
} from "./workEntries";
import "./works.css";
import { SpendingChart } from "../../components/ui/SpendingChart";
import { AppMenu } from "../../components/ui/AppMenu";
import { orderedWorks } from "./workOverview";
import { workBalances, type WorkBalances } from "./workBalances";
import { workLabourSummary } from "./workLabourSummary";
import { WorkPayables } from "./WorkPayables";
const statusNames = {
  planned: "শুরু হয়নি",
  ongoing: "কাজ চলছে",
  done: "কাজ শেষ",
};
const fields: Record<keyof WorkSnapshot, string> = {
  name: "নাম",
  description: "বিবরণ",
  color: "রং",
  icon: "চিহ্ন",
  status: "অবস্থা",
  startedOn: "শুরুর তারিখ",
  completedOn: "শেষের তারিখ",
  quickActions: "পছন্দের বোতাম",
};
function workDueRows(balance: WorkBalances) {
  if (!balance.valid) return [];
  if (balance.reconciledPayable !== null)
    return balance.reconciledPayable > 0
      ? [
          {
            label: balance.sharedOutstanding > 0 ? "এই খাতায় বাকি" : "মোট বাকি",
            amount: balance.reconciledPayable,
          },
        ]
      : [];
  return [
    { label: "বিলের বাকি", amount: balance.billPayable },
    { label: "চুক্তির বাকি", amount: balance.workCommitmentOutstanding },
  ].filter((row) => row.amount > 0);
}
export function WorkCard({
  work,
  ledger,
  onOpen,
}: {
  work: Work;
  ledger: Ledger;
  onOpen: () => void;
}) {
  const { t, money, formatDigits } = useLanguageContext();
  const balance = workBalances(ledger, work.id);
  const dues = workDueRows(balance);
  const color =
    workColorChoices.find((choice) => choice.id === work.color)?.color ??
    "#3b82f6";
  return (
    <button
      className="notebook-card notebook-card-v3 work-notebook-card"
      style={{ "--work-color": color } as CSSProperties}
      onClick={onOpen}
    >
      <div className="notebook-card-top">
        <WorkMark icon={work.icon} color={work.color} />
        <span className={`status-tag ${work.status}`}>
          <i />
          {t(statusNames[work.status])}
        </span>
      </div>
      <div className="notebook-card-heading">
        <h3 title={formatDigits(work.name)}>{formatDigits(work.name)}</h3>
        <ArrowUpRightIcon
          className="notebook-card-arrow"
          size={17}
          aria-hidden="true"
        />
      </div>
      <div className="notebook-card-total">
        <span>{t("মোট টাকা দিয়েছি")}</span>
        <strong>
          {balance.valid
            ? money(balance.reconciledNetPaid)
            : t("টাকার অঙ্ক বেশি হয়েছে।")}
        </strong>
      </div>
      <div
        className="notebook-card-balance"
        aria-hidden={dues.length ? undefined : true}
      >
        {dues.map((row) => (
          <div className="notebook-card-due" key={row.label}>
            <span>{t(row.label)}</span>
            <strong>{money(row.amount)}</strong>
          </div>
        ))}
      </div>
    </button>
  );
}
export function WorksPage() {
  const { ledger, go, entity } = useNotebook();
  const { t, number, language } = useLanguageContext();
  const [params, setParams] = useSearchParams();
  const rawStatus = params.get("status") ?? "all";
  const status = ["planned", "ongoing", "done"].includes(rawStatus)
    ? rawStatus
    : "all";
  const search = params.get("q") ?? "";
  const query = latinDigits(search).trim().toLocaleLowerCase();
  const matches = orderedWorks(ledger).filter((work) =>
    latinDigits(work.name).toLocaleLowerCase().includes(query),
  );
  const works = matches.filter(
    (work) => status === "all" || work.status === status,
  );
  const filterRail = useWorkTabRail(status, `works:${language}`);
  const changeFilter = (key: "q" | "status", value: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value && !(key === "status" && value === "all"))
          next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: key === "q" },
    );
  return (
    <div className="page-flow works-directory">
      <header className="page-heading works-directory-heading">
        <h1>{t("খাতা")}</h1>
        <button className="primary-button" onClick={() => entity("work")}>
          <PlusIcon size={19} />
          {t("নতুন খাতা বানান")}
        </button>
      </header>
      <button
        type="button"
        className="text-button"
        onClick={() => go("/works")}
      >
        {t("সব কাজ")}
      </button>
      <section className="works-directory-tools">
        <label className="works-search">
          <MagnifyingGlassIcon size={20} aria-hidden="true" />
          <input
            aria-label={t("খাতা খুঁজুন")}
            placeholder={t("খাতার নাম লিখুন")}
            value={search}
            onChange={(event) => changeFilter("q", event.target.value)}
          />
          {search ? (
            <button
              type="button"
              aria-label={t("খোঁজা মুছুন")}
              onClick={() => changeFilter("q", "")}
            >
              <XIcon size={17} />
            </button>
          ) : null}
        </label>
        <div
          className={`work-tabs-rail works-filter-rail ${filterRail.edges.left ? "can-scroll-left" : ""} ${filterRail.edges.right ? "can-scroll-right" : ""}`}
        >
          <div
            ref={filterRail.ref}
            className="works-status-filters"
            role="group"
            aria-label={t("কাজের অবস্থা")}
          >
            {(
              [
                ["all", "সব"],
                ["ongoing", "চলছে"],
                ["planned", "শুরু হয়নি"],
                ["done", "শেষ"],
              ] as const
            ).map(([value, label]) => {
              const count =
                value === "all"
                  ? matches.length
                  : matches.filter((work) => work.status === value).length;
              return (
                <button
                  type="button"
                  key={value}
                  aria-label={t(label)}
                  aria-pressed={status === value}
                  className={`work-status-filter-${value}${status === value ? " selected" : ""}`}
                  onClick={() => changeFilter("status", value)}
                >
                  <span>{t(label)}</span>
                  {count ? (
                    <small aria-hidden="true">{number(count)}</small>
                  ) : null}
                </button>
              );
            })}
          </div>
          {filterRail.edges.left ? (
            <button
              className="work-tabs-scroll-control is-left"
              type="button"
              aria-label={t("আগের বোতাম দেখুন")}
              onClick={() => filterRail.scroll(-1)}
            >
              <CaretLeftIcon size={17} weight="bold" />
            </button>
          ) : null}
          {filterRail.edges.right ? (
            <button
              className="work-tabs-scroll-control is-right"
              type="button"
              aria-label={t("পরের বোতাম দেখুন")}
              onClick={() => filterRail.scroll(1)}
            >
              <CaretRightIcon size={17} weight="bold" />
            </button>
          ) : null}
        </div>
      </section>
      <div className="notebook-grid works-directory-grid">
        {works.map((work) => (
          <WorkCard
            key={work.id}
            work={work}
            ledger={ledger}
            onOpen={() => go(`/sectors/${work.id}`)}
          />
        ))}
      </div>
      {!works.length ? (
        <div className="empty-panel works-directory-empty">
          <FolderOpenIcon size={36} weight="duotone" />
          <h3>{t("কোনো খাতা পাওয়া যায়নি")}</h3>
          {search || status !== "all" ? (
            <button
              className="text-button"
              onClick={() =>
                setParams((previous) => {
                  const next = new URLSearchParams(previous);
                  next.delete("q");
                  next.delete("status");
                  return next;
                })
              }
            >
              {t("সব খাতা দেখুন")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
function useWorkTabRail(active: string, context: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const rail = ref.current;
    if (!rail) return;
    const left = rail.scrollLeft > 1;
    const right = rail.scrollWidth - rail.clientWidth - rail.scrollLeft > 1;
    setEdges((previous) =>
      previous.left === left && previous.right === right
        ? previous
        : { left, right },
    );
  }, []);
  const move = useCallback((left: number) => {
    const rail = ref.current;
    if (!rail) return;
    const maximum = Math.max(0, rail.scrollWidth - rail.clientWidth);
    rail.scrollTo?.({
      left: Math.max(0, Math.min(left, maximum)),
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, []);
  const reveal = useCallback(() => {
    const rail = ref.current;
    const selected = rail?.querySelector<HTMLButtonElement>(
      'button[aria-pressed="true"]',
    );
    if (rail && selected && rail.clientWidth) {
      const start = selected.offsetLeft - 40;
      const end = selected.offsetLeft + selected.offsetWidth + 40;
      if (start < rail.scrollLeft) move(start);
      else if (end > rail.scrollLeft + rail.clientWidth)
        move(end - rail.clientWidth);
    }
    measure();
  }, [measure, move]);
  useEffect(() => {
    const rail = ref.current;
    if (!rail) return;
    reveal();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reveal);
    observer?.observe(rail);
    rail
      .querySelectorAll("button")
      .forEach((button) => observer?.observe(button));
    rail.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", reveal);
    return () => {
      observer?.disconnect();
      rail.removeEventListener("scroll", measure);
      window.removeEventListener("resize", reveal);
    };
  }, [context, measure, reveal]);
  useEffect(reveal, [active, context, reveal]);
  return {
    ref,
    edges,
    scroll: (direction: -1 | 1) => {
      const rail = ref.current;
      if (rail)
        move(
          rail.scrollLeft + direction * Math.max(180, rail.clientWidth * 0.75),
        );
    },
  };
}

export function WorkPage() {
  const { workId } = useParams();
  const { ledger, go, entity, add, detail, base = "" } = useNotebook();
  const { t, money, date, language, formatDigits } = useLanguageContext();
  const [showChart, setShowChart] = useState(false);
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") ?? "all";
  const tab: WorkTab = [
    "all",
    "material",
    "labour",
    "transport",
    "other",
    "activity",
  ].includes(raw)
    ? (raw as WorkTab)
    : "all";
  const work = ledger.works.find((w) => w.id === workId);
  const removal = useEntityRemoval("work", workId);
  const tabRail = useWorkTabRail(tab, `${work?.id ?? ""}:${language}`);
  if (!work)
    return (
      <div className="empty-panel">
        <h2>{t("খাতা পাওয়া যায়নি")}</h2>
        <button onClick={() => go("/sectors")}>{t("সব খাতা")}</button>
      </div>
    );
  const s = summarize(ledger, work.id);
  const balance = workBalances(ledger, work.id);
  const dues = workDueRows(balance);
  const typeMatches = (type: string) =>
    tab === "labour"
      ? type === "labour"
      : tab === "transport"
        ? ["transport", "unload"].includes(type)
        : tab === "other"
          ? ["rental", "other"].includes(type)
          : type === "material";
  const scoped = workTabEntries(s.entries, work.id, tab, ledger.entries);
  const labour = tab === "labour" ? workLabourSummary(ledger, work.id) : null;
  const account =
    tab === "labour"
      ? "labour"
      : ["transport", "other"].includes(tab)
        ? "other"
        : "materials";
  const entries = recentWorkEntries(scoped);
  const amounts = Object.fromEntries(
    scoped.map((entry) => [entry.id, workEntryAmount(entry, work.id, tab)]),
  );
  const titles = Object.fromEntries(
    scoped
      .filter((entry) => entry.lines.length)
      .map((entry) => [
        entry.id,
        entry.lines
          .filter(
            (line) =>
              line.workId === work.id &&
              (tab === "all" || typeMatches(line.costType)),
          )
          .map((line) => line.label)
          .join(" · "),
      ]),
  );
  const amount = scoped
    .filter(
      (entry) => entry.kind === "expense" || entry.kind === "expense_credit",
    )
    .reduce((sum, entry) => sum + workEntryAmount(entry, work.id, tab), 0);
  const historyPath = `/ledger?work=${work.id}${tab === "labour" || tab === "material" ? `&account=${account}` : ""}`;
  const actions = removal.archived
    ? []
    : (work.quickActions ?? ["expense", "payment"]);
  const addLabourPayment = () =>
    add({
      kind: "payment",
      workId: work.id,
      account: "labour",
      costType: "labour",
      purpose: "settle",
    });
  const timestamp = (at: string) =>
    formatDigits(
      new Intl.DateTimeFormat(language === "bn" ? "bn-BD" : "en-BD", {
        timeZone: "Asia/Dhaka",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(at)),
    );
  const showValue = (key: keyof WorkSnapshot, value: unknown) =>
    key === "status"
      ? t(statusNames[value as keyof typeof statusNames])
      : key === "startedOn" || key === "completedOn"
        ? value
          ? date(String(value), { year: "numeric" })
          : t("লেখা নেই")
        : key === "quickActions"
          ? Array.isArray(value)
            ? value
                .map((v) =>
                  t(
                    (
                      {
                        expense: "খরচ লিখি",
                        payment: "টাকা দিলাম",
                        labour: "মজুরি",
                        transport: "আনা-নামানো",
                      } as Record<string, string>
                    )[v] ?? v,
                  ),
                )
                .join(" · ") || t("কোনো বোতাম নেই")
            : t("সাধারণ বোতাম")
          : key === "color"
            ? t(
                workColorChoices.find((c) => c.id === value)?.label ??
                  String(value),
              )
            : key === "icon"
              ? t(
                  workIconChoices.find((c) => c.id === value)?.label ??
                    String(value),
                )
              : String(value ?? t("লেখা নেই"));
  return (
    <div className="page-flow work-page-v3">
      <button className="back-link" onClick={() => go("/sectors")}>
        <ArrowLeftIcon size={17} />
        {t("খাতা")}
      </button>
      <header className="page-heading">
        <div className="work-title">
          <WorkMark icon={work.icon} color={work.color} size={29} />
          <div>
            <h1>{formatDigits(work.name)}</h1>
            <span className={`status-tag ${work.status}`}>
              <i />
              {t(statusNames[work.status])}
            </span>
          </div>
        </div>
        <AppMenu
          trigger={
            <button
              className="icon-button"
              aria-label={t("খাতার আরও কাজ")}
              ref={removal.triggerRef}
            >
              <DotsThreeIcon size={25} />
            </button>
          }
          items={[
            {
              label: t("খাতার তথ্য বদলাই"),
              onSelect: () => entity("work", work.id),
              disabled: removal.archived,
            },
            {
              label: t("সব লেনদেন দেখি"),
              onSelect: () => go(`/ledger?work=${work.id}`),
            },
            removal.menuItem,
          ]}
        />
      </header>
      {removal.notice}
      {removal.dialog}
      <section className="work-overview" aria-label={t("এই খাতার হিসাব")}>
        <div className="work-overview-total">
          <div>
            <span>{t("মোট টাকা দিয়েছি")}</span>
            <strong>
              {balance.valid
                ? money(balance.reconciledNetPaid)
                : t("টাকার অঙ্ক বেশি হয়েছে।")}
            </strong>
          </div>
          <button
            className="work-chart-toggle"
            aria-label={t("মাসে মাসে দিয়েছি")}
            aria-expanded={showChart}
            onClick={() => setShowChart((value) => !value)}
          >
            <CalendarDotsIcon size={23} weight="regular" />
          </button>
        </div>
        {dues.map((row) => (
          <div className="work-known-due" key={row.label}>
            <span>{t(row.label)}</span>
            <strong>{money(row.amount)}</strong>
          </div>
        ))}
        {balance.valid && balance.reconciledPayable !== null ? (
          <WorkPayables workId={work.id} />
        ) : null}
        {balance.valid && balance.costCorrection !== 0 ? (
          <div className="work-known-due">
            <span>
              {t("মোট খরচ")}
              {" · "}
              {t("সমন্বয়সহ")}
            </span>
            <strong>{money(balance.reconciledCost)}</strong>
          </div>
        ) : null}
        {balance.valid &&
        (balance.paidCorrection !== 0 || balance.balanceCorrection !== 0) ? (
          <p className="work-due-note">{t("সমন্বয়সহ")}</p>
        ) : null}
        {balance.valid && balance.sharedOutstanding > 0 ? (
          <details className="work-shared-dues">
            <summary className="work-known-due work-shared-due">
              <span>{t("সব খাতা মিলিয়ে কাজের বাকি")}</span>
              <strong>
                {money(balance.sharedOutstanding)}{" "}
                <CaretRightIcon size={15} aria-hidden="true" />
              </strong>
            </summary>
            <div className="work-shared-jobs">
              {balance.sharedCommitments.map((commitment) => {
                const job = ledger.contracts.find(
                  (candidate) => candidate.id === commitment.id,
                )!;
                const person = ledger.people.find(
                  (candidate) => candidate.id === job.personId,
                );
                return (
                  <button
                    key={job.id}
                    onClick={() =>
                      go(
                        jobDetailUrl(
                          job.id,
                          `${base}/sectors/${encodeURIComponent(work.id)}?${params}`,
                          base,
                        ),
                      )
                    }
                  >
                    <span>
                      {formatDigits(job.title || person?.name || t("কাজ"))}
                      {commitment.archived ? (
                        <small>{t("সরানো কাজ")}</small>
                      ) : null}
                    </span>
                    <strong>{money(commitment.remaining)}</strong>
                    <ArrowRightIcon size={15} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </details>
        ) : null}
        {balance.valid &&
        (balance.scopedOutstanding === null ||
          (balance.sharedOutstanding > 0 && dues.length > 0)) ? (
          <p className="work-due-note">
            {t("এই বাকিগুলোতে একই টাকা থাকতে পারে, তাই যোগ করে দেখানো হয়নি।")}
          </p>
        ) : null}
      </section>
      {showChart ? (
        <SpendingChart
          ledger={ledger}
          workId={work.id}
          basis="paid"
          title="মাসে মাসে দিয়েছি"
        />
      ) : null}
      <div
        className={`work-tabs-rail ${tabRail.edges.left ? "can-scroll-left" : ""} ${tabRail.edges.right ? "can-scroll-right" : ""}`}
      >
        <div
          ref={tabRail.ref}
          className="work-tabs-v3 work-tabs-scroll"
          role="group"
          aria-label={t("খাতার লেনদেন বেছে দেখুন")}
        >
          {(
            [
              ["all", "সব লেনদেন", ListBulletsIcon],
              ["material", "মাল", PackageIcon],
              ["labour", "মজুরি", HardHatIcon],
              ["transport", "আনা-নামানো", TruckIcon],
              ["other", "অন্য খরচ", SquaresFourIcon],
              ["activity", "কাজের খবর", ClockCounterClockwiseIcon],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              type="button"
              key={id}
              aria-pressed={tab === id}
              className={tab === id ? "selected" : ""}
              onClick={() =>
                setParams((previous) => {
                  const next = new URLSearchParams(previous);
                  next.set("tab", id);
                  return next;
                })
              }
            >
              <Icon
                size={17}
                weight={tab === id ? "fill" : "duotone"}
                aria-hidden="true"
                focusable="false"
              />
              <span>{t(label)}</span>
            </button>
          ))}
        </div>
        {tabRail.edges.left ? (
          <button
            className="work-tabs-scroll-control is-left"
            type="button"
            aria-label={t("আগের বোতাম দেখুন")}
            onClick={() => tabRail.scroll(-1)}
          >
            <CaretLeftIcon size={17} weight="bold" />
          </button>
        ) : null}
        {tabRail.edges.right ? (
          <button
            className="work-tabs-scroll-control is-right"
            type="button"
            aria-label={t("পরের বোতাম দেখুন")}
            onClick={() => tabRail.scroll(1)}
          >
            <CaretRightIcon size={17} weight="bold" />
          </button>
        ) : null}
      </div>

      {tab === "activity" ? (
        <>
          <section className="panel work-facts-v3">
            {work.description ? <p>{formatDigits(work.description)}</p> : null}
            <div>
              <span>{t("কাজ শুরুর তারিখ")}</span>
              <strong>
                {work.startedOn
                  ? date(work.startedOn, { year: "numeric" })
                  : t("লেখা নেই")}
              </strong>
            </div>
            <div>
              <span>{t("কাজ শেষের তারিখ")}</span>
              <strong>
                {work.completedOn
                  ? date(work.completedOn, { year: "numeric" })
                  : t("লেখা নেই")}
              </strong>
            </div>
            <button
              className="text-button"
              disabled={removal.archived}
              onClick={() => entity("work", work.id)}
            >
              {t("তারিখ বা তথ্য যোগ করি")}
            </button>
          </section>
          <section className="panel">
            <div className="section-heading">
              <h2>{t("কখন কী বদলেছে")}</h2>
              <ClockCounterClockwiseIcon size={22} />
            </div>
            {!work.activity.length ? (
              <p className="helper-text">
                {t("আগের পরিবর্তনের সময় লেখা ছিল না। এখন থেকে এখানে থাকবে।")}
              </p>
            ) : (
              <ol className="work-activity-list">
                {[...work.activity].reverse().map((event) => (
                  <li key={event.id}>
                    <span className="activity-pin" />
                    <div>
                      <strong>
                        {t(
                          event.before
                            ? "খাতার তথ্য বদলেছে"
                            : "খাতা খোলা হয়েছে",
                        )}
                      </strong>
                      <time>{timestamp(event.at)}</time>
                      {event.before ? (
                        <dl>
                          {workChanges(event.before, event.after).map((key) => (
                            <div key={key}>
                              <dt>{t(fields[key])}</dt>
                              <dd>
                                <span
                                  className={
                                    key === "status"
                                      ? `work-activity-status ${event.before!.status}`
                                      : undefined
                                  }
                                >
                                  {showValue(key, event.before![key])}
                                </span>
                                <ArrowRightIcon size={13} />
                                <strong
                                  className={
                                    key === "status"
                                      ? `work-activity-status ${event.after.status}`
                                      : undefined
                                  }
                                >
                                  {showValue(key, event.after[key])}
                                </strong>
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p>
                          {formatDigits(event.after.name)} ·{" "}
                          <span
                            className={`work-activity-status ${event.after.status}`}
                          >
                            {t(statusNames[event.after.status])}
                          </span>
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      ) : (
        <>
          {tab === "labour" && labour ? (
            <section
              className="work-scope-summary work-labour-summary"
              aria-label={t("মজুরির মোট হিসাব")}
            >
              <div className="work-labour-primary">
                <span>{t("মজুরিতে দিয়েছি")}</span>
                <strong>
                  {labour.valid
                    ? money(labour.reconciledNetPaid)
                    : t("টাকার অঙ্ক বেশি হয়েছে।")}
                </strong>
                <button
                  className="text-button"
                  onClick={() =>
                    go(`/reports?mode=cash&account=labour&work=${work.id}`)
                  }
                >
                  {t("বিস্তারিত হিসাব")}
                  <ArrowRightIcon size={15} />
                </button>
              </div>
              {labour.valid && labour.actualRefunds > 0 ? (
                <p className="work-labour-note">
                  {t("ফেরত পাওয়া {{amount}} বাদ দিয়ে").replace(
                    "{{amount}}",
                    money(labour.actualRefunds),
                  )}
                </p>
              ) : null}
              {labour.valid && labour.paidCorrection !== 0 ? (
                <p className="work-labour-note">
                  {t("সমন্বয়সহ")}
                  {" · "}
                  {t("আসলে দেওয়া টাকা")} {money(labour.actualNetPaid)}
                </p>
              ) : null}
            </section>
          ) : tab !== "all" ? (
            <section className="work-scope-summary">
              <span>
                {t(
                  tab === "transport"
                    ? "আনা-নামানোর খরচ"
                    : tab === "other"
                      ? "অন্য খরচ"
                      : "মালের দাম",
                )}
              </span>
              <strong>{money(amount)}</strong>
              <button
                className="text-button"
                onClick={() =>
                  go(`/reports?mode=cost&section=${tab}&work=${work.id}`)
                }
              >
                {t("বিস্তারিত হিসাব")}
                <ArrowRightIcon size={15} />
              </button>
            </section>
          ) : null}
          <div className="work-action-buttons">
            {tab === "labour" && !removal.archived ? (
              actions.includes("labour") ? (
                <button className="primary-button" onClick={addLabourPayment}>
                  {t("টাকা দিই")}
                </button>
              ) : null
            ) : (
              <>
                {actions.includes("expense") ? (
                  <button
                    className="primary-button"
                    onClick={() =>
                      add({
                        workId: work.id,
                        costType:
                          tab === "transport"
                            ? "transport"
                            : tab === "other"
                              ? "other"
                              : "material",
                        account,
                      })
                    }
                  >
                    <PlusIcon size={18} />
                    {t("খরচ লিখি")}
                  </button>
                ) : null}
                {actions.includes("payment") ? (
                  <button
                    className="secondary-button"
                    onClick={() =>
                      add({
                        kind: "payment",
                        workId: work.id,
                        account: tab === "all" ? undefined : account,
                      })
                    }
                  >
                    {t("টাকা দিলাম")}
                  </button>
                ) : null}
                {actions.includes("labour") ? (
                  <button
                    className="secondary-button"
                    onClick={addLabourPayment}
                  >
                    {t("মিস্ত্রির টাকা")}
                  </button>
                ) : null}
                {actions.includes("transport") ? (
                  <button
                    className="secondary-button"
                    onClick={() =>
                      add({
                        workId: work.id,
                        costType: "transport",
                        account: "other",
                      })
                    }
                  >
                    {t("আনার খরচ")}
                  </button>
                ) : null}
              </>
            )}
          </div>
          {tab === "labour" ? (
            <JobPreview
              ledger={ledger}
              contracts={ledger.contracts.filter((contract) =>
                contractAppliesToWork(contract, work.id),
              )}
              workId={work.id}
              allowCreate={false}
            />
          ) : null}
          <section className="panel">
            <div className="section-heading">
              <h2>
                {t(tab === "all" ? "এই খাতার লেনদেন" : "সাম্প্রতিক হিসাব")}
              </h2>
              <button className="text-button" onClick={() => go(historyPath)}>
                {t(
                  tab === "transport" || tab === "other"
                    ? "এই খাতার সব লেনদেন"
                    : "পুরো হিসাব",
                )}
                <ArrowRightIcon size={15} />
              </button>
            </div>
            <EntryList
              ledger={ledger}
              entries={entries}
              showKind
              workId={work.id}
              amounts={amounts}
              titles={titles}
              hideWork
              onEntry={detail}
            />
          </section>
        </>
      )}
    </div>
  );
}
