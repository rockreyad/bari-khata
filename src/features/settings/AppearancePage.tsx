import { useState } from "react";
import { CaretLeftIcon } from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import {
  applyPalette,
  applyTheme,
  readPreferences,
  savePreferences,
  type Preferences,
} from "../../lib/preferences";
import { SettingsAppearance } from "./SettingsAppearance";
import "./settings.css";
import "./appearance-page.css";

export function AppearancePage() {
  const { go } = useNotebook();
  const { t } = useLanguageContext();
  const [preferences, setPreferences] = useState(readPreferences);
  const change = (update: Partial<Preferences>) => {
    const next = { ...preferences, ...update };
    savePreferences(update);
    applyPalette(next.palette);
    applyTheme(next.theme);
    setPreferences(next);
  };
  return (
    <div className="appearance-page">
      <header className="appearance-page-header">
        <button
          type="button"
          className="appearance-back"
          onClick={() => go("/settings")}
        >
          <CaretLeftIcon size={18} />
          {t("সেটিংসে ফিরুন")}
        </button>
        <h1>{t("রং ও সাজ")}</h1>
        <p>{t("পছন্দের রং আর আলোর ধরন বেছে নিন।")}</p>
      </header>
      <section
        className="appearance-choices"
        aria-label={t("খাতার সাজ বেছে নিন")}
      >
        <SettingsAppearance preferences={preferences} onChange={change} />
      </section>
    </div>
  );
}
