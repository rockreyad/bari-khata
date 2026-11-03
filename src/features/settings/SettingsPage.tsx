import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  CaretRight,
  Check,
  CloudCheck,
  CloudSlash,
  ClockCounterClockwise,
  DeviceMobile,
  FloppyDisk,
  Globe,
  House,
  LockKey,
  Moon,
  Palette,
  PencilSimple,
  Robot,
  ShieldCheck,
  Sun,
  Warning,
} from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { Sheet } from "../../components/Sheet";
import { FormError, useFormError } from "../../components/ui/FormError";
import { useLanguageContext } from "../../context/LanguageProvider";
import {
  createWorkspaceStorage,
  parseBackup,
  type LedgerBackup,
} from "../../data/repository";
import type { Ledger } from "../../domain/model";
import { isCloudConfigured, resolveCloudConflict } from "../../data/sync";
import { saveFile, todayDhaka } from "../../lib/display";
import {
  applyPalette,
  applyTheme,
  readPreferences,
  savePreferences,
  type Preferences,
} from "../../lib/preferences";
import { themePalettes } from "../../lib/themes";
import { useAuth } from "../auth/AuthProvider";
import { SettingsAppearance } from "./SettingsAppearance";
import { BackupImportReview } from "./BackupImportReview";
import "./settings.css";

type Panel = "appearance" | "language" | "name" | "backup" | "sync" | "install";

