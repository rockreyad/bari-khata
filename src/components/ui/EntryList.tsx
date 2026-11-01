import { ReceiptIcon } from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import { entryWorkAmount } from "../../domain/ledger";
import type { Entry, Ledger } from "../../domain/model";
import {
  historySubtitle,
  historyTitle,
  historyGroups,
  sortHistory,
  type HistoryOrder,
} from "../../features/history/history";
import "../../features/history/history.css";
import "../../features/history/history-v4.css";
export type EntryListProps = {
  ledger: Ledger;
  entries: Entry[];
  workId?: string;
  onEntry: (id: string) => void;
  order?: HistoryOrder;
  grouped?: boolean;
  hidePerson?: boolean;
  hideWork?: boolean;
  amounts?: Record<string, number>;
  titles?: Record<string, string>;
  subtitles?: Record<string, string>;
};
export function EntryList({
  ledger,
  entries,
  workId,
  onEntry,
  order = "newest",
  grouped = false,
  hidePerson = false,
  hideWork = false,
  amounts,
  titles,
  subtitles,
}: EntryListProps) {
  const { t, money, date } = useLanguageContext();
  if (!entries.length)
    return (
      <div className="history-empty">
        <ReceiptIcon size={28} weight="duotone" />
        <p>{t("এখানে কোনো হিসাব নেই")}</p>
      </div>
    );
  const groups = historyGroups(entries);
  let previousMonth = "";
  return (
    <div className="history-list">
      {sortHistory(groups.entries, order).map((entry) => {
        const month = entry.date?.slice(0, 7) ?? "unknown";
        const header = grouped && month !== previousMonth;
        previousMonth = month;
        const title =
          titles?.[entry.id] ?? historyTitle(ledger, entry, hidePerson);
        const paired = groups.payments.get(entry.id) ?? [];
        const paid = paired.reduce(
          (sum, payment) => sum + entryWorkAmount(payment, workId),
          0,
        );
        const original = entryWorkAmount(entry, workId);
        const extra =
          paired.length && paid !== original
            ? t("দিয়েছি {{amount}}", { amount: money(paid) })
            : "";
        const subtitle =
          subtitles?.[entry.id] ??
          [historySubtitle(ledger, entry, { hidePerson, hideWork }), extra]
            .filter(Boolean)
            .join(" · ");
        const sign =
          entry.kind === "refund" || entry.kind === "expense_credit" ? -1 : 1;
        const amount =
          amounts?.[entry.id] ?? entryWorkAmount(entry, workId) * sign;
        return (
          <div className="history-record" key={entry.id}>
            {header ? (
              <h3 className="history-month">
                {entry.date
                  ? date(`${month}-01`, {
                      day: undefined,
                      month: "long",
                      year: "numeric",
                    })
                  : t("তারিখ দেওয়া নেই")}
              </h3>
            ) : null}
            <button
              className={`history-row history-${entry.kind} ${entry.voided ? "is-void" : ""}`}
              onClick={() => onEntry(entry.id)}
            >
              <span className="history-row-copy">
                <strong>
                  {t(title)}
                  {entry.voided ? <i>{t("বাতিল")}</i> : null}
                </strong>
                <small className="history-row-meta-v4">
                  <time dateTime={entry.date ?? undefined}>
                    {entry.date
                      ? date(entry.date, { year: "numeric" })
                      : t("তারিখ দেওয়া নেই")}
                  </time>
                  <span aria-hidden="true">·</span>
                  <span>{t(subtitle)}</span>
                </small>
              </span>
              <strong className="history-row-amount">{money(amount)}</strong>
            </button>
          </div>
        );
      })}
    </div>
  );
}
