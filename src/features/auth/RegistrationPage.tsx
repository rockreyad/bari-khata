import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  Envelope,
  House,
  ShieldCheck,
} from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import { useAuth } from "./AuthProvider";
import { PasswordInput } from "./PasswordInput";
import {
  registerAccount,
  resendRegistration,
  registrationErrorText,
} from "./registration";
import "./registration.css";
export function RegistrationPage() {
  const { t, number } = useLanguageContext(),
    auth = useAuth();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [until, setUntil] = useState(0),
    [now, setNow] = useState(Date.now);
  const active = useRef(true),
    inFlight = useRef(false);
  const currentAccount = useRef(auth.user?.id ?? null);
  currentAccount.current = auth.user?.id ?? null;
  useEffect(() => {
    setPassword("");
    setConfirmation("");
    setBusy(false);
  }, [auth.user?.id]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (!until) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [until]);
  const remaining = Math.max(0, Math.ceil((until - now) / 1000));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    const accountAtStart = currentAccount.current;
    const alive = () =>
      active.current && currentAccount.current === accountAtStart;
    setBusy(true);
    setError("");
    try {
      await registerAccount(email, password, confirmation);
      if (!alive()) return;
      setEmail(email.trim().toLowerCase());
      setPassword("");
      setConfirmation("");
      setSent(true);
      setUntil(Date.now() + 60000);
      setNow(Date.now());
    } catch (cause) {
      if (alive())
        setError(
          registrationErrorText(cause instanceof Error ? cause.message : ""),
        );
    } finally {
      inFlight.current = false;
      if (alive()) setBusy(false);
    }
  }
  async function resend() {
    if (inFlight.current || remaining) return;
    inFlight.current = true;
    const accountAtStart = currentAccount.current;
    const alive = () =>
      active.current && currentAccount.current === accountAtStart;
    setBusy(true);
    setError("");
    try {
      await resendRegistration(email);
      if (alive()) {
        setUntil(Date.now() + 60000);
        setNow(Date.now());
      }
    } catch (cause) {
      if (alive())
        setError(
          registrationErrorText(cause instanceof Error ? cause.message : ""),
        );
    } finally {
      inFlight.current = false;
      if (alive()) setBusy(false);
    }
  }
  if (auth.status === "loading")
    return (
      <main className="auth-page">
        <p>{t("অপেক্ষা করুন…")}</p>
      </main>
    );
  if (auth.user)
    return (
      <main className="auth-page">
        <section className="auth-card auth-result">
          <ShieldCheck size={44} weight="duotone" />
          <h1>{t("এই ফোনে আপনার খাতা খোলা আছে")}</h1>
          <p>{t("নতুন অ্যাকাউন্টে ঢুকতে আগে নিজের খাতা থেকে বের হতে হবে।")}</p>
          <Link className="primary-button" to="/">
            {t("নিজের খাতায় ফিরি")}
          </Link>
        </section>
      </main>
    );
  return (
    <main className="auth-page">
      <section className="auth-card auth-register-card">
        <Link className="auth-back-link" to="/login">
          <ArrowLeft size={16} />
          {t("লগইনে ফিরি")}
        </Link>
        <div className="auth-brand">
          <House size={31} weight="duotone" />
          <span>{t("বাড়ির খাতা")}</span>
        </div>
        <div className="auth-registration-symbol">
          <Envelope size={32} weight="duotone" />
        </div>
        <h1>{t(sent ? "ইমেইল দেখুন" : "নিজের অ্যাকাউন্ট খুলুন")}</h1>
        <p className="auth-description">
          {t(
            sent
              ? "নতুন অ্যাকাউন্ট হলে নিশ্চিত করার ইমেইল পাবেন। আগে খুলে থাকলে লগইন করুন।"
              : "আপনার হিসাব শুধু আপনার খাতাতেই থাকবে।",
          )}
        </p>
        {sent ? (
          <div className="auth-email-sent" role="status">
            <strong>{email}</strong>
            <p>
              {t(
                "ইমেইলের লিংক খুলে নিশ্চিত করুন। তারপর পাসওয়ার্ড দিয়ে লগইন করুন।",
              )}
            </p>
            <p className="helper-text">
              {t("ইমেইল না পেলে Spam বা Junk ফোল্ডারও দেখুন।")}
            </p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void resend()}
              disabled={busy || remaining > 0}
            >
              {remaining
                ? t("{{seconds}} সেকেন্ড পরে আবার পাঠান", {
                    seconds: number(remaining),
                  })
                : t(busy ? "পাঠাচ্ছি…" : "ইমেইল আবার পাঠাই")}
            </button>
            <button
              className="text-button"
              onClick={() => {
                setSent(false);
                setError("");
              }}
              type="button"
            >
              {t("ইমেইল ঠিকানা বদলাই")}
            </button>
            <Link to="/login" state={{ email }} className="primary-button">
              {t("লগইন করি")}
              <ArrowRight size={19} />
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <label htmlFor="register-email">{t("ইমেইল")}</label>
            <div className="auth-input">
              <Envelope size={20} />
              <input
                id="register-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                placeholder={t("আপনার ইমেইল")}
                maxLength={254}
                disabled={busy}
              />
            </div>
            <label htmlFor="register-password">{t("পাসওয়ার্ড")}</label>
            <PasswordInput
              id="register-password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
              maxLength={128}
              disabled={busy}
              aria-describedby="register-password-hint"
            />
            <p id="register-password-hint" className="auth-field-hint">
              {t("অন্তত ৮ অক্ষর দিন।")}
            </p>
            <label htmlFor="register-confirmation">
              {t("পাসওয়ার্ড আবার লিখুন")}
            </label>
            <PasswordInput
              id="register-confirmation"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              required
              maxLength={128}
              disabled={busy}
            />
            {error ? (
              <p className="auth-error" role="alert">
                {t(error)}
              </p>
            ) : null}
            <button
              className="primary-button auth-submit"
              type="submit"
              disabled={busy}
            >
              {t(busy ? "অপেক্ষা করুন…" : "অ্যাকাউন্ট খুলুন")}
              <ArrowRight size={20} />
            </button>
          </form>
        )}
        {sent && error ? (
          <p className="auth-error" role="alert">
            {t(error)}
          </p>
        ) : null}
        <p className="auth-private">
          <ShieldCheck size={18} />
          {t("অন্য কারও হিসাব আপনার খাতায় দেখা যাবে না।")}
        </p>
        {!sent ? (
          <p className="auth-register-link">
            {t("আগে অ্যাকাউন্ট খুলেছেন?")}{" "}
            <Link to="/login">{t("লগইন করি")}</Link>
          </p>
        ) : null}
      </section>
    </main>
  );
}
