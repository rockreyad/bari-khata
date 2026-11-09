import { useMemo } from "react";
import { useLanguageContext } from "../../context/LanguageProvider";
import { personKind } from "../../domain/contacts";
import type { Ledger, Person } from "../../domain/model";
import { LedgerSearchSummary } from "./LedgerSearchSummary";
import { LedgerSearchNotes } from "./LedgerSearchNotes";
import { personLedgerSummary } from "./personLedgerTotals";
import type { LedgerSearchResult } from "./searchAnalytics";

export function PartyLedgerSummary({
  ledger,
  person,
  result,
  workId,
  kind,
  costType,
  material,
  month,
  onMonthChange,
}: {
  ledger: Ledger;
  person: Person;
  result: LedgerSearchResult | null;
  workId: string;
  kind: string;
  costType: string;
  material: string;
  month: string;
  onMonthChange: (month: string) => void;
}) {
  const { t, money, number, date } = useLanguageContext();
  const cash = useMemo(() => {
    if (!result || result.materialInvalid || result.monthInvalid) return null;
    try {
      return personLedgerSummary(ledger, result.entries, {
        personId: person.id,
        workId: workId || undefined,
      });
    } catch {
      return null;
    }
  }, [ledger, result, person.id, workId]);
  if (!result || result.materialInvalid || result.monthInvalid || !cash)
    return (
      <LedgerSearchSummary
        result={result?.materialInvalid || result?.monthInvalid ? result : null}
        month={month}
        onMonthChange={onMonthChange}
      />
    );

  const correctionsOnly =
    kind === "adjustment" ||
    (!kind &&
      !material &&
      !costType &&
      cash.cashEntryCount === 0 &&
      result.costEntryCount === 0 &&
      cash.adjustmentEntryCount > 0);
  const returnsOnly = kind === "expense_credit";
  const cashOnly = kind === "payment" || kind === "refund";
  const showCost =
    !correctionsOnly &&
    !cashOnly &&
    !returnsOnly &&
    Boolean(
      kind === "expense" ||
      material ||
      costType ||
      (result.costEntryCount > 0 &&
        (personKind(person) === "shop" ||
          (cash.cashEntryCount === 0 && cash.adjustmentCounts.paid === 0))),
    );
  const refundsOnly =
    kind === "refund" ||
    (kind !== "payment" &&
      cash.paymentEntryCount === 0 &&
      cash.refundEntryCount > 0 &&
      cash.adjustmentCounts.paid === 0);
  const showCashParts = cash.refunds !== 0 || cash.paidCorrection !== 0;
  const unresolvedNote =
    cash.unresolvedAdjustmentCount > 0 ? (
      <p className="ledger-party-note" role="status">
        {t("{{count}}টি সংশোধন যাচাই বাকি। সেগুলো মোটে ধরা হয়নি।", {
          count: number(cash.unresolvedAdjustmentCount),
        })}
      </p>
    ) : null;
  const cashDetails = (
    <>
      <dl className="ledger-search-parts ledger-party-parts">
        {showCost &&
        (cash.cashEntryCount > 0 || cash.adjustmentCounts.paid > 0) ? (
          <div>
            <dt>{t("মোট টাকা দিয়েছি")}</dt>
            <dd>{money(cash.netPaid)}</dd>
          </div>
        ) : null}
        {showCashParts ? (
          <>
            <div>
              <dt>{t("লেনদেনে দিয়েছি")}</dt>
              <dd>{money(cash.paid)}</dd>
            </div>
            {cash.refunds !== 0 ? (
              <div>
                <dt>{t("ফেরত পেয়েছি")}</dt>
                <dd>{money(cash.refunds)}</dd>
              </div>
            ) : null}
            {cash.paidCorrection !== 0 ? (
              <div>
                <dt>{t("দেওয়া টাকার সংশোধন")}</dt>
                <dd>{money(cash.paidCorrection)}</dd>
              </div>
            ) : null}
          </>
        ) : null}
        {!showCost && result.costEntryCount > 0 ? (
          <div>
            <dt>{t("বিলের মোট")}</dt>
            <dd>{money(result.totalCost)}</dd>
          </div>
        ) : null}
      </dl>
      {cash.historicalCashEntryCount > 0 ? (
        <p className="ledger-party-note">
          {t("{{count}}টি পুরোনো লেনদেন এই মোটে ধরা হয়নি।", {
            count: number(cash.historicalCashEntryCount),
          })}
        </p>
      ) : null}
      {unresolvedNote}
    </>
  );
  if (showCost || returnsOnly)
    return (
      <LedgerSearchSummary
        result={result}
        month={month}
        onMonthChange={onMonthChange}
        details={showCost ? cashDetails : undefined}
        variant={returnsOnly ? "returns" : "cost"}
      />
    );

  const label = correctionsOnly
    ? "হিসাবের সংশোধন"
    : refundsOnly
      ? "মোট ফেরত পেয়েছি"
      : "মোট টাকা দিয়েছি";
  const count = correctionsOnly
    ? cash.adjustmentEntryCount
    : cash.cashEntryCount;
  return (
    <section className="ledger-search-summary" aria-label={t("খোঁজার হিসাব")}>
      <div className="ledger-search-total">
        <div className="ledger-search-total-heading">
          <span>{t(label)}</span>
        </div>
        <output className="ledger-search-total-value" aria-live="polite">
          {correctionsOnly
            ? number(count)
            : money(refundsOnly ? cash.refunds : cash.netPaid)}
        </output>
        {correctionsOnly ? (
          <dl className="ledger-search-parts ledger-party-parts">
            {(
              [
                ["paid", "দেওয়া টাকার সংশোধন"],
                ["cost", "বিলের সংশোধন"],
                ["balance", "বাকি টাকার সংশোধন"],
              ] as const
            ).map(([basis, title]) =>
              cash.adjustmentCounts[basis] > 0 ? (
                <div key={basis}>
                  <dt>{t(title)}</dt>
                  <dd>
                    {cash.adjustmentAmounts[basis] === null
                      ? t("যাচাই বাকি")
                      : money(cash.adjustmentAmounts[basis])}
                  </dd>
                </div>
              ) : null,
            )}
          </dl>
        ) : (
          cashDetails
        )}
        {correctionsOnly ? unresolvedNote : null}
        <div className="ledger-search-context">
          <span>
            {t(
              correctionsOnly ? "{{count}}টি হিসাব" : "{{count}}টি টাকা লেনদেন",
              {
                count: number(count),
              },
            )}
            {month
              ? ` · ${month === "undated" ? t("তারিখ লেখা নেই") : date(`${month}-01`, { day: undefined, month: "long", year: "numeric" })}`
              : ""}
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
      {correctionsOnly ? (
        <p className="ledger-search-note">
          {t("এগুলো আগের হিসাবের সংশোধন; নতুন টাকা দেওয়া বা খরচ নয়।")}
        </p>
      ) : cash.cashEntryCount === 0 && cash.adjustmentCounts.paid === 0 ? (
        <p className="ledger-search-note">
          {t("এই বাছাইয়ে টাকা দেওয়া বা ফেরত পাওয়ার হিসাব নেই।")}
        </p>
      ) : cash.refunds !== 0 || cash.paidCorrection !== 0 ? (
        <p className="ledger-search-note">
          {t("টাকা দেওয়া, ফেরত ও দেওয়া টাকার সংশোধন আলাদা দেখানো হয়েছে।")}
        </p>
      ) : null}
      <LedgerSearchNotes result={result} showCostContext={false} />
    </section>
  );
}
