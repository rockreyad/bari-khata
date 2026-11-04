import { useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  CopyIcon,
  LinkIcon,
  ShareNetworkIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { FormError, useFormError } from "../../components/ui/FormError";
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
  const [statusFailed, setStatusFailed] = useState(false);
  const [statusAttempt, setStatusAttempt] = useState(0);
  const [error, setError, errorNotice] = useFormError();
  const mounted = useRef(false);
  const generation = useRef(0);
  const operation = useRef<symbol | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const scopeKey = JSON.stringify(scope);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  useEffect(() => {
    mounted.current = true;
    generation.current++;
    const requestedGeneration = generation.current;
    operation.current = null;
    let active = true;
    setStatus(null);
    setUrl("");
    setError("");
    setLoading(mode === "real");
    setStatusFailed(false);
    setBusy(false);
    const current = () =>
      active &&
      mounted.current &&
      currentScope.current === scopeKey &&
      generation.current === requestedGeneration;
    if (mode === "real") {
      void shareStatus(scope)
        .then((value) => {
          if (current()) setStatus(value);
        })
        .catch(() => {
          if (current()) {
            setStatusFailed(true);
            setError("লিংকের খবর পাওয়া যায়নি। আবার চেষ্টা করুন।");
          }
        })
        .finally(() => {
          if (current()) setLoading(false);
        });
    }
    return () => {
      active = false;
      mounted.current = false;
      generation.current++;
      operation.current = null;
    };
  }, [scopeKey, mode, statusAttempt]);
  function retryStatus() {
    if (!statusFailed || loading || operation.current || mode !== "real")
      return;
    setLoading(true);
    setStatusAttempt((attempt) => attempt + 1);
  }
  function start() {
    if (operation.current || loading || statusFailed || mode !== "real")
      return null;
    const id = Symbol();
    operation.current = id;
    const requestedScope = scopeKey;
    const requestedGeneration = generation.current;
    setBusy(true);
    setError("");
    return {
      alive: () =>
        mounted.current &&
        currentScope.current === requestedScope &&
        generation.current === requestedGeneration &&
        operation.current === id,
      finish() {
        if (operation.current === id) {
          operation.current = null;
          if (mounted.current && generation.current === requestedGeneration)
            setBusy(false);
        }
      },
    };
  }
  async function create() {
    const request = start();
    if (!request) return;
    try {
      const synced = await state.sync();
      if (synced.status !== "synced") throw new Error("unsynced");
      if (!request.alive()) return;
      const link = await createShare(scope);
      if (!request.alive()) return;
      setStatus(link);
      setUrl(liveShareUrl(link.token));
    } catch (error) {
      if (request.alive())
        setError(
          error instanceof Error && error.message === "unsynced"
            ? "লিংকের জন্য আগে ইন্টারনেটে হিসাব জমা হতে হবে। সংযোগ দেখে আবার চেষ্টা করুন।"
            : "লিংক তৈরি বা বন্ধ করা যায়নি। আবার চেষ্টা করুন।",
        );
    } finally {
      request.finish();
    }
  }
  async function revoke() {
    if (!status) return;
    const request = start();
    if (!request) return;
    try {
      await revokeShare(status.id);
      if (!request.alive()) return;
      setStatus(null);
      setUrl("");
      notify(t("লিংক বন্ধ হয়েছে।"));
    } catch {
      if (request.alive())
        setError("লিংক তৈরি বা বন্ধ করা যায়নি। আবার চেষ্টা করুন।");
    } finally {
      request.finish();
    }
  }
  async function copy() {
    if (!url) return;
    const request = start();
    if (!request) return;
    try {
      if (!navigator.clipboard) throw new Error("clipboard_unavailable");
      await navigator.clipboard.writeText(url);
      if (request.alive()) notify(t("লিংক কপি হয়েছে।"));
    } catch {
      if (request.alive()) {
        field.current?.focus();
        field.current?.select();
        notify(t("লিংকটি বেছে কপি করুন।"));
      }
    } finally {
      request.finish();
    }
  }
  async function share() {
    if (!url || !navigator.share) return;
    const request = start();
    if (!request) return;
    try {
      await navigator.share({ url });
    } catch (cause) {
      const cancelled =
        typeof cause === "object" &&
        cause !== null &&
        "name" in cause &&
        cause.name === "AbortError";
      if (request.alive() && !cancelled)
        setError("লিংক পাঠানো যায়নি। কপি করে পাঠান।");
    } finally {
      request.finish();
    }
  }
  return (
    <section
      className="share-link-card"
      aria-label={t("লিংক পাঠান")}
      aria-busy={busy || loading}
    >
      <div className="share-link-heading">
        <span className="share-link-symbol">
          <LinkIcon size={22} />
        </span>
        <div className="share-link-intro">
          <div className="share-link-title">
            <h3>{t("লিংক পাঠান")}</h3>
            {status ? (
              <span className="share-active">
                <CheckIcon size={13} aria-hidden="true" />
                {t("লিংক চালু আছে")}
              </span>
            ) : null}
          </div>
          <p>{t("নতুন হিসাবও এই লিংকে দেখা যাবে।")}</p>
        </div>
      </div>
      <FormError {...errorNotice} message={t(error)} className="share-error" />
      {mode === "demo" ? (
        <p className="helper-text">
          {t("নমুনা খাতা থেকে লিংক দেওয়া যায় না। নিজের খাতায় ব্যবহার করুন।")}
        </p>
      ) : (
        <>
          {url && (
            <div className="share-link-ready">
              <div className="share-url-field">
                <input
                  ref={field}
                  aria-label={t("লিংক কপি করুন")}
                  readOnly
                  value={url}
                  onFocus={(event) => event.target.select()}
                />
              </div>
              <div className="share-link-actions">
                <button
                  type="button"
                  className="primary-button share-copy-button"
                  disabled={busy}
                  onClick={() => void copy()}
                >
                  <CopyIcon size={20} />
                  {t("লিংক কপি করুন")}
                </button>
                {typeof navigator.share === "function" ? (
                  <button
                    type="button"
                    className="secondary-button share-native-button"
                    disabled={busy}
                    onClick={() => void share()}
                    aria-label={t("অন্যভাবে পাঠান")}
                    title={t("অন্যভাবে পাঠান")}
                  >
                    <ShareNetworkIcon size={20} />
                  </button>
                ) : null}
              </div>
            </div>
          )}
          {status && !url && (
            <p className="helper-text">
              {t("আগের লিংক চালু আছে। নতুন লিংক নিলে আগেরটি বন্ধ হবে।")}
            </p>
          )}
          {statusFailed ? (
            <div className="share-link-actions share-link-create">
              <button
                type="button"
                className="primary-button"
                disabled={busy || loading}
                onClick={retryStatus}
              >
                {t("আবার চেষ্টা করুন")}
              </button>
            </div>
          ) : null}
          {!url && !statusFailed ? (
            <div className="share-link-actions share-link-create">
              <button
                type="button"
                className="primary-button"
                disabled={busy || loading}
                onClick={() => void create()}
              >
                <LinkIcon size={18} />
                {t(
                  busy
                    ? "অপেক্ষা করুন…"
                    : status
                      ? "নতুন লিংক নিন"
                      : "লিংক তৈরি করুন",
                )}
              </button>
            </div>
          ) : null}
          {status && (
            <details className="share-link-management" key={status.id}>
              <summary>{t("লিংক সামলান")}</summary>
              {url ? (
                <>
                  <p className="helper-text">
                    {t("নতুন লিংক নিলে আগেরটি বন্ধ হবে।")}
                  </p>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => void create()}
                  >
                    <LinkIcon size={18} />
                    {t("নতুন লিংক নিন")}
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="text-button share-revoke"
                disabled={busy}
                onClick={() => void revoke()}
              >
                <XCircleIcon size={18} />
                {t("লিংক বন্ধ করুন")}
              </button>
            </details>
          )}
        </>
      )}
    </section>
  );
}
