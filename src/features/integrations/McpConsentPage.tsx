import { useEffect, useRef, useState } from "react";
import {
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  RobotIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import { getActiveOwner } from "../../data/database";
import { parseMoneyText } from "../../domain/money";
import { useAuth } from "../auth/AuthProvider";
import { AssistantPermissions } from "./AssistantPermissions";
import { FormError, useFormError } from "../../components/ui/FormError";
import {
  approveAssistantAuthorization,
  assistantErrors,
  loadAssistantAuthorization,
  type AssistantAuthorization,
  type AssistantScope,
} from "./mcpClient";
import "./integrations.css";
import "./mcp-consent.css";

export function McpConsentPage({
  onRedirect = (url: string) => window.location.assign(url),
}: {
  onRedirect?: (url: string) => void;
}) {
  const auth = useAuth();
  const { t, formatDigits } = useLanguageContext();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requestId = params.get("request") ?? "";
  const owner = auth.user?.id ?? null;
  const [authorization, setAuthorization] = useState<{
    owner: string;
    value: AssistantAuthorization;
  } | null>(null);
  const [scopes, setScopes] = useState<AssistantScope[]>([]);
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [maximum, setMaximum] = useState("");
  const [error, setError, errorNotice] = useFormError();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [completed, setCompleted] = useState<{
    key: string;
    approved: boolean;
    clientName: string;
    redirectUrl: string;
  } | null>(null);
  const mounted = useRef(false);
  const submission = useRef<{ key: string } | null>(null);
  const flowKey = `${owner ?? ""}:${requestId}`;
  const activeFlow = useRef(flowKey);
  activeFlow.current = flowKey;
  const finished = completed?.key === flowKey ? completed : null;
  const current =
    auth.status === "signed-in" &&
    authorization?.owner === owner &&
    authorization.value.requestId === requestId
      ? authorization.value
      : null;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!owner || auth.status !== "signed-in" || !requestId) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setAuthorization(null);
    setBusy(false);
    setMaximum("");
    setConfirmationRequired(false);
    void loadAssistantAuthorization(owner, requestId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted && getActiveOwner() === owner) {
          setAuthorization({ owner, value: result.authorization });
          setScopes(result.authorization.scopes);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            assistantErrors[cause instanceof Error ? cause.message : ""] ??
              "সংযোগের অনুরোধ পাওয়া যায়নি। সহকারী থেকে আবার চেষ্টা করুন।",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [owner, auth.status, requestId, reload]);
  function returnToAssistant(url: string) {
    try {
      onRedirect(url);
    } catch {
      setError(
        "অনুমতির সিদ্ধান্ত রাখা হয়েছে। সহকারীতে ফিরতে নিচের বোতাম চাপুন।",
      );
    }
  }
  async function decide(approve: boolean) {
    if (
      !current ||
      !owner ||
      submission.current?.key === flowKey ||
      finished ||
      getActiveOwner() !== owner
    )
      return;
    const attempt = { key: flowKey };
    submission.current = attempt;
    let saved = false;
    setBusy(true);
    setError("");
    try {
      let maxAmountPaisa: number | null = null;
      if (approve && maximum.trim()) {
        try {
          maxAmountPaisa = parseMoneyText(maximum);
          if (maxAmountPaisa <= 0) throw new Error();
        } catch {
          throw new Error("invalid_amount");
        }
      }
      const result = await approveAssistantAuthorization(owner, {
        requestId: current.requestId,
        approve,
        name: current.clientName,
        scopes: approve ? scopes : [],
        policy: { confirmationRequired, maxAmountPaisa },
      });
      saved = true;
      if (
        mounted.current &&
        activeFlow.current === flowKey &&
        getActiveOwner() === owner
      ) {
        setCompleted({
          key: flowKey,
          approved: approve,
          clientName: current.clientName,
          redirectUrl: result.redirectUrl,
        });
        returnToAssistant(result.redirectUrl);
      }
    } catch (cause) {
      if (
        mounted.current &&
        activeFlow.current === flowKey &&
        getActiveOwner() === owner
      )
        setError(
          assistantErrors[cause instanceof Error ? cause.message : ""] ??
            "সংযোগ দেওয়া যায়নি। আবার চেষ্টা করুন।",
        );
    } finally {
      if (!saved && submission.current === attempt) submission.current = null;
      if (mounted.current && activeFlow.current === flowKey) setBusy(false);
    }
  }
  if (auth.status === "loading")
    return <div className="app-splash">{t("অপেক্ষা করুন…")}</div>;
  if (!auth.user)
    return (
      <Navigate
        to="/login"
        state={{ from: location.pathname + location.search }}
        replace
      />
    );
  return (
    <main className="assistant-consent-page">
      <div className="mcp-consent-shell">
        <header className="mcp-consent-brand">
          <span>{t("বাড়ির খাতা")}</span>
          <span>{t("MCP সংযোগ")}</span>
        </header>
        <section className="assistant-card assistant-consent">
          <div
            className={`mcp-consent-symbol${finished ? " is-complete" : ""}`}
          >
            {finished ? (
              <CheckCircleIcon size={36} weight="duotone" aria-hidden="true" />
            ) : (
              <RobotIcon size={36} weight="duotone" aria-hidden="true" />
            )}
          </div>
          <p className="mcp-consent-eyebrow">
            {t(
              finished
                ? "অনুমতির সিদ্ধান্ত রাখা হয়েছে"
                : "আপনার খাতা, আপনার অনুমতি",
            )}
          </p>
          <h1>
            {t(
              finished
                ? finished.approved
                  ? "অনুমতি দেওয়া হয়েছে"
                  : "অনুমতি দেওয়া হয়নি"
                : "সহকারীকে খাতার সঙ্গে যুক্ত করুন",
            )}
          </h1>
          <p className="mcp-consent-intro">
            {finished
              ? t(
                  "{{name}}-এ ফিরে যাচ্ছেন। সংযোগ শেষ হওয়ার বার্তা দেখালে সেই পাতা বন্ধ করতে পারবেন।",
                  {
                    name: finished.clientName,
                  },
                )
              : t(
                  "আপনার বেছে দেওয়া কাজেই সহকারী অনুমতি পাবে। পরে সেটিংস থেকে বন্ধ করতে পারবেন।",
                )}
          </p>
          <p className="assistant-account mcp-consent-account">
            <ShieldCheckIcon size={18} aria-hidden="true" />
            {auth.user.email ||
              (auth.user.phone
                ? formatDigits(auth.user.phone)
                : t("নিজের অ্যাকাউন্ট"))}
          </p>
          {loading ? <p role="status">{t("সংযোগের তথ্য আনছি…")}</p> : null}
          {!requestId ? (
            <p role="alert" className="assistant-error">
              {t("সংযোগের অনুরোধ নেই। সহকারী থেকে আবার সংযোগ দিন।")}
            </p>
          ) : null}
          {auth.status === "offline" ? (
            <p role="alert">
              {t(
                "সংযোগ দিতে বা অনুমতি বদলাতে ইন্টারনেটে যুক্ত হয়ে নিজের খাতা খুলুন।",
              )}
            </p>
          ) : null}
          <FormError
            {...errorNotice}
            message={t(error)}
            className="assistant-error"
          />
          {finished ? (
            <div className="mcp-consent-completed" role="status">
              <p>{t("এই অনুরোধে আর অনুমতি দিতে হবে না।")}</p>
              <button
                type="button"
                className="primary-button"
                onClick={() => returnToAssistant(finished.redirectUrl)}
              >
                {t("সহকারীতে ফিরে যান")}
                <ArrowRightIcon size={18} aria-hidden="true" />
              </button>
            </div>
          ) : current ? (
            <>
              <div className="assistant-client-name">
                <h2>{current.clientName}</h2>
                <small>
                  {t("সংযোগ শেষে ফিরবেন: {{host}}", {
                    host: new URL(current.redirectUri).host,
                  })}
                </small>
                <p className="mcp-consent-handoff-note">
                  {t("শেষ ধাপে সহকারীর নিজস্ব পাতায় সংযোগের ফল দেখাবে।")}
                </p>
              </div>
              <AssistantPermissions
                scopes={scopes}
                onScopesChange={setScopes}
                confirmationRequired={confirmationRequired}
                onConfirmationChange={setConfirmationRequired}
                maximum={maximum}
                onMaximumChange={setMaximum}
                allowed={current.scopes}
                disabled={busy}
              />
              <p className="assistant-notice">
                <ShieldCheckIcon size={21} aria-hidden="true" />
                {t(
                  "আপনার ব্যক্তিগত খাতার অনুমোদিত হিসাব এই সহকারী দেখতে পাবে।",
                )}
              </p>
              <div className="assistant-actions">
                <button
                  className="primary-button"
                  type="button"
                  disabled={busy || !scopes.length}
                  onClick={() => void decide(true)}
                >
                  {t(busy ? "অপেক্ষা করুন…" : "অনুমতি দিয়ে যুক্ত করুন")}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void decide(false)}
                >
                  {t("অনুমতি দেব না")}
                </button>
              </div>
            </>
          ) : requestId && !loading && auth.status === "signed-in" ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => setReload((value) => value + 1)}
            >
              {t("আবার চেষ্টা করুন")}
            </button>
          ) : null}
          <button
            className="assistant-back"
            type="button"
            disabled={busy}
            onClick={() => navigate("/settings/assistants")}
          >
            {t("সেটিংসে ফিরুন")}
          </button>
        </section>
        <p className="mcp-consent-footer">
          {t("কোন অনুমতি দিচ্ছেন তা দেখে নিন। চাইলে এখনই ফিরে যেতে পারেন।")}
        </p>
      </div>
    </main>
  );
}
