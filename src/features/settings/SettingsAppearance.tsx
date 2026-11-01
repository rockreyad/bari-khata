import type { CSSProperties } from "react";
import {
  ArrowUpRight,
  Check,
  DeviceMobile,
  Moon,
  Sun,
} from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import type { Preferences } from "../../lib/preferences";
import { themePalettes } from "../../lib/themes";

export function SettingsAppearance({
  preferences,
  onChange,
}: {
  preferences: Preferences;
  onChange: (change: Partial<Preferences>) => void;
}) {
  const { t } = useLanguageContext();
  const selectedPalette =
    themePalettes.find((palette) => palette.value === preferences.palette) ??
    themePalettes[0];
  return (
    <div className="settings-appearance">
      <p className="settings-sheet-intro">
        {t("রঙ বদলালে পুরো খাতাই নতুন সাজে।")}
      </p>
      <div
        className="settings-palette-grid"
        role="group"
        aria-label={t("খাতার রং")}
      >
        {themePalettes.map((palette) => (
          <button
            key={palette.value}
            type="button"
            aria-pressed={preferences.palette === palette.value}
            className={`settings-palette ${preferences.palette === palette.value ? "is-selected" : ""}`}
            onClick={() => onChange({ palette: palette.value })}
            style={
              {
                "--preview-light-bg": palette.preview.background,
                "--preview-light-surface": palette.preview.surface,
                "--preview-accent": palette.preview.accent,
                "--preview-gradient": palette.preview.gradient,
              } as CSSProperties
            }
          >
            <span className="settings-theme-preview" aria-hidden="true">
              <span className="settings-preview-header">
                <i />
                <i />
              </span>
              <span className="settings-preview-total">
                <i />
                <i />
              </span>
              <span className="settings-preview-row">
                <i />
                <i />
                <i />
              </span>
              <span className="settings-preview-row">
                <i />
                <i />
                <i />
              </span>
            </span>
            <span className="settings-palette-copy">
              <span className="settings-palette-name">
                <strong>{t(palette.label)}</strong>
                {preferences.palette === palette.value && (
                  <span className="settings-palette-check" aria-hidden="true">
                    <Check size={13} weight="bold" />
                  </span>
                )}
              </span>
              <span className="settings-palette-description">
                {t(palette.description)}
              </span>
              <span className="settings-palette-swatches" aria-hidden="true">
                {palette.colors.map((color) => (
                  <i key={color} style={{ background: color }} />
                ))}
              </span>
            </span>
          </button>
        ))}
      </div>
      <div className="settings-mode-heading">
        <h3>{t("আলোর ধরন")}</h3>
        <p>{t("দিনে হালকা, রাতে গাঢ়—যেভাবে আরাম লাগে।")}</p>
      </div>
      <div
        className="settings-theme-grid"
        role="group"
        aria-label={t("আলোর ধরন")}
      >
        {(
          [
            { value: "light", label: "দিনের আলো", Icon: Sun },
            { value: "dark", label: "গভীর রাত", Icon: Moon },
            { value: "system", label: "ফোনের সঙ্গে", Icon: DeviceMobile },
          ] as const
        ).map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={preferences.theme === value}
            className={preferences.theme === value ? "is-selected" : ""}
            onClick={() => onChange({ theme: value })}
          >
            <span
              className={`settings-mode-symbol is-${value}`}
              aria-hidden="true"
            >
              <Icon size={20} weight="duotone" />
            </span>
            {t(label)}
          </button>
        ))}
      </div>
      <a
        className="settings-theme-source"
        href={selectedPalette.source}
        target="_blank"
        rel="noreferrer"
      >
        {t("রঙের উৎস: Color Hunt")}
        <ArrowUpRight size={13} />
      </a>
    </div>
  );
}
