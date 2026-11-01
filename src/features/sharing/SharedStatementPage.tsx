import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  HouseLineIcon,
  LinkBreakIcon,
  LockSimpleIcon,
} from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import { readShare, type SharedStatement } from "./shareClient";
import { accountLabels } from "../people/ContactIdentity";
import "./sharing.css";
const kinds = {
  expense: "বিল",
  payment: "টাকা দিয়েছি",
  expense_credit: "মাল ফেরত",
  refund: "টাকা পেয়েছি",
};
export function SharedStatementPage() {
  const { t, money, date } = useLanguageContext();
  const [token, setToken] = useState(() => window.location.hash.slice(1));
  const [statement, setStatement] = useState<SharedStatement | null>(null);
  const [busy, setBusy] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const currentToken = useRef(token);
  useEffect(() => {
    const change = () => {
      const nextToken = window.location.hash.slice(1);
      if (nextToken === currentToken.current) return;
      currentToken.current = nextToken;
      request.current++;
      setStatement(null);
      setMissing(false);
      setError("");
      setBusy(true);
      setToken(nextToken);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const load = useCallback(async () => {
    const id = ++request.current;
    setBusy(true);
    setError("");
    setMissing(false);
    try {
      const data = await readShare(token);
      if (id !== request.current) return;
      setStatement(data);
      setMissing(data === null);
    } catch {
      if (id === request.current) {
        setStatement(null);
        setError("লিংক খোলা যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।");
      }
    } finally {
      if (id === request.current) setBusy(false);
    }
  }, [token]);
  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, [load]);
  async function more() {
    if (!statement || statement.nextOffset === null || busy) return;
    const id = ++request.current;
    setBusy(true);
    setError("");
    try {
      const data = await readShare(
        token,
        statement.nextOffset,
        statement.revision,
      );
      if (id !== request.current) return;
      if (!data) {
        setStatement(null);
        setMissing(true);
        return;
      }
      setStatement({ ...data, rows: [...statement.rows, ...data.rows] });
    } catch (error) {
      if (id === request.current)
        setError(
          error instanceof Error && error.message === "share_changed"
            ? "নতুন হিসাব এসেছে। হালনাগাদ করে আবার দেখুন।"
            : "লিংক খোলা যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।",
        );
    } finally {
      if (id === request.current) setBusy(false);
    }
  }
  return (
    <main className="shared-statement-page">
      <header className="shared-brand">
        <span>
          <HouseLineIcon size={22} weight="duotone" />
          {t("বাড়ির খাতা")}
        </span>
        <small>
          <LockSimpleIcon size={14} />
          {t("এই লিংকে শুধু হিসাব দেখা যায়")}
        </small>
      </header>
      {!statement ? (
        <section className="shared-empty panel">
          {missing ? (
            <>
              <LinkBreakIcon size={36} />
              <h1>{t("লিংকটি এখন কাজ করছে না")}</h1>
              <p>{t("যিনি পাঠিয়েছেন তাঁর কাছ থেকে নতুন লিংক নিন।")}</p>
            </>
          ) : (
            <>
              <h1>{t(busy ? "অপেক্ষা করুন…" : "হিসাবের কপি")}</h1>
              {error && <p role="alert">{t(error)}</p>}
            </>
          )}
          {!busy && (
            <button className="secondary-button" onClick={() => void load()}>
              <ArrowClockwiseIcon size={18} />
              {t("আবার চেষ্টা করুন")}
            </button>
          )}
        </section>
      ) : (
        <>
          <section className="shared-heading">
            <div>
              <p className="eyebrow">
                {statement.projectName} · {t(accountLabels[statement.account])}
              </p>
              <h1>{statement.person.name}</h1>
              {(statement.person.role || statement.workName) && (
                <p>
                  {[statement.person.role, statement.workName]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </div>
            <button
              className="icon-button"
              disabled={busy}
              aria-label={t("হালনাগাদ দেখি")}
              onClick={() => void load()}
            >
              <ArrowClockwiseIcon size={22} />
            </button>
          </section>
          <section className="shared-totals">
            {[
              { label: "টাকা দিয়েছি", value: statement.totals.paid },
              { label: "দিতে বাকি", value: statement.totals.payable },
              { label: "আগাম দিয়েছি", value: statement.totals.advance },
            ].map(({ label, value }) => (
              <div key={label}>
                <small>{t(label)}</small>
                <strong>{money(value)}</strong>
              </div>
            ))}
          </section>
          <section className="panel shared-history">
            <h2>{t("সব হিসাব")}</h2>
            {statement.rows.length ? (
              statement.rows.map((row) => (
                <article key={row.key}>
                  <div>
                    <strong>{row.description || t(kinds[row.kind])}</strong>
                    <small>
                      {date(row.date, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                      {row.works && ` · ${row.works}`}
                    </small>
                    {row.historical && (
                      <small>{t("পুরোনো খরচ; পরিশোধ জানা নেই")}</small>
                    )}
                  </div>
                  <div className="shared-row-amount">
                    <strong>{money(Math.abs(row.charge || row.paid))}</strong>
                    <small>{t(kinds[row.kind])}</small>
                  </div>
                </article>
              ))
            ) : (
              <p className="helper-text">
                {t("এই নামের কোনো হিসাব এখনও লেখা হয়নি।")}
              </p>
            )}
            {error && (
              <p className="share-error" role="alert">
                {t(error)}
              </p>
            )}
            {statement.nextOffset !== null && (
              <button
                className="secondary-button shared-more"
                disabled={busy}
                onClick={() => void more()}
              >
                {t(busy ? "অপেক্ষা করুন…" : "আরও হিসাব দেখি")}
              </button>
            )}
          </section>
          <footer className="shared-footer">
            <p>
              {t("শেষ হালনাগাদ")} ·{" "}
              {date(statement.updatedAt.slice(0, 10), {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
            <p>{t("এই লিংকে কোনো তথ্য বদলানো যায় না।")}</p>
            {statement.totals.historicalCost > 0 && (
              <p>
                {t(
                  "পুরোনো খাতার তথ্য আছে। সেখানে পরিশোধ পরিষ্কার নয় বলে বাকি বা অগ্রিম ধরে নেওয়া হয়নি।",
                )}
              </p>
            )}
          </footer>
        </>
      )}
    </main>
  );
}
