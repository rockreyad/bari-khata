import { useId } from "react";
import { useLanguageContext } from "../context/LanguageProvider";
import { PaymentIcon } from "./ui/Icons";
import "./transaction-form.css";

type Method = "cash" | "bkash" | "bank" | "other";
const methods = [
  ["cash", "ক্যাশ"],
  ["bkash", "বিকাশ"],
  ["bank", "ব্যাংক"],
  ["other", "অন্যভাবে"],
] as const;

export function PaymentMethodField({
  value,
  onChange,
  disabled,
  label,
}: {
  value: string;
  onChange: (method: Method) => void;
  disabled?: boolean;
  label?: string;
}) {
  const { t } = useLanguageContext();
  const labelId = useId();
  return (
    <div className="transaction-methods" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="transaction-label">
        {label ?? t("কীভাবে দিয়েছেন")}
      </span>
      <div className="transaction-methods-options">
        {methods.map(([method, name]) => (
          <button
            key={method}
            type="button"
            aria-pressed={value === method}
            disabled={disabled}
            onClick={() => onChange(method)}
          >
            <span aria-hidden="true">
              <PaymentIcon method={method} size={22} />
            </span>
            <span>{t(name)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
