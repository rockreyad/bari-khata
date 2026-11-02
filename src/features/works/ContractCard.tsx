import { useMemo, useState } from "react";
import {
  ArrowRightIcon,
  ClockCounterClockwiseIcon,
  PencilSimpleIcon,
} from "@phosphor-icons/react";
import { BalanceProgress } from "../../components/ui/BalanceProgress";
import { LoadMore } from "../../components/ui/LoadMore";
import { useLanguageContext } from "../../context/LanguageProvider";
import { contractChanges } from "../../domain/contracts";
import { contractSummary } from "../../domain/ledger";
import type { Contract, ContractSnapshot, Ledger } from "../../domain/model";
import { jobName } from "../jobs/jobView";
import "./contract-card.css";

type HistoryEvent = {
  id: string;
  at: string;
  before: ContractSnapshot | null;
  after: ContractSnapshot | null;
  total: number;
  reason: string;
  created: boolean;
  legacy: boolean;
};
const fieldNames: Record<keyof ContractSnapshot, string> = {
  title: "কাজের নাম",
  status: "অবস্থা",
  personId: "মিস্ত্রি",
  scope: "কাজের খাতা",
  workId: "কাজের খাতা",
  basis: "মজুরি ঠিক হয়েছে",
  quantity: "পরিমাণ",
  rate: "দর",
  total: "ঠিক করা টাকা",
  agreedOn: "কাজের তারিখ",
  notes: "নোট",
};
export function ContractHistory({
  ledger,
  contract,
  alwaysOpen = false,
}: {
  ledger: Ledger;
  contract: Contract;
  alwaysOpen?: boolean;
}) {
  const { t, money, date, formatDigits } = useLanguageContext();
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(12);
  const events = useMemo<HistoryEvent[]>(
    () =>
      [
        ...contract.activity.map((event) => ({
          id: `activity-${event.id}`,
          at: event.at,
          before: event.before,
          after: event.after,
          total: event.after.total,
          reason: event.reason,
          created: event.before === null,
          legacy: false,
        })),
        ...contract.history.map((event, index) => ({
          id: `legacy-${index}`,
          at: event.at,
          before: null,
          after: null,
          total: event.total,
          reason: event.note,
          created: false,
          legacy: true,
        })),
      ].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0)),
    [contract],
  );
  function value(snapshot: ContractSnapshot, key: keyof ContractSnapshot) {
    if (key === "workId" || key === "scope")
      return snapshot.scope === "house"
        ? t("সব খাতা")
        : formatDigits(
            ledger.works.find((work) => work.id === snapshot.workId)?.name ??
              t("লেখা নেই"),
          );
    if (key === "status")
      return t(
        snapshot.status === "planned"
          ? "শুরু হয়নি"
          : snapshot.status === "ongoing"
            ? "চলছে"
            : snapshot.status === "done"
              ? "শেষ"
              : "অবস্থা লেখা নেই",
      );
    if (key === "personId")
      return formatDigits(
        ledger.people.find((person) => person.id === snapshot.personId)?.name ??
          t("লেখা নেই"),
      );
    if (key === "total" || key === "rate") return money(snapshot[key]);
    if (key === "basis")
      return t(
        snapshot.basis === "fixed"
          ? "মোট টাকা"
          : snapshot.basis === "day"
            ? "প্রতি দিন"
            : "প্রতি বর্গফুট",
      );
    if (key === "agreedOn")
      return snapshot.agreedOn
        ? date(snapshot.agreedOn, { year: "numeric" })
        : t("লেখা নেই");
    if (key === "title") return formatDigits(jobName(snapshot, t));
    return formatDigits(snapshot[key] || t("লেখা নেই"));
  }
  function fields(event: HistoryEvent): (keyof ContractSnapshot)[] {
    if (!event.after) return [];
    if (!event.before)
      return (
        [
          "title",
          "status",
          "basis",
          ...(event.after.basis === "fixed" ? [] : ["quantity", "rate"]),
          "agreedOn",
          "notes",
        ] as (keyof ContractSnapshot)[]
      ).filter((key) => Boolean(event.after![key]));
    const changed = contractChanges(event.before, event.after).filter(
      (key) =>
        key !== "total" &&
        key !== "scope" &&
        !(
          key === "rate" &&
          event.before?.basis === "fixed" &&
          event.after?.basis === "fixed" &&
          event.after.rate === event.after.total
        ),
    );
    if (event.before.scope !== event.after.scope && !changed.includes("workId"))
      changed.push("workId");
    return changed;
  }
  if (!events.length)
    return <p className="job-history-empty">{t("এখনও কোনো পরিবর্তন হয়নি।")}</p>;
  const body = (
    <>
      <ol className="contract-history-list" aria-label={t("পরিবর্তনের ইতিহাস")}>
        {events.slice(0, limit).map((event) => {
          const changes = fields(event);
          const validAt = Number.isFinite(Date.parse(event.at));
          return (
            <li key={event.id}>
              <div className="contract-history-heading">
                <strong>
                  {t(
                    event.created
                      ? "কাজ রাখা হয়েছে"
                      : event.legacy
                        ? "আগের লেখা"
                        : "কাজ বদলেছে",
                  )}
                </strong>
                <time dateTime={validAt ? event.at : undefined}>
                  {validAt
                    ? date(event.at, {
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : t("সময় লেখা নেই")}
                </time>
              </div>
              <div className="contract-history-amount">
                {event.before && event.before.total !== event.total ? (
                  <>
                    <span>{money(event.before.total)}</span>
                    <ArrowRightIcon size={14} />
                  </>
                ) : null}
                <strong>{money(event.total)}</strong>
              </div>
              {changes.length && event.after ? (
                <dl className="contract-history-fields">
                  {changes.map((key) => (
                    <div key={key}>
                      <dt>{t(fieldNames[key])}</dt>
                      <dd>
                        {event.before ? (
                          <>
                            <span className="job-before-value">
                              {value(event.before, key)}
                            </span>
                            <ArrowRightIcon size={12} aria-hidden="true" />
                          </>
                        ) : null}
                        <span>{value(event.after!, key)}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {event.reason &&
              !(event.created && event.reason === "চুক্তি করেছি") ? (
                <p className="contract-history-reason">
                  {formatDigits(event.reason)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      <LoadMore
        hasMore={limit < events.length}
        onLoadMore={() => setLimit((current) => current + 12)}
      />
    </>
  );
  return alwaysOpen ? (
    <div className="contract-history is-open">{body}</div>
  ) : (
    <details
      className="contract-history"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>
          <ClockCounterClockwiseIcon size={18} />
          {t("পরিবর্তনের ইতিহাস")}
        </span>
      </summary>
      {open ? body : null}
    </details>
  );
}

export function ContractCard({
  ledger,
  contract,
  heading,
  onEdit,
  showHeading = true,
  showHistory = true,
}: {
  ledger: Ledger;
  contract: Contract;
  heading?: string;
  onEdit?: () => void;
  showHeading?: boolean;
  showHistory?: boolean;
}) {
  const { t, money, date, formatDigits } = useLanguageContext();
  const summary = contractSummary(ledger, contract.id);
  const extra = Math.max(summary.netPaid - contract.total, 0);
  if (!Number.isSafeInteger(summary.remaining) || !Number.isSafeInteger(extra))
    return (
      <p className="form-error" role="alert">
        {t("টাকার অঙ্ক বেশি হয়েছে।")}
      </p>
    );
  return (
    <article
      className="contract-card"
      aria-label={formatDigits(heading || jobName(contract, t))}
    >
      {showHeading ? (
        <header>
          <div>
            <h3>{formatDigits(heading || jobName(contract, t))}</h3>
          </div>
          {onEdit ? (
            <button
              type="button"
              className="icon-button"
              aria-label={t("কাজ বদলাই")}
              onClick={onEdit}
            >
              <PencilSimpleIcon size={19} />
            </button>
          ) : null}
        </header>
      ) : null}
      <div className="job-detail-total">
        <span>{t("মোট টাকা")}</span>
        <strong>{money(contract.total)}</strong>
      </div>
      <dl className="job-detail-money">
        <div>
          <dt>{t("দিয়েছি")}</dt>
          <dd>{money(summary.netPaid)}</dd>
        </div>
        <div>
          <dt>{t("বাকি")}</dt>
          <dd>{money(summary.remaining)}</dd>
        </div>
        {extra > 0 ? (
          <div className="job-extra-paid">
            <dt>{t("বেশি দিয়েছি")}</dt>
            <dd>{money(extra)}</dd>
          </div>
        ) : null}
      </dl>
      <BalanceProgress
        total={contract.total}
        paid={summary.netPaid}
        showAmounts={false}
        showStatus={false}
      />
      {summary.refunds > 0 ? (
        <p className="job-refund-note">
          {t("ফেরত পেয়েছি")} <strong>{money(summary.refunds)}</strong>
        </p>
      ) : null}
      {contract.basis !== "fixed" ? (
        <p className="job-rate-note">
          {formatDigits(contract.quantity)}{" "}
          {t(contract.basis === "day" ? "দিন" : "বর্গফুট")} ×{" "}
          {money(contract.rate)}
        </p>
      ) : null}
      {contract.agreedOn ? (
        <p className="contract-agreed-date">
          <span>{t("কাজের তারিখ")}</span>
          <time dateTime={contract.agreedOn}>
            {date(contract.agreedOn, { year: "numeric" })}
          </time>
        </p>
      ) : null}
      {contract.notes ? (
        <p className="job-detail-note">{formatDigits(contract.notes)}</p>
      ) : null}
      {showHistory ? (
        <ContractHistory ledger={ledger} contract={contract} />
      ) : null}
    </article>
  );
}
