import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Envelope } from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import { FormError, useFormError } from "../../components/ui/FormError";
import { resendRegistration, registrationErrorText } from "./registration";
import "./registration.css";
export function ResendEmailPage() {
  const { t, number } = useLanguageContext();
  const [email, setEmail] = useState(""),
    [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false),
    [until, setUntil] = useState(0),
    [now, setNow] = useState(Date.now);
  const [error, setError, errorNotice] = useFormError();
  const active = useRef(true),
    inFlight = useRef(false);
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
    if (inFlight.current || remaining) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await resendRegistration(email);
      if (active.current) {
        setSent(true);
        setUntil(Date.now() + 60000);
        setNow(Date.now());
      }
    } catch (cause) {
      if (active.current)
        setError(
          registrationErrorText(cause instanceof Error ? cause.message : ""),
        );
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-card auth-result">
        <div className="auth-registration-symbol">
          <Envelope size={35} weight="duotone" />
        </div>
        <h1>{t("নিশ্চিত করার ইমেইল চাই")}</h1>
        <p className="auth-description">
          {t("অ্যাকাউন্ট খোলার সময় যে ইমেইল দিয়েছেন সেটি লিখুন।")}
        </p>
        <form onSubmit={submit} noValidate>
          <FormError
            {...errorNotice}
            message={t(error)}
            className="auth-error"
          />
          <label htmlFor="resend-email">{t("ইমেইল")}</label>
          <div className="auth-input">
            <Envelope size={20} />
            <input
              id="resend-email"
              value={email}
              type="email"
              inputMode="email"
              autoComplete="email"
              maxLength={254}
              required
              disabled={busy}
              onChange={(event) => {
                setEmail(event.target.value);
                setSent(false);
              }}
            />
          </div>
          <button
            className="primary-button auth-submit"
            disabled={busy || remaining > 0}
          >
            {remaining
              ? t("{{seconds}} সেকেন্ড পরে আবার পাঠান", {
                  seconds: number(remaining),
                })
              : t(busy ? "পাঠাচ্ছি…" : "ইমেইল পাঠান")}
          </button>
        </form>
        {sent ? (
          <p className="auth-confirm-notice" role="status">
            {t(
              "নতুন অ্যাকাউন্ট হলে নিশ্চিত করার ইমেইল পাবেন। আগে খুলে থাকলে লগইন করুন।",
            )}
          </p>
        ) : null}
        <Link className="text-button" to="/login">
          {t("লগইনে ফিরি")}
        </Link>
      </section>
    </main>
  );
}
