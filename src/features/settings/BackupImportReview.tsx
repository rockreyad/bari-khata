import { useMemo, useState } from "react";
import { useLanguageContext } from "../../context/LanguageProvider";
import {
  planBackupMerge,
  sameBackupLedger,
  type BackupCollection,
  type BackupDecisions,
} from "../../data/backupMerge";
import type { LedgerBackup } from "../../data/repository";
import type { Ledger } from "../../domain/model";
import { entryTotal, entryWorkIds, summarize } from "../../domain/ledger";
import { cashSummary } from "../../domain/cashSummary";
import { adjustmentBasisLabels } from "../history/adjustmentDisplay";
import "./backup-import.css";

const collectionLabels: Record<BackupCollection, string> = {
  project: "খাতার নাম",
  works: "কাজের খাতা",
  people: "মানুষ ও দোকান",
  materialGroups: "মালের ধরন",
  items: "মালের নাম",
  paymentPurposes: "টাকার কারণ",
  contracts: "মিস্ত্রির কাজ",
  entries: "লেনদেন",
  paymentAllocations: "বিলে টাকার ভাগ",
};

export function BackupImportReview({
  backup,
  current,
  at,
  busy,
  onImport,
}: {
  backup: LedgerBackup;
  current: Ledger;
  at: string;
  busy: boolean;
  onImport: (decisions: BackupDecisions) => void;
}) {
  const { t, number, money, date } = useLanguageContext();
  const describe = (
    source: Ledger,
    collection: BackupCollection,
    id: string,
  ) => {
    if (collection === "project") return source.project.name;
    if (collection === "entries") {
      const entry = source.entries.find((record) => record.id === id)!;
      const kind = {
        expense: "খরচের বিল",
        payment: "টাকা দেওয়া",
        refund: "টাকা ফেরত পাওয়া",
        expense_credit: "মাল ফেরত",
        adjustment: "সমন্বয়",
      }[entry.kind];
      return [
        t(kind),
        entry.adjustment
          ? t(adjustmentBasisLabels[entry.adjustment.basis])
          : "",
        money(
          entry.kind === "adjustment"
            ? (entry.adjustment?.delta ?? 0)
            : entryTotal(entry),
        ),
        date(entry.date),
        source.people.find((person) => person.id === entry.personId)?.name,
        entryWorkIds(entry)
          .map(
            (workId) => source.works.find((work) => work.id === workId)?.name,
          )
          .join(", "),
        entry.note,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    if (collection === "paymentAllocations") {
      const allocation = source.paymentAllocations?.find(
        (value) => value.id === id,
      );
      const bill = source.entries.find(
        (value) => value.id === allocation?.billId,
      );
      const payment = source.entries.find(
        (value) => value.id === allocation?.paymentId,
      );
      return allocation
        ? [
            money(allocation.amount),
            bill?.note ||
              bill?.lines.map((line) => line.label).join(" · ") ||
              t("বিল"),
            payment?.date ? date(payment.date) : "",
          ]
            .filter(Boolean)
            .join(" · ")
        : "";
    }
    const record = source[collection]?.find((value) => value.id === id);
    if (!record) return "";
    return [
      "name" in record ? record.name : record.title,
      "total" in record ? money(record.total) : "",
      "phone" in record ? record.phone : "",
      "unit" in record ? record.unit : "",
      "note" in record ? record.note : "",
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const [decisions, setDecisions] = useState<BackupDecisions>({});
  const [confirmed, setConfirmed] = useState(false);
  const plan = useMemo(
    () => planBackupMerge(current, backup.ledger, decisions, at),
    [current, backup.ledger, decisions, at],
  );
  const fileSummary = useMemo(() => summarize(backup.ledger), [backup.ledger]);
  const fileCash = useMemo(() => cashSummary(backup.ledger), [backup.ledger]);
  const result = useMemo(
    () =>
      plan.ledger
        ? { summary: summarize(plan.ledger), cash: cashSummary(plan.ledger) }
        : null,
    [plan.ledger],
  );
  const unchanged =
    plan.ledger &&
    sameBackupLedger(current, plan.ledger) &&
    !plan.unresolved.length;
  return (
    <div className="backup-import-review">
      <section className="backup-import-summary" aria-label={t("ফাইলে যা আছে")}>
        <small>{t("ফাইলে যা আছে")}</small>
        <h3>{backup.ledger.project.name}</h3>
        <p>
          {t("{{count}}টি হিসাব", {
            count: number(backup.ledger.entries.length),
          })}
        </p>
        <dl>
          <div>
            <dt>{t("মোট টাকা দিয়েছি")}</dt>
            <dd>{money(fileCash.netPaid)}</dd>
          </div>
          <div>
            <dt>{t("খরচের বিল")}</dt>
            <dd>{money(fileSummary.cost)}</dd>
          </div>
          <div>
            <dt>{t("দিতে হবে")}</dt>
            <dd>{money(fileSummary.payable)}</dd>
          </div>
          <div>
            <dt>{t("অগ্রিম আছে")}</dt>
            <dd>{money(fileSummary.advance)}</dd>
          </div>
        </dl>
      </section>
      <p className="settings-sheet-text">
        {t(
          "দেওয়া টাকা আর খরচের বিল আলাদা হিসাব। অগ্রিম টাকা দিলে বিলের চেয়ে দেওয়া টাকা বেশি হতে পারে।",
        )}
      </p>
      <section className="backup-import-changes" aria-label={t("যা আনা হবে")}>
        <h3>{t("যা আনা হবে")}</h3>
        <p>{t("নতুন তথ্য: {{count}}টি", { count: number(plan.added) })}</p>
        <p>{t("আগেই আছে: {{count}}টি", { count: number(plan.unchanged) })}</p>
        <p>
          {t("বেছে নেওয়া পরিবর্তন: {{count}}টি", {
            count: number(plan.updated),
          })}
        </p>
        <p className="settings-sheet-text">
          {t(
            "ফাইলে নেই এমন বর্তমান তথ্য রাখা হবে। একই তথ্য আবার যোগ হবে না। আগের খাতার একটি উদ্ধার কপিও ফোনে থাকবে।",
          )}
        </p>
      </section>
      {plan.differences.length > 0 && (
        <fieldset className="backup-import-differences" disabled={busy}>
          <legend>{t("দুই কপিতে আলাদা তথ্য আছে")}</legend>
          <p>{t("প্রতিটি আলাদা তথ্যের কোন কপিটি রাখবেন, বেছে নিন।")}</p>
          {plan.differences.map((difference, index) => (
            <label key={difference.key}>
              <span>
                <small>{t(collectionLabels[difference.collection])}</small>
                <strong>{difference.label}</strong>
                <span>
                  {t("এখনকার: {{value}}", {
                    value: describe(
                      current,
                      difference.collection,
                      difference.id,
                    ),
                  })}
                </span>
                <span>
                  {t("ফাইলের: {{value}}", {
                    value: describe(
                      backup.ledger,
                      difference.collection,
                      difference.id,
                    ),
                  })}
                </span>
              </span>
              <select
                aria-label={t("{{name}} — কোন কপি রাখবেন", {
                  name: difference.label,
                })}
                value={decisions[difference.key] ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  setDecisions((previous) => {
                    const next = { ...previous };
                    if (value === "current" || value === "backup")
                      next[difference.key] = value;
                    else delete next[difference.key];
                    return next;
                  });
                  setConfirmed(false);
                }}
              >
                <option value="">{t("একটি বেছে নিন")}</option>
                <option value="current">{t("এখনকারটি রাখব")}</option>
                <option value="backup">{t("ফাইলেরটি নেব")}</option>
              </select>
              <span className="visually-hidden">{number(index + 1)}</span>
            </label>
          ))}
        </fieldset>
      )}
      {!plan.unresolved.length && (!plan.ledger || plan.historyConflict) && (
        <p className="backup-import-warning" role="status">
          {t(
            "এই পছন্দে যুক্ত হিসাব বা আগের ইতিহাস মিলছে না। এখনকার তথ্য রাখুন অথবা নতুন কপি বেছে নিন।",
          )}
        </p>
      )}
      {!plan.unresolved.length && result && (
        <section
          className="backup-import-result"
          aria-label={t("মেলানোর পর খাতা")}
        >
          <h3>{t("মেলানোর পর খাতা")}</h3>
          <dl>
            <div>
              <dt>{t("মোট টাকা দিয়েছি")}</dt>
              <dd>{money(result.cash.netPaid)}</dd>
            </div>
            <div>
              <dt>{t("খরচের বিল")}</dt>
              <dd>{money(result.summary.cost)}</dd>
            </div>
          </dl>
        </section>
      )}
      {unchanged ? (
        <p role="status">
          {t("এই কপির সব তথ্য খাতায় আছে। আবার আনার দরকার নেই।")}
        </p>
      ) : (
        <>
          <label className="backup-import-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy || plan.unresolved.length > 0 || !plan.ledger}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>{t("তালিকা দেখে নতুন ও বাছাই করা তথ্য আনতে চাই।")}</span>
          </label>
          <button
            className="primary-button settings-sheet-primary"
            disabled={
              !confirmed || busy || plan.unresolved.length > 0 || !plan.ledger
            }
            onClick={() => onImport(decisions)}
          >
            {busy ? t("অপেক্ষা করুন…") : t("নতুন ও বাছাই করা তথ্য আনুন")}
          </button>
        </>
      )}
    </div>
  );
}
