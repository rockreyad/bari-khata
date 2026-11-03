import { useDeferredValue, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ClockCounterClockwiseIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import {
  indexTimeline,
  notebookTimeline,
  normalizeTimelineSearch,
  searchTimeline,
  timelinePage,
  type TimelineEvent,
} from "./timeline";
import "./timeline.css";
import { adjustmentBasisLabels } from "./adjustmentDisplay";

const filters = [
  ["all", "সব ঘটনা"],
  ["money", "হিসাব"],
  ["notebooks", "খাতা"],
  ["jobs", "মিস্ত্রির কাজ"],
  ["removed", "সরানো ও ফেরানো"],
] as const;
export function TimelinePage() {
  const { ledger, go, detail } = useNotebook();
  const { t, date, money, number, formatDigits } = useLanguageContext();
  const [params, setParams] = useSearchParams();
  const raw = params.get("type") ?? "all";
  const type = filters.find(([value]) => value === raw)?.[0] ?? "all";
  const query = params.get("q") ?? "";
  const rawPage = params.get("page");
  const deferredQuery = useDeferredValue(query);
  const searching =
    normalizeTimelineSearch(query) !== normalizeTimelineSearch(deferredQuery);
  const summary = useRef<HTMLParagraphElement>(null);
  const focusPage = useRef(false);
  const events = useMemo(() => notebookTimeline(ledger), [ledger]);
  const index = useMemo(() => indexTimeline(events, t), [events, t]);
  const matching = useMemo(
    () => searchTimeline(index, deferredQuery, type),
    [index, type, deferredQuery],
  );
  const current = useMemo(
    () => timelinePage(matching, rawPage),
    [matching, rawPage],
  );
  const canonicalPage = current.page === 1 ? null : String(current.page);
  useEffect(() => {
    if (searching || rawPage === canonicalPage) return;
    setParams(
      (previous) => {
        if (previous.get("page") !== rawPage) return previous;
        const next = new URLSearchParams(previous);
        if (canonicalPage) next.set("page", canonicalPage);
        else next.delete("page");
        return next;
      },
      { replace: true },
    );
  }, [canonicalPage, rawPage, searching, setParams]);
  useEffect(() => {
    if (!focusPage.current) return;
    focusPage.current = false;
    summary.current?.focus({ preventScroll: true });
    summary.current?.scrollIntoView?.({ block: "start" });
  }, [current.page]);
  function filter(key: "type" | "q", value: string) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value && (key !== "type" || value !== "all")) next.set(key, value);
        else next.delete(key);
        next.delete("page");
        return next;
      },
      { replace: true },
    );
  }
  function changePage(page: number) {
    if (searching || page < 1 || page > current.count || page === current.page)
      return;
    focusPage.current = true;
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (page === 1) next.delete("page");
      else next.set("page", String(page));
      return next;
    });
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
      <section className="timeline-results" aria-busy={searching}>
        <p
          className="timeline-result-summary"
          role="status"
          aria-atomic="true"
          tabIndex={-1}
          ref={summary}
        >
          {searching
            ? t("খুঁজছি…")
            : t("{{from}}–{{to}} / {{total}}টি ঘটনা", {
                from: number(current.from),
                to: number(current.to),
                total: number(matching.length),
              })}
        </p>
        {matching.length ? (
          <ol className="timeline-list">
            {current.events.map((event) => {
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
                  data-state={event.state}
                >
                  {newDay ? <h2>{day}</h2> : null}
                  <button
                    className="timeline-event-card"
                    onClick={() => open(event)}
                  >
                    <span className="timeline-marker" aria-hidden="true" />
                    <span className="timeline-event-copy">
                      <span className="timeline-event-action">
                        {t(event.title)}
                      </span>
                      <strong>{formatDigits(event.subject)}</strong>
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
                      {event.adjustmentChange ? (
                        <small>
                          {t(
                            adjustmentBasisLabels[event.adjustmentChange.basis],
                          )}
                          : {money(event.adjustmentChange.before)}
                          {" → "}
                          {money(event.adjustmentChange.after)}
                        </small>
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
                      {event.note &&
                      event.note.trim() !== event.subject.trim() ? (
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
        {current.count > 1 ? (
          <nav
            className="timeline-pagination"
            aria-label={t("টাইমলাইনের পাতা")}
          >
            <button
              type="button"
              onClick={() => changePage(current.page - 1)}
              disabled={searching || current.page === 1}
            >
              <ArrowLeftIcon size={16} aria-hidden="true" />
              {t("আগের পাতা")}
            </button>
            <span>
              {t("{{page}} / {{total}} পাতা", {
                page: number(current.page),
                total: number(current.count),
              })}
            </span>
            <button
              type="button"
              onClick={() => changePage(current.page + 1)}
              disabled={searching || current.page === current.count}
            >
              {t("পরের পাতা")}
              <ArrowRightIcon size={16} aria-hidden="true" />
            </button>
          </nav>
        ) : null}
      </section>
    </div>
  );
}
