import { useId, useState, type ReactNode } from "react";
import { CalendarDotsIcon, CaretDownIcon } from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import { SpendingSeriesChart } from "../../components/ui/SpendingChart";
import { LedgerSearchNotes } from "./LedgerSearchNotes";
import type { LedgerSearchResult } from "./searchAnalytics";
import "./ledger-search.css";

export function LedgerSearchSummary({
  result,
  month,
  onMonthChange,
  details,
  variant = "cost",
}: {
  result: LedgerSearchResult | null;
  month: string;
  onMonthChange: (month: string) => void;
  details?: ReactNode;
  variant?: "cost" | "returns";
}) {
  const { t, money, number, date } = useLanguageContext();
  const [expanded, setExpanded] = useState(Boolean(month));
  const chartId = useId();
  const invalidScope = result?.materialInvalid || result?.monthInvalid;
  return (
    <section className="ledger-search-summary" aria-label={t("খোঁজার হিসাব")}>
      {!result || invalidScope ? (
        <div className="ledger-search-total">
          <p className="ledger-search-note" role="status">
            {t(
              invalidScope
                ? "বাছাইটি পাওয়া যায়নি। আবার বেছে নিন।"
                : "টাকার অঙ্ক বেশি হয়েছে।",
            )}
          </p>
          {result?.monthInvalid ? (
            <button
              type="button"
              className="text-button"
              onClick={() => onMonthChange("")}
            >
              {t("সব মাস দেখুন")}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="ledger-search-total">
            <div className="ledger-search-total-heading">
              <span>
                {t(variant === "returns" ? "ফেরত দেওয়া মালের মোট" : "মোট খরচ")}
              </span>
              {variant === "cost" && result.monthlyRows.length ? (
                <button
                  type="button"
                  className="ledger-search-chart-toggle"
                  aria-expanded={expanded}
                  aria-controls={chartId}
                  onClick={() => setExpanded((current) => !current)}
                >
                  <CalendarDotsIcon size={17} aria-hidden="true" />
                  {t("মাসে মাসে")}
                  <CaretDownIcon size={14} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <output className="ledger-search-total-value" aria-live="polite">
              {money(variant === "returns" ? result.returns : result.totalCost)}
            </output>
            {variant === "cost" && result.returns > 0 ? (
              <dl className="ledger-search-parts">
                <div>
                  <dt>{t("কেনা")}</dt>
                  <dd>{money(result.purchases)}</dd>
                </div>
                <div>
                  <dt>{t("মাল ফেরত")}</dt>
                  <dd>{money(result.returns)}</dd>
                </div>
              </dl>
            ) : null}
            {details}
            <div className="ledger-search-context">
              <span>
                {t(
                  variant === "returns"
                    ? "{{count}}টি মাল ফেরতের হিসাব"
                    : "{{count}}টি খরচের হিসাব",
                  {
                    count: number(result.costEntryCount),
                  },
                )}
                {month ? (
                  <>
                    {" · "}
                    {month === "undated"
                      ? t("তারিখ লেখা নেই")
                      : date(`${month}-01`, {
                          day: undefined,
                          month: "long",
                          year: "numeric",
                        })}
                  </>
                ) : null}
              </span>
              {month ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => onMonthChange("")}
                >
                  {t("সব মাস দেখুন")}
                </button>
              ) : null}
            </div>
          </div>
          {variant === "cost" && expanded && result.monthlyRows.length ? (
            <div id={chartId}>
              <SpendingSeriesChart
                rows={result.monthlyRows}
                selectedMonth={month}
                onMonthChange={onMonthChange}
                presentation="embedded"
                windowed
              />
            </div>
          ) : null}
          {result.baseUndatedEntryCount > 0 ? (
            <button
              type="button"
              className="ledger-search-undated"
              aria-label={t("তারিখ লেখা নেই")}
              aria-pressed={month === "undated"}
              onClick={() =>
                onMonthChange(month === "undated" ? "" : "undated")
              }
            >
              <span>
                {t("তারিখ লেখা নেই")}
                <small>
                  {t("{{count}}টি হিসাব", {
                    count: number(result.baseUndatedEntryCount),
                  })}
                </small>
              </span>
              <strong>
                {money(
                  variant === "returns"
                    ? -result.baseUndatedCost
                    : result.baseUndatedCost,
                )}
              </strong>
            </button>
          ) : null}
          <LedgerSearchNotes result={result} />
        </>
      )}
    </section>
  );
}
