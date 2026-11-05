import { useId, useMemo, useState } from "react";
import { cashSummary } from "../../domain/cashSummary";
import { CashReport } from "./CashReport";
import { reportMode } from "./reportMode";
import { useSearchParams } from "react-router";
import {
  ArrowRightIcon,
  CalendarDotsIcon,
  DownloadSimpleIcon,
  FunnelSimpleIcon,
  MagnifyingGlassIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { Account, CostType, Ledger } from "../../domain/model";
import { useLanguageContext } from "../../context/LanguageProvider";
import { AppSelect } from "../../components/ui/AppSelect";
import { AppDatePicker } from "../../components/ui/AppDatePicker";
import { EntryList } from "../../components/ui/EntryList";
import { SpendingSeriesChart } from "../../components/ui/SpendingChart";
import { useComposedSearch } from "../../lib/useComposedSearch";
import { Sheet } from "../../components/Sheet";
import {
  accountNames,
  costNames,
  saveFile,
  todayDhaka,
} from "../../lib/display";
import { validHistoryDate } from "../history/history";
import { reportAdjustments } from "./reportAdjustments";
import {
  analyticsCsv,
  breakdownRows,
  buildCostReportIndex,
  emptyFilters,
  filterCostRows,
  matchingEntries,
  summarizeRows,
  selectCostReport,
  reportSection,
  sectionRows,
  type AnalyticsDimension,
  type AnalyticsFilters,
  type ReportSection,
} from "./analytics";
import "./analytics.css";
export type AnalyticsPageProps = {
  ledger: Ledger;
  onEntry?: (id: string) => void;
  initialGroupId?: string;
};
export function AnalyticsPage(props: AnalyticsPageProps) {
  const [params] = useSearchParams();
  return reportMode(params, props.initialGroupId) === "cost" ? (
    <CostAnalyticsPage {...props} />
  ) : (
    <CashReport {...props} />
  );
}
const queryKeys: Record<keyof AnalyticsFilters, string> = {
  groupId: "group",
  itemId: "item",
  brand: "brand",
  usage: "usage",
  workId: "work",
  costType: "type",
  personId: "person",
  from: "from",
  to: "to",
  query: "q",
  review: "review",
  dates: "dates",
};
export function filtersFromSearch(
  params: URLSearchParams,
  initialGroupId = "",
): AnalyticsFilters {
  const next = { ...emptyFilters };
  for (const [field, key] of Object.entries(queryKeys))
    if (params.has(key))
      (next as Record<string, string>)[field] = (params.get(key) ?? "").slice(
        0,
        field === "query" ? 300 : 200,
      );
  if (!params.has("group")) next.groupId = initialGroupId;
  if (!["all", "needs_review", "confirmed"].includes(next.review))
    next.review = "all";
  if (!["all", "known", "unknown"].includes(next.dates)) next.dates = "all";
  if (next.costType && !(next.costType in costNames)) next.costType = "";
  next.from = validHistoryDate(next.from);
  next.to = validHistoryDate(next.to);
  return next;
}
const sections: { id: ReportSection; label: string }[] = [
  { id: "material", label: "মালামাল" },
  { id: "labour", label: "মজুরি" },
  { id: "transport", label: "আনা ও নামানো" },
  { id: "other", label: "অন্য খরচ" },
];
const dimensions: { id: AnalyticsDimension; label: string }[] = [
  { id: "group", label: "মাল অনুযায়ী" },
  { id: "work", label: "কাজ অনুযায়ী" },
  { id: "person", label: "ব্যক্তি বা দোকান অনুযায়ী" },
  { id: "brand", label: "ব্র্যান্ড অনুযায়ী" },
  { id: "usage", label: "ব্যবহার অনুযায়ী" },
  { id: "item", label: "মালের নাম অনুযায়ী" },
];
function CostAnalyticsPage({
  ledger,
  onEntry,
  initialGroupId,
}: AnalyticsPageProps) {
  const { t, money, date, formatDigits } = useLanguageContext();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(
    () => filtersFromSearch(params, initialGroupId),
    [params, initialGroupId],
  );
  const section = reportSection(params.get("section"), filters.costType);
  const [filterOpen, setFilterOpen] = useState(false);
  const [limit, setLimit] = useState(20);
  const month = params.get("month") ?? "";
  const [chartOpen, setChartOpen] = useState(Boolean(month));
  const chartId = useId();
  const searchInput = useComposedSearch(filters.query, (value) =>
    update({ query: value }),
  );
  const rawAccount = params.get("account");
  const account = ["materials", "labour", "other"].includes(rawAccount ?? "")
    ? (rawAccount as Account)
    : null;
  const sectionAccount =
    section === "material"
      ? "materials"
      : section === "labour"
        ? "labour"
        : null;
  const cashAccount = account ?? sectionAccount;
  const reportIndex = useMemo(() => {
    try {
      return buildCostReportIndex(ledger);
    } catch {
      return null;
    }
  }, [ledger]);
  const allRows = useMemo(() => {
    if (!reportIndex) return [];
    if (!account) return reportIndex.rows;
    const entryIds = new Set(
      reportIndex.search.documents
        .filter((document) => document.account === account)
        .map((document) => document.entry.id),
    );
    return reportIndex.rows.filter((row) => entryIds.has(row.entry.id));
  }, [reportIndex, account]);
  const hasMaterialGroups = allRows.some(
    (row) => row.line.costType === "material" && row.groupId,
  );
  const visibleDimensions = dimensions.filter(
    (d) =>
      section === "all" ||
      section === "material" ||
      d.id === "work" ||
      d.id === "person",
  );
  const dimension: AnalyticsDimension = visibleDimensions.some(
    (d) => d.id === params.get("by"),
  )
    ? (params.get("by") as AnalyticsDimension)
    : initialGroupId || section !== "material"
      ? "work"
      : hasMaterialGroups
        ? "group"
        : "item";
  const selectedSection = useMemo(
    () => sectionRows(allRows, section),
    [allRows, section],
  );
  const derived = useMemo(() => {
    if (!reportIndex) return null;
    try {
      const report = selectCostReport(reportIndex, filters, {
        section,
        account: account ?? undefined,
        month,
      });
      const groupScope = filterCostRows(selectedSection, {
        groupId: filters.groupId,
      });
      return {
        report,
        rows: report.rows,
        totals: summarizeRows(report.rows),
        breakdown: breakdownRows(report.rows, dimension),
        matches: matchingEntries(report.rows),
        groupScope,
        availableItems: breakdownRows(groupScope, "item"),
      };
    } catch {
      return null;
    }
  }, [
    reportIndex,
    filters,
    section,
    account,
    month,
    dimension,
    selectedSection,
  ]);
  // Corrections have account/work scope, not individual line classifications.
  const completeCorrectionScope =
    (section === "all" || sectionAccount !== null) &&
    (!account || !sectionAccount || account === sectionAccount) &&
    !filters.groupId &&
    !filters.itemId &&
    !filters.brand &&
    !filters.usage &&
    !filters.costType &&
    !filters.query &&
    !month &&
    filters.review === "all" &&
    filters.dates === "all";
  const financialScope = {
    workId: filters.workId,
    personId: filters.personId,
    account: account ?? sectionAccount ?? undefined,
    from: filters.from,
    to: filters.to,
  };
  const corrections = completeCorrectionScope
    ? reportAdjustments(ledger, financialScope)
    : null;
  const costCorrection = corrections?.costCorrection ?? 0;
  const labourPayments =
    section === "labour" && completeCorrectionScope
      ? cashSummary(ledger, {
          ...financialScope,
          personId:
            filters.personId === "__unknown__"
              ? "__anonymous__"
              : filters.personId,
        })
      : null;
  const entries = useMemo(
    () =>
      [...(derived?.report.search.entries ?? [])].sort(
        (a, b) =>
          (b.date ?? "").localeCompare(a.date ?? "") ||
          b.createdAt.localeCompare(a.createdAt),
      ),
    [derived],
  );
  if (!derived)
    return (
      <div className="report-page">
        <header className="page-heading">
          <h1>{t("মাল ও কাজের দাম")}</h1>
        </header>
        <p role="status">{t("টাকার অঙ্ক বেশি হয়েছে।")}</p>
      </div>
    );
  const {
    report,
    rows,
    totals,
    breakdown,
    matches,
    groupScope,
    availableItems,
  } = derived;
  const brands = [
    ...new Set(groupScope.map((row) => row.brand).filter(Boolean)),
  ].sort();
  const usages = [
    ...new Set(groupScope.map((row) => row.usage).filter(Boolean)),
  ].sort();
  const group = ledger.materialGroups.find((g) => g.id === filters.groupId);
  const person = ledger.people.find((p) => p.id === filters.personId);
  const relevantPeople = ledger.people.filter(
    (person) =>
      person.id === filters.personId ||
      selectedSection.some((row) => row.entry.personId === person.id),
  );
  const work = ledger.works.find((w) => w.id === filters.workId);
  const cashPeriod = (() => {
    if (month === "undated" || report.search.monthInvalid) return null;
    let from = filters.from,
      to = filters.to;
    if (month) {
      const start = `${month}-01`;
      const endDate = new Date(`${start}T00:00:00.000Z`);
      endDate.setUTCMonth(endDate.getUTCMonth() + 1, 0);
      const end = endDate.toISOString().slice(0, 10);
      from = from && from > start ? from : start;
      to = to && to < end ? to : end;
    }
    return from && to && from > to ? null : { from, to };
  })();
  function showPayments() {
    if (!cashPeriod) return;
    const next = new URLSearchParams({ mode: "cash" });
    for (const key of ["work", "person", "q"])
      if (params.get(key)) next.set(key, params.get(key)!);
    if (cashPeriod.from) next.set("from", cashPeriod.from);
    if (cashPeriod.to) next.set("to", cashPeriod.to);
    const latestQuery = searchInput.getCommittedQuery();
    if (latestQuery) next.set("q", latestQuery);
    else next.delete("q");
    if (next.get("person") === "__unknown__")
      next.set("person", "__anonymous__");
    if (cashAccount) next.set("account", cashAccount);
    setParams(next);
  }
  function scopedParams() {
    const next = new URLSearchParams(params);
    const query = searchInput.getCommittedQuery();
    if (query) next.set("q", query);
    else next.delete("q");
    return next;
  }
  function update(
    change: Partial<AnalyticsFilters>,
    reset = false,
    by?: AnalyticsDimension,
  ) {
    if (reset) searchInput.clear();
    const next = reset
      ? { ...emptyFilters, ...change }
      : { ...filters, query: searchInput.getCommittedQuery(), ...change };
    if (change.groupId !== undefined && change.groupId !== filters.groupId) {
      next.itemId = "";
      next.brand = "";
      next.usage = "";
    }
    const search = scopedParams();
    search.delete("month");
    if (by) search.set("by", by);
    if (reset) search.set("section", section);
    for (const [field, key] of Object.entries(queryKeys)) {
      const value = (next as Record<string, string>)[field];
      if (value && value !== (emptyFilters as Record<string, string>)[field])
        search.set(key, value);
      else search.delete(key);
    }
    if (initialGroupId && !next.groupId) search.set("group", "");
    setParams(search, { replace: true });
    setLimit(20);
  }
  function chooseSection(id: ReportSection) {
    const next = scopedParams();
    next.delete("month");
    next.set("section", id);
    if (id !== "all") next.delete("account");
    ["type", "item", "brand", "usage", "by"].forEach((key) => next.delete(key));
    setParams(next, { replace: true });
    setLimit(20);
  }
  function chooseBreakdown(id: string) {
    const fields: Record<AnalyticsDimension, keyof AnalyticsFilters> = {
      group: "groupId",
      item: "itemId",
      work: "workId",
      brand: "brand",
      usage: "usage",
      costType: "costType",
      person: "personId",
    };
    update(
      { [fields[dimension]]: id },
      false,
      dimension === "group" ? "work" : undefined,
    );
  }
  function chooseMonth(value: string) {
    const next = scopedParams();
    if (value) next.set("month", value);
    else next.delete("month");
    setParams(next, { replace: true, preventScrollReset: true });
    setLimit(20);
  }
  const filterChips: { label: string; field: keyof AnalyticsFilters }[] = [];
  if (filters.groupId)
    filterChips.push({
      label: group?.name ?? t("মালের নাম দেওয়া নেই"),
      field: "groupId",
    });
  if (filters.workId)
    filterChips.push({ label: work?.name ?? filters.workId, field: "workId" });
  if (filters.personId)
    filterChips.push({
      label: person?.name ?? t("নাম দেওয়া নেই"),
      field: "personId",
    });
  if (filters.brand)
    filterChips.push({
      label:
        filters.brand === "__unknown__"
          ? t("ব্র্যান্ড দেওয়া নেই")
          : filters.brand,
      field: "brand",
    });
  if (filters.usage)
    filterChips.push({
      label:
        filters.usage === "__unknown__" ? t("ব্যবহার লেখা নেই") : filters.usage,
      field: "usage",
    });
  if (filters.itemId)
    filterChips.push({
      label:
        availableItems.find((i) => i.id === filters.itemId)?.label ??
        t("একটি মাল বাছা আছে"),
      field: "itemId",
    });
  if (filters.costType)
    filterChips.push({
      label: t(costNames[filters.costType as CostType]),
      field: "costType",
    });
  if (filters.from)
    filterChips.push({
      label: t("{{date}} থেকে", { date: date(filters.from) }),
      field: "from",
    });
  if (filters.to)
    filterChips.push({
      label: t("{{date}} পর্যন্ত", { date: date(filters.to) }),
      field: "to",
    });
  const heading =
    group && (section === "all" || section === "material")
      ? t("{{name}} — কোথায় কত", { name: group.name })
      : section === "all"
        ? t("মাল ও কাজের দাম")
        : section === "material"
          ? group
            ? t("{{name}} — কোথায় কত", { name: group.name })
            : t("মালের খরচ")
          : section === "labour"
            ? t("মজুরির বিল")
            : section === "transport"
              ? t("আনা ও নামানোর খরচ")
              : t("অন্য খরচ");
  const scopeLabel = [
    work?.name ?? t("সব কাজ মিলিয়ে"),
    account ? t(accountNames[account as keyof typeof accountNames]) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const max = Math.max(1, ...breakdown.map((row) => Math.abs(row.amount)));
  const amounts = Object.fromEntries(
    matches.map((match) => [match.entry.id, match.amount]),
  );
  const titles = Object.fromEntries(
    matches.map((match) => [
      match.entry.id,
      match.lines
        .map((row) => row.line.label || row.itemName)
        .filter(Boolean)
        .join(" + "),
    ]),
  );
  const selectedByEntry = new Map(
    matches.map((match) => [match.entry.id, match]),
  );
  const partial = new Set(report.search.matchedPartEntryIds);
  const subtitles = Object.fromEntries(
    entries.map((entry) => {
      const match = selectedByEntry.get(entry.id);
      return [
        entry.id,
        [
          !match
            ? t("খোঁজে মিলেছে · মোটে ধরা হয়নি")
            : partial.has(entry.id)
              ? t("মেলা অংশ")
              : "",
          ...new Set(match?.lines.map((row) => row.workName) ?? []),
        ]
          .filter(Boolean)
          .join(" · "),
      ];
    }),
  );
  const selectCostTypes =
    section === "all"
      ? Object.keys(costNames)
      : section === "material"
        ? ["material"]
        : section === "labour"
          ? ["labour"]
          : section === "transport"
            ? ["transport", "unload"]
            : ["rental", "other"];
  return (
    <div className="report-page report-basis-expense">
      <header className="page-heading">
        <div>
          <h1>{t("মাল ও কাজের দাম")}</h1>
          <p>
            {t("বিলের দাম থেকে মাল ফেরত বাদ আছে। টাকা দেওয়া আবার যোগ হয় না।")}
          </p>
        </div>
        <button
          className="report-download icon-button"
          aria-label={t("এই হিসাব নামান")}
          disabled={!rows.length}
          onClick={() =>
            saveFile(
              analyticsCsv(rows, t),
              `bari-report-${todayDhaka()}.csv`,
              "text/csv;charset=utf-8",
            )
          }
        >
          <DownloadSimpleIcon size={21} />
        </button>
      </header>
      {!labourPayments && cashPeriod ? (
        <button className="text-button" onClick={showPayments}>
          {t(
            cashAccount === "other"
              ? "অন্য খাতে দেওয়া টাকার হিসাব দেখি"
              : cashAccount
                ? "টাকা দেওয়ার হিসাব দেখি"
                : "সব ধরনের টাকা দেওয়ার হিসাব দেখি",
          )}
          <ArrowRightIcon size={16} />
        </button>
      ) : null}
      <div
        className="report-section-tabs"
        role="tablist"
        aria-label={t("খরচের খাত")}
      >
        {[{ id: "all" as const, label: "সব দাম" }, ...sections].map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={section === item.id}
            className={section === item.id ? "active" : ""}
            onClick={() => chooseSection(item.id)}
          >
            {t(item.label)}
          </button>
        ))}
      </div>
      <section className="history-toolbar">
        <label className="history-search">
          <MagnifyingGlassIcon size={21} />
          <input
            aria-label={t("রিপোর্টে খুঁজুন")}
            placeholder={t(
              section === "labour"
                ? "মিস্ত্রি বা কাজ খুঁজুন"
                : "মাল, দোকান বা খাতা খুঁজুন",
            )}
            maxLength={300}
            {...searchInput.inputProps}
          />
          {searchInput.value ? (
            <button
              className="history-clear"
              aria-label={t("খোঁজ মুছুন")}
              type="button"
              onClick={searchInput.clear}
            >
              <XIcon size={17} />
            </button>
          ) : null}
        </label>
        <button
          className={`history-filter-button ${filterChips.length ? "has-filter" : ""}`}
          onClick={() => setFilterOpen(true)}
          aria-label={t("হিসাব বেছে দেখুন")}
        >
          <FunnelSimpleIcon size={21} />
          <span>{t("বেছে দেখুন")}</span>
        </button>
      </section>
      {filterChips.length ? (
        <div className="report-filter-chips">
          {filterChips.map((chip) => (
            <button
              key={chip.field}
              onClick={() => update({ [chip.field]: "" })}
            >
              {formatDigits(chip.label)}
              <XIcon size={13} />
            </button>
          ))}
          <button className="report-clear-all" onClick={() => update({}, true)}>
            {t("সব বাছাই মুছুন")}
          </button>
        </div>
      ) : null}
      <section className="report-total">
        <span>{heading}</span>
        <strong>{money(totals.total)}</strong>
        {costCorrection !== 0 ? (
          <p>
            {t("সমন্বয়")} · {t("মোট খরচ")}: {money(costCorrection)}
          </p>
        ) : null}
        <small>
          {formatDigits(scopeLabel)}
          {section === "material" ? ` · ${t("মালের দাম")}` : ""}
        </small>
        {totals.returns ? (
          <p>
            {t("মাল ফেরতের {{amount}} বাদ দেওয়া হয়েছে।", {
              amount: money(totals.returns),
            })}
          </p>
        ) : null}
        <div className="report-month-controls">
          {report.search.monthlyRows.length ? (
            <button
              type="button"
              className="text-button"
              aria-expanded={chartOpen}
              aria-controls={chartId}
              onClick={() => setChartOpen((value) => !value)}
            >
              <CalendarDotsIcon size={17} aria-hidden="true" />
              {t("মাসে মাসে")}
            </button>
          ) : null}
          {month ? (
            <>
              <span>
                {month === "undated"
                  ? t("তারিখ লেখা নেই")
                  : report.search.monthInvalid
                    ? t("বাছাইটি পাওয়া যায়নি। আবার বেছে নিন।")
                    : date(`${month}-01`, {
                        day: undefined,
                        month: "long",
                        year: "numeric",
                      })}
              </span>
              <button
                type="button"
                className="text-button"
                onClick={() => chooseMonth("")}
              >
                {t("সব মাস দেখুন")}
              </button>
            </>
          ) : null}
        </div>
        {chartOpen && report.search.monthlyRows.length ? (
          <div id={chartId} className="report-cost-chart">
            <SpendingSeriesChart
              key={JSON.stringify([filters, section, account])}
              rows={report.search.monthlyRows}
              selectedMonth={month}
              onMonthChange={chooseMonth}
              presentation="embedded"
              windowed
            />
          </div>
        ) : null}
        {report.search.baseUndatedEntryCount > 0 ? (
          <button
            type="button"
            className="report-undated"
            aria-pressed={month === "undated"}
            onClick={() => chooseMonth(month === "undated" ? "" : "undated")}
          >
            <span>{t("তারিখ লেখা নেই")}</span>
            <strong>{money(report.search.baseUndatedCost)}</strong>
          </button>
        ) : null}
        {report.search.groupAmbiguousEntryIds.length ? (
          <p role="status">
            {t(
              "কিছু লেখায় একাধিক মালের নাম বা ধরন মিলেছে। অস্পষ্ট অংশ এই মালের মোটে ধরা হয়নি।",
            )}
          </p>
        ) : null}
        {report.search.partiallyAmbiguousEntryIds.length ? (
          <p role="status">
            {t(
              "কিছু ফেরতের মালের পরিচয় মেলেনি। শুধু নিশ্চিত অংশ মোটে ধরা হয়েছে।",
            )}
          </p>
        ) : null}
        {report.search.ambiguousEntryIds.some(
          (id) => !report.search.groupAmbiguousEntryIds.includes(id),
        ) ? (
          <p role="status">
            {t(
              "কিছু হিসাব শুধু অন্য তথ্যে মিলেছে। সেগুলো খরচের মোটে ধরা হয়নি।",
            )}
          </p>
        ) : null}
        {labourPayments ? (
          <div className="report-paid-summary">
            <button
              type="button"
              onClick={showPayments}
              aria-label={t("টাকা দেওয়ার হিসাব দেখি")}
            >
              <span>{t("মোট দিয়েছি")}</span>
              <strong>{money(labourPayments.netPaid)}</strong>
              <ArrowRightIcon size={18} aria-hidden="true" />
            </button>
            {labourPayments.refunds > 0 ? (
              <small>
                {t("ফেরত পাওয়া {{amount}} বাদ দিয়ে", {
                  amount: money(labourPayments.refunds),
                })}
              </small>
            ) : null}
            {corrections?.paidCorrection ? (
              <small>
                {t("সমন্বয়")} · {t("মোট দিয়েছি")}:{" "}
                {money(corrections.paidCorrection)}
              </small>
            ) : null}
          </div>
        ) : null}
      </section>
      <section className="report-breakdown">
        <div className="report-breakdown-heading">
          <h2>{t("কোথায় কত গেল")}</h2>
          <AppSelect
            aria-label={t("হিসাব কীভাবে দেখাব")}
            value={dimension}
            onChange={(e) => {
              const next = scopedParams();
              next.set("by", e.target.value);
              setParams(next, { replace: true });
            }}
          >
            {visibleDimensions.map((d) => (
              <option key={d.id} value={d.id}>
                {t(d.label)}
              </option>
            ))}
          </AppSelect>
        </div>
        {breakdown.length ? (
          <div className="report-breakdown-list">
            {breakdown.map((row) => (
              <button key={row.id} onClick={() => chooseBreakdown(row.id)}>
                <span className="report-breakdown-label">
                  <strong>{t(row.label)}</strong>
                  <span className="report-mini-track">
                    <i
                      style={{
                        width: `${Math.max(1, (Math.abs(row.amount) / max) * 100)}%`,
                      }}
                    />
                  </span>
                </span>
                <strong>{money(row.amount)}</strong>
                <ArrowRightIcon size={17} />
              </button>
            ))}
          </div>
        ) : (
          <p className="report-no-results">
            {t(
              section === "labour"
                ? "এই বাছাইয়ে মজুরির বিল নেই।"
                : "এই বাছাইয়ে কোনো খরচ নেই।",
            )}
          </p>
        )}
      </section>
      <section className="report-history">
        <div className="report-history-heading">
          <h2>{t("এই খরচের লেনদেন")}</h2>
          <span>{t("চাপলে পুরো হিসাব দেখবেন")}</span>
        </div>
        <EntryList
          ledger={ledger}
          entries={entries.slice(0, limit)}
          onEntry={(id) => onEntry?.(id)}
          amounts={amounts}
          titles={titles}
          subtitles={subtitles}
          grouped
        />
        {entries.length > limit ? (
          <button
            className="history-load-more"
            onClick={() => setLimit(limit + 30)}
          >
            {t("আরও হিসাব দেখুন")}
          </button>
        ) : null}
      </section>
      {totals.historicalCount ? (
        <p className="report-old-note">
          {t(
            "পুরোনো খাতার লেখা এই খরচে আছে। কার কত বাকি, তা আলাদা করে যাচাই করতে হবে।",
          )}
        </p>
      ) : null}
      {filterOpen ? (
        <Sheet
          title={t("কোন খরচ দেখবেন?")}
          subtitle={t("মাল, কাজ বা দোকান বেছে খুঁজুন।")}
          onClose={() => setFilterOpen(false)}
          footer={
            <div className="history-filter-footer">
              <button className="text-button" onClick={() => update({}, true)}>
                {t("সব বাছাই মুছুন")}
              </button>
              <button
                className="primary-button"
                onClick={() => setFilterOpen(false)}
              >
                {t("হিসাব দেখুন")}
              </button>
            </div>
          }
        >
          <div className="history-filter-form">
            <label>
              {t("খাতা")}
              <AppSelect
                value={filters.workId}
                onChange={(e) => update({ workId: e.target.value })}
              >
                <option value="">{t("সব খাতা")}</option>
                {ledger.works.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </AppSelect>
            </label>
            <label>
              {t(section === "labour" ? "মিস্ত্রি" : "ব্যক্তি বা দোকান")}
              <AppSelect
                value={filters.personId}
                onChange={(e) => update({ personId: e.target.value })}
              >
                <option value="">{t("সবাই")}</option>
                {relevantPeople.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </AppSelect>
            </label>
            <label>
              {t("কোন মাল")}
              <AppSelect
                value={filters.groupId}
                onChange={(e) => update({ groupId: e.target.value })}
              >
                <option value="">{t("সব মাল")}</option>
                {ledger.materialGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
                <option value="__unknown__">{t("মালের নাম দেওয়া নেই")}</option>
              </AppSelect>
            </label>
            {section === "all" || section === "material" ? (
              <>
                <label>
                  {t("মালের নাম")}
                  <AppSelect
                    value={filters.itemId}
                    onChange={(e) => update({ itemId: e.target.value })}
                  >
                    <option value="">{t("সব মাল")}</option>
                    {availableItems.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.label}
                      </option>
                    ))}
                  </AppSelect>
                </label>
                <div className="field-grid">
                  <label>
                    {t("ব্র্যান্ড")}
                    <AppSelect
                      value={filters.brand}
                      onChange={(e) => update({ brand: e.target.value })}
                    >
                      <option value="">{t("সব ব্র্যান্ড")}</option>
                      {brands.map((brand) => (
                        <option key={brand} value={brand}>
                          {brand}
                        </option>
                      ))}
                    </AppSelect>
                  </label>
                  <label>
                    {t("কোথায় ব্যবহার")}
                    <AppSelect
                      value={filters.usage}
                      onChange={(e) => update({ usage: e.target.value })}
                    >
                      <option value="">{t("সব ব্যবহার")}</option>
                      {usages.map((usage) => (
                        <option key={usage} value={usage}>
                          {usage}
                        </option>
                      ))}
                    </AppSelect>
                  </label>
                </div>
              </>
            ) : null}
            {selectCostTypes.length > 1 ? (
              <label>
                {t("খরচের ধরন")}
                <AppSelect
                  value={filters.costType}
                  onChange={(e) => update({ costType: e.target.value })}
                >
                  <option value="">{t("এই খাতের সব খরচ")}</option>
                  {selectCostTypes.map((type) => (
                    <option key={type} value={type}>
                      {t(costNames[type as CostType])}
                    </option>
                  ))}
                </AppSelect>
              </label>
            ) : null}
            <div className="field-grid">
              <label>
                {t("কবে থেকে")}
                <AppDatePicker
                  value={filters.from}
                  max={filters.to || undefined}
                  onChange={(e) => update({ from: e.target.value })}
                />
              </label>
              <label>
                {t("কবে পর্যন্ত")}
                <AppDatePicker
                  value={filters.to}
                  min={filters.from || undefined}
                  onChange={(e) => update({ to: e.target.value })}
                />
              </label>
            </div>
            <details className="report-extra-filters">
              <summary>{t("আরও বাছাই")}</summary>
              <label>
                {t("তথ্য ঠিক করা হয়েছে?")}
                <AppSelect
                  value={filters.review}
                  onChange={(e) =>
                    update({
                      review: e.target.value as AnalyticsFilters["review"],
                    })
                  }
                >
                  <option value="all">{t("সব হিসাব")}</option>
                  <option value="needs_review">{t("দেখে নেওয়া বাকি")}</option>
                  <option value="confirmed">{t("দেখে নিয়েছি")}</option>
                </AppSelect>
              </label>
              <label>
                {t("তারিখের তথ্য")}
                <AppSelect
                  value={filters.dates}
                  onChange={(e) =>
                    update({
                      dates: e.target.value as AnalyticsFilters["dates"],
                    })
                  }
                >
                  <option value="all">{t("সব হিসাব")}</option>
                  <option value="known">{t("তারিখ দেওয়া আছে")}</option>
                  <option value="unknown">{t("তারিখ দেওয়া নেই")}</option>
                </AppSelect>
              </label>
            </details>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}
