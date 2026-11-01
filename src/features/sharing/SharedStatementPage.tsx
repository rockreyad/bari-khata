import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  DownloadSimpleIcon,
  HouseLineIcon,
  LinkBreakIcon,
  StorefrontIcon,
  HardHatIcon,
  ReceiptIcon,
} from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import { readShare, type SharedStatement } from "./shareClient";
import type { SharedKind } from "./shareModel";
import {
  completeSharedStatement,
  downloadSharedCsv,
  sharedExportFilename,
  sharedStatementCsv,
} from "./shareExport";
import "./sharing.css";
const kinds = {
  expense: "বিল",
  payment: "পরিশোধ",
  expense_credit: "মাল ফেরত",
  refund: "টাকা ফেরত",
};
export function SharedStatementPage() {
  const { t, money, date, formatDigits } = useLanguageContext();
  const [token, setToken] = useState(() => window.location.hash.slice(1));
  const [statement, setStatement] = useState<SharedStatement | null>(null);
  const [filter, setFilter] = useState<SharedKind | "">("");
  const [busy, setBusy] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");
  const [contractLimit, setContractLimit] = useState(5);
  const request = useRef(0);
  const exportRequest = useRef(0);
  const currentToken = useRef(token);
  useEffect(() => {
    const change = () => {
      const nextToken = window.location.hash.slice(1);
      if (nextToken === currentToken.current) return;
      currentToken.current = nextToken;
      request.current++;
      exportRequest.current++;
      setStatement(null);
      setFilter("");
      setMissing(false);
      setError("");
      setExportError("");
      setExporting(false);
      setBusy(true);
      setContractLimit(5);
      setToken(nextToken);
    };
    window.addEventListener("hashchange", change);
    return () => {
      window.removeEventListener("hashchange", change);
      exportRequest.current++;
    };
  }, []);
  const load = useCallback(async () => {
    const id = ++request.current;
    setBusy(true);
    setError("");
    setMissing(false);
    try {
      const data = filter
        ? await readShare(token, 0, undefined, filter)
        : await readShare(token);
      if (id !== request.current) return;
      setStatement(data);
      setMissing(data === null);
    } catch {
      if (id === request.current) {
        setStatement(null);
        setError("লিংক খোলা যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।");
      }
    } finally {
      if (id === request.current) setBusy(false);
    }
  }, [token, filter]);
  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, [load]);
  async function more() {
    if (!statement || statement.nextOffset === null || busy) return;
    const id = ++request.current;
    setBusy(true);
    setError("");
    try {
      const data = filter
        ? await readShare(
            token,
            statement.nextOffset,
            statement.revision,
            filter,
          )
        : await readShare(token, statement.nextOffset, statement.revision);
      if (id !== request.current) return;
      if (!data) {
        setStatement(null);
        setMissing(true);
        return;
      }
      setStatement({ ...data, rows: [...statement.rows, ...data.rows] });
    } catch (cause) {
      if (id === request.current)
        setError(
          cause instanceof Error && cause.message === "share_changed"
            ? "নতুন হিসাব এসেছে। হালনাগাদ করে আবার দেখুন।"
            : "লিংক খোলা যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।",
        );
    } finally {
      if (id === request.current) setBusy(false);
    }
  }
  async function exportCopy() {
    if (exporting) return;
    const id = ++exportRequest.current;
    const cancelled = () =>
      id !== exportRequest.current || token !== currentToken.current;
    setExporting(true);
    setExportError("");
    try {
      const complete = await completeSharedStatement(
        token,
        readShare,
        cancelled,
      );
      if (cancelled()) return;
      downloadSharedCsv(
        sharedExportFilename(complete.person.name),
        sharedStatementCsv(complete, { t, money, date }, formatDigits),
      );
    } catch (cause) {
      if (cancelled()) return;
      if (cause instanceof Error && cause.message === "share_unavailable") {
        setStatement(null);
        setMissing(true);
      } else
        setExportError(
          cause instanceof Error && cause.message === "share_changed"
            ? "নতুন হিসাব এসেছে। হালনাগাদ করে আবার দেখুন।"
            : "কপি নামানো যায়নি। সংযোগ দেখে আবার চেষ্টা করুন।",
        );
    } finally {
      if (!cancelled()) setExporting(false);
    }
  }
  const isWorker = statement?.account === "labour";
  const isShop =
    statement?.person.kind === "shop" || statement?.account === "materials";
  const Icon = isWorker ? HardHatIcon : isShop ? StorefrontIcon : ReceiptIcon;
  const filters: { kind: SharedKind | ""; label: string }[] = [
    { kind: "", label: "সব লেনদেন" },
    { kind: "expense", label: isShop ? "কেনাকাটা" : "বিল" },
    { kind: "payment", label: "পরিশোধ" },
    ...(isShop || statement?.counts.expense_credit
      ? [{ kind: "expense_credit" as const, label: "মাল ফেরত" }]
      : []),
    ...(statement?.counts.refund
      ? [{ kind: "refund" as const, label: "টাকা ফেরত" }]
      : []),
  ];
  return (
    <main className="shared-statement-page">
      <header className="shared-brand">
        <span>
          <HouseLineIcon size={22} weight="duotone" />
          {t("বাড়ির খাতা")}
        </span>
        <span className="shared-copy-label">{t("হিসাবের কপি")}</span>
      </header>
      {!statement ? (
        <section className="shared-empty panel">
          {missing ? (
            <>
              <LinkBreakIcon size={36} />
              <h1>{t("লিংকটি এখন কাজ করছে না")}</h1>
              <p>{t("যিনি পাঠিয়েছেন তাঁর কাছ থেকে নতুন লিংক নিন।")}</p>
            </>
          ) : (
            <>
              <h1>{t(busy ? "অপেক্ষা করুন…" : "হিসাবের কপি")}</h1>
              {error ? <p role="alert">{t(error)}</p> : null}
            </>
          )}
          {!busy ? (
            <button className="secondary-button" onClick={() => void load()}>
              <ArrowClockwiseIcon size={18} />
              {t("আবার চেষ্টা করুন")}
            </button>
          ) : null}
        </section>
      ) : (
        <>
          <section className="shared-heading">
            <span className="shared-person-mark">
              <Icon size={26} weight="duotone" />
            </span>
            <div>
              <p className="eyebrow">{formatDigits(statement.projectName)}</p>
              <h1>{formatDigits(statement.person.name)}</h1>
              {statement.person.role || statement.workName ? (
                <p>
                  {formatDigits(
                    [statement.person.role, statement.workName]
                      .filter(Boolean)
                      .join(" · "),
                  )}
                </p>
              ) : null}
            </div>
            <button
              className="icon-button"
              disabled={busy}
              aria-label={t("হালনাগাদ দেখি")}
              onClick={() => void load()}
            >
              <ArrowClockwiseIcon size={20} />
            </button>
          </section>
          <section className="shared-overview" aria-label={t("হিসাবের সারাংশ")}>
            <div className="shared-total-main">
              <span>
                {t(
                  isWorker
                    ? "মোট পেয়েছেন"
                    : isShop
                      ? statement.counts.expense_credit
                        ? "ফেরত বাদে কেনাকাটা"
                        : "মোট কেনাকাটা"
                      : "মোট খরচ",
                )}
              </span>
              <strong>
                {money(
                  isWorker ? statement.totals.paid : statement.totals.cost,
                )}
              </strong>
              <small>
                {t(statement.workName ? "এই কাজের হিসাব" : "সব সময়ের হিসাব")}
              </small>
            </div>
            <dl className="shared-balance-grid">
              <div>
                <dt>{t(isWorker ? "কাজের বিল" : "পরিশোধ হয়েছে")}</dt>
                <dd>
                  {money(
                    isWorker ? statement.totals.cost : statement.totals.paid,
                  )}
                </dd>
              </div>
              <div
                className={statement.totals.payable > 0 ? "shared-has-due" : ""}
              >
                <dt>{t("আর পাবেন")}</dt>
                <dd>{money(statement.totals.payable)}</dd>
              </div>
              <div>
                <dt>{t("অগ্রিম")}</dt>
                <dd>{money(statement.totals.advance)}</dd>
              </div>
            </dl>
          </section>
          {isWorker && statement.contracts.length ? (
            <details className="shared-contracts">
              <summary>
                {t("চুক্তির হিসাব")}
                <span>
                  {statement.contracts.length === 1
                    ? money(statement.contracts[0].total)
                    : t("{{count}}টি চুক্তি", {
                        count: formatDigits(statement.contracts.length),
                      })}
                </span>
              </summary>
              <div>
                {statement.contracts
                  .slice(0, contractLimit)
                  .map((contract, index) => (
                    <article key={index}>
                      <h3>
                        {formatDigits(contract.title || contract.workName)}
                      </h3>
                      {contract.title && contract.workName ? (
                        <p>{formatDigits(contract.workName)}</p>
                      ) : null}
                      <dl>
                        <div>
                          <dt>{t("চুক্তির মোট")}</dt>
                          <dd>{money(contract.total)}</dd>
                        </div>
                        <div>
                          <dt>{t("পরিশোধ হয়েছে")}</dt>
                          <dd>{money(contract.netPaid)}</dd>
                        </div>
                        <div>
                          <dt>{t("চুক্তির বাকি")}</dt>
                          <dd>{money(contract.remaining)}</dd>
                        </div>
                      </dl>
                    </article>
                  ))}
                {contractLimit < statement.contracts.length ? (
                  <button
                    className="text-button"
                    onClick={() => setContractLimit((value) => value + 5)}
                  >
                    {t("আরও চুক্তি দেখি")}
                  </button>
                ) : null}
              </div>
            </details>
          ) : null}
          <div className="shared-history-heading">
            <h2>{t("লেনদেন")}</h2>
            <button
              className="shared-export-button"
              disabled={exporting || busy}
              onClick={() => void exportCopy()}
            >
              <DownloadSimpleIcon size={17} />
              {t(exporting ? "কপি তৈরি হচ্ছে…" : "কপি নামান")}
            </button>
          </div>
          {exportError ? (
            <p className="share-error" role="alert">
              {t(exportError)}
            </p>
          ) : null}
          <div
            className="shared-filters"
            role="group"
            aria-label={t("লেনদেন বেছে দেখুন")}
          >
            {filters.map((item) => (
              <button
                key={item.kind}
                type="button"
                disabled={busy}
                aria-pressed={filter === item.kind}
                onClick={() => {
                  if (filter !== item.kind) {
                    setFilter(item.kind);
                    setStatement((current) =>
                      current
                        ? { ...current, rows: [], nextOffset: null }
                        : null,
                    );
                  }
                }}
              >
                {t(item.label)}
              </button>
            ))}
          </div>
          <section
            className="panel shared-history"
            aria-label={t("লেনদেনের তালিকা")}
            aria-busy={busy}
          >
            {statement.rows.length ? (
              statement.rows.map((row) => (
                <article key={row.key}>
                  <div>
                    <strong>
                      {formatDigits(row.description || t(kinds[row.kind]))}
                    </strong>
                    <small>
                      {date(row.date, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                      {row.works ? ` · ${formatDigits(row.works)}` : ""}
                    </small>
                    {row.historical ? (
                      <small>{t("পুরোনো খরচ; পরিশোধ জানা নেই")}</small>
                    ) : null}
                  </div>
                  <div className={`shared-row-amount shared-kind-${row.kind}`}>
                    <strong>{money(Math.abs(row.charge || row.paid))}</strong>
                    {row.description ? (
                      <small>{t(kinds[row.kind])}</small>
                    ) : null}
                  </div>
                </article>
              ))
            ) : (
              <div className="shared-history-empty">
                <ReceiptIcon size={25} weight="duotone" />
                <p>{t(busy ? "অপেক্ষা করুন…" : "এখানে কোনো লেনদেন নেই")}</p>
              </div>
            )}
            {error ? (
              <p className="share-error" role="alert">
                {t(error)}
              </p>
            ) : null}
            {statement.nextOffset !== null ? (
              <button
                className="secondary-button shared-more"
                disabled={busy}
                onClick={() => void more()}
              >
                {t(busy ? "অপেক্ষা করুন…" : "আরও হিসাব দেখি")}
              </button>
            ) : null}
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
    </main>
  );
}
