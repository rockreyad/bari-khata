import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import {
  ArrowLeftIcon,
  ArrowDownIcon,
  ArrowRightIcon,
  ArchiveIcon,
  CaretRightIcon,
  EnvelopeSimpleIcon,
  KeyIcon,
  PhoneIcon,
  SignOutIcon,
  TrashSimpleIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { getActiveOwner } from "../../data/database";
import { createWorkspaceStorage } from "../../data/repository";
import { saveFile, todayDhaka } from "../../lib/display";
import { ConfirmationDialog } from "../../components/ui/ConfirmationDialog";
import { useAuth } from "../auth/AuthProvider";
import { canChangeEmailPassword } from "../auth/changePassword";
import { deleteOwnAccount } from "../auth/deleteAccount";
import { SettingsPassword } from "./SettingsPassword";
import "./account-page.css";

function AccountRow({
  icon,
  title,
  detail,
  onClick,
  disabled = false,
  danger = false,
}: {
  icon: ReactNode;
  title: string;
  detail?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      className={`account-row ${danger ? "is-danger" : ""}`}
      type="button"
      onClick={onClick}
      disabled={disabled}
    >
      <span className="account-row-icon" aria-hidden="true">
        {icon}
      </span>
      <span>
        <strong>{title}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
      <CaretRightIcon size={18} aria-hidden="true" />
    </button>
  );
}
const deletionErrors: Record<string, string> = {
  account_has_pending_data:
    "ফোনের নতুন হিসাব আগে অনলাইনে মিলিয়ে নিন। তারপর অ্যাকাউন্ট মুছতে পারবেন।",
  account_changed: "অ্যাকাউন্ট বদলে গেছে। নিজের খাতা আবার খুলুন।",
  sign_in_required: "আবার লগইন করে চেষ্টা করুন।",
  account_delete_unavailable:
    "অ্যাকাউন্ট মুছে ফেলা এখন চালু নেই। পরে চেষ্টা করুন।",
  account_too_large:
    "এই অ্যাকাউন্ট মুছতে সহায়তা লাগবে। আপাতত নিজের হিসাবের কপি রাখুন।",
};

export function AccountPage() {
  const { mode, state, go } = useNotebook();
  const auth = useAuth();
  const { t, formatDigits } = useLanguageContext();
  const navigate = useNavigate();
  const owner = auth.user?.id ?? null;
  const storage = useMemo(() => createWorkspaceStorage(mode), [mode, owner]);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [error, setError] = useState("");
  const [copySaved, setCopySaved] = useState(false);
  const mounted = useRef(true),
    lock = useRef(false),
    deleteButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setDialog(false);
    setError("");
    setCopySaved(false);
  }, [owner]);
  const current = () =>
    mounted.current &&
    (mode === "demo" || (owner !== null && getActiveOwner() === owner));
  const pending = Boolean(state.pending || state.conflict || state.syncing);
  const online = mode === "real" && auth.status === "signed-in";
  const phone =
    mode === "real" &&
    Boolean(
      (auth.user?.phone && !auth.user.email) ||
      /@phone\.bari\.invalid$/i.test(auth.user?.email ?? ""),
    );
  const identity =
    mode === "demo"
      ? t("নমুনা খাতা")
      : (phone ? auth.user?.phone : auth.user?.email || auth.user?.phone) ||
        t("নিজের অ্যাকাউন্ট");
  async function copy() {
    if (lock.current || !current()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const text = await storage.exportBackup();
      if (!current()) return;
      saveFile(text, `bari-khata-${todayDhaka()}.json`, "application/json");
      setCopySaved(true);
    } catch {
      if (current()) setError(t("কপি নামানো যায়নি। আবার চেষ্টা করুন।"));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function signOut() {
    if (lock.current || !current() || mode !== "real") return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await auth.signOut();
    } catch {
      if (getActiveOwner() === owner)
        setError(t("লগআউট হয়নি। আবার চেষ্টা করুন।"));
    } finally {
      lock.current = false;
      if (mounted.current && !getActiveOwner())
        navigate("/login", { replace: true });
      if (mounted.current) setBusy(false);
    }
  }
  async function remove() {
    if (lock.current || !owner || !current()) return;
    if (!online || pending) {
      setError(
        t(
          pending
            ? deletionErrors.account_has_pending_data
            : "আবার লগইন করে চেষ্টা করুন।",
        ),
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await deleteOwnAccount(owner, "DELETE");
      if (getActiveOwner() !== owner) return;
      try {
        await auth.signOut();
      } finally {
        if (mounted.current && !getActiveOwner())
          navigate("/login", { replace: true });
      }
    } catch (cause) {
      if (current())
        setError(
          t(
            deletionErrors[cause instanceof Error ? cause.message : ""] ??
              "অ্যাকাউন্ট মুছতে পুরো কাজ শেষ হয়নি। আবার চেষ্টা করুন।",
          ),
        );
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div className="account-page page-flow">
      <header className="account-heading">
        <button
          type="button"
          className="account-back"
          onClick={() => go("/settings")}
          disabled={busy}
          aria-label={t("সেটিংসে ফিরুন")}
        >
          <ArrowLeftIcon size={22} />
        </button>
        <h1>{t("অ্যাকাউন্ট")}</h1>
      </header>
      <section className="account-identity">
        <span className="account-avatar" aria-hidden="true">
          <UserCircleIcon size={38} weight="duotone" />
        </span>
        <div>
          <small>
            {t(mode === "demo" ? "নমুনা খাতা" : "নিজের অ্যাকাউন্ট")}
          </small>
          <strong>{phone ? formatDigits(identity) : identity}</strong>
          {mode === "real" ? (
            <span className="account-login-method">
              {phone ? (
                <PhoneIcon size={13} />
              ) : (
                <EnvelopeSimpleIcon size={13} />
              )}
              {t(phone ? "ফোন নম্বরে লগইন" : "ইমেইলে লগইন")}
            </span>
          ) : null}
        </div>
      </section>
      <section className="account-section">
        <h2>{t("লগইন ও নিরাপত্তা")}</h2>
        <div className="account-group">
          {mode === "real" && canChangeEmailPassword(auth.user) ? (
            <AccountRow
              icon={<KeyIcon size={22} weight="duotone" />}
              title={t("পাসওয়ার্ড পরিবর্তন")}
              detail={t("এখনকার পাসওয়ার্ড দিয়ে নতুনটি রাখুন")}
              onClick={() => go("/settings/account/password")}
              disabled={busy}
            />
          ) : (
            <div className="account-info">
              <PhoneIcon size={21} weight="duotone" />
              <span>
                {t(
                  mode === "demo"
                    ? "নমুনায় অ্যাকাউন্টের তথ্য বদলানো যায় না।"
                    : "আপনাকে দেওয়া PIN দিয়ে ফোন নম্বরে লগইন করবেন।",
                )}
              </span>
            </div>
          )}
        </div>
      </section>
      <section className="account-section">
        <h2>{t("নিজের তথ্য")}</h2>
        <div className="account-group">
          <AccountRow
            icon={<ArrowDownIcon size={22} weight="bold" />}
            title={t("হিসাবের কপি নামাই")}
            detail={
              copySaved ? t("কপি নামানো হয়েছে") : t("হিসাব ও ভাউচার একসাথে")
            }
            onClick={() => void copy()}
            disabled={busy}
          />
          <AccountRow
            icon={<ArchiveIcon size={22} weight="duotone" />}
            title={t("মুছে রাখা তথ্য")}
            detail={t("সরানো খাতা ও নাম ফিরিয়ে আনুন")}
            onClick={() => go("/settings/removed")}
            disabled={busy}
          />
        </div>
      </section>
      {error && !dialog ? (
        <p className="account-error" role="alert">
          {error}
        </p>
      ) : null}
      {mode === "real" ? (
        <>
          <button
            type="button"
            className="account-signout"
            onClick={() => void signOut()}
            disabled={busy}
          >
            <SignOutIcon size={21} />
            {t("লগআউট")}
            <ArrowRightIcon size={18} />
          </button>
          <section className="account-danger-zone">
            <div>
              <h2>{t("অ্যাকাউন্ট মুছে ফেলুন")}</h2>
              <p>
                {t(
                  "অনলাইনের হিসাব, ভাউচার ও শেয়ার করা লিংক মুছে যাবে। এটি ফেরানো যাবে না।",
                )}
              </p>
            </div>
            {pending ? (
              <p className="account-pending" role="status">
                {t(
                  "ফোনের নতুন হিসাব আগে অনলাইনে মিলিয়ে নিন। তারপর অ্যাকাউন্ট মুছতে পারবেন।",
                )}
              </p>
            ) : !online ? (
              <p className="account-pending">
                {t("অ্যাকাউন্ট মুছতে ইন্টারনেটসহ লগইন থাকতে হবে।")}
              </p>
            ) : null}
            <button
              ref={deleteButton}
              className="account-delete-open"
              type="button"
              disabled={busy || !online || pending}
              onClick={() => {
                setError("");
                setDialog(true);
              }}
            >
              <TrashSimpleIcon size={19} />
              {t("অ্যাকাউন্ট মুছতে চাই")}
            </button>
          </section>
        </>
      ) : null}
      {dialog ? (
        <ConfirmationDialog
          title={t("অ্যাকাউন্ট মুছে ফেলবেন?")}
          description={t(
            "অনলাইনের হিসাব, ভাউচার ও শেয়ার করা লিংক মুছে যাবে। এটি ফেরানো যাবে না।",
          )}
          confirmLabel={t("অ্যাকাউন্ট মুছে ফেলুন")}
          typedConfirmation="DELETE"
          typedLabel={t("নিশ্চিত করতে DELETE লিখুন")}
          onConfirm={remove}
          onClose={() => {
            if (!busy) {
              setDialog(false);
              setError("");
            }
          }}
          busy={busy}
          error={error}
          returnFocusRef={deleteButton}
        >
          <p className="account-deletion-note">
            {t(
              "এই ফোনের কপি নিজে থেকে মুছবে না। দরকার হলে আগে কপি নামিয়ে রাখুন।",
            )}
          </p>
        </ConfirmationDialog>
      ) : null}
    </div>
  );
}

export function AccountPasswordPage() {
  const { go, mode } = useNotebook();
  const auth = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguageContext();
  const [busy, setBusy] = useState(false);
  const owner = auth.user?.id;
  return (
    <div className="account-page account-password-page page-flow">
      <header className="account-heading">
        <button
          className="account-back"
          type="button"
          aria-label={t("অ্যাকাউন্টে ফিরুন")}
          disabled={busy}
          onClick={() => go("/settings/account")}
        >
          <ArrowLeftIcon size={22} />
        </button>
        <h1>{t("পাসওয়ার্ড পরিবর্তন")}</h1>
      </header>
      {mode === "real" && auth.user && canChangeEmailPassword(auth.user) ? (
        <SettingsPassword
          presentation="page"
          key={auth.user.id}
          user={auth.user}
          disabled={auth.status !== "signed-in"}
          onBusyChange={setBusy}
          onSignInAgain={async () => {
            if (!owner || getActiveOwner() !== owner)
              throw new Error("account_changed");
            try {
              await auth.signOut();
            } finally {
              if (!getActiveOwner()) navigate("/login", { replace: true });
            }
          }}
        />
      ) : (
        <div className="account-group account-info">
          <PhoneIcon size={22} />
          <p>{t("পাসওয়ার্ড পরিবর্তন শুধু ইমেইলের অ্যাকাউন্টে করা যায়।")}</p>
        </div>
      )}
    </div>
  );
}
