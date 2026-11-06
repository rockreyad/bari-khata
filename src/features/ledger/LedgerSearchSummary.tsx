import { useId, useState } from "react";
import { CalendarDotsIcon, CaretDownIcon } from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import { SpendingSeriesChart } from "../../components/ui/SpendingChart";
import type { LedgerSearchResult } from "./searchAnalytics";
import "./ledger-search.css";

export function LedgerSearchSummary({
  result,
  month,
  onMonthChange,
}: {
  result: LedgerSearchResult | null;
  month: string;
  onMonthChange: (month: string) => void;
}) {
  const { t, money, number, date } = useLanguageContext();
  const [expanded, setExpanded] = useState(Boolean(month));
  const chartId = useId();
  const invalidScope = result?.materialInvalid || result?.monthInvalid;
  const groupAmbiguities = new Set(result?.groupAmbiguousEntryIds ?? []);
  const otherAmbiguityCount =
    result?.ambiguousEntryIds.filter((id) => !groupAmbiguities.has(id))
      .length ?? 0;
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
              <span>{t("মোট খরচ")}</span>
              {result.monthlyRows.length ? (
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
              {money(result.totalCost)}
            </output>
            {result.returns > 0 ? (
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
            <div className="ledger-search-context">
              <span>
                {t("{{count}}টি খরচের হিসাব", {
                  count: number(result.costEntryCount),
                })}
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
          {expanded && result.monthlyRows.length ? (
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
              <strong>{money(result.baseUndatedCost)}</strong>
            </button>
          ) : null}
          {otherAmbiguityCount > 0 ? (
            <p className="ledger-search-note" role="status">
              {t(
                "{{count}}টি বিল শুধু অন্য তথ্যে মিলেছে। সেগুলো খরচের মোটে ধরা হয়নি।",
                { count: number(otherAmbiguityCount) },
              )}
            </p>
          ) : null}
          {groupAmbiguities.size > 0 ? (
            <p className="ledger-search-note" role="status">
              {t(
                "কিছু লেখায় একাধিক মালের নাম বা ধরন মিলেছে। অস্পষ্ট অংশ এই মালের মোটে ধরা হয়নি।",
              )}
            </p>
          ) : null}
          {result.partiallyAmbiguousEntryIds?.length ? (
            <p className="ledger-search-note" role="status">
              {t(
                "কিছু ফেরতের মালের পরিচয় মেলেনি। শুধু নিশ্চিত অংশ মোটে ধরা হয়েছে।",
              )}
            </p>
          ) : null}
          {result.unassignedAdjustmentCount > 0 ? (
            <p className="ledger-search-note">
              {t(
                "মোট খরচে বিল ও মালের ফেরত আছে। আলাদা সমন্বয় এখানে যোগ করা হয়নি।",
              )}
            </p>
          ) : null}
          {result.reviewEntryCount > 0 || result.historicalEntryCount > 0 ? (
            <p className="ledger-search-note">
              {[
                result.reviewEntryCount > 0
                  ? t("{{count}}টি হিসাব যাচাই বাকি", {
                      count: number(result.reviewEntryCount),
                    })
                  : "",
                result.historicalEntryCount > 0
                  ? t("{{count}}টি পুরোনো খরচের হিসাব আছে", {
                      count: number(result.historicalEntryCount),
                    })
                  : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          {result.costEntryCount === 0 && result.entries.length > 0 ? (
            <p className="ledger-search-note">
              {t(
                "এই বাছাইয়ে খরচের বিল নেই। টাকা দেওয়ার রেকর্ড খরচে আবার যোগ হয় না।",
              )}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
