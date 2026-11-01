import { useMemo, useState } from "react";
import { DownloadSimpleIcon, ShareNetworkIcon } from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { Sheet } from "../../components/Sheet";
import type { Account, Person } from "../../domain/model";
import { ShareLinkControls } from "../sharing/ShareLinkControls";
import { saveFile } from "../../lib/display";
import { PersonMark, accountLabels } from "./ContactIdentity";
import {
  contactStatement,
  statementFilename,
  statementHtml,
} from "./statement";
export function StatementSheet({
  person,
  account,
  workId,
  onClose,
}: {
  person: Person;
  account: Account;
  workId?: string;
  onClose: () => void;
}) {
  const { ledger, notify } = useNotebook();
  const { t, money, date, formatDigits, language } = useLanguageContext();
  const [notes, setNotes] = useState(false);
  const [busy, setBusy] = useState(false);
  const statement = useMemo(
    () =>
      contactStatement(ledger, person, {
        account,
        workId,
        includeNotes: notes,
      }),
    [ledger, person, account, workId, notes],
  );
  const file = () =>
    new File(
      [statementHtml(statement, { t, money, date, formatDigits, language })],
      statementFilename(person.name),
      { type: "text/html" },
    );
  async function share() {
    if (busy) return;
    setBusy(true);
    try {
      const copy = file();
      if (navigator.canShare?.({ files: [copy] })) {
        await navigator.share({ title: t("হিসাবের কপি"), files: [copy] });
      } else {
        saveFile(await copy.text(), copy.name, "text/html;charset=utf-8");
        notify(t("কপি নামানো হয়েছে। ফাইলটি যাকে দরকার পাঠাতে পারবেন।"));
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError"))
        notify(t("কপি পাঠানো যায়নি। নামিয়ে আবার চেষ্টা করুন।"), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title={t("হিসাবের কপি পাঠাই")}
      subtitle={formatDigits(person.name)}
      onClose={onClose}
      footer={
        <div className="statement-buttons">
          <button
            className="secondary-button"
            onClick={() => {
              const copy = file();
              saveFile(
                statementHtml(statement, {
                  t,
                  money,
                  date,
                  formatDigits,
                  language,
                }),
                copy.name,
                "text/html;charset=utf-8",
              );
            }}
          >
            <DownloadSimpleIcon size={19} />
            {t("কপি নামান")}
          </button>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void share()}
          >
            <ShareNetworkIcon size={19} />
            {t("পাঠাই")}
          </button>
        </div>
      }
    >
      <div className="statement-preview">
        <ShareLinkControls scope={{ personId: person.id, account, workId }} />
        <div className="statement-person">
          <PersonMark person={person} />
          <div>
            <strong>{formatDigits(person.name)}</strong>
            <span>{t(accountLabels[account])}</span>
          </div>
        </div>
        <div className="contact-statement-totals">
          <div>
            <small>{t("টাকা দিয়েছি")}</small>
            <strong>{money(statement.totals.paid)}</strong>
          </div>
          <div>
            <small>{t("দিতে বাকি")}</small>
            <strong>{money(statement.totals.payable)}</strong>
          </div>
          <div>
            <small>{t("আগাম দিয়েছি")}</small>
            <strong>{money(statement.totals.advance)}</strong>
          </div>
        </div>
        <p className="statement-explainer">
          {t(
            "এখানে শুধু এই নামের হিসাব থাকবে। অন্য কারও হিসাব বা আপনার লগইন থাকবে না।",
          )}
        </p>
        <label className="statement-notes">
          <input
            type="checkbox"
            checked={notes}
            onChange={(event) => setNotes(event.target.checked)}
          />
          <span>{t("আমার লেখা নোটও দিই")}</span>
        </label>
        <div className="statement-rows">
          {statement.rows.slice(0, 10).map((row, index) => (
            <div key={index}>
              <span>
                <strong>
                  {formatDigits(row.description) ||
                    t(
                      row.kind === "payment"
                        ? "টাকা দিয়েছি"
                        : row.kind === "expense_credit"
                          ? "মাল ফেরত"
                          : "টাকা পেয়েছি",
                    )}
                </strong>
                <small>{formatDigits(row.works)}</small>
              </span>
              <strong>{money(Math.abs(row.charge || row.paid))}</strong>
            </div>
          ))}
        </div>
        <p className="helper-text">
          {t("সব হিসাব এই কপিতে থাকবে। পরে নতুন হিসাব লিখলে আবার কপি পাঠান।")}
        </p>
      </div>
    </Sheet>
  );
}
