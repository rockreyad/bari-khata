import { useEffect, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  DownloadSimpleIcon,
  HardHatIcon,
  HouseLineIcon,
  LinkBreakIcon,
  MagnifyingGlassIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  StorefrontIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import { readShare, type SharedStatement } from "./shareClient";
import { useSharedStatement } from "./useSharedStatement";
import { SharedEntryDetail } from "./SharedEntryDetail";
import {
  completeSharedStatement,
  downloadSharedCsv,
  sharedExportFilename,
  sharedStatementCsv,
} from "./shareExport";
import "./sharing.css";

const recipientBasis = {
  paid: "পরিশোধ",
  cost: "বিলের মোট",
  balance: "বাকি",
};
const rowLabels = {
  expense: "বিল",
  payment: "পরিশোধ",
  expense_credit: "মাল ফেরত",
  refund: "টাকা ফেরত",
  adjustment: "হিসাবের সমন্বয়",
};
const errorLabels = {
  share_request_failed:
    "লিংক খোলা যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।",
  share_changed: "নতুন হিসাব এসেছে। হালনাগাদ করে আবার দেখুন।",
  share_invalid_page: "হিসাবের পাতা মিলছে না। হালনাগাদ করে আবার দেখুন।",
};
type SharedRow = SharedStatement["rows"][number];

function SharedTransactionRow({
  row,
  account,
  onOpen,
}: {
  row: SharedRow;
  account: SharedStatement["account"];
  onOpen: () => void;
}) {
  const { t, money, date, formatDigits } = useLanguageContext();
  const label =
    row.kind === "expense"
      ? account === "materials"
        ? "বিল"
        : account === "labour"
          ? "কাজের বিল"
          : "খরচের বিল"
      : row.kind === "payment"
        ? "টাকা পেয়েছেন"
        : rowLabels[row.kind];
  const amount =
    row.kind === "adjustment" ? (row.adjustment ?? 0) : row.charge || row.paid;
  const description = row.description.trim().slice(0, 100);
  const works = row.works.trim().slice(0, 70);
  const signed = (value: number) =>
    (value < 0 ? "−" : "") + money(Math.abs(value));
  const settlement = row.settlement;
  const status = settlement
    ? settlement.balance > 0
      ? settlement.paid === 0 &&
        settlement.returned === 0 &&
        settlement.refunded === 0
        ? t("পুরোটাই বাকি")
        : t("বাকি {{amount}}", { amount: money(settlement.balance) })
      : settlement.balance < 0
        ? t("জমা {{amount}}", { amount: money(-settlement.balance) })
        : t(
            settlement.returned || settlement.refunded
              ? "হিসাব মিটেছে"
              : "মেটানো",
          )
    : "";
  return (
    <article className={"shared-entry shared-entry-" + row.kind}>
      <button
        type="button"
        className="shared-ledger-row"
        onClick={onOpen}
        aria-label={[
          t(label),
          ...(description ? [formatDigits(description)] : []),
          signed(amount),
          ...(status ? [status] : []),
          date(row.date),
          t("বিস্তারিত"),
        ].join(" · ")}
      >
        <span className="shared-ledger-info">
          <span className="shared-ledger-label">
            <span>
              {row.kind === "expense" && description
                ? formatDigits(description)
                : t(label)}
            </span>
          </span>
          {description && row.kind !== "expense" ? (
            <span className="shared-ledger-description">
              {formatDigits(description)}
            </span>
          ) : null}
          <span className="shared-entry-meta">
            <time dateTime={row.date ?? undefined}>
              {date(row.date, { day: "numeric", month: "short" })}
            </time>
            {works ? (
              <span className="shared-entry-works">{formatDigits(works)}</span>
            ) : null}
          </span>
          {row.kind === "adjustment" && row.adjustmentBasis ? (
            <span className="shared-entry-basis">
              {t(recipientBasis[row.adjustmentBasis])}
            </span>
          ) : null}
          {row.historical ? (
            <span className="shared-historical-note">
              {t("পুরোনো তথ্য; বর্তমান হিসাবে ধরা হয়নি")}
            </span>
          ) : null}
        </span>
        <span className="shared-ledger-value">
          <strong>{signed(amount)}</strong>
          {settlement ? (
            <span
              className={
                "shared-bill-status " +
                (settlement.balance > 0
                  ? "shared-bill-outstanding"
                  : "shared-bill-settled")
              }
            >
              {settlement.balance === 0 ? (
                <CheckCircleIcon size={13} aria-hidden="true" />
              ) : null}
              {status}
            </span>
          ) : row.kind === "adjustment" ? (
            <small>{t("সমন্বয়")}</small>
          ) : null}
          {settlement && settlement.balance > 0 && settlement.paid > 0 ? (
            <small>
              {t("পেয়েছেন {{amount}}", { amount: money(settlement.paid) })}
            </small>
          ) : null}
        </span>
        <CaretRightIcon
          className="shared-ledger-open"
          size={16}
          aria-hidden="true"
        />
      </button>
    </article>
  );
}

function SharedShopSummary({ statement }: { statement: SharedStatement }) {
  const { t, money } = useLanguageContext();
  const totals = statement.totals;
  const cost = totals.reconciledCost ?? totals.cost;
  const paid = totals.reconciledNetPaid ?? totals.paid;
  const due = totals.reconciledPayable ?? totals.payable;
  const credit = totals.reconciledAdvance ?? totals.advance;
  const fullyPaid =
    cost > 0 &&
    cost === paid &&
    due === 0 &&
    credit === 0 &&
    !totals.costCorrection &&
    !totals.paidCorrection &&
    !totals.balanceCorrection &&
    !totals.historicalCost;
  const correction = (value: number | undefined) =>
    value ? (
      <small className="shared-metric-note">
        {t("সমন্বয়সহ")} · {value > 0 ? "+" : ""}
        {money(value)}
      </small>
    ) : null;
  return (
    <section className="shared-shop-summary" aria-label={t("হিসাবের সারাংশ")}>
      <div className="shared-shop-bill">
        <span>{t("মোট বিল")}</span>
        <strong>{money(cost)}</strong>
        {correction(totals.costCorrection)}
        {statement.counts.expense_credit ? (
          <small>{t("মাল ফেরত বাদে")}</small>
        ) : null}
      </div>
      {!fullyPaid &&
      (cost !== 0 ||
        paid !== 0 ||
        due !== 0 ||
        credit !== 0 ||
        totals.costCorrection ||
        totals.paidCorrection ||
        totals.balanceCorrection) ? (
        <dl className="shared-shop-balances">
          <div>
            <dt>{t("পরিশোধ")}</dt>
            <dd>{money(paid)}</dd>
            {correction(totals.paidCorrection)}
            {statement.counts.refund ? (
              <small>{t("টাকা ফেরত বাদে")}</small>
            ) : null}
          </div>
          <div
            className={
              credit > 0 ? "shared-customer-credit" : "shared-shop-due"
            }
          >
            <dt>{t(credit > 0 ? "ক্রেতা পাবেন" : "বাকি")}</dt>
            <dd>{money(credit > 0 ? credit : due)}</dd>
            {correction(totals.balanceCorrection)}
          </div>
        </dl>
      ) : null}
      {due === 0 && credit === 0 ? (
        <p className="shared-paid-status">
          <CheckCircleIcon size={16} />
          {t(fullyPaid ? "পুরো বিল মেটানো" : "বাকি নেই")}
        </p>
      ) : null}
    </section>
  );
}

export function SharedStatementPage() {
  const { t, money, date, formatDigits } = useLanguageContext();
  const pager = useSharedStatement();
  const { token, statement, query, busy, missing, error, stale } = pager;
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [contractPage, setContractPage] = useState(0);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const exportRequest = useRef(0);
  const exportAbort = useRef<AbortController | null>(null);
  const currentToken = useRef(token);
  currentToken.current = token;
  const exportLock = useRef(false);
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const navigationFrom = useRef<number | null>(null);
  useEffect(() => {
    exportRequest.current++;
    exportAbort.current?.abort();
    exportLock.current = false;
    setExporting(false);
    setExportError("");
    setContractPage(0);
    return () => {
      exportRequest.current++;
      exportAbort.current?.abort();
    };
  }, [token]);
  useEffect(() => {
    if (!missing && !stale) return;
    exportRequest.current++;
    exportAbort.current?.abort();
    exportAbort.current = null;
    exportLock.current = false;
    setExporting(false);
    setExportError("");
  }, [missing, stale]);
  useEffect(() => {
    setContractPage(0);
    setSelectedEntryId(null);
  }, [token, statement?.revision]);
  useEffect(() => {
    if (busy || navigationFrom.current === null) return;
    const from = navigationFrom.current;
    navigationFrom.current = null;
    if (statement && pager.pageStart !== from) {
      historyHeading.current?.focus({ preventScroll: true });
      historyHeading.current?.scrollIntoView?.({
        block: "start",
        behavior: "instant",
      });
    }
  }, [busy, statement, pager.pageStart]);
  function turnPage(direction: "next" | "previous") {
    navigationFrom.current = pager.pageStart;
    void pager[direction]();
  }
  function cancelExport() {
    exportRequest.current++;
    exportAbort.current?.abort();
    exportLock.current = false;
    setExporting(false);
    setExportError("");
  }
  async function exportCopy() {
    if (exportLock.current || busy || !statement) return;
    exportLock.current = true;
    const id = ++exportRequest.current;
    const controller = new AbortController();
    exportAbort.current = controller;
    const cancelled = () =>
      id !== exportRequest.current ||
      token !== currentToken.current ||
      token !== window.location.hash.slice(1) ||
      controller.signal.aborted;
    setExporting(true);
    setExportError("");
    try {
      const complete = await completeSharedStatement(
        token,
        readShare,
        cancelled,
        { signal: controller.signal },
      );
      if (cancelled()) return;
      downloadSharedCsv(
        sharedExportFilename(complete.person.name),
        sharedStatementCsv(complete, { t, money, date }, formatDigits),
      );
    } catch (cause) {
      if (cancelled()) return;
      const message = cause instanceof Error ? cause.message : "";
      if (message === "share_unavailable") pager.markUnavailable();
      else if (message === "share_changed") pager.markStale();
      else
        setExportError(
          message === "share_export_too_large"
            ? "হিসাবের কপি অনেক বড়। যিনি পাঠিয়েছেন তাঁর কাছ থেকে কপি নিন।"
            : "কপি নামানো যায়নি। সংযোগ দেখে আবার চেষ্টা করুন।",
        );
    } finally {
      if (!cancelled()) {
        exportLock.current = false;
        exportAbort.current = null;
        setExporting(false);
      }
    }
  }
  const isWorker = statement?.account === "labour";
  const isShop = statement?.account === "materials";
  const Icon = isWorker ? HardHatIcon : isShop ? StorefrontIcon : ReceiptIcon;
  const totals = statement?.totals;
  const paid = totals?.reconciledNetPaid ?? totals?.paid ?? 0;
  const cost = totals?.reconciledCost ?? totals?.cost ?? 0;
  const due = totals?.reconciledPayable ?? totals?.payable ?? 0;
  const credit = totals?.reconciledAdvance ?? totals?.advance ?? 0;
  const metrics = [
    ...((cost !== 0 && (cost !== paid || due > 0 || credit > 0)) ||
    totals?.costCorrection
      ? [
          {
            label: isShop ? "মালের বিল" : isWorker ? "কাজের বিল" : "খরচের বিল",
            amount: cost,
            due: false,
            correction: totals?.costCorrection ?? 0,
          },
        ]
      : []),
    ...(due > 0 || totals?.balanceCorrection
      ? [
          {
            label: "আর পাবেন",
            amount: due,
            due: true,
            correction: totals?.balanceCorrection ?? 0,
          },
        ]
      : []),
  ];
  const months = new Map<string, SharedRow[]>();
  for (const row of statement?.rows ?? []) {
    const key = row.date?.slice(0, 7) ?? "unknown";
    const entries = months.get(key) ?? [];
    entries.push(row);
    months.set(key, entries);
  }
  const contractStart = Math.min(
    contractPage * 5,
    Math.max(0, (statement?.contracts.length ?? 0) - 1),
  );
  return (
    <main className="shared-statement-page">
      <header className="shared-brand">
        <span>
          <HouseLineIcon size={22} />
          {t("বাড়ির খাতা")}
        </span>
        <span className="shared-copy-label">
          <ShieldCheckIcon size={15} />
          {t("শুধু দেখার কপি")}
        </span>
      </header>
      {!statement ? (
        <section className="shared-empty panel" aria-busy={busy}>
          {busy ? (
            <>
              <span className="shared-loading-mark" aria-hidden="true">
                <ReceiptIcon size={28} />
              </span>
              <h1>{t("হিসাব আসছে…")}</h1>
              <p role="status">{t("অল্প অল্প করে লেনদেন দেখানো হবে।")}</p>
              <div className="shared-loading-lines" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
            </>
          ) : missing ? (
            <>
              <LinkBreakIcon size={36} />
              <h1>{t("লিংকটি এখন কাজ করছে না")}</h1>
              <p>{t("যিনি পাঠিয়েছেন তাঁর কাছ থেকে নতুন লিংক নিন।")}</p>
            </>
          ) : (
            <>
              <ReceiptIcon size={34} />
              <h1>{t(stale ? "নতুন হিসাব এসেছে" : "হিসাবের কপি")}</h1>
              {error ? <p role="alert">{t(errorLabels[error])}</p> : null}
            </>
          )}
          {!busy ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => void pager.load()}
            >
              <ArrowClockwiseIcon size={18} />
              {t(stale ? "হালনাগাদ দেখি" : "আবার চেষ্টা করুন")}
            </button>
          ) : null}
        </section>
      ) : (
        <>
          <section className="shared-heading">
            <span className="shared-person-mark" aria-hidden="true">
              <Icon size={26} />
            </span>
            <div>
              <p className="eyebrow">{formatDigits(statement.projectName)}</p>
              <h1>{formatDigits(statement.person.name)}</h1>
              {statement.person.role ? (
                <p>{formatDigits(statement.person.role)}</p>
              ) : null}
            </div>
            <button
              type="button"
              className="icon-button"
              disabled={busy}
              aria-label={t("হালনাগাদ দেখি")}
              onClick={() => void pager.load()}
            >
              <ArrowClockwiseIcon size={20} />
            </button>
          </section>
          {statement.workName ? (
            <div className="shared-scope">
              <ReceiptIcon size={15} aria-hidden="true" />
              <span>{formatDigits(statement.workName)}</span>
            </div>
          ) : null}
          {isShop ? (
            <SharedShopSummary statement={statement} />
          ) : (
            <section
              className={`shared-overview ${metrics.length === 1 ? "shared-overview-pair" : ""}`}
              aria-label={t("হিসাবের সারাংশ")}
            >
              <div className="shared-total-main">
                <span>{t("মোট পেয়েছেন")}</span>
                <strong>{money(paid)}</strong>
                {totals?.paidCorrection ? (
                  <small>
                    {t("সমন্বয়সহ")} · {t("সমন্বয়")}:{" "}
                    {money(totals.paidCorrection)}
                    {totals.actualNetPaid !== undefined ? (
                      <span>
                        {t("আসলে পেয়েছেন {{amount}}", {
                          amount: money(totals.actualNetPaid),
                        })}
                      </span>
                    ) : null}
                  </small>
                ) : statement.counts.refund > 0 ? (
                  <small>{t("ফেরত দেওয়া টাকা বাদে")}</small>
                ) : null}
              </div>
              {metrics.length ? (
                <dl className="shared-balance-grid">
                  {metrics.map((metric) => (
                    <div
                      key={metric.label}
                      className={metric.due ? "shared-has-due" : ""}
                    >
                      <dt>{t(metric.label)}</dt>
                      <dd>
                        {money(metric.amount)}
                        {metric.correction !== 0 ? (
                          <small className="shared-metric-note">
                            {t("সমন্বয়সহ")} · {t("সমন্বয়")}:{" "}
                            {metric.correction > 0 ? "+" : ""}
                            {money(metric.correction)}
                          </small>
                        ) : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : credit === 0 ? (
                <p className="shared-settled">
                  {t(
                    cost > 0 &&
                      cost === paid &&
                      !totals?.paidCorrection &&
                      !totals?.costCorrection &&
                      !totals?.balanceCorrection &&
                      !totals?.historicalCost
                      ? "পুরো বিল মেটানো"
                      : "বাকি নেই",
                  )}
                </p>
              ) : null}
              {credit > 0 ? (
                <details className="shared-reconciliation">
                  <summary>
                    <span>{t("আপনার কাছে জমা")}</span>
                    <strong>{money(credit)}</strong>
                    <CaretDownIcon size={16} />
                  </summary>
                  <dl>
                    <dt>{t("হিসাবের জমা")}</dt>
                    <dd>{money(credit)}</dd>
                  </dl>
                </details>
              ) : null}
            </section>
          )}
          {isWorker && statement.contracts.length > 0 ? (
            <details className="shared-contracts">
              <summary>
                <span>
                  <HardHatIcon size={19} />
                  <span>
                    {t("কাজ ও চুক্তি")}
                    <small>
                      {t("{{count}}টি চুক্তি", {
                        count: formatDigits(statement.contracts.length),
                      })}
                    </small>
                  </span>
                </span>
                <CaretDownIcon size={18} />
              </summary>
              <div className="shared-contract-list">
                {statement.contracts
                  .slice(contractStart, contractStart + 5)
                  .map((contract, index) => (
                    <article key={contractStart + index}>
                      <h3>
                        {formatDigits(contract.title || t("কাজের চুক্তি"))}
                      </h3>
                      {contract.workName ? (
                        <p>{formatDigits(contract.workName)}</p>
                      ) : null}
                      <dl>
                        <div>
                          <dt>{t("চুক্তির মোট")}</dt>
                          <dd>{money(contract.total)}</dd>
                        </div>
                        <div>
                          <dt>{t("পেয়েছেন")}</dt>
                          <dd>{money(contract.netPaid)}</dd>
                        </div>
                        <div>
                          <dt>{t("আর পাবেন")}</dt>
                          <dd>{money(contract.remaining)}</dd>
                        </div>
                      </dl>
                    </article>
                  ))}
                {statement.contracts.length > 5 ? (
                  <nav
                    className="shared-contract-pages"
                    aria-label={t("চুক্তির পাতা")}
                  >
                    <button
                      type="button"
                      className="text-button"
                      disabled={contractPage === 0}
                      onClick={() => setContractPage((value) => value - 1)}
                    >
                      {t("আগের চুক্তি")}
                    </button>
                    <span>
                      {formatDigits(
                        `${contractStart + 1}–${Math.min(contractStart + 5, statement.contracts.length)}`,
                      )}{" "}
                      / {formatDigits(statement.contracts.length)}
                    </span>
                    <button
                      type="button"
                      className="text-button"
                      disabled={contractStart + 5 >= statement.contracts.length}
                      onClick={() => setContractPage((value) => value + 1)}
                    >
                      {t("পরের চুক্তি")}
                    </button>
                  </nav>
                ) : null}
              </div>
            </details>
          ) : null}
          <section className="shared-transactions">
            <div className="shared-history-heading">
              <div>
                <h2 ref={historyHeading} tabIndex={-1}>
                  {t("লেনদেন")}
                </h2>
              </div>
              <button
                type="button"
                className="shared-export-button"
                disabled={exporting || busy}
                onClick={() => void exportCopy()}
              >
                <DownloadSimpleIcon size={18} />
                {t(exporting ? "কপি তৈরি হচ্ছে…" : "কপি নামান")}
              </button>
            </div>
            {exporting ? (
              <div className="shared-export-status" role="status">
                <span>{t("সব লেনদেনের কপি তৈরি হচ্ছে…")}</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={cancelExport}
                >
                  <XIcon size={16} />
                  {t("বন্ধ করুন")}
                </button>
              </div>
            ) : null}
            {exportError ? (
              <p className="share-error" role="alert">
                {t(exportError)}
              </p>
            ) : null}
            <div className="shared-search">
              <MagnifyingGlassIcon size={19} aria-hidden="true" />
              <input
                type="search"
                value={query}
                maxLength={200}
                aria-label={t("লেনদেন খুঁজুন")}
                placeholder={t("বিবরণ, তারিখ বা টাকা দিয়ে খুঁজুন")}
                onChange={(event) => pager.setQuery(event.target.value)}
              />
              {query ? (
                <button
                  type="button"
                  aria-label={t("খোঁজা মুছুন")}
                  onClick={() => pager.setQuery("")}
                >
                  <XIcon size={17} />
                </button>
              ) : null}
            </div>
            {busy ? (
              <p className="shared-loading-status" role="status">
                {t("লেনদেন আসছে…")}
              </p>
            ) : null}
            {error ? (
              <div className="shared-page-error" role="alert">
                <p>{t(errorLabels[error])}</p>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void pager.retry()}
                >
                  {t("আবার চেষ্টা করুন")}
                </button>
              </div>
            ) : null}
            <section
              className="shared-history"
              aria-label={t("লেনদেনের তালিকা")}
              aria-busy={busy}
            >
              {statement.rows.length ? (
                [...months.entries()].map(([month, rows]) => (
                  <section className="shared-month" key={month}>
                    <h3>
                      {date(month === "unknown" ? null : `${month}-01`, {
                        day: undefined,
                        month: "long",
                        year: "numeric",
                      })}
                    </h3>
                    <div className="shared-month-entries">
                      {rows.map((row) => (
                        <SharedTransactionRow
                          key={row.key}
                          row={row}
                          account={statement.account}
                          onOpen={() => setSelectedEntryId(row.key)}
                        />
                      ))}
                    </div>
                  </section>
                ))
              ) : busy ? (
                <div className="shared-loading-lines" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
              ) : (
                <div className="shared-history-empty">
                  <ReceiptIcon size={26} />
                  <p>
                    {t(
                      query
                        ? "কিছু মেলেনি। অন্যভাবে খুঁজে দেখুন।"
                        : "এখানে কোনো লেনদেন নেই",
                    )}
                  </p>
                </div>
              )}
            </section>
            <nav className="shared-pagination" aria-label={t("লেনদেনের পাতা")}>
              <button
                type="button"
                className="secondary-button"
                disabled={!pager.canPrevious}
                onClick={() => turnPage("previous")}
              >
                <CaretLeftIcon size={17} />
                {t("আগের পাতা")}
              </button>
              <span>
                {t("পাতা {{page}}", { page: formatDigits(pager.pageNumber) })}
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={!pager.canNext}
                onClick={() => turnPage("next")}
              >
                {t("পরের পাতা")}
                <CaretRightIcon size={17} />
              </button>
            </nav>
          </section>
          <footer className="shared-footer">
            <p>
              {t("শেষ হালনাগাদ")} ·{" "}
              {date(statement.updatedAt, {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
            <p>
              <ShieldCheckIcon size={14} />
              {t("এই লিংকে কোনো তথ্য বদলানো যায় না।")}
            </p>
            {statement.totals.historicalCost > 0 ? (
              <p>
                {t(
                  "পুরোনো খাতার তথ্য আছে। সেখানে পরিশোধ পরিষ্কার নয় বলে বাকি বা অগ্রিম ধরে নেওয়া হয়নি।",
                )}
              </p>
            ) : null}
          </footer>
        </>
      )}
      {statement && selectedEntryId ? (
        <SharedEntryDetail
          key={[token, selectedEntryId, statement.revision].join(":")}
          token={token}
          entryId={selectedEntryId}
          revision={statement.revision}
          onClose={() => setSelectedEntryId(null)}
          onUnavailable={pager.markUnavailable}
          onStale={pager.markStale}
        />
      ) : null}
    </main>
  );
}
