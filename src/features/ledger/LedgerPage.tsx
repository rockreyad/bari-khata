import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  FunnelSimpleIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { useComposedSearch } from "../../lib/useComposedSearch";
import { EntryList } from "../../components/ui/EntryList";
import { LoadMore } from "../../components/ui/LoadMore";
import { AppSelect } from "../../components/ui/AppSelect";
import { AppDatePicker } from "../../components/ui/AppDatePicker";
import { Sheet } from "../../components/Sheet";
import {
  historyGroups,
  historySubtitle,
  sortHistory,
  validHistoryDate,
  type HistoryOrder,
} from "../history/history";
import "../history/history.css";
import "../history/history-v4.css";
import { historyGroupPage } from "../history/page";
import { pendingReviewEntries } from "../import/bulkReview";
import {
  buildLedgerSearchIndex,
  materialSuggestions,
  selectLedgerSearch,
  type MaterialChoice,
} from "./searchAnalytics";
import { LedgerSearchSummary } from "./LedgerSearchSummary";
function materialChoiceKind(choice: MaterialChoice) {
  return choice.token.startsWith("group:")
    ? "মালের ধরন"
    : choice.token.startsWith("item:")
      ? "নির্দিষ্ট মাল"
      : "আগের নাম";
}
export function LedgerPage() {
  const { ledger, add, detail, go } = useNotebook();
  const { t, number, formatDigits } = useLanguageContext();
  const [params, setParams] = useSearchParams();
  const [filterOpen, setFilterOpen] = useState(false);
  const page = Number(params.get("page") ?? "1");
  const reviewCount = useMemo(
    () => pendingReviewEntries(ledger).length,
    [ledger],
  );
  const q = params.get("q") ?? "",
    person = params.get("person") ?? "",
    work = params.get("work") ?? "",
    kind = params.get("kind") ?? "",
    account = params.get("account") ?? "",
    costType = params.get("type") ?? "",
    from = validHistoryDate(params.get("from") ?? ""),
    to = validHistoryDate(params.get("to") ?? "");
  const material = params.get("material") ?? "";
  const month = params.get("month") ?? "";
  const order: HistoryOrder =
    params.get("order") === "oldest" ? "oldest" : "newest";
  const includeVoided = params.get("voided") === "yes";
  const index = useMemo(() => {
    try {
      return buildLedgerSearchIndex(ledger);
    } catch {
      return null;
    }
  }, [ledger]);
  const selection = useMemo(() => {
    if (!index) return null;
    try {
      return selectLedgerSearch(index, {
        query: q,
        personId: person,
        workId: work,
        kind,
        account,
        costType,
        from,
        to,
        includeVoided,
        material,
        month,
      });
    } catch {
      return null;
    }
  }, [
    index,
    q,
    person,
    work,
    kind,
    account,
    costType,
    from,
    to,
    includeVoided,
    material,
    month,
  ]);
  const groups = useMemo(
    () => historyGroups(sortHistory(selection?.entries ?? [], order)),
    [selection, order],
  );
  const result = useMemo(() => historyGroupPage(groups, page), [groups, page]);
  const suggestions = useMemo(
    () => (index && !material ? materialSuggestions(index, q, 4) : []),
    [index, material, q],
  );
  const update = (key: string, value: string): void => {
    setParams(
      (prev) => {
        const next =
          key === "q" ? new URLSearchParams(prev) : currentParams(prev);
        next.delete("page");
        if (key === "q") {
          next.delete("material");
          next.delete("month");
        }
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true, preventScrollReset: key === "q" },
    );
  };
  const search = useComposedSearch(q, (value) => update("q", value));
  const searchInput = search.inputProps.ref;
  const focusSearch = params.get("focus") === "search";
  useEffect(() => {
    if (focusSearch) searchInput.current?.focus({ preventScroll: true });
  }, [focusSearch, searchInput]);
  const currentParams = (previous: URLSearchParams): URLSearchParams => {
    const next = new URLSearchParams(previous);
    const latestQuery = search.getCommittedQuery();
    if (latestQuery !== (previous.get("q") ?? "")) {
      next.delete("page");
      next.delete("material");
      next.delete("month");
    }
    if (latestQuery) next.set("q", latestQuery);
    else next.delete("q");
    return next;
  };
  const contact = ledger.people.find((p) => p.id === person),
    selectedWork = ledger.works.find((w) => w.id === work);
  const filtered = Boolean(
    person ||
    work ||
    kind ||
    account ||
    costType ||
    from ||
    to ||
    includeVoided ||
    material ||
    month,
  );
  const showAnalytics = Boolean(q.trim() || filtered || !index);
  const subtitles = useMemo(() => {
    if (!selection || !showAnalytics) return undefined;
    const partial = new Set(selection.matchedPartEntryIds);
    const ambiguous = new Set(selection.ambiguousEntryIds);
    const overrides: Record<string, string> = Object.create(null);
    for (const entry of result.rows) {
      if (!partial.has(entry.id) && !ambiguous.has(entry.id)) continue;
      const context = historySubtitle(ledger, entry, {
        hidePerson: Boolean(person),
        hideWork: Boolean(work),
        translate: t,
      });
      overrides[entry.id] = [
        t(
          ambiguous.has(entry.id) ? "খোঁজে মিলেছে · মোটে ধরা হয়নি" : "মেলা অংশ",
        ),
        context,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    return overrides;
  }, [selection, result.rows, showAnalytics, ledger, person, work, t]);
  const chooseMaterial = (choice: MaterialChoice) => {
    search.clear();
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("material", choice.token);
        next.delete("q");
        next.delete("month");
        next.delete("page");
        return next;
      },
      { preventScrollReset: true },
    );
  };
  const chooseMonth = (value: string) =>
    setParams(
      (previous) => {
        const next = currentParams(previous);
        if (value) next.set("month", value);
        else next.delete("month");
        next.delete("page");
        return next;
      },
      { preventScrollReset: true },
    );
  const clear = () => {
    setParams(
      (prev) => {
        const next = currentParams(prev);
        [
          "page",
          "person",
          "work",
          "kind",
          "account",
          "type",
          "from",
          "to",
          "voided",
          "material",
          "month",
        ].forEach((key) => next.delete(key));
        return next;
      },
      { replace: true },
    );
  };
  const loadMore = () => {
    setParams(
      (previous) => {
        const next = currentParams(previous);
        if (search.getCommittedQuery() === q)
          next.set("page", String(result.page + 1));
        else next.delete("page");
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  };
  return (
    <div className="page-flow history-page">
      <header className="page-heading">
        <div>
          <h1>
            {contact
              ? t("{{name}}-এর সব হিসাব", { name: contact.name })
              : t("আগের হিসাব")}
          </h1>
          <p>
            {contact
              ? t("প্রথম লেনদেন থেকে আজ পর্যন্ত।")
              : t("নাম, মাল বা খাতার নাম লিখে খুঁজুন।")}
          </p>
        </div>
        <button className="primary-button" onClick={() => add()}>
          <PlusIcon size={19} />
          {t("খরচ লিখি")}
        </button>
      </header>
      {reviewCount ? (
        <button className="review-warning-v4" onClick={() => go("/review")}>
          <span>
            {t("{{count}}টি হিসাবের তথ্য দেখা বাকি", {
              count: number(reviewCount),
            })}
          </span>
          <span>{t("একসঙ্গে ঠিক করি")} →</span>
        </button>
      ) : null}
      <section className="history-toolbar">
        <label className="history-search">
          <MagnifyingGlassIcon size={21} />
          <input
            type="search"
            aria-label={t("হিসাব খুঁজুন")}
            placeholder={t(material ? "আরও খুঁজতে লিখুন" : "কী খুঁজছেন?")}
            {...search.inputProps}
          />
          {search.value ? (
            <button
              className="history-clear"
              type="button"
              aria-label={t("খোঁজ মুছুন")}
              onClick={search.clear}
            >
              <XIcon size={17} />
            </button>
          ) : null}
        </label>
        <button
          className={`history-filter-button ${filtered ? "has-filter" : ""}`}
          onClick={() => setFilterOpen(true)}
          aria-label={t("হিসাব বেছে দেখুন")}
        >
          <FunnelSimpleIcon size={21} weight={filtered ? "fill" : "regular"} />
          <span>{t("বেছে দেখুন")}</span>
        </button>
      </section>
      {suggestions.length ? (
        <div
          className="ledger-material-suggestions"
          role="group"
          aria-label={t("মালের হিসাব বেছে দেখুন")}
        >
          <span>{t("মালের হিসাব বেছে দেখুন")}</span>
          {suggestions.map((choice) => (
            <button
              key={choice.token}
              type="button"
              aria-label={t("মালের হিসাব: {{name}}", {
                name: [
                  choice.label,
                  t(materialChoiceKind(choice)),
                  choice.description,
                ]
                  .filter(Boolean)
                  .join(" · "),
              })}
              onClick={() => chooseMaterial(choice)}
            >
              {formatDigits(choice.label)}
              <small>
                {[
                  t(materialChoiceKind(choice)),
                  choice.description ? formatDigits(choice.description) : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </button>
          ))}
        </div>
      ) : null}
      <div className="history-scope">
        <div>
          {material ? (
            <button
              type="button"
              className="history-filter-chip"
              aria-label={t("মালের বাছাই মুছুন")}
              onClick={() => update("material", "")}
            >
              {selection?.material
                ? [
                    formatDigits(selection.material.label),
                    t(materialChoiceKind(selection.material)),
                  ].join(" · ")
                : t("মালের বাছাই")}
              <XIcon size={14} aria-hidden="true" />
            </button>
          ) : null}
          {contact ? (
            <button
              onClick={() => update("person", "")}
              className="history-filter-chip"
            >
              {formatDigits(contact.name)}
              <XIcon size={14} />
            </button>
          ) : null}
          {selectedWork ? (
            <button
              className="history-filter-chip"
              onClick={() => update("work", "")}
            >
              {formatDigits(selectedWork.name)}
              <XIcon size={14} />
            </button>
          ) : null}
          {account ? (
            <button
              className="history-filter-chip"
              onClick={() => update("account", "")}
            >
              {t(
                account === "labour"
                  ? "মজুরি"
                  : account === "materials"
                    ? "মালের হিসাব"
                    : "অন্য হিসাব",
              )}
              <XIcon size={14} />
            </button>
          ) : null}
          {from || to ? (
            <button
              className="history-filter-chip"
              onClick={() =>
                setParams(
                  (previous) => {
                    const next = currentParams(previous);
                    next.delete("page");
                    next.delete("from");
                    next.delete("to");
                    return next;
                  },
                  { replace: true },
                )
              }
            >
              {t("তারিখ বাছা আছে")}
              <XIcon size={14} />
            </button>
          ) : null}
        </div>
        <button
          className="history-order"
          onClick={() =>
            update("order", order === "oldest" ? "newest" : "oldest")
          }
        >
          {order === "oldest" ? (
            <ArrowDownIcon size={16} />
          ) : (
            <ArrowUpIcon size={16} />
          )}
          {t(order === "oldest" ? "শুরু থেকে" : "সাম্প্রতিক আগে")}
        </button>
      </div>
      {showAnalytics ? (
        <LedgerSearchSummary
          key={JSON.stringify([
            q,
            person,
            work,
            kind,
            account,
            costType,
            from,
            to,
            includeVoided,
            material,
          ])}
          result={selection}
          month={month}
          onMonthChange={chooseMonth}
        />
      ) : null}
      <section className="history-surface">
        <EntryList
          showKind
          ledger={ledger}
          entries={result.rows}
          workId={work || undefined}
          onEntry={detail}
          order={order}
          grouped
          hidePerson={Boolean(person)}
          hideWork={Boolean(work)}
          amounts={showAnalytics ? selection?.amounts : undefined}
          titles={showAnalytics ? selection?.titles : undefined}
          subtitles={subtitles}
        />
        <LoadMore hasMore={result.hasMore} onLoadMore={loadMore} />
      </section>
      {filterOpen ? (
        <Sheet
          title={t("কোন হিসাব দেখবেন?")}
          subtitle={t("যতটুকু দরকার, ততটুকু বেছে নিন।")}
          onClose={() => setFilterOpen(false)}
          footer={
            <div className="history-filter-footer">
              <button className="text-button" onClick={clear}>
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
              {t("ব্যক্তি বা দোকান")}
              <AppSelect
                value={person}
                onChange={(e) => update("person", e.target.value)}
              >
                <option value="">{t("সবাই")}</option>
                {ledger.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </AppSelect>
            </label>
            <label>
              {t("খাতা")}
              <AppSelect
                value={work}
                onChange={(e) => update("work", e.target.value)}
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
              {t("হিসাবের খাত")}
              <AppSelect
                value={account}
                onChange={(e) => update("account", e.target.value)}
              >
                <option value="">{t("সব লেনদেন")}</option>
                <option value="materials">{t("মালের হিসাব")}</option>
                <option value="labour">{t("মজুরি")}</option>
                <option value="other">{t("অন্য হিসাব")}</option>
              </AppSelect>
            </label>
            <label>
              {t("কী হয়েছে")}
              <AppSelect
                value={kind}
                onChange={(e) => update("kind", e.target.value)}
              >
                <option value="">{t("সব লেনদেন")}</option>
                <option value="expense">{t("খরচ লিখেছি")}</option>
                <option value="payment">{t("টাকা দিয়েছি")}</option>
                <option value="expense_credit">{t("মাল ফেরত")}</option>
                <option value="refund">{t("টাকা পেয়েছি")}</option>
                <option value="adjustment">{t("হিসাবের সমন্বয়")}</option>
              </AppSelect>
            </label>
            <label>
              {t("খরচের ধরন")}
              <AppSelect
                value={costType}
                onChange={(e) => update("type", e.target.value)}
              >
                <option value="">{t("সব খরচ")}</option>
                <option value="material">{t("মালামাল")}</option>
                <option value="labour">{t("মজুরি")}</option>
                <option value="transport">{t("গাড়িভাড়া")}</option>
                <option value="unload">{t("মাল নামানো")}</option>
                <option value="rental">{t("ভাড়া")}</option>
                <option value="other">{t("অন্যান্য")}</option>
              </AppSelect>
            </label>
            <div className="field-grid">
              <label>
                {t("কবে থেকে")}
                <AppDatePicker
                  value={from}
                  max={to || undefined}
                  onChange={(e) => update("from", e.target.value)}
                />
              </label>
              <label>
                {t("কবে পর্যন্ত")}
                <AppDatePicker
                  value={to}
                  min={from || undefined}
                  onChange={(e) => update("to", e.target.value)}
                />
              </label>
            </div>
            <label className="history-checkbox">
              <input
                type="checkbox"
                checked={includeVoided}
                onChange={(e) =>
                  update("voided", e.target.checked ? "yes" : "")
                }
              />
              <span>{t("বাতিল করা হিসাবও দেখাব")}</span>
            </label>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}
