import { useState } from "react";
import { useSearchParams } from "react-router";
import {
  ArrowRightIcon,
  DownloadSimpleIcon,
  FunnelSimpleIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import { cashSummary } from "../../domain/cashSummary";
import type { Account, Ledger } from "../../domain/model";
import { cashReportCsv } from "./cashReportCsv";
import { EntryList } from "../../components/ui/EntryList";
import { AppSelect } from "../../components/ui/AppSelect";
import { AppDatePicker } from "../../components/ui/AppDatePicker";
import { Sheet } from "../../components/Sheet";
import { validHistoryDate } from "../history/history";
import { accountNames, saveFile, todayDhaka } from "../../lib/display";
import { reportAdjustments } from "./reportAdjustments";

export function CashReport({
  ledger,
  onEntry,
}: {
  ledger: Ledger;
  onEntry?: (id: string) => void;
}) {
  const { t, money, formatDigits } = useLanguageContext();
  const [params, setParams] = useSearchParams();
  const [filterOpen, setFilterOpen] = useState(false);
  const workId = params.get("work") ?? "";
  const personId = params.get("person") ?? "";
  const rawAccount = params.get("account") ?? "";
  const account = ["materials", "labour", "other"].includes(rawAccount)
    ? (rawAccount as Account)
    : undefined;
  const from = validHistoryDate(params.get("from") ?? "");
  const to = validHistoryDate(params.get("to") ?? "");
  const query = (params.get("q") ?? "").slice(0, 300);
  const byPerson = params.get("by") === "person";
  const requestedPage = Number(params.get("page") ?? "1");
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? Math.min(requestedPage, 3334)
      : 1;
  const result = cashSummary(ledger, {
    workId,
    personId,
    account,
    from,
    to,
    query,
  });
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
  const amountMap = new Map<string, number>();
  for (const row of result.rows)
    amountMap.set(
      row.entry.id,
      (amountMap.get(row.entry.id) ?? 0) + row.amount,
    );
  const amounts = Object.fromEntries(amountMap);
  const entries = [...result.entries].sort(
    (a, b) =>
      (b.date ?? "").localeCompare(a.date ?? "") ||
      b.createdAt.localeCompare(a.createdAt),
  );
  const filtered = Boolean(
    workId || personId || account || from || to || query,
  );
  function update(key: string, value: string) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("page");
        next.delete("groups");
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
      <section className="history-toolbar">
        <label className="history-search">
          <MagnifyingGlassIcon size={21} />
          <input
            aria-label={t("দেওয়া টাকা খুঁজুন")}
            placeholder={t("নাম বা খাতা খুঁজুন")}
            value={query}
            onChange={(event) => update("q", event.target.value)}
          />
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
        <button className="text-button" onClick={() => setParams({})}>
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
      <section className="report-history">
        <div className="report-history-heading">
          <h2>{t("কখন কত দিয়েছি")}</h2>
        </div>
        <EntryList
          ledger={ledger}
          entries={entries.slice(0, page * 30)}
          amounts={amounts}
          onEntry={(id) => onEntry?.(id)}
          showKind
          grouped
        />
        {entries.length > page * 30 ? (
          <button
            className="history-load-more"
            onClick={() => {
              setParams(
                (previous) => {
                  const next = new URLSearchParams(previous);
                  next.set("page", String(page + 1));
                  return next;
                },
                { replace: true, preventScrollReset: true },
              );
            }}
          >
            {t("আরও হিসাব দেখুন")}
          </button>
        ) : null}
      </section>
      <button className="secondary-button" onClick={showCosts}>
        {t("মাল ও কাজের দাম দেখি")}
        <ArrowRightIcon size={17} />
      </button>
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
