import { useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  CopyIcon,
  LinkIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import {
  createShare,
  liveShareUrl,
  revokeShare,
  shareStatus,
  type ShareScope,
  type ShareStatus,
} from "./shareClient";
import "./sharing.css";

export function ShareLinkControls({ scope }: { scope: ShareScope }) {
  const { t } = useLanguageContext();
  const { state, mode, notify } = useNotebook();
  const [status, setStatus] = useState<ShareStatus | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(mode === "real");
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  const scopeKey = JSON.stringify(scope);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  useEffect(() => {
    mounted.current = true;
    let active = true;
    setStatus(null);
    setUrl("");
    setError("");
    setLoading(mode === "real");
    setBusy(false);
    if (mode === "real") {
      void shareStatus(scope)
        .then((value) => {
          if (active) setStatus(value);
        })
        .catch(() => {
          if (active)
            setError("লিংক তৈরি বা বন্ধ করা যায়নি। আবার চেষ্টা করুন।");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [scopeKey, mode]);
  async function create() {
    if (busy || mode !== "real") return;
    const requestedScope = scopeKey;
    const alive = () =>
      mounted.current && currentScope.current === requestedScope;
    setBusy(true);
    setError("");
    try {
      const synced = await state.sync();
      if (synced.status !== "synced") throw new Error("unsynced");
      if (!alive()) return;
      const link = await createShare(scope);
      if (!alive()) return;
      setStatus(link);
      setUrl(liveShareUrl(link.token));
      notify(t("লিংক তৈরি হয়েছে। কপি করে রাখুন বা পাঠান।"));
    } catch (error) {
      if (alive())
        setError(
          error instanceof Error && error.message === "unsynced"
            ? "লিংকের জন্য আগে ইন্টারনেটে হিসাব জমা হতে হবে। সংযোগ দেখে আবার চেষ্টা করুন।"
            : "লিংক তৈরি বা বন্ধ করা যায়নি। আবার চেষ্টা করুন।",
        );
    } finally {
      if (alive()) setBusy(false);
    }
  }
  async function revoke() {
    if (!status || busy) return;
    const requestedScope = scopeKey;
    const alive = () =>
      mounted.current && currentScope.current === requestedScope;
    setBusy(true);
    setError("");
    try {
      await revokeShare(status.id);
      if (!alive()) return;
      setStatus(null);
      setUrl("");
      notify(t("লিংক বন্ধ হয়েছে। আগের লিংকে আর হিসাব দেখা যাবে না।"));
    } catch {
      if (alive()) setError("লিংক তৈরি বা বন্ধ করা যায়নি। আবার চেষ্টা করুন।");
    } finally {
      if (alive()) setBusy(false);
    }
  }
  return (
    <section className="share-link-card" aria-label={t("লিংকে হিসাব দেখাই")}>
      <div className="share-link-heading">
        <span className="share-link-symbol">
          <LinkIcon size={22} />
        </span>
        <div>
          <h3>{t("লিংকে হিসাব দেখাই")}</h3>
          <p>
            {t("নতুন হিসাব লিখলে এই লিংকেই দেখা যাবে। দেখতে ইন্টারনেট লাগবে।")}
          </p>
        </div>
      </div>
      {mode === "demo" ? (
        <p className="helper-text">
          {t("নমুনা খাতা থেকে লিংক দেওয়া যায় না। নিজের খাতায় ব্যবহার করুন।")}
        </p>
      ) : (
        <>
          <p className="helper-text">
            {t(
              "যাঁর কাছে লিংক থাকবে, তিনি শুধু এই হিসাব দেখতে পারবেন। কোনো তথ্য বদলাতে পারবেন না।",
            )}
          </p>
          {status && (
            <p className="share-active">
              <CheckIcon size={15} />
              {t("লিংক চালু আছে")}
            </p>
          )}
          {url && (
            <div className="share-url-field">
              <input
                ref={field}
                aria-label={t("লিংক কপি করি")}
                readOnly
                value={url}
                onFocus={(event) => event.target.select()}
              />
              <button
                className="icon-button"
                aria-label={t("লিংক কপি করি")}
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(url)
                    .then(() =>
                      notify(
                        t("লিংক কপি হয়েছে। যাঁর হিসাব তাঁকে পাঠাতে পারবেন।"),
                      ),
                    )
                    .catch(() => {
                      field.current?.focus();
                      field.current?.select();
                      notify(t("লিংকটি বেছে কপি করুন।"));
                    });
                  if (!navigator.clipboard) {
                    field.current?.focus();
                    field.current?.select();
                    notify(t("লিংকটি বেছে কপি করুন।"));
                  }
                }}
              >
                <CopyIcon size={20} />
              </button>
            </div>
          )}
          {status && !url && (
            <p className="helper-text">
              {t(
                "আগের লিংক রাখা থাকলে সেটিই চলবে। আবার পাঠাতে চাইলে নতুন লিংক নিন।",
              )}
            </p>
          )}
          {error && (
            <p role="alert" className="share-error">
              {t(error)}
            </p>
          )}
          <div className="share-link-actions">
            <button
              className="secondary-button"
              disabled={busy || loading}
              onClick={() => void create()}
            >
              <LinkIcon size={18} />
              {t(
                busy
                  ? "অপেক্ষা করুন…"
                  : status
                    ? "নতুন লিংক তৈরি করি"
                    : "লিংক তৈরি করি",
              )}
            </button>
            {status && (
              <button
                className="text-button share-revoke"
                disabled={busy}
                onClick={() => void revoke()}
              >
                <XCircleIcon size={18} />
                {t("লিংক বন্ধ করি")}
              </button>
            )}
          </div>
          {status && (
            <small className="helper-text">
              {t("নতুন লিংক করলে আগের লিংক বন্ধ হবে।")}
            </small>
          )}
        </>
      )}
    </section>
  );
}
