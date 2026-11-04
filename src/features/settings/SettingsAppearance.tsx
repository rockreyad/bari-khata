import { useId } from "react";
import { Check, DeviceMobile, Moon, Sun } from "@phosphor-icons/react";
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
  const id = useId();
  const selectedPalette =
    themePalettes.find((palette) => palette.value === preferences.palette) ??
    themePalettes[0];
  return (
    <div className="settings-appearance">
      <div className="settings-appearance-heading">
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
      <div className="settings-appearance-heading settings-palette-heading">
        <h3>{t("খাতার রং")}</h3>
        <p role="status" aria-live="polite">
          {t("এখন বেছে নেওয়া: {{name}}", { name: t(selectedPalette.label) })}
        </p>
      </div>
      <div
        className="settings-palette-grid"
        role="group"
        aria-label={t("খাতার রং")}
      >
        {themePalettes.map((palette) => {
          return (
            <button
              key={palette.value}
              type="button"
              aria-pressed={preferences.palette === palette.value}
              aria-labelledby={`${id}-${palette.value}-name`}
              aria-describedby={`${id}-${palette.value}-description`}
              className={`settings-palette ${preferences.palette === palette.value ? "is-selected" : ""}`}
              onClick={() => onChange({ palette: palette.value })}
            >
              <span className="settings-palette-copy">
                <span className="settings-palette-name">
                  <strong id={`${id}-${palette.value}-name`}>
                    {t(palette.label)}
                  </strong>
                  {preferences.palette === palette.value && (
                    <span className="settings-palette-check" aria-hidden="true">
                      <Check size={13} weight="bold" />
                    </span>
                  )}
                </span>
                <span
                  className="settings-palette-description"
                  id={`${id}-${palette.value}-description`}
                >
                  {t(palette.description)}
                </span>
                <span className="settings-palette-swatches" aria-hidden="true">
                  {palette.colors.map((color, index) => (
                    <i key={index} style={{ background: color }} />
                  ))}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