function SettingsRow({
  title,
  description,
  value,
  icon,
  tone = "blue",
  onClick,
  disabled = false,
}: {
  title: string;
  description?: string;
  value?: string;
  icon: ReactNode;
  tone?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const detailId = useId();
  return (
    <button
      className="settings-row"
      type="button"
      aria-label={title}
      aria-describedby={description || value ? detailId : undefined}
      onClick={onClick}
      disabled={disabled}
    >
      <span className={`settings-row-icon is-${tone}`} aria-hidden="true">
        {icon}
      </span>
      <span className="settings-row-copy">
        <strong>{title}</strong>
        {description && <small id={detailId}>{description}</small>}
      </span>
      {value && (
        <span
          className="settings-row-value"
          id={description ? undefined : detailId}
        >
          {value}
        </span>
      )}
      <CaretRight className="settings-row-caret" size={16} aria-hidden="true" />
    </button>
  );
}

export function SettingsPage() {
  const { ledger, state, mode, save, notify, go } = useNotebook();
  const { t, language, setLanguage, number, date, formatDigits } =
    useLanguageContext();
  const auth = useAuth();
  const navigate = useNavigate();
  const storage = useMemo(() => createWorkspaceStorage(mode), [mode]);
  const [preferences, setPreferences] = useState(readPreferences);
  const selectedPalette =
    themePalettes.find((palette) => palette.value === preferences.palette) ??
    themePalettes[0];
  const [panel, setPanel] = useState<Panel | null>(null);
  const [name, setName] = useState(ledger.project.name);
  const [busy, setBusy] = useState(false);
  const [, setError, errorNotice] = useFormError();
  const [restore, setRestore] = useState<{
    text: string;
    backup: LedgerBackup;
    current: Ledger;
    at: string;
  } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const accountLabel =
    auth.user?.email?.trim() ||
    auth.user?.phone?.trim() ||
    t("নিজের অ্যাকাউন্ট");
  const phoneAccount = Boolean(auth.user?.phone && !auth.user?.email);
  const activePanel = restore ? "restore" : panel;
  const themeName = t(
    preferences.theme === "dark"
      ? "গভীর রাত"
      : preferences.theme === "system"
        ? "ফোনের সঙ্গে"
        : "দিনের আলো",
  );
  const ThemeIcon =
    preferences.theme === "dark"
      ? Moon
      : preferences.theme === "system"
        ? DeviceMobile
        : Sun;
  const openPanel = (value: Panel) => {
    setError("");
    if (value === "name") setName(ledger.project.name);
    setPanel(value);
  };
  const closePanel = () => {
    if (busy) return;
    setError("");
    if (restore) {
      setRestore(null);
    } else setPanel(null);
  };
  const action = async (callback: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await callback();
    } catch (error) {
      const backupErrors: Record<string, string> = {
        backup_preview_changed:
          "ফাইল দেখার পর খাতায় পরিবর্তন হয়েছে। ফাইলটি আবার খুলে মিলিয়ে নিন।",
        backup_sync_conflict:
          "আগে ফোন ও অনলাইনের আলাদা হিসাব মিলিয়ে নিন। তারপর কপি থেকে তথ্য আনুন।",
        backup_decisions_required:
          "দুই কপির আলাদা তথ্য কোনটি রাখবেন, আগে বেছে নিন।",
        backup_merge_invalid:
          "বেছে নেওয়া তথ্যের সঙ্গে যুক্ত হিসাব মিলছে না। পছন্দগুলো আবার দেখুন।",
        backup_history_conflict:
          "ফাইলের এই তথ্য নিলে আগের পরিবর্তনের ইতিহাস বাদ যাবে। এখনকারটি রাখুন অথবা নতুন কপি নিন।",
        balance_adjustment_would_be_lost:
          "এই কপিতে সমন্বয়ের আগের তথ্য নেই। এখনকারটি রাখুন অথবা নতুন কপি নিন।",
        balance_adjustment_history_invalid:
          "এই কপির সমন্বয়ের তথ্য মিলছে না। নতুন কপি বেছে নিন।",
        receipt_content_conflict:
          "একই ভাউচারের দুই কপিতে আলাদা ফাইল আছে। নতুন কপি নিয়ে আবার চেষ্টা করুন।",
        account_changed:
          "অ্যাকাউন্ট বদলে গেছে। নিজের খাতায় ফিরে আবার চেষ্টা করুন।",
        contract_history_would_be_lost:
          "ফাইলের এই তথ্য নিলে চুক্তির আগের ইতিহাস বাদ যাবে। এখনকারটি রাখুন অথবা নতুন কপি নিন।",
        mcp_provenance_would_be_lost:
          "ফাইলের এই তথ্য নিলে হিসাব কীভাবে এসেছে তার আগের তথ্য বাদ যাবে। এখনকারটি রাখুন অথবা নতুন কপি নিন।",
        person_work_links_would_be_lost:
          "ফাইলের এই তথ্য নিলে মানুষ ও দোকানের বেছে রাখা খাতার তথ্য বাদ যাবে। এখনকারটি রাখুন অথবা নতুন কপি নিন।",
      };
      setError(
        t(
          error instanceof Error && backupErrors[error.message]
            ? backupErrors[error.message]
            : error instanceof Error &&
                error.message === "removal_history_would_be_lost"
              ? "এই কপিতে সরানো তথ্যের ইতিহাস নেই। নতুন কপি বেছে নিন।"
              : error instanceof Error &&
                  error.message === "payment_purpose_would_be_lost"
                ? "এই কপিতে টাকার কারণের আগের তথ্য নেই। নতুন কপি বেছে নিন।"
                : error instanceof Error &&
                    error.message === "work_history_would_be_lost"
                  ? "এই কপিতে কাজের আগের তথ্য নেই। ইতিহাস রাখতে নতুন কপি বেছে নিন।"
                  : "কাজটি পুরো শেষ হয়নি। আবার চেষ্টা করুন।",
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const appearance = (change: Partial<Preferences>) => {
    const next = { ...preferences, ...change };
    setPreferences(next);
    savePreferences(change);
    applyTheme(next.theme);
    applyPalette(next.palette);
  };
  const loadBackup = (file?: File) => {
    if (!file) return;
    void action(async () => {
      if (file.size > 100 * 1024 * 1024) throw new Error("backup_too_large");
      const text = await file.text();
      const backup = parseBackup(text);
      if (backup.ledger.isDemo !== (mode === "demo"))
        throw new Error("workspace_mode_mismatch");
      setRestore({
        text,
        backup,
        current: structuredClone(ledger),
        at: new Date().toISOString(),
      });
    });
  };
  const status =
    mode === "demo"
      ? t("নমুনা খাতা")
      : state.conflict
        ? t("হিসাব মিলিয়ে নিন")
        : auth.status === "offline"
          ? t("এখন ইন্টারনেট নেই")
          : state.pending
            ? t("সংযোগ পেলে হিসাব পাঠানো হবে")
            : state.lastSyncedAt
              ? t("হিসাব নিরাপদে সংরক্ষিত")
              : t("ফোনে সংরক্ষিত");
  const panelTitle = restore
    ? t("কপি থেকে হিসাব মেলান")
    : t(
        panel === "appearance"
          ? "নিজের মতো সাজান"
          : panel === "language"
            ? "ভাষা"
            : panel === "name"
              ? "খাতার নাম"
              : panel === "backup"
                ? "হিসাবের কপি"
                : panel === "sync"
                  ? "সংরক্ষণের অবস্থা"
                  : "ফোনে অ্যাপ রাখুন",
      );
  const pending = Boolean(
    state.pending || state.conflict || auth.status === "offline",
  );
  return (
    <div className="settings-page page-content">
      <header className="page-heading settings-page-heading">
        <div>
          <h1>{t("সেটিংস")}</h1>
          <p>{t("আপনার খাতা, আপনার পছন্দ।")}</p>
        </div>
        <span className="settings-heading-mark" aria-hidden="true">
          <Palette size={24} weight="duotone" />
        </span>
      </header>
      <section className="settings-profile">
        <span className="settings-avatar">
          <House size={30} weight="duotone" />
        </span>
        <div className="settings-profile-copy">
          <p className="settings-profile-label">
            {t(mode === "demo" ? "নমুনা খাতা" : "আপনার খাতা")}
          </p>
          <h2>{ledger.project.name}</h2>
          <p className="settings-profile-account">
            {mode === "demo"
              ? t("নমুনা হিসাব দেখছেন")
              : phoneAccount
                ? formatDigits(accountLabel)
                : accountLabel}
          </p>
          <span className={`settings-sync ${pending ? "is-pending" : ""}`}>
            {auth.status === "offline" ? (
              <CloudSlash size={14} />
            ) : (
              <CloudCheck size={14} />
            )}{" "}
            {status}
          </span>
        </div>
        <button
          className="settings-profile-edit"
          type="button"
          onClick={() => openPanel("name")}
          aria-label={t("খাতার নাম বদলান")}
        >
          <PencilSimple size={19} />
        </button>
      </section>
      {mode === "real" && state.conflict && (
        <button
          className="settings-conflict-notice"
          onClick={() => openPanel("sync")}
        >
          <Warning size={23} weight="duotone" />
          <span>
            <strong>{t("এই ফোন ও অনলাইনের হিসাব আলাদা হয়েছে।")}</strong>
            <small>{t("হিসাব মিলিয়ে নিন")}</small>
          </span>
          <CaretRight size={17} />
        </button>
      )}
      <div className="settings-dashboard">
        <section
          className="settings-group settings-personal-group"
          aria-labelledby="settings-preferences-title"
        >
          <h2 id="settings-preferences-title">{t("আপনার পছন্দ")}</h2>
          <button
            className="settings-appearance-card"
            type="button"
            aria-label={t("রং ও সাজ")}
            onClick={() => openPanel("appearance")}
          >
            <span className="settings-appearance-card-top">
              <span className="settings-row-icon is-violet">
                <Palette size={21} weight="duotone" />
              </span>
              <span className="settings-appearance-card-title">
                <strong>{t("রং ও সাজ")}</strong>
                <small>{t("নিজের মতো সাজান")}</small>
              </span>
              <CaretRight size={17} />
            </span>
            <span className="settings-appearance-scene" aria-hidden="true">
              <span className="settings-scene-lines">
                <i />
                <i />
                <i />
              </span>
              <span className="settings-scene-swatch">
                {selectedPalette.colors.map((color) => (
                  <i key={color} style={{ background: color }} />
                ))}
              </span>
            </span>
            <span className="settings-appearance-card-bottom">
              <strong>{t(selectedPalette.label)}</strong>
              <span>
                <ThemeIcon size={14} />
                {themeName}
              </span>
            </span>
          </button>
          <div className="settings-group-card">
            <SettingsRow
              title={t("ভাষা")}
              value={language === "bn" ? t("বাংলা") : t("English")}
              icon={<Globe size={21} weight="duotone" />}
              tone="blue"
              onClick={() => openPanel("language")}
            />
            <SettingsRow
              title={t("খাতার নাম")}
              description={ledger.project.name}
              icon={<BookOpen size={21} weight="duotone" />}
              tone="amber"
              onClick={() => openPanel("name")}
            />
          </div>
        </section>
        <div className="settings-data-column">
          <section
            className="settings-group"
            aria-labelledby="settings-data-title"
          >
            <h2 id="settings-data-title">{t("হিসাব ও সংরক্ষণ")}</h2>
            <div className="settings-group-card">
              <SettingsRow
                title={t("হিসাবের কপি")}
                description={t("কপি নামান বা আগের কপি খুলুন")}
                icon={<ShieldCheck size={22} weight="duotone" />}
                tone="green"
                onClick={() => openPanel("backup")}
              />
              {mode === "real" && (
                <SettingsRow
                  title={t("সংরক্ষণের অবস্থা")}
                  description={status}
                  icon={
                    auth.status === "offline" ? (
                      <CloudSlash size={21} weight="duotone" />
                    ) : (
                      <CloudCheck size={21} weight="duotone" />
                    )
                  }
                  tone={pending ? "amber" : "blue"}
                  onClick={() => openPanel("sync")}
                />
              )}
              <SettingsRow
                title={t("পুরোনো হিসাব ঠিক করি")}
                description={t("আগের খাতার তথ্য দেখুন")}
                icon={<PencilSimple size={21} weight="duotone" />}
                tone="amber"
                onClick={() => go("/review")}
              />
              <SettingsRow
                title={t("হিসাব মিলিয়ে নিই")}
                description={t("ব্যক্তি বা খাতার মোট মিলিয়ে নিন")}
                icon={<PencilSimple size={21} weight="duotone" />}
                tone="violet"
                onClick={() => go("/reconcile")}
              />
            </div>
          </section>
          <section
            className="settings-group"
            aria-labelledby="settings-more-title"
          >
            <h2 id="settings-more-title">{t("আরও কিছু")}</h2>
            <div className="settings-group-card">
              <SettingsRow
                title={t("আপনার AI সহকারী")}
                description={t("সহকারী দিয়ে হিসাব রাখুন ও খুঁজুন")}
                icon={<Robot size={21} weight="duotone" />}
                tone="violet"
                onClick={() => go("/settings/assistants")}
              />
              <SettingsRow
                title={t("টাইমলাইন")}
                description={t("কখন কী করেছি")}
                icon={<ClockCounterClockwise size={21} />}
                onClick={() => go("/timeline")}
              />
              {mode === "real" && (
                <SettingsRow
                  title={t("অ্যাকাউন্ট")}
                  description={t("লগইন ও গোপনীয়তা")}
                  icon={<LockKey size={21} weight="duotone" />}
                  tone="violet"
                  onClick={() => go("/settings/account")}
                />
              )}
              <SettingsRow
                title={t("ফোনে অ্যাপ রাখুন")}
                description={t("এক ট্যাপেই নিজের খাতা খুলুন")}
                icon={<DeviceMobile size={21} weight="duotone" />}
                tone="blue"
                onClick={() => openPanel("install")}
              />
            </div>
          </section>
          {mode === "demo" && (
            <button
              className="settings-own-notebook"
              type="button"
              onClick={() => navigate(auth.user ? "/" : "/login")}
            >
              <House size={20} weight="duotone" />
              <span>{t("নিজের খাতা খুলুন")}</span>
              <ArrowUpRight size={17} />
            </button>
          )}
        </div>
      </div>
      <p className="settings-footer-note">
        <ShieldCheck size={14} aria-hidden="true" />
        <span>{t("নিজের হিসাব, নিজের কাছে।")}</span>
      </p>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          loadBackup(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {activePanel && (
        <Sheet
          key={activePanel}
          title={panelTitle}
          subtitle={restore ? t("ফাইলটি দেখে নিশ্চিত হয়ে নিন।") : undefined}
          onClose={closePanel}
        >
          <div className="settings-sheet-body">
            <FormError {...errorNotice} className="settings-error" />
            {restore ? (
              <BackupImportReview
                backup={restore.backup}
                current={restore.current}
                at={restore.at}
                busy={busy}
                onImport={(decisions) =>
                  void action(async () => {
                    const result = await storage.mergeBackup(restore.text, {
                      confirmed: true,
                      expectedLedger: restore.current,
                      decisions,
                      at: restore.at,
                    });
                    setRestore(null);
                    setPanel(null);
                    notify(
                      t(
                        result.changed
                          ? "কপির নতুন ও বাছাই করা তথ্য আনা হয়েছে"
                          : "এই কপির সব তথ্য খাতায় আছে।",
                      ),
                    );
                    if (result.changed) void state.sync().catch(() => {});
                  })
                }
              />
            ) : panel === "appearance" ? (
              <SettingsAppearance
                preferences={preferences}
                onChange={appearance}
              />
            ) : panel === "language" ? (
              <>
                <p className="settings-sheet-intro">
                  {t("যে ভাষায় হিসাব রাখতে চান।")}
                </p>
                <div className="settings-language">
                  {(
                    [
                      ["bn", "বাংলা"],
                      ["en", "English"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={language === value}
                      className={language === value ? "is-selected" : ""}
                      onClick={() => setLanguage(value)}
                    >
                      <span
                        className="settings-language-glyph"
                        aria-hidden="true"
                      >
                        {value === "bn" ? "অ" : "A"}
                      </span>
                      <strong>{t(label)}</strong>
                      {language === value ? (
                        <Check size={19} weight="bold" />
                      ) : null}
                    </button>
                  ))}
                </div>
              </>
            ) : panel === "name" ? (
              <>
                <p className="settings-sheet-intro">
                  {t("আপনার পছন্দের একটি নাম দিন।")}
                </p>
                <form
                  className="settings-name"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (name.trim())
                      void action(async () => {
                        await save((current) => ({
                          ...current,
                          project: { ...current.project, name: name.trim() },
                        }));
                        setPanel(null);
                      });
                  }}
                >
                  <label htmlFor="notebook-name">{t("খাতার নাম")}</label>
                  <input
                    id="notebook-name"
                    className="field-input"
                    disabled={busy}
                    value={name}
                    maxLength={200}
                    required
                    autoFocus
                    onChange={(event) => setName(event.target.value)}
                  />
                  <button
                    className="primary-button settings-sheet-primary"
                    disabled={busy || !name.trim()}
                  >
                    <FloppyDisk size={18} />
                    {busy ? t("অপেক্ষা করুন…") : t("রাখুন")}
                  </button>
                </form>
              </>
            ) : panel === "backup" ? (
              <>
                <div className="settings-sheet-callout">
                  <span className="settings-row-icon is-green">
                    <ShieldCheck size={25} weight="duotone" />
                  </span>
                  <p>{t("ভাউচারসহ পুরো খাতার একটি কপি নিজের কাছে রাখুন।")}</p>
                </div>
                <div className="settings-sheet-actions">
                  <SettingsRow
                    title={t("কপি নামান")}
                    description={t("এই মুহূর্তের পুরো হিসাব")}
                    icon={<ArrowDown size={21} />}
                    tone="green"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        const backup = await storage.exportBackup();
                        saveFile(backup, `bari-khata-${todayDhaka()}.json`);
                        notify(t("খাতার কপি নামানো হয়েছে"));
                      })
                    }
                  />
                  <SettingsRow
                    title={t("আগের কপি খুলুন")}
                    description={t("ফাইল বেছে আগে দেখে নিন")}
                    icon={<ArrowUp size={21} />}
                    tone="blue"
                    disabled={busy}
                    onClick={() => input.current?.click()}
                  />
                </div>
                <p className="settings-hint">
                  {t("এই ফাইলে ব্যক্তিগত হিসাব থাকে। নিরাপদ জায়গায় রাখুন।")}
                </p>
              </>
            ) : panel === "sync" ? (
              <>
                <div
                  className={`settings-storage-status ${pending ? "is-pending" : ""}`}
                >
                  <span
                    className={`settings-row-icon ${pending ? "is-amber" : "is-green"}`}
                  >
                    {auth.status === "offline" ? (
                      <CloudSlash size={28} weight="duotone" />
                    ) : (
                      <CloudCheck size={28} weight="duotone" />
                    )}
                  </span>
                  <strong>{status}</strong>
                  <p>{t("আপনার হিসাব এই ফোনেও সংরক্ষিত থাকে।")}</p>
                  {state.lastSyncedAt && (
                    <small>
                      {t("শেষ সংরক্ষণ: {{date}}", {
                        date: date(state.lastSyncedAt),
                      })}
                    </small>
                  )}
                </div>
                {isCloudConfigured && (
                  <button
                    className="primary-button settings-sheet-primary"
                    type="button"
                    disabled={busy || auth.status === "offline"}
                    onClick={() =>
                      void action(async () => {
                        const result = await state.sync();
                        notify(
                          result.status === "synced"
                            ? t("হিসাব মিলিয়ে নেওয়া হয়েছে")
                            : t(
                                "এখন মিলিয়ে নেওয়া যায়নি। ফোনের হিসাব রাখা আছে।",
                              ),
                        );
                      })
                    }
                  >
                    <CloudCheck size={20} />
                    {busy ? t("অপেক্ষা করুন…") : t("এখন মিলিয়ে নিন")}
                  </button>
                )}
                {state.conflict && (
                  <div className="settings-conflict">
                    <strong>{t("এই ফোন ও অনলাইনের হিসাব আলাদা হয়েছে।")}</strong>
                    <p>
                      {t("একটি কপি বেছে নেওয়ার আগে খাতার কপি নামিয়ে রাখুন।")}
                    </p>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => openPanel("backup")}
                    >
                      <ArrowDown size={18} />
                      {t("হিসাবের কপি")}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={busy || auth.status === "offline"}
                      onClick={() =>
                        void action(async () => {
                          await resolveCloudConflict("use-cloud");
                          notify(t("অনলাইনের হিসাব নেওয়া হয়েছে"));
                        })
                      }
                    >
                      {t("অনলাইনের কপি নিন")}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={busy || auth.status === "offline"}
                      onClick={() =>
                        void action(async () => {
                          await resolveCloudConflict("keep-local");
                          notify(t("ফোনের হিসাব রাখা হয়েছে"));
                        })
                      }
                    >
                      {t("এই ফোনের কপি রাখুন")}
                    </button>
                  </div>
                )}
              </>
            ) : panel === "install" ? (
              <>
                <div className="settings-install-hero">
                  <DeviceMobile size={48} weight="duotone" />
                  <h3>{t("আইফোনে অ্যাপের মতো রাখুন")}</h3>
                  <p>{t("এক ট্যাপেই নিজের খাতা খুলুন")}</p>
                </div>
                <ol className="settings-install-steps">
                  <li>
                    <span>{number(1)}</span>
                    {t("Safari-তে বাড়ির খাতা খুলুন।")}
                  </li>
                  <li>
                    <span>{number(2)}</span>
                    {t("শেয়ার বোতামে চাপ দিন।")}
                  </li>
                  <li>
                    <span>{number(3)}</span>
                    {t("‘হোম স্ক্রিনে যোগ করুন’ বেছে নিন।")}
                  </li>
                </ol>
              </>
            ) : null}
          </div>
        </Sheet>
      )}
    </div>
  );
}
