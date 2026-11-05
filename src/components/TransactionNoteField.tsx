import { useLanguageContext } from "../context/LanguageProvider";

export function TransactionNoteField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useLanguageContext();
  return (
    <label className="field">
      <span className="field-label">{t("মনে রাখার কথা")}</span>
      <textarea
        className="field-input"
        rows={2}
        maxLength={10000}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("কী বাবদ, কোথা থেকে বা অন্য কিছু…")}
      />
    </label>
  );
}
