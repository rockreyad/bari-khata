import { NumericInput } from "../../components/ui/NumericInput";
import { PwaUpdateNotice } from "../../components/PwaUpdateNotice";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { PasswordInput } from "./PasswordInput";
import {
  HouseLine,
  LockKey,
  Envelope,
  Phone,
  ArrowRight,
  ShieldCheck,
  ArrowLeft,
  BookOpen,
} from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import { useAuth } from "./AuthProvider";
import { nationalPhoneInput, normalizeBangladeshPhone } from "./phone";
import "./phone-login.css";

const phoneCode = (value: string) =>
  value
    .replace(/[০-৯]/g, (digit) => String("০১২৩৪৫৬৭৮৯".indexOf(digit)))
    .replace(/[^0-9]/g, "")
    .slice(0, 8);
function phoneError(code: string, manual = false) {
  if (code === "invalid_phone") return "সঠিক বাংলাদেশি ফোন নম্বর লিখুন।";
  if (code === "invalid_otp") return "কোডটি মেলেনি। আবার চেষ্টা করুন।";
  if (
    [
      "otp_expired",
      "otp_challenge_expired",
      "challenge_expired",
      "challenge_invalid",
    ].includes(code)
  )
    return manual
      ? "লগইন হয়নি। আবার চেষ্টা করুন।"
      : "কোডের মেয়াদ শেষ হয়েছে। আবার কোড নিন।";
  if (/rate_limit|too_many|attempts_exceeded/.test(code))
    return "একটু অপেক্ষা করে আবার চেষ্টা করুন।";
  if (
    [
      "phone_requires_real_otp",
      "phone_account_unavailable",
      "phone_requires_sms",
    ].includes(code)
  )
    return manual
      ? "লগইন হয়নি। আবার চেষ্টা করুন।"
      : "এই নম্বরে আসল SMS দিয়ে লগইন করতে হবে।";
  if (/unavailable|disabled/.test(code))
    return manual
      ? "ফোন দিয়ে লগইন এখন চালু নেই। পরে আবার চেষ্টা করুন।"
      : "ফোন দিয়ে লগইন এখন চালু নেই। ইমেইল ব্যবহার করুন।";
  if (code === "cloud_not_configured")
    return "লগইনের সংযোগ এখনও প্রস্তুত হয়নি।";
  if (/fetch|network|offline|connection/i.test(code))
    return "সংযোগ পাওয়া যায়নি। আবার চেষ্টা করুন।";
  return "লগইন হয়নি। তথ্য ও ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।";
}
export function LoginPage({ onSuccess }: { onSuccess?: () => void }) {
  const { t, number, formatDigits } = useLanguageContext();
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const initialEmail =
    typeof location.state?.email === "string" &&
    location.state.email.length <= 254
      ? location.state.email
      : "";
  const mode = auth.phoneAuthMode ?? (auth.phoneOtpEnabled ? "sms" : "off");
  const manual = mode === "manual";
  const [method, setMethod] = useState<"email" | "phone">(() =>
    initialEmail || !auth.phoneOtpEnabled ? "email" : "phone",
  );
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const pinRoute = location.pathname === "/login/pin";
  const pinPage = pinRoute && sent && method === "phone";
  const navigationState = {
    ...(typeof location.state?.from === "string"
      ? { from: location.state.from }
      : {}),
    ...(initialEmail ? { email: initialEmail } : {}),
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryUntil, setRetryUntil] = useState(0);
  const [now, setNow] = useState(Date.now);
  const active = useRef(true),
    requestScope = useRef(0),
    inFlight = useRef(false);
  const minimumCodeLength = mode === "sms" ? 6 : 4;
  const remaining = Math.max(0, Math.ceil((retryUntil - now) / 1000));
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      requestScope.current++;
    };
  }, []);
  useEffect(() => {
    if (!retryUntil) return;
    const timer = window.setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= retryUntil) setRetryUntil(0);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryUntil]);
  useEffect(() => {
    if (!pinRoute) setOtp("");
  }, [pinRoute]);
  useEffect(() => {
    if (pinRoute && (!sent || method !== "phone" || !auth.phoneOtpEnabled))
      navigate("/login", { replace: true, state: navigationState });
  }, [pinRoute, sent, method, auth.phoneOtpEnabled, navigate]);
  useEffect(() => {
    if (!auth.phoneOtpEnabled && method === "phone") {
      requestScope.current++;
      setMethod("email");
      setSent(false);
      setOtp("");
      setError("");
    }
  }, [auth.phoneOtpEnabled, method]);
  const changeMethod = (value: "email" | "phone") => {
    if (busy) return;
    requestScope.current++;
    setMethod(value);
    setOtp("");
    setError("");
    navigate(value === "phone" && sent ? "/login/pin" : "/login", {
      replace: true,
      state: navigationState,
    });
  };
  const setCooldown = (response: unknown) => {
    const seconds =
      typeof response === "object" &&
      response &&
      "retryAfter" in response &&
      typeof response.retryAfter === "number" &&
      Number.isFinite(response.retryAfter)
        ? Math.max(1, Math.min(900, Math.ceil(response.retryAfter)))
        : 60;
    setRetryUntil(Date.now() + seconds * 1000);
    setNow(Date.now());
  };
  async function requestCode() {
    if (inFlight.current || remaining > 0) return;
    let normalized: string;
    try {
      normalized = normalizeBangladeshPhone(phone);
    } catch {
      setError(t("সঠিক বাংলাদেশি ফোন নম্বর লিখুন।"));
      return;
    }
    inFlight.current = true;
    const scope = requestScope.current;
    setBusy(true);
    setError("");
    try {
      const response = await auth.requestPhoneOtp(normalized);
      if (!active.current || scope !== requestScope.current) return;
      setSent(true);
      setOtp("");
      if (!pinRoute) navigate("/login/pin", { state: navigationState });
      if (!manual) setCooldown(response);
    } catch (failure) {
      if (active.current && scope === requestScope.current) {
        const code = failure instanceof Error ? failure.message : "";
        setError(t(phoneError(code, manual)));
        if (!manual && /rate_limit/.test(code)) setCooldown(failure);
      }
    } finally {
      inFlight.current = false;
      if (active.current && scope === requestScope.current) setBusy(false);
    }
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current || (method === "phone" && manual && remaining > 0))
      return;
    if (method === "phone" && !pinPage) {
      await requestCode();
      return;
    }
    if (method === "phone" && otp.length < minimumCodeLength) {
      setError(t("কোডটি পুরো লিখুন।"));
      return;
    }
    inFlight.current = true;
    const scope = requestScope.current;
    setBusy(true);
    setError("");
    try {
      if (method === "email") await auth.signIn(email, password);
      else
        await auth.verifyPhoneOtp(
          normalizeBangladeshPhone(phone),
          phoneCode(otp),
        );
      if (active.current && scope === requestScope.current) onSuccess?.();
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : "";
      if (active.current && scope === requestScope.current) {
        setError(
          t(
            code === "email_not_confirmed"
              ? "আগে আপনার ইমেইল নিশ্চিত করুন। তারপর লগইন করুন।"
              : phoneError(code, manual),
          ),
        );
        if (
          !manual &&
          [
            "otp_expired",
            "otp_challenge_expired",
            "challenge_expired",
            "challenge_invalid",
            "otp_attempts_exceeded",
          ].includes(code)
        ) {
          setSent(false);
          setOtp("");
          setRetryUntil(0);
        }
        if (
          method === "phone" &&
          manual &&
          /rate_limit|too_many|attempts_exceeded/.test(code)
        )
          setCooldown(failure);
      }
    } finally {
      inFlight.current = false;
      if (active.current && scope === requestScope.current) setBusy(false);
    }
  };
  const editNumber = () => {
    if (busy) return;
    requestScope.current++;
    setSent(false);
    setOtp("");
    setError("");
    navigate("/login", { replace: true, state: navigationState });
  };
  return (
    <main className={`auth-page login-page ${pinPage ? "login-pin-page" : ""}`}>
      <section
        className={`auth-card auth-login-card ${method === "phone" ? "auth-phone-card" : ""}`}
      >
        <PwaUpdateNotice
          blocked={
            busy ||
            Boolean(email || password || phone || otp || sent || pinRoute)
          }
        />
        <header className="login-topbar">
          {pinPage ? (
            <button
              type="button"
              className="login-back"
              onClick={editNumber}
              disabled={busy}
              aria-label={t("ফিরুন")}
            >
              <ArrowLeft size={22} weight="bold" />
            </button>
          ) : (
            <span className="login-brand-mark" aria-hidden="true">
              <BookOpen size={27} weight="duotone" />
            </span>
          )}
          <span className="login-brand-name">{t("বাড়ির খাতা")}</span>
          {method === "phone" ? (
            <span
              className="login-step"
              aria-label={t(pinPage ? "দ্বিতীয় ধাপ" : "প্রথম ধাপ")}
            >
              <i className="is-filled" />
              <i className={pinPage ? "is-filled" : ""} />
            </span>
          ) : null}
        </header>
        <div className="login-welcome">
          <span
            className={`login-welcome-symbol ${pinPage ? "is-pin" : ""}`}
            aria-hidden="true"
          >
            {pinPage ? (
              <LockKey size={36} weight="duotone" />
            ) : (
              <HouseLine size={39} weight="duotone" />
            )}
          </span>
          <p className="login-eyebrow">
            {t(pinPage ? "আর এক ধাপ" : "নিজের খাতা, নিজের মতো")}
          </p>
          <h1>
            {t(
              pinPage
                ? manual
                  ? "PIN লিখুন"
                  : "কোড লিখুন"
                : "বাড়ির হিসাব, হাতের মুঠোয়",
            )}
          </h1>
          <p className="auth-description">
            {pinPage ? (
              <>
                <span>{t("ফোন নম্বর")}</span>{" "}
                <strong dir="ltr">
                  {formatDigits(normalizeBangladeshPhone(phone))}
                </strong>
              </>
            ) : (
              t("মালামাল, মজুরি আর প্রতিটি লেনদেন—সব হিসাব এক খাতায়।")
            )}
          </p>
        </div>
        {!pinPage && auth.phoneOtpEnabled ? (
          <div
            className="segmented-control auth-methods"
            aria-label={t("লগইনের পদ্ধতি")}
          >
            <button
              type="button"
              disabled={busy}
              aria-pressed={method === "phone"}
              onClick={() => changeMethod("phone")}
            >
              <Phone size={18} weight="duotone" />
              {t("ফোন নম্বর")}
            </button>
            <button
              type="button"
              disabled={busy}
              aria-pressed={method === "email"}
              onClick={() => changeMethod("email")}
            >
              <Envelope size={18} weight="duotone" />
              {t("ইমেইল")}
            </button>
          </div>
        ) : null}
        <form onSubmit={submit} className="login-form">
          {method === "email" ? (
            <>
              <label htmlFor="login-email">{t("ইমেইল")}</label>
              <div className="auth-input">
                <Envelope size={20} />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                  value={email}
                  disabled={busy}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  placeholder={t("আপনার ইমেইল")}
                />
              </div>
              <label htmlFor="login-password">{t("পাসওয়ার্ড")}</label>
              <PasswordInput
                id="login-password"
                autoComplete="current-password"
                value={password}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </>
          ) : pinPage ? (
            <>
              <label className="login-pin-label" htmlFor="login-otp">
                {t(manual ? "প্রবেশের কোড" : "কোড")}
              </label>
              <NumericInput
                className="auth-otp-input"
                id="login-otp"
                autoFocus
                type="password"
                inputMode="numeric"
                autoComplete={manual ? "off" : "one-time-code"}
                value={otp}
                disabled={busy}
                onChange={(event) => {
                  setOtp(phoneCode(event.target.value));
                  setError("");
                }}
                required
                minLength={minimumCodeLength}
                maxLength={8}
                pattern="[0-9০-৯]*"
                placeholder={t("কোড লিখুন")}
                aria-describedby="phone-code-hint"
              />
              <p id="phone-code-hint" className="auth-field-hint" role="status">
                {t(
                  manual
                    ? "আপনাকে দেওয়া প্রবেশের কোডটি লিখুন।"
                    : mode === "mock"
                      ? "পরীক্ষার কোডটি লিখুন।"
                      : "ফোনে পাঠানো কোডটি লিখুন।",
                )}
              </p>
              {!manual ? (
                <button
                  type="button"
                  className="text-button auth-phone-resend"
                  disabled={busy || remaining > 0}
                  onClick={() => void requestCode()}
                >
                  {remaining > 0
                    ? t("{{seconds}} সেকেন্ড পরে আবার নিন", {
                        seconds: number(remaining),
                      })
                    : t("আবার কোড নিন")}
                </button>
              ) : null}
            </>
          ) : (
            <>
              <label htmlFor="login-phone">{t("ফোন নম্বর")}</label>
              <div className="login-phone-field">
                <span
                  className="login-country"
                  aria-label={t("বাংলাদেশের কোড")}
                >
                  <svg
                    className="login-bd-flag"
                    viewBox="0 0 40 28"
                    role="img"
                    aria-label={t("বাংলাদেশ")}
                  >
                    <rect width="40" height="28" rx="5" fill="#006a4e" />
                    <circle cx="18" cy="14" r="8" fill="#f42a41" />
                  </svg>
                  <span dir="ltr">{formatDigits("+880")}</span>
                </span>
                <NumericInput
                  id="login-phone"
                  type="tel"
                  autoComplete="tel-national"
                  inputMode="tel"
                  value={phone}
                  disabled={busy}
                  onChange={(event) => {
                    requestScope.current++;
                    setPhone(nationalPhoneInput(event.target.value));
                    setSent(false);
                    setOtp("");
                    setError("");
                    setRetryUntil(0);
                  }}
                  required
                  placeholder={t("17 1234 5678")}
                  maxLength={24}
                />
              </div>
            </>
          )}
          {method === "phone" && mode === "mock" ? (
            <p className="auth-phone-test-note">
              <ShieldCheck size={17} />
              {t("পরীক্ষার জন্য ফোনে SMS যাবে না।")}
            </p>
          ) : null}
          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}
          {!manual &&
          error === t("আগে আপনার ইমেইল নিশ্চিত করুন। তারপর লগইন করুন।") ? (
            <Link className="auth-resend-link" to="/register/resend">
              {t("নিশ্চিত করার ইমেইল আবার চাই")}
            </Link>
          ) : null}
          <button
            className="primary-button auth-submit"
            type="submit"
            disabled={
              busy ||
              (method === "phone" && remaining > 0 && (manual || !pinPage))
            }
          >
            {busy
              ? t("অপেক্ষা করুন…")
              : method === "phone" && manual && remaining > 0
                ? t("{{seconds}} সেকেন্ড পরে চেষ্টা করুন", {
                    seconds: number(remaining),
                  })
                : method === "phone" && !pinPage
                  ? manual
                    ? t("এগিয়ে যাই")
                    : remaining > 0
                      ? t("{{seconds}} সেকেন্ড পরে আবার নিন", {
                          seconds: number(remaining),
                        })
                      : t("কোড নিন")
                  : t("খাতা খুলুন")}
            <ArrowRight size={21} weight="bold" />
          </button>
        </form>
        {pinPage ? (
          <div className="login-pin-options">
            <button
              type="button"
              className="text-button"
              onClick={editNumber}
              disabled={busy}
            >
              {t("নম্বর বদলাই")}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => changeMethod("email")}
              disabled={busy}
            >
              {t("ইমেইল")}
            </button>
          </div>
        ) : (
          <div className="login-secondary-links">
            <Link className="auth-guest-link" to="/sample">
              {t("নমুনা দেখুন")}
            </Link>
            {manual ? (
              method === "email" ? (
                <button
                  type="button"
                  className="text-button auth-register-link"
                  disabled={busy}
                  onClick={() => changeMethod("phone")}
                >
                  {t("ফোন দিয়ে লগইন করুন")}
                </button>
              ) : null
            ) : (
              <Link className="auth-register-link" to="/register">
                {t("অ্যাকাউন্ট খুলুন")}
              </Link>
            )}
          </div>
        )}
        <p className="auth-private">
          <ShieldCheck size={16} weight="duotone" />
          {t("লগইন ছাড়া ব্যক্তিগত হিসাব দেখা যায় না।")}
        </p>
      </section>
    </main>
  );
}
