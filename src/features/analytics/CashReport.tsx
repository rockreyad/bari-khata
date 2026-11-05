import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import {
  ArrowRightIcon,
  DownloadSimpleIcon,
  FunnelSimpleIcon,
  MagnifyingGlassIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import { cashSummary } from "../../domain/cashSummary";
import type { Ledger } from "../../domain/model";
import { cashReportCsv } from "./cashReportCsv";
import { useComposedSearch } from "../../lib/useComposedSearch";
import { AppSelect } from "../../components/ui/AppSelect";
import { AppDatePicker } from "../../components/ui/AppDatePicker";
import { Sheet } from "../../components/Sheet";
import { validHistoryDate } from "../history/history";
import { accountNames, saveFile, todayDhaka } from "../../lib/display";
import { reportAdjustments } from "./reportAdjustments";
import { reportCashAccount } from "./reportMode";

export function CashReport({
  ledger,
}: {
  ledger: Ledger;
  onEntry?: (id: string) => void;
}) {
  const { t, money, formatDigits } = useLanguageContext();
  const [params, setParams] = useSearchParams();
  const [filterOpen, setFilterOpen] = useState(false);
  const workId = params.get("work") ?? "";
  const personId = params.get("person") ?? "";
  const account = reportCashAccount(params);
  const from = validHistoryDate(params.get("from") ?? "");
  const to = validHistoryDate(params.get("to") ?? "");
  const query = (params.get("q") ?? "").slice(0, 300);
  const byPerson = params.get("by") === "person";
  const result = useMemo(
    () => cashSummary(ledger, { workId, personId, account, from, to, query }),
    [ledger, workId, personId, account, from, to, query],
  );
  const search = useComposedSearch(query, (value) => update("q", value));
  const people = new Map(
    ledger.people.map((person) => [person.id, person.name]),
  );
  const corrections = reportAdjustments(ledger, {
    workId,
    personId,
    account,
    from,
    to,
    query,
  });
  const works = new Map(ledger.works.map((work) => [work.id, work.name]));
  const groups = byPerson ? result.byPerson : result.byWork;
  const requestedGroups = Number(params.get("groups") ?? "1");
  const groupPage =
    Number.isSafeInteger(requestedGroups) && requestedGroups > 0
      ? Math.min(requestedGroups, 334)
      : 1;
  const filtered = Boolean(
    workId || personId || account || from || to || query,
  );
  function update(key: string, value: string) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (key !== "q") {
          const latestQuery = search.getCommittedQuery();
          if (latestQuery) next.set("q", latestQuery);
          else next.delete("q");
        }
        next.delete("page");
        next.delete("groups");
        if (key === "account") {
          next.delete("section");
          next.delete("type");
        }
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  }
  function showCosts() {
    const next = new URLSearchParams();
    next.set("mode", "cost");
    for (const key of ["work", "person", "from", "to"])
      if (params.get(key)) next.set(key, params.get(key)!);
    if (account)
      next.set(
        "section",
        account === "materials"
          ? "material"
          : account === "labour"
            ? "labour"
            : "all",
      );
    if (account === "other") next.set("account", "other");
    setParams(next);
  }
  function download() {
    saveFile(
      cashReportCsv(ledger, result.rows, t),
      `bari-payments-${todayDhaka()}.csv`,
      "text/csv;charset=utf-8",
    );
  }
  return (
    <div className="report-page cash-report-page report-basis-paid">
      <header className="page-heading">
        <div>
          <h1>{t("টাকা কোথায় দিলাম")}</h1>
          <p>{t("দেওয়া টাকা আর বিলের দাম আলাদা হিসাব।")}</p>
        </div>
        <button
          className="report-download icon-button"
          aria-label={t("এই হিসাব নামান")}
          disabled={!result.rows.length}
          onClick={download}
        >
          <DownloadSimpleIcon size={21} />
        </button>
      </header>
      <button
        className="secondary-button report-mode-action"
        onClick={showCosts}
      >
        {t("মাল ও কাজের দাম দেখি")}
        <ArrowRightIcon size={17} />
      </button>
      <section className="history-toolbar">
        <label className="history-search">
          <MagnifyingGlassIcon size={21} />
          <input
            aria-label={t("দেওয়া টাকা খুঁজুন")}
            placeholder={t("নাম বা খাতা খুঁজুন")}
            maxLength={300}
            {...search.inputProps}
          />
          {search.value ? (
            <button
              type="button"
              className="history-clear"
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
          <FunnelSimpleIcon size={21} />
          <span>{t("বেছে দেখুন")}</span>
        </button>
      </section>
      <section className="report-total" aria-label={t("মোট টাকা দিয়েছি")}>
        <span>{t("মোট টাকা দিয়েছি")}</span>
        <strong>{money(result.netPaid)}</strong>
        {corrections.paidCorrection !== 0 ? (
          <p>
            {t("সমন্বয়")} · {t("মোট দিয়েছি")}:{" "}
            {money(corrections.paidCorrection)}
          </p>
        ) : null}
        <small>
          {formatDigits(
            works.get(workId) ??
              people.get(personId) ??
              (personId === "__anonymous__"
                ? t("নাম দেওয়া নেই")
                : t("সব কাজ মিলিয়ে")),
          )}
          {account ? ` · ${t(accountNames[account])}` : ""}
        </small>
        {result.refunds > 0 ? (
          <p>
            {t("ফেরত পাওয়া {{amount}} বাদ দিয়ে", {
              amount: money(result.refunds),
            })}
          </p>
        ) : null}
      </section>
      {filtered ? (
        <button
          className="text-button"
          onClick={() => {
            search.clear();
            setParams({});
          }}
        >
          {t("সব বাছাই মুছুন")}
        </button>
      ) : null}
      <section className="report-breakdown">
        <div className="report-breakdown-heading">
          <h2>{t("ভাগ করে দেখি")}</h2>
          <AppSelect
            aria-label={t("হিসাব কীভাবে দেখাব")}
            value={byPerson ? "person" : "work"}
            onChange={(event) => update("by", event.target.value)}
          >
            <option value="work">{t("কাজ অনুযায়ী")}</option>
            <option value="person">{t("কাকে দিয়েছি")}</option>
          </AppSelect>
        </div>
        {groups.length ? (
          <div className="report-breakdown-list">
            {groups.slice(0, groupPage * 30).map((row) => (
              <button
                key={row.id ?? "__anonymous__"}
                onClick={() =>
                  update(
                    byPerson ? "person" : "work",
                    row.id ?? "__anonymous__",
                  )
                }
              >
                <span className="report-breakdown-label">
                  <strong>
                    {formatDigits(
                      (byPerson
                        ? people.get(row.id ?? "")
                        : works.get(row.id ?? "")) ?? t("নাম দেওয়া নেই"),
                    )}
                  </strong>
                </span>
                <strong>{money(row.amount)}</strong>
                <ArrowRightIcon size={17} />
              </button>
            ))}
          </div>
        ) : (
          <p className="report-no-results">
            {t("এখানে টাকা দেওয়ার হিসাব নেই।")}
          </p>
        )}
        {groups.length > groupPage * 30 ? (
          <button
            className="history-load-more"
            onClick={() =>
              setParams(
                (previous) => {
                  const next = new URLSearchParams(previous);
                  next.set("groups", String(groupPage + 1));
                  return next;
                },
                { replace: true, preventScrollReset: true },
              )
            }
          >
            {t("আরও দেখুন")}
          </button>
        ) : null}
      </section>
      {filterOpen ? (
        <Sheet
          title={t("কোন হিসাব দেখবেন?")}
          onClose={() => setFilterOpen(false)}
          footer={
            <button
              className="primary-button"
              onClick={() => setFilterOpen(false)}
            >
              {t("হিসাব দেখুন")}
            </button>
          }
        >
          <div className="history-filter-form">
            <label>
              {t("খাতা")}
              <AppSelect
                value={workId}
                onChange={(event) => update("work", event.target.value)}
              >
                <option value="">{t("সব খাতা")}</option>
                {ledger.works.map((work) => (
                  <option key={work.id} value={work.id}>
                    {formatDigits(work.name)}
                  </option>
                ))}
              </AppSelect>
            </label>
            <label>
              {t("কাকে দিয়েছি")}
              <AppSelect
                value={personId}
                onChange={(event) => update("person", event.target.value)}
              >
                <option value="">{t("সবাই")}</option>
                <option value="__anonymous__">{t("নাম দেওয়া নেই")}</option>
                {ledger.people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {formatDigits(person.name)}
                  </option>
                ))}
              </AppSelect>
            </label>
            <label>
              {t("কিসের টাকা")}
              <AppSelect
                value={account ?? ""}
                onChange={(event) => update("account", event.target.value)}
              >
                <option value="">{t("সব ধরনের")}</option>
                {Object.entries(accountNames).map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </AppSelect>
            </label>
            <div className="field-grid">
              <label>
                {t("শুরু থেকে")}
                <AppDatePicker
                  value={from}
                  onChange={(event) => update("from", event.target.value)}
                />
              </label>
              <label>
                {t("শেষ পর্যন্ত")}
                <AppDatePicker
                  value={to}
                  onChange={(event) => update("to", event.target.value)}
                />
              </label>
            </div>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}
