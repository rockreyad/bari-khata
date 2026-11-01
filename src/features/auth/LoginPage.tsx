import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router";
import { PasswordInput } from "./PasswordInput";
import {
  House,
  Envelope,
  Phone,
  ArrowRight,
  ShieldCheck,
  ArrowLeft,
  BookOpen,
} from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import { useAuth } from "./AuthProvider";
import { normalizeBangladeshPhone } from "./phone";
import "./phone-login.css";

const phoneCode = (value: string) =>
  value
    .replace(/[০-৯]/g, (digit) => String("০১২৩৪৫৬৭৮৯".indexOf(digit)))
    .replace(/[^0-9]/g, "")
    .slice(0, 8);
function phoneError(code: string) {
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
    return "কোডের মেয়াদ শেষ হয়েছে। আবার কোড নিন।";
  if (/rate_limit|too_many|attempts_exceeded/.test(code))
    return "একটু অপেক্ষা করে আবার চেষ্টা করুন।";
  if (
    [
      "phone_requires_real_otp",
      "phone_account_unavailable",
      "phone_requires_sms",
    ].includes(code)
  )
    return "এই নম্বরে আসল SMS দিয়ে লগইন করতে হবে।";
  if (/unavailable|disabled/.test(code))
    return "ফোন দিয়ে লগইন এখন চালু নেই। ইমেইল ব্যবহার করুন।";
  if (code === "cloud_not_configured")
    return "লগইনের সংযোগ এখনও প্রস্তুত হয়নি।";
  if (/fetch|network|offline|connection/i.test(code))
    return "সংযোগ পাওয়া যায়নি। আবার চেষ্টা করুন।";
  return "লগইন হয়নি। তথ্য ও ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।";
}
export function LoginPage({ onSuccess }: { onSuccess?: () => void }) {
  const { t, number } = useLanguageContext();
  const auth = useAuth();
  const location = useLocation();
  const initialEmail =
    typeof location.state?.email === "string" &&
    location.state.email.length <= 254
      ? location.state.email
      : "";
  const mode = auth.phoneAuthMode ?? (auth.phoneOtpEnabled ? "sms" : "off");
  const [method, setMethod] = useState<"email" | "phone">(() =>
    initialEmail || !auth.phoneOtpEnabled ? "email" : "phone",
  );
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryUntil, setRetryUntil] = useState(0);
  const [now, setNow] = useState(Date.now);
  const active = useRef(true),
    requestScope = useRef(0),
    inFlight = useRef(false);
  const minimumCodeLength = mode === "mock" ? 4 : 6;
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
  };
  const setCooldown = (response: unknown) => {
    const seconds =
      typeof response === "object" &&
      response &&
      "retryAfter" in response &&
      typeof response.retryAfter === "number" &&
      Number.isFinite(response.retryAfter)
        ? Math.max(1, Math.min(300, Math.ceil(response.retryAfter)))
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
      setCooldown(response);
    } catch (failure) {
      if (active.current && scope === requestScope.current) {
        const code = failure instanceof Error ? failure.message : "";
        setError(t(phoneError(code)));
        if (/rate_limit/.test(code)) setCooldown(failure);
      }
    } finally {
      inFlight.current = false;
      if (active.current && scope === requestScope.current) setBusy(false);
    }
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current) return;
    if (method === "phone" && !sent) {
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
              : phoneError(code),
          ),
        );
        if (
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
      }
    } finally {
      inFlight.current = false;
      if (active.current && scope === requestScope.current) setBusy(false);
    }
  };
  return (
    <main className="auth-page">
      <section
        className={`auth-card auth-login-card ${method === "phone" ? "auth-phone-card" : ""}`}
      >
        <div className="auth-brand">
          <House size={34} weight="duotone" />
          <span>{t("বাড়ির খাতা")}</span>
        </div>
        <div className="auth-illustration" aria-hidden="true">
          <House size={72} weight="duotone" />
          <ShieldCheck size={30} weight="fill" />
        </div>
        <h1>{t("আপনার বাড়ি, আপনার হিসাব")}</h1>
        <p className="auth-description">
          {t("মালামাল, মজুরি আর প্রতিটি লেনদেন—সব হিসাব এক খাতায়।")}
        </p>
        {auth.phoneOtpEnabled && (
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
              <Phone size={17} />
              {t("ফোন নম্বর")}
            </button>
            <button
              type="button"
              disabled={busy}
              aria-pressed={method === "email"}
              onClick={() => changeMethod("email")}
            >
              <Envelope size={17} />
              {t("ইমেইল")}
            </button>
          </div>
        )}
        <form onSubmit={submit}>
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
          ) : (
            <>
              {sent ? (
                <div className="auth-phone-recipient">
                  <span>{t("এই নম্বরের কোড লিখুন")}</span>
                  <strong>{phone}</strong>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      requestScope.current++;
                      setSent(false);
                      setOtp("");
                      setError("");
                    }}
                  >
                    <ArrowLeft size={15} />
                    {t("নম্বর বদলাই")}
                  </button>
                </div>
              ) : (
                <>
                  <label htmlFor="login-phone">{t("ফোন নম্বর")}</label>
                  <div className="auth-input">
                    <Phone size={20} />
                    <input
                      id="login-phone"
                      type="tel"
                      autoComplete="tel-national"
                      inputMode="tel"
                      value={phone}
                      disabled={busy}
                      onChange={(event) => {
                        requestScope.current++;
                        setPhone(event.target.value);
                        setSent(false);
                        setOtp("");
                        setError("");
                        setRetryUntil(0);
                      }}
                      required
                      placeholder={t("01XXXXXXXXX")}
                      maxLength={24}
                      aria-describedby="phone-number-hint"
                    />
                  </div>
                  <p id="phone-number-hint" className="auth-field-hint">
                    {t("বাংলাদেশের মোবাইল নম্বর দিন।")}
                  </p>
                </>
              )}
              {mode === "mock" ? (
                <p className="auth-phone-test-note">
                  <ShieldCheck size={17} />
                  {t("পরীক্ষার জন্য ফোনে SMS যাবে না।")}
                </p>
              ) : null}
              {sent ? (
                <>
                  <label htmlFor="login-otp">{t("কোড")}</label>
                  <input
                    className="auth-otp-input"
                    id="login-otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={otp}
                    disabled={busy}
                    onChange={(event) => {
                      setOtp(phoneCode(event.target.value));
                      setError("");
                    }}
                    required
                    minLength={minimumCodeLength}
                    maxLength={8}
                    pattern="[0-9]*"
                    placeholder={t("কোড লিখুন")}
                    aria-describedby="phone-code-hint"
                  />
                  <p
                    id="phone-code-hint"
                    className="auth-field-hint"
                    role="status"
                  >
                    {t(
                      mode === "mock"
                        ? "পরীক্ষার কোডটি লিখুন।"
                        : "ফোনে পাঠানো কোডটি লিখুন।",
                    )}
                  </p>
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
                </>
              ) : null}
            </>
          )}
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          {error === t("আগে আপনার ইমেইল নিশ্চিত করুন। তারপর লগইন করুন।") ? (
            <Link className="auth-resend-link" to="/register/resend">
              {t("নিশ্চিত করার ইমেইল আবার চাই")}
            </Link>
          ) : null}
          <button
            className="primary-button auth-submit"
            type="submit"
            disabled={busy || (method === "phone" && !sent && remaining > 0)}
          >
            {busy
              ? t("অপেক্ষা করুন…")
              : method === "phone" && !sent
                ? remaining > 0
                  ? t("{{seconds}} সেকেন্ড পরে আবার নিন", {
                      seconds: number(remaining),
                    })
                  : t("কোড নিন")
                : t("খাতা খুলুন")}
            <ArrowRight size={20} />
          </button>
        </form>
        <Link
          className="auth-guest-link"
          to="/sample"
          aria-label={t("নমুনা দেখুন")}
        >
          <span className="auth-guest-symbol" aria-hidden="true">
            <BookOpen size={23} weight="duotone" />
          </span>
          <span className="auth-guest-copy">
            <strong>{t("নমুনা দেখুন")}</strong>
            <span>{t("লগইন ছাড়াই অ্যাপ ঘুরে দেখুন।")}</span>
          </span>
          <ArrowRight size={18} aria-hidden="true" />
        </Link>
        <p className="auth-private">
          <ShieldCheck size={18} />
          {t("লগইন ছাড়া ব্যক্তিগত হিসাব দেখা যায় না।")}
        </p>
        <p className="auth-register-link">
          {t("প্রথমবার এসেছেন?")}{" "}
          <Link to="/register">{t("অ্যাকাউন্ট খুলুন")}</Link>
        </p>
      </section>
    </main>
  );
}
