import { useId, useMemo, useState } from "react";
import { ChartLineUpIcon } from "@phosphor-icons/react";
import type { Ledger } from "../../domain/model";
import { useLanguageContext } from "../../context/LanguageProvider";
import {
  monthlySpending,
  smoothSpendingPath,
  spendingCategories,
  type SpendingScope,
} from "./monthlySpending";
import "./spending-chart.css";

const categoryNames = {
  material: "কেনাকাটা",
  labour: "মিস্ত্রির খরচ",
  other: "অন্য খরচ",
} as const;
export function SpendingChart({
  ledger,
  workId,
  personId,
  account,
  title = "মাসে মাসে খরচ",
}: SpendingScope & { ledger: Ledger; title?: string }) {
  const { t, money, date } = useLanguageContext();
  const rows = useMemo(
    () => monthlySpending(ledger, { workId, personId, account }),
    [ledger, workId, personId, account],
  );
  const [selectedMonth, setSelectedMonth] = useState("");
  const id = useId().replaceAll(":", "");
  if (!rows.length) return null;
  const selected =
    rows.find((row) => row.month === selectedMonth) ?? rows[rows.length - 1];
  const selectedIndex = rows.indexOf(selected);
  const categories = spendingCategories.filter((category) =>
    rows.some((row) => row[category] !== 0),
  );
  if (!categories.length) return null;
  const values = rows.flatMap((row) =>
    categories.map((category) => row[category]),
  );
  const low = Math.min(0, ...values),
    high = Math.max(0, ...values);
  const range = high - low || 1;
  const x = (index: number) => 14 + index * 59.2;
  const y = (value: number) => 114 - ((value - low) / range) * 98;
  const baseline = y(0);
  const monthName = (month: string, long = false) =>
    date(`${month}-01`, {
      day: undefined,
      month: long ? "long" : "short",
      ...(long ? { year: "numeric" } : {}),
    });
  return (
    <section className="spending-chart-card" aria-label={t(title)}>
      <header className="spending-chart-header">
        <div>
          <span className="spending-chart-caption">
            <ChartLineUpIcon size={17} weight="duotone" />
            {t(title)}
          </span>
          <h2>{money(selected.total)}</h2>
        </div>
        <span className="spending-chart-period">
          {monthName(selected.month, true)}
        </span>
      </header>
      <svg
        className="spending-chart-plot"
        viewBox="0 0 324 135"
        role="img"
        aria-label={t("মাসভিত্তিক খরচের রেখাচিত্র")}
      >
        <defs>
          {categories.map((category) => (
            <linearGradient
              id={`${id}-${category}`}
              key={category}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="0%"
                stopColor={`var(--chart-${category})`}
                stopOpacity="0.18"
              />
              <stop
                offset="100%"
                stopColor={`var(--chart-${category})`}
                stopOpacity="0"
              />
            </linearGradient>
          ))}
        </defs>
        {[16, 65, 114].map((value) => (
          <line
            key={value}
            x1="14"
            x2="310"
            y1={value}
            y2={value}
            className="spending-chart-grid"
          />
        ))}
        <line
          x1={x(selectedIndex)}
          x2={x(selectedIndex)}
          y1="10"
          y2="122"
          className="spending-chart-selection"
        />
        {categories.map((category) => {
          const points = rows.map((row, index) => ({
            x: x(index),
            y: y(row[category]),
          }));
          const path = smoothSpendingPath(points);
          return (
            <g key={category}>
              <path
                d={`${path} L ${x(rows.length - 1)} ${baseline} L ${x(0)} ${baseline} Z`}
                fill={`url(#${id}-${category})`}
              />
              <path
                d={path}
                fill="none"
                stroke={`var(--chart-${category})`}
                strokeWidth="2.5"
                strokeLinecap="round"
                className="spending-chart-line"
              />
              <circle
                cx={x(selectedIndex)}
                cy={y(selected[category])}
                r="4.5"
                fill={`var(--chart-${category})`}
                className="spending-chart-dot"
              />
            </g>
          );
        })}
      </svg>
      <div
        className="spending-chart-months"
        aria-label={t("চার্টের মাস বেছে নিন")}
      >
        {rows.map((row) => (
          <button
            type="button"
            key={row.month}
            aria-pressed={row.month === selected.month}
            aria-label={monthName(row.month, true)}
            onClick={() => setSelectedMonth(row.month)}
          >
            {monthName(row.month)}
          </button>
        ))}
      </div>
      <dl className="spending-chart-legend">
        {categories.map((category) => (
          <div key={category}>
            <dt>
              <i style={{ background: `var(--chart-${category})` }} />
              {t(categoryNames[category])}
            </dt>
            <dd>{money(selected[category])}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
