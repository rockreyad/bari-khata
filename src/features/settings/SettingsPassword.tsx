import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CaretDownIcon,
  CheckCircleIcon,
  LockKeyIcon,
} from "@phosphor-icons/react";
import type { AccountUser } from "../../data/authSession";
import { getActiveOwner } from "../../data/database";
import { useLanguageContext } from "../../context/LanguageProvider";
import { FormError, useFormError } from "../../components/ui/FormError";
import { PasswordInput } from "../auth/PasswordInput";
import {
  changeEmailPassword,
  type PasswordChange,
} from "../auth/changePassword";
const empty = (): PasswordChange => ({
  currentPassword: "",
  password: "",
  confirmation: "",
});
const errors: Record<string, string> = {
  current_password_required: "এখনকার পাসওয়ার্ড লিখুন।",
  current_password_invalid: "এখনকার পাসওয়ার্ড মেলেনি। আবার লিখুন।",
  password_weak: "অন্তত ৮ অক্ষরের নতুন পাসওয়ার্ড দিন।",
  password_mismatch: "নতুন পাসওয়ার্ড দুইবার একইভাবে লিখুন।",
  password_same: "এখনকার থেকে আলাদা নতুন পাসওয়ার্ড দিন।",
  password_rate_limited: "কিছুক্ষণ পরে আবার চেষ্টা করুন।",
  email_not_confirmed: "আগে আপনার ইমেইল নিশ্চিত করুন।",
  account_changed: "অ্যাকাউন্ট বদলে গেছে। নিজের খাতা আবার খুলুন।",
};
export function SettingsPassword({
  user,
  presentation = "disclosure",
  disabled = false,
  onBusyChange,
  onSignInAgain,
}: {
  user: AccountUser;
  presentation?: "disclosure" | "page";
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
  onSignInAgain: () => Promise<void>;
}) {
  const { t } = useLanguageContext();
  const [fields, setFields] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [, setError, errorNotice] = useFormError();
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () => mounted.current && getActiveOwner() === user.id;
  function field(name: keyof PasswordChange, value: string) {
    setError("");
    setFields((previous) => ({ ...previous, [name]: value }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (locked.current || disabled) return;
    if (!current()) {
      setError(t(errors.account_changed));
      return;
    }
    locked.current = true;
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      await changeEmailPassword(user, fields);
      if (current()) {
        setFields(empty());
        setComplete(true);
      }
    } catch (cause) {
      if (current())
        setError(
          t(
            errors[cause instanceof Error ? cause.message : ""] ??
              "পাসওয়ার্ড বদলানো যায়নি। আবার চেষ্টা করুন।",
          ),
        );
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
      onBusyChange(false);
    }
  }
  async function signInAgain() {
    if (locked.current || !current()) return;
    locked.current = true;
    setBusy(true);
    onBusyChange(true);
    try {
      await onSignInAgain();
    } catch {
      if (current()) setError(t("লগইন পাতায় যেতে পারিনি। আবার চেষ্টা করুন।"));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
      onBusyChange(false);
    }
  }
  const content = complete ? (
    <div className="settings-password-success" role="status">
      <FormError {...errorNotice} className="settings-error" />
      <CheckCircleIcon size={30} weight="duotone" />
      <strong>{t("পাসওয়ার্ড বদলেছে")}</strong>
      <p>
        {t(
          "এবার নতুন পাসওয়ার্ড দিয়ে আবার লগইন করুন। আপনার হিসাব একই খাতায় থাকবে।",
        )}
      </p>
      <button
        type="button"
        className="primary-button"
        disabled={busy}
        onClick={() => void signInAgain()}
      >
        {t("নতুন পাসওয়ার্ড দিয়ে ঢুকি")}
      </button>
    </div>
  ) : (
    <form
      onSubmit={(event) => void submit(event)}
      className="settings-password-form"
    >
      <FormError {...errorNotice} className="settings-error" />
      <p className="settings-hint">
        {t(
          "এখনকার পাসওয়ার্ড মিলিয়ে নতুনটি রাখুন। ইমেইলে কোনো কোড পাঠানো হবে না।",
        )}
      </p>
      <label>
        {t("এখনকার পাসওয়ার্ড")}
        <PasswordInput
          aria-label={t("এখনকার পাসওয়ার্ড")}
          autoComplete="current-password"
          required
          maxLength={128}
          disabled={busy || disabled}
          value={fields.currentPassword}
          onChange={(event) => field("currentPassword", event.target.value)}
        />
      </label>
      <label>
        {t("নতুন পাসওয়ার্ড")}
        <PasswordInput
          aria-label={t("নতুন পাসওয়ার্ড")}
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
          disabled={busy || disabled}
          value={fields.password}
          onChange={(event) => field("password", event.target.value)}
        />
      </label>
      <label>
        {t("নতুন পাসওয়ার্ড আবার লিখুন")}
        <PasswordInput
          aria-label={t("নতুন পাসওয়ার্ড আবার লিখুন")}
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
          disabled={busy || disabled}
          value={fields.confirmation}
          onChange={(event) => field("confirmation", event.target.value)}
        />
      </label>
      <button
        className="primary-button"
        type="submit"
        disabled={busy || disabled}
      >
        {t(busy ? "বদলাচ্ছি…" : "নতুন পাসওয়ার্ড রাখুন")}
      </button>
    </form>
  );
  if (presentation === "page")
    return (
      <section className="settings-password settings-password-page">
        {content}
      </section>
    );
  return (
    <details
      className="settings-password"
      onToggle={(event) => {
        if (!event.currentTarget.open && !busy) {
          setFields(empty());
          setError("");
        }
      }}
    >
      <summary
        onClick={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <LockKeyIcon size={21} weight="duotone" />
        <span>{t("পাসওয়ার্ড পরিবর্তন")}</span>
        <CaretDownIcon size={17} />
      </summary>
      {content}
    </details>
  );
}
