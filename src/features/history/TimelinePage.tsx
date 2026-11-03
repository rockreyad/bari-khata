import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ClockCounterClockwiseIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { latinDigits } from "../../lib/numerals";
import {
  notebookTimeline,
  type TimelineCategory,
  type TimelineEvent,
} from "./timeline";
import "./timeline.css";

const filters = [
  ["all", "সব ঘটনা"],
  ["money", "হিসাব"],
  ["notebooks", "খাতা"],
  ["jobs", "মিস্ত্রির কাজ"],
  ["removed", "সরানো ও ফেরানো"],
] as const;
const normalize = (text: string) =>
  latinDigits(text).normalize("NFKC").toLocaleLowerCase().trim();
export function TimelinePage() {
  const { ledger, go, detail } = useNotebook();
  const { t, date, money, formatDigits } = useLanguageContext();
  const [params, setParams] = useSearchParams();
  const [limit, setLimit] = useState(40);
  const raw = params.get("type") ?? "all";
  const type = filters.some(([value]) => value === raw) ? raw : "all";
  const query = params.get("q") ?? "";
  const events = useMemo(() => notebookTimeline(ledger), [ledger]);
  const matching = useMemo(
    () =>
      events.filter(
        (event) =>
          (type === "all" || event.category === (type as TimelineCategory)) &&
          normalize(
            [
              t(event.title),
              event.subject,
              event.note,
              ...event.changes.map((field) => t(field)),
            ].join(" "),
          ).includes(normalize(query)),
      ),
    [events, type, query, t],
  );
  function filter(key: string, value: string) {
    setLimit(40);
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value && value !== "all") next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  }
  function open(event: TimelineEvent) {
    if (event.target.kind === "entry") detail(event.target.id);
    else if (event.target.kind === "work")
      go(`/works/${encodeURIComponent(event.target.id)}?tab=activity`);
    else if (event.target.kind === "job")
      go(`/jobs/${encodeURIComponent(event.target.id)}?tab=history`);
    else go(`/people/${encodeURIComponent(event.target.id)}`);
  }
  let previousDay = "";
  return (
    <div className="page-flow timeline-page">
      <button className="back-link" onClick={() => go("/settings")}>
        <ArrowLeftIcon size={17} />
        {t("সেটিংস")}
      </button>
      <header className="page-heading">
        <div>
          <h1>{t("টাইমলাইন")}</h1>
          <p>{t("কখন কী করেছি")}</p>
        </div>
        <ClockCounterClockwiseIcon size={28} aria-hidden="true" />
      </header>
      <p className="helper-text">
        {t("যেসব ঘটনার সময় খাতায় রাখা আছে, সেগুলো এখানে দেখা যায়।")}
      </p>
      <label className="timeline-search">
        <MagnifyingGlassIcon size={20} aria-hidden="true" />
        <input
          aria-label={t("টাইমলাইনে খুঁজুন")}
          placeholder={t("নাম বা কারণ লিখুন")}
          value={query}
          onChange={(event) => filter("q", event.target.value)}
        />
      </label>
      <div
        className="timeline-filters"
        role="group"
        aria-label={t("কোন ঘটনা দেখব")}
      >
        {filters.map(([value, label]) => (
          <button
            key={value}
            className={type === value ? "selected" : ""}
            aria-pressed={type === value}
            onClick={() => filter("type", value)}
          >
            {t(label)}
          </button>
        ))}
      </div>
      {matching.length ? (
        <ol className="timeline-list">
          {matching.slice(0, limit).map((event) => {
            const day = date(event.at, {
              year: "numeric",
              month: "long",
              day: "numeric",
            });
            const newDay = day !== previousDay;
            previousDay = day;
            return (
              <li
                key={event.id}
                className={`timeline-event timeline-${event.category}`}
              >
                {newDay ? <h2>{day}</h2> : null}
                <button
                  className="timeline-event-card"
                  onClick={() => open(event)}
                >
                  <span className="timeline-marker" aria-hidden="true" />
                  <span className="timeline-event-copy">
                    <strong>{t(event.title)}</strong>
                    <span>{formatDigits(event.subject)}</span>
                    {event.amount !== undefined ? (
                      <span className="timeline-event-money">
                        {event.before !== undefined &&
                        event.before !== event.amount ? (
                          <>
                            <del>{money(event.before)}</del>
                            <ArrowRightIcon size={13} aria-hidden="true" />
                          </>
                        ) : null}
                        <b>{money(event.amount)}</b>
                      </span>
                    ) : null}
                    {event.changes.length ? (
                      <small>
                        {event.changes.map((field) => t(field)).join(" · ")}
                      </small>
                    ) : null}
                    {event.statusChange ? (
                      <small>
                        {t(event.statusChange.before)}{" "}
                        <span aria-hidden="true">→</span>{" "}
                        {t(event.statusChange.after)}
                      </small>
                    ) : null}
                    {event.note ? (
                      <small className="timeline-event-note">
                        {formatDigits(event.note)}
                      </small>
                    ) : null}
                  </span>
                  <time dateTime={event.at}>
                    {date(event.at, {
                      hour: "numeric",
                      minute: "2-digit",
                      day: undefined,
                      month: undefined,
                      year: undefined,
                    })}
                  </time>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="empty-panel">
          <ClockCounterClockwiseIcon size={30} />
          <p>{t("এখানে কোনো ঘটনা পাওয়া যায়নি।")}</p>
        </div>
      )}
      {matching.length > limit ? (
        <button
          className="secondary-button"
          onClick={() => setLimit((current) => current + 40)}
        >
          {t("আরও ঘটনা দেখুন")}
        </button>
      ) : null}
    </div>
  );
}
