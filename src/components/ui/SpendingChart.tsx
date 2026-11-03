import {
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { CalendarDotsIcon } from "@phosphor-icons/react";
import type { Ledger } from "../../domain/model";
import { useLanguageContext } from "../../context/LanguageProvider";
import {
  monthlySpending,
  monthlyCashSpending,
  smoothSpendingPath,
  spendingCategories,
  type SpendingCategory,
  type SpendingScope,
} from "./monthlySpending";
import "./spending-chart.css";

const categoryNames = {
  material: "কেনাকাটা",
  labour: "মিস্ত্রির খরচ",
  other: "অন্য খরচ",
} as const;
const paidCategoryNames = {
  material: "মালের টাকা",
  labour: "মিস্ত্রির টাকা",
  other: "অন্য টাকা",
} as const;
type Series = SpendingCategory | "total";
export function SpendingChart({
  ledger,
  workId,
  personId,
  account,
  title = "মাসে মাসে খরচ",
  basis = "cost",
  presentation = "card",
}: SpendingScope & {
  ledger: Ledger;
  title?: string;
  basis?: "cost" | "paid";
  presentation?: "card" | "embedded";
}) {
  const { t, money, date } = useLanguageContext();
  const rows = useMemo(
    () =>
      (basis === "paid" ? monthlyCashSpending : monthlySpending)(ledger, {
        workId,
        personId,
        account,
      }),
    [ledger, workId, personId, account, basis],
  );
  const [selectedMonth, setSelectedMonth] = useState("");
  const nodeButtons = useRef(new Map<string, HTMLButtonElement>());
  const id = useId().replaceAll(":", "");
  if (!rows.length) return null;
  const embedded = presentation === "embedded";
  const chosen = rows.find((row) => row.month === selectedMonth);
  const selected = chosen ?? rows[rows.length - 1];
  const hasSelection = !embedded || Boolean(chosen);
  const selectedIndex = rows.indexOf(selected);
  const categories = spendingCategories.filter((category) =>
    rows.some((row) => row[category] !== 0),
  );
  const series: Series[] =
    embedded || !categories.length ? ["total"] : categories;
  const values = rows.flatMap((row) => series.map((category) => row[category]));
  const low = Math.min(0, ...values),
    high = Math.max(0, ...values);
  const range = high - low || 1;
  const x = (index: number) => 27 + index * 54;
  const y = (value: number) => 114 - ((value - low) / range) * 98;
  const baseline = y(0);
  const monthName = (month: string, long = false) =>
    date(`${month}-01`, {
      day: undefined,
      month: long ? "long" : "short",
      ...(long ? { year: "numeric" } : {}),
    });
  const categoryName = (category: SpendingCategory) =>
    t((basis === "paid" ? paidCategoryNames : categoryNames)[category]);
  const nodeKey = (category: Series, month: string) => `${category}:${month}`;
  const selectByKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    category: Series,
    index: number,
  ) => {
    const next =
      event.key === "ArrowLeft"
        ? Math.max(index - 1, 0)
        : event.key === "ArrowRight"
          ? Math.min(index + 1, rows.length - 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? rows.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    setSelectedMonth(rows[next].month);
    nodeButtons.current.get(nodeKey(category, rows[next].month))?.focus();
  };
  const calloutEdge =
    selectedIndex < 2
      ? "start"
      : selectedIndex >= rows.length - 2
        ? "end"
        : "center";
  const calloutBelow = y(selected.total) < 40;
  const chartTitle = embedded ? "মাসের হিসাব" : title;
  const showLegend =
    categories.length > 0 &&
    (!embedded || (hasSelection && categories.length > 1));
  return (
    <section
      className={`spending-chart-card${embedded ? " is-embedded" : ""}`}
      aria-label={t(chartTitle)}
    >
      <header className="spending-chart-header">
        <div>
          <span className="spending-chart-caption">
            <CalendarDotsIcon size={17} weight="regular" aria-hidden="true" />
            {t(chartTitle)}
          </span>
          {!embedded ? <h2>{money(selected.total)}</h2> : null}
        </div>
        {!embedded ? (
          <span className="spending-chart-period">
            {monthName(selected.month, true)}
          </span>
        ) : null}
      </header>
      <div className="spending-chart-canvas">
        <svg
          className="spending-chart-plot"
          viewBox="0 0 324 135"
          preserveAspectRatio="none"
          role="img"
          aria-label={t("মাসভিত্তিক খরচের রেখাচিত্র")}
        >
          <defs>
            {series.map((category) => (
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
          {hasSelection ? (
            <line
              x1={x(selectedIndex)}
              x2={x(selectedIndex)}
              y1="10"
              y2="122"
              className="spending-chart-selection"
            />
          ) : null}
          {series.map((category) => {
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
                  vectorEffect="non-scaling-stroke"
                  strokeLinecap="round"
                  strokeDasharray={
                    category === "labour"
                      ? "6 4"
                      : category === "other"
                        ? "2 4"
                        : undefined
                  }
                  className="spending-chart-line"
                  data-series={category}
                />
              </g>
            );
          })}
        </svg>
        <div
          className="spending-chart-nodes"
          role="group"
          aria-label={t("গ্রাফের মাস বেছে নিন")}
        >
          {series.flatMap((category) =>
            rows.map((row, index) => {
              const key = nodeKey(category, row.month);
              return (
                <button
                  type="button"
                  key={key}
                  ref={(element) => {
                    if (element) nodeButtons.current.set(key, element);
                    else nodeButtons.current.delete(key);
                  }}
                  className="spending-chart-node"
                  style={
                    {
                      left: `${(x(index) / 324) * 100}%`,
                      top: `${(y(row[category]) / 135) * 100}%`,
                      "--node-color": `var(--chart-${category})`,
                    } as CSSProperties
                  }
                  aria-label={
                    category === "total"
                      ? t("{{month}} · {{amount}}", {
                          month: monthName(row.month, true),
                          amount: money(row.total),
                        })
                      : t("{{month}} · {{category}} · {{amount}}", {
                          month: monthName(row.month, true),
                          category: categoryName(category),
                          amount: money(row[category]),
                        })
                  }
                  aria-pressed={hasSelection && row.month === selected.month}
                  data-selected={Boolean(chosen) && row.month === chosen?.month}
                  tabIndex={index === selectedIndex ? 0 : -1}
                  onClick={() => setSelectedMonth(row.month)}
                  onKeyDown={(event) =>
                    selectByKeyboard(event, category, index)
                  }
                >
                  <span className="spending-chart-node-dot" />
                </button>
              );
            }),
          )}
        </div>
        {embedded && hasSelection ? (
          <output
            className={`spending-chart-callout is-${calloutEdge}${calloutBelow ? " is-below" : ""}`}
            aria-live="polite"
            style={{
              ...(calloutEdge === "start"
                ? { left: 8 }
                : calloutEdge === "end"
                  ? { right: 8 }
                  : { left: "50%" }),
              top: `${(y(selected.total) / 135) * 100}%`,
            }}
          >
            <span>{monthName(selected.month, true)}</span>
            <strong>{money(selected.total)}</strong>
          </output>
        ) : null}
      </div>
      <div
        className="spending-chart-months"
        role="group"
        aria-label={t("চার্টের মাস বেছে নিন")}
      >
        {rows.map((row) => (
          <button
            type="button"
            key={row.month}
            aria-pressed={hasSelection && row.month === selected.month}
            aria-label={monthName(row.month, true)}
            onClick={() => setSelectedMonth(row.month)}
          >
            {monthName(row.month)}
          </button>
        ))}
      </div>
      {showLegend ? (
        <dl className="spending-chart-legend">
          {categories.map((category) => (
            <div key={category}>
              <dt>
                <i style={{ background: `var(--chart-${category})` }} />
                {categoryName(category)}
              </dt>
              <dd>{money(selected[category])}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
