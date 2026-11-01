import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  CheckCircle,
  Envelope,
  House,
  WarningCircle,
} from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import { useAuth } from "./AuthProvider";
import {
  confirmRegistration,
  readConfirmation,
  type Confirmation,
} from "./registration";
import "./registration.css";
export function ConfirmEmailPage() {
  const { t } = useLanguageContext(),
    auth = useAuth(),
    location = useLocation(),
    navigate = useNavigate();
  const [confirmation, setConfirmation] = useState<Confirmation | null>(
    () => readConfirmation(location.search, location.hash).confirmation,
  );
  const [state, setState] = useState<
    "ready" | "busy" | "confirmed" | "invalid"
  >(() => (confirmation ? "ready" : "invalid"));
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const generation = useRef(0),
    active = useRef(true),
    inFlight = useRef(false);
  const accountScope = useRef(auth.user?.id ?? null);
  useEffect(() => {
    const owner = auth.user?.id ?? null;
    if (accountScope.current === owner) return;
    accountScope.current = owner;
    if (inFlight.current) {
      generation.current++;
      setConfirmation(null);
      setState("invalid");
      setError("");
    }
  }, [auth.user?.id]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    const input = readConfirmation(location.search, location.hash);
    if (!input.hasCredential) return;
    generation.current++;
    setConfirmation(input.confirmation);
    setState(input.confirmation ? "ready" : "invalid");
    setEmail("");
    setError("");
    navigate("/auth/confirm", { replace: true });
  }, [location.search, location.hash, navigate]);
  async function confirm() {
    if (!confirmation || inFlight.current) return;
    inFlight.current = true;
    const request = generation.current;
    setState("busy");
    setError("");
    try {
      const verifiedEmail = await confirmRegistration(confirmation);
      if (active.current && request === generation.current) {
        setConfirmation(null);
        setEmail(verifiedEmail);
        setState("confirmed");
      }
    } catch (cause) {
      if (active.current && request === generation.current) {
        const code = cause instanceof Error ? cause.message : "";
        if (
          code === "confirmation_network" ||
          code === "confirmation_rate_limited"
        ) {
          setError(
            code === "confirmation_rate_limited"
              ? "একটু অপেক্ষা করে আবার চেষ্টা করুন।"
              : "সংযোগ পাওয়া যায়নি। লিংকটি আছে; আবার চেষ্টা করুন।",
          );
          setState("ready");
        } else {
          setConfirmation(null);
          setState("invalid");
        }
      }
    } finally {
      inFlight.current = false;
    }
  }
  const confirmed = state === "confirmed",
    invalid = state === "invalid";
  return (
    <main className="auth-page">
      <section className="auth-card auth-result">
        <div className="auth-brand">
          <House size={31} weight="duotone" />
          <span>{t("বাড়ির খাতা")}</span>
        </div>
        <div
          className={`auth-registration-symbol ${invalid ? "is-invalid" : ""}`}
        >
          {confirmed ? (
            <CheckCircle size={37} weight="duotone" />
          ) : invalid ? (
            <WarningCircle size={37} weight="duotone" />
          ) : (
            <Envelope size={36} weight="duotone" />
          )}
        </div>
        <h1>
          {t(
            confirmed
              ? "ইমেইল নিশ্চিত হয়েছে"
              : invalid
                ? "লিংকটি কাজ করছে না"
                : "ইমেইল নিশ্চিত করুন",
          )}
        </h1>
        <p className="auth-description">
          {t(
            confirmed
              ? "এবার আপনার ইমেইল ও পাসওয়ার্ড দিয়ে খাতা খুলুন।"
              : invalid
                ? "লিংকটি ভুল বা মেয়াদ শেষ হয়েছে। নতুন ইমেইল চেয়ে আবার চেষ্টা করুন।"
                : "অ্যাকাউন্ট খোলা শেষ করতে নিচের বোতামে চাপুন।",
          )}
        </p>
        {error ? (
          <p className="auth-error" role="alert">
            {t(error)}
          </p>
        ) : null}
        {!confirmed && !invalid ? (
          <button
            className="primary-button"
            type="button"
            disabled={state === "busy"}
            onClick={() => void confirm()}
          >
            {t(state === "busy" ? "অপেক্ষা করুন…" : "ইমেইল নিশ্চিত করি")}
          </button>
        ) : null}
        {auth.user ? (
          <>
            <p className="helper-text">
              {t("এই ফোনে আগের অ্যাকাউন্টই খোলা আছে। সেটি বদলানো হয়নি।")}
            </p>
            <Link className="primary-button" to="/">
              {t("নিজের খাতায় ফিরি")}
            </Link>
          </>
        ) : confirmed ? (
          <Link className="primary-button" to="/login" state={{ email }}>
            {t("লগইন করি")}
          </Link>
        ) : invalid ? (
          <Link className="primary-button" to="/register/resend">
            {t("নতুন ইমেইল চাই")}
          </Link>
        ) : null}
        <p className="auth-private">
          {t("এই লিংক আপনার ফোনের অন্য কোনো খাতা বদলাবে না।")}
        </p>
      </section>
    </main>
  );
}
