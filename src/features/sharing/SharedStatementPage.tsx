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
import { useComposedInput } from "../../lib/useComposedInput";
import { readShare, type SharedStatement } from "./shareClient";
import { useSharedStatement } from "./useSharedStatement";
import { SharedEntryDetail } from "./SharedEntryDetail";
import { SharedContractCarousel } from "./SharedContractCarousel";
import { SharedMonthlySection } from "./SharedMonthlySection";
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

function SharedRecipientSummary({ statement }: { statement: SharedStatement }) {
  const { t, money } = useLanguageContext();
  const totals = statement.totals;
  const cost = totals.reconciledCost ?? totals.cost;
  const paid = totals.reconciledNetPaid ?? totals.paid;
  const due = totals.reconciledPayable ?? totals.payable;
  const credit = totals.reconciledAdvance ?? totals.advance;
  const ambiguous = Boolean(totals.balanceAmbiguous);
  const fullyPaid =
    !ambiguous &&
    cost > 0 &&
    cost === paid &&
    due === 0 &&
    credit === 0 &&
    !totals.costCorrection &&
    !totals.paidCorrection &&
    !totals.balanceCorrection &&
    !totals.historicalCost;
  const showBill = cost !== 0 && !fullyPaid;
  const hasDetails =
    showBill ||
    totals.costCorrection ||
    totals.paidCorrection ||
    (!ambiguous && totals.balanceCorrection);
  const correction = (value: number | undefined) =>
    value ? (
      <small className="shared-metric-note">
        {t("সমন্বয়সহ")} · {value > 0 ? "+" : "−"}
        {money(Math.abs(value))}
      </small>
    ) : null;
  return (
    <section className="shared-overview" aria-label={t("হিসাবের সারাংশ")}>
      <div className="shared-summary-balances">
        <div className="shared-total-main">
          <span>{t("মোট পেয়েছেন")}</span>
          <strong>{money(paid)}</strong>
          {correction(totals.paidCorrection)}
          {statement.counts.refund ? (
            <small>{t("ফেরত দেওয়া টাকা বাদে")}</small>
          ) : null}
        </div>
        <dl className="shared-balance-grid">
          <div className={!ambiguous && due > 0 ? "shared-has-due" : undefined}>
            <dt>
              {t(
                !ambiguous && credit > 0 && due === 0
                  ? "আপনার কাছে জমা"
                  : "আর পাবেন",
              )}
            </dt>
            <dd className={ambiguous ? "shared-balance-pending" : undefined}>
              {ambiguous
                ? t("বাকি মেলানো বাকি")
                : money(credit > 0 && due === 0 ? credit : due)}
            </dd>
            {!ambiguous ? correction(totals.balanceCorrection) : null}
            {!ambiguous && due === 0 && credit === 0 ? (
              <small className="shared-paid-status">
                <CheckCircleIcon size={15} aria-hidden="true" />
                {t(fullyPaid ? "পুরো বিল মেটানো" : "বাকি নেই")}
              </small>
            ) : null}
          </div>
        </dl>
      </div>
      {!ambiguous && due > 0 && credit > 0 ? (
        <dl className="shared-credit-note">
          <dt>{t("আপনার কাছে জমা")}</dt>
          <dd>{money(credit)}</dd>
        </dl>
      ) : null}
      {ambiguous ? (
        <p role="status" className="shared-balance-notice">
          {t(
            "বাকি টাকার হিসাব এখনও মেলানো হয়নি। যিনি লিংক পাঠিয়েছেন, তাঁর সঙ্গে মিলিয়ে নিন।",
          )}
        </p>
      ) : null}
      {hasDetails ? (
        <details className="shared-summary-details">
          <summary>
            <span>{t("আরও হিসাব")}</span>
            <CaretDownIcon size={16} aria-hidden="true" />
          </summary>
          <dl className="shared-detail-amounts">
            {showBill || totals.costCorrection ? (
              <div>
                <dt>
                  {t(statement.account === "labour" ? "কাজের বিল" : "মোট বিল")}
                </dt>
                <dd>
                  {money(cost)}
                  {correction(totals.costCorrection)}
                </dd>
                {statement.counts.expense_credit ? (
                  <small>{t("মাল ফেরত বাদে")}</small>
                ) : null}
              </div>
            ) : null}
            {totals.paidCorrection ? (
              <div>
                <dt>{t("আসলে পাওয়া টাকা")}</dt>
                <dd>{money(totals.actualNetPaid ?? totals.paid)}</dd>
                <small>
                  {t("হিসাব মিলিয়ে পাওয়া টাকার অঙ্ক বদলানো হয়েছে।")}
                </small>
              </div>
            ) : null}
            {!ambiguous && totals.balanceCorrection ? (
              <div>
                <dt>{t("বাকি টাকার সমন্বয়")}</dt>
                <dd>
                  {totals.balanceCorrection > 0 ? "+" : "−"}
                  {money(Math.abs(totals.balanceCorrection))}
                </dd>
              </div>
            ) : null}
          </dl>
        </details>
      ) : null}
    </section>
  );
}

export function SharedStatementPage() {
  const { t, money, date, formatDigits } = useLanguageContext();
  const pager = useSharedStatement();
  const { token, statement, query, busy, missing, error, stale } = pager;
  const search = useComposedInput(query, pager.setQuery, {
    scope: token,
    restore: true,
  });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
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
  const ambiguous = Boolean(statement?.totals.balanceAmbiguous);
  const months = new Map<string, SharedRow[]>();
  for (const row of statement?.rows ?? []) {
    const key = row.date?.slice(0, 7) ?? "unknown";
    const entries = months.get(key) ?? [];
    entries.push(row);
    months.set(key, entries);
  }
  return (
    <main className="shared-statement-page">
      <header className="shared-brand">
        <span>
          <HouseLineIcon size={22} />
          {t("বাড়ির খাতা")}
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
          <SharedRecipientSummary statement={statement} />
          <SharedMonthlySection
            key={`monthly:${token}:${statement.revision}`}
            token={token}
            statement={statement}
            onUnavailable={pager.markUnavailable}
            onStale={pager.markStale}
          />
          {isWorker && statement.contracts.length > 0 ? (
            <SharedContractCarousel
              key={`contracts:${token}:${statement.revision}`}
              contracts={statement.contracts}
              ambiguous={ambiguous}
            />
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
                maxLength={200}
                aria-label={t("লেনদেন খুঁজুন")}
                placeholder={t("বিবরণ, তারিখ বা টাকা দিয়ে খুঁজুন")}
                {...search.inputProps}
              />
              {search.value ? (
                <button
                  type="button"
                  aria-label={t("খোঁজা মুছুন")}
                  onClick={search.clear}
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
