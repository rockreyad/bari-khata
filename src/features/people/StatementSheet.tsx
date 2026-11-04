import { useEffect, useRef, useState } from "react";
import {
  CaretDownIcon,
  DownloadSimpleIcon,
  ShareNetworkIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { Sheet } from "../../components/Sheet";
import { AppSelect } from "../../components/ui/AppSelect";
import type { Account, Person } from "../../domain/model";
import { ShareLinkControls } from "../sharing/ShareLinkControls";
import { saveFile } from "../../lib/display";
import { PersonMark, accountLabels } from "./ContactIdentity";
import { contactActionAccount } from "./contactActionAccounts";
import {
  contactStatement,
  statementFilename,
  statementHtml,
} from "./statement";

type StatementSheetProps = {
  person: Person;
  account?: Account;
  workId?: string;
  onClose: () => void;
};

export function StatementSheet(props: StatementSheetProps) {
  return (
    <StatementShare
      key={`${props.person.id}:${props.account}:${props.workId ?? ""}`}
      {...props}
    />
  );
}

function StatementShare({
  person,
  account: requestedAccount,
  workId,
  onClose,
}: StatementSheetProps) {
  const { ledger, notify } = useNotebook();
  const { t, money, date, formatDigits, language } = useLanguageContext();
  const [account, setAccount] = useState(() =>
    contactActionAccount(ledger, person.id, requestedAccount),
  );
  const [notes, setNotes] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(false);
  const workName = workId
    ? ledger.works.find((work) => work.id === workId)?.name
    : undefined;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function exportFile(share: boolean) {
    if (locked.current || !account) return;
    locked.current = true;
    setBusy(true);
    try {
      const statement = contactStatement(ledger, person, {
        account,
        workId,
        includeNotes: notes,
      });
      const html = statementHtml(statement, {
        t,
        money,
        date,
        formatDigits,
        language,
      });
      const name = statementFilename(person.name);
      const copy = new File([html], name, { type: "text/html" });
      if (
        share &&
        typeof navigator.share === "function" &&
        navigator.canShare?.({ files: [copy] })
      ) {
        await navigator.share({ title: t("হিসাবের কপি"), files: [copy] });
      } else {
        saveFile(html, name, "text/html;charset=utf-8");
        notify(t("কপি নামানো হয়েছে। ফাইলটি যাকে দরকার পাঠাতে পারবেন।"));
      }
    } catch (error) {
      const cancelled =
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "AbortError";
      if (mounted.current && !cancelled)
        notify(t("কপি পাঠানো যায়নি। নামিয়ে আবার চেষ্টা করুন।"), true);
    } finally {
      if (mounted.current) {
        locked.current = false;
        setBusy(false);
      }
    }
  }

  return (
    <Sheet title={t("হিসাবের কপি পাঠাই")} onClose={onClose}>
      <div className="statement-share">
        <div className="statement-recipient">
          <PersonMark person={person} />
          <div className="statement-recipient-copy">
            <strong>{formatDigits(person.name)}</strong>
            <span>
              {account ? t(accountLabels[account]) : t("হিসাব বেছে নিন")}
              <span aria-hidden="true"> · </span>
              {workId
                ? formatDigits(workName || t("এই কাজের হিসাব"))
                : t("সব কাজ")}
            </span>
          </div>
        </div>

        {!requestedAccount ? (
          <label className="statement-account-select">
            {t("কোন হিসাবের কপি")}
            <AppSelect
              value={account}
              disabled={busy}
              onChange={(event) => {
                setNotes(false);
                setAccount(event.target.value as Account | "");
              }}
            >
              <option value="">{t("হিসাব বেছে নিন")}</option>
              {(["materials", "labour", "other"] as const).map((value) => (
                <option key={value} value={value}>
                  {t(accountLabels[value])}
                </option>
              ))}
            </AppSelect>
          </label>
        ) : null}

        {account ? (
          <>
            <ShareLinkControls
              key={account}
              scope={{ personId: person.id, account, workId }}
            />

            <details key={`${account}:file`} className="statement-file-options">
              <summary>
                <span className="statement-file-symbol" aria-hidden="true">
                  <DownloadSimpleIcon size={21} />
                </span>
                <span className="statement-file-heading">
                  <strong>{t("ফাইল পাঠাতে চাইলে")}</strong>
                  <small>{t("এখনকার হিসাবের কপি")}</small>
                </span>
                <CaretDownIcon
                  className="statement-file-caret"
                  size={17}
                  aria-hidden="true"
                />
              </summary>
              <div className="statement-file-content">
                <label className="statement-notes">
                  <input
                    type="checkbox"
                    checked={notes}
                    disabled={busy}
                    onChange={(event) => setNotes(event.target.checked)}
                  />
                  <span>{t("ফাইলে আমার নোটও রাখি")}</span>
                </label>
                <div className="statement-buttons">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void exportFile(false)}
                  >
                    <DownloadSimpleIcon size={18} aria-hidden="true" />
                    {t("কপি নামান")}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void exportFile(true)}
                  >
                    <ShareNetworkIcon size={18} aria-hidden="true" />
                    {t(busy ? "অপেক্ষা করুন…" : "ফাইল পাঠান")}
                  </button>
                </div>
                <p>{t("নতুন হিসাব যোগ হলে আবার ফাইল পাঠাতে হবে।")}</p>
              </div>
            </details>
          </>
        ) : (
          <p className="statement-scope-hint">
            {t("যে হিসাবের কপি পাঠাবেন, সেটি বেছে নিন।")}
          </p>
        )}

        <p className="statement-share-note">
          <ShieldCheckIcon size={15} aria-hidden="true" />
          {t("শুধু দেখার কপি")}
        </p>
      </div>
    </Sheet>
  );
}
