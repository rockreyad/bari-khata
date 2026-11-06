import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import {
  ArrowClockwiseIcon,
  CalendarDotsIcon,
  CaretDownIcon,
} from "@phosphor-icons/react";
import { SpendingSeriesChart } from "../../components/ui/SpendingChart";
import { useLanguageContext } from "../../context/LanguageProvider";
import type { SharedMonthlyData } from "./sharedMonthly";
import "./shared-monthly-chart.css";

type Props = {
  data: SharedMonthlyData | null;
  busy: boolean;
  error: string;
  onRetry: () => void;
  hasPaidCorrection?: boolean;
};

export function SharedMonthlyChart({ data, busy, error, onRetry }: Props) {
  const { t, money, date, formatDigits } = useLanguageContext();
  const headingId = useId();
  const [selection, setSelection] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const months = data?.months ?? [];
  const firstMonth = months[0]?.month ?? "";
  const latestMonth = months.at(-1)?.month ?? "";
  const firstYear = Number(firstMonth.slice(0, 4));
  const lastYear = Number(latestMonth.slice(0, 4));
  const years = months.length
    ? Array.from({ length: lastYear - firstYear + 1 }, (_, index) =>
        String(firstYear + index).padStart(4, "0"),
      )
    : [];
  const year = years.includes(selectedYear)
    ? selectedYear
    : latestMonth.slice(0, 4);
  const start =
    year === firstMonth.slice(0, 4) ? Number(firstMonth.slice(5)) : 1;
  const end =
    year === latestMonth.slice(0, 4) ? Number(latestMonth.slice(5)) : 12;
  const byMonth = new Map(months.map((row) => [row.month, row]));
  const visibleMonths = year
    ? Array.from({ length: end - start + 1 }, (_, index) => {
        const month = `${year}-${String(start + index).padStart(2, "0")}`;
        return (
          byMonth.get(month) ?? { month, received: 0, refunded: 0, net: 0 }
        );
      })
    : [];
  const selectedMonth = visibleMonths.find(({ month }) => month === selection);
  const hasUndated = Boolean(
    data && (data.undated.received || data.undated.refunded),
  );
  const ready = Boolean(data) && !busy && !error;
  useEffect(() => {
    const scroll = scrollRef.current;
    if (scroll) scroll.scrollLeft = scroll.scrollWidth;
  }, [year, ready]);

  return (
    <section
      className="shared-monthly-chart"
      aria-labelledby={headingId}
      aria-busy={busy}
    >
      <header className="shared-chart-heading">
        <h2 id={headingId}>
          <CalendarDotsIcon size={17} aria-hidden="true" />
          {t("মাসের হিসাব")}
        </h2>
        {ready && years.length > 1 ? (
          <select
            className="shared-chart-year"
            aria-label={t("বছর বেছে দেখুন")}
            value={year}
            onChange={(event) => {
              setSelectedYear(event.target.value);
              setSelection("");
            }}
          >
            {years.map((value) => (
              <option key={value} value={value}>
                {formatDigits(value)}
              </option>
            ))}
          </select>
        ) : null}
      </header>
      {busy ? (
        <div className="shared-chart-message" role="status">
          <p>{t("মাসের হিসাব আসছে…")}</p>
        </div>
      ) : error ? (
        <div className="shared-chart-message" role="alert">
          <p>
            {t(
              error === "share_monthly_too_large"
                ? "হিসাব অনেক বড়। যিনি পাঠিয়েছেন, তাঁর কাছ থেকে মাসের হিসাব নিন।"
                : "মাসের হিসাব দেখা যায়নি। আবার চেষ্টা করুন।",
            )}
          </p>
          {error !== "share_monthly_too_large" ? (
            <button type="button" className="text-button" onClick={onRetry}>
              <ArrowClockwiseIcon size={16} aria-hidden="true" />
              {t("আবার চেষ্টা করুন")}
            </button>
          ) : null}
        </div>
      ) : data && visibleMonths.length ? (
        <div className="shared-chart-plot-container">
          <div className="shared-chart-scroll" ref={scrollRef}>
            <div
              className="shared-chart-series"
              style={{ "--month-count": visibleMonths.length } as CSSProperties}
            >
              <SpendingSeriesChart
                rows={visibleMonths.map(({ month, received }) => ({
                  month,
                  material: 0,
                  labour: 0,
                  other: 0,
                  total: received,
                }))}
                title="মাসের হিসাব"
                basis="paid"
                presentation="embedded"
                selectedMonth={selection}
                onMonthChange={setSelection}
              />
            </div>
          </div>
          {selectedMonth ? (
            <div className="shared-chart-selection-info">
              <output aria-label={t("পেয়েছেন")}>
                <span>
                  {date(`${selectedMonth.month}-01`, {
                    day: undefined,
                    month: "long",
                    year: "numeric",
                  })}
                </span>
                <strong>{money(selectedMonth.received)}</strong>
              </output>
              {selectedMonth.refunded > 0 ? (
                <dl className="shared-chart-refunds" aria-live="polite">
                  <div>
                    <dt>{t("ফেরত দিয়েছেন")}</dt>
                    <dd>{money(selectedMonth.refunded)}</dd>
                  </div>
                  <div>
                    <dt>{t("ফেরত বাদে পেয়েছেন")}</dt>
                    <dd>{money(selectedMonth.net)}</dd>
                  </div>
                </dl>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="shared-chart-message">
          <p>
            {t(
              hasUndated
                ? "তারিখ লেখা হলে মাসের হিসাবে দেখা যাবে।"
                : "টাকা দেওয়া হলে মাসের হিসাব এখানে দেখবেন।",
            )}
          </p>
        </div>
      )}
      {ready && hasUndated && data ? (
        <details className="shared-chart-undated">
          <summary>
            <span>{t("তারিখ ছাড়া পাওয়া টাকা")}</span>
            <strong>{money(data.undated.received)}</strong>
            <CaretDownIcon size={15} aria-hidden="true" />
          </summary>
          <p>{t("তারিখ নেই বলে কোনো মাসে ধরা হয়নি।")}</p>
          {data.undated.refunded > 0 ? (
            <dl className="shared-chart-refunds">
              <div>
                <dt>{t("ফেরত দিয়েছেন")}</dt>
                <dd>{money(data.undated.refunded)}</dd>
              </div>
              <div>
                <dt>{t("ফেরত বাদে পেয়েছেন")}</dt>
                <dd>{money(data.undated.net)}</dd>
              </div>
            </dl>
          ) : null}
        </details>
      ) : null}
    </section>
  );
}
