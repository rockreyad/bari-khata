import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CaretDownIcon } from "@phosphor-icons/react";
import { useLanguageContext } from "../context/LanguageProvider";
import { MoneyInput } from "./ui/MoneyInput";
import "./transaction-form.css";

export function TransactionAmount({
  label,
  inputLabel,
  value,
  onChange,
  id,
  error,
  hint,
  required,
  disabled,
  className = "",
  placeholder,
}: {
  label: string;
  inputLabel?: string;
  value: string;
  onChange: (value: string) => void;
  id?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const { t, number } = useLanguageContext();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={`transaction-amount ${className}`} data-invalid={!!error}>
      <label htmlFor={inputId}>{label}</label>
      <button
        type="button"
        className="text-button transaction-amount-focus"
        disabled={disabled}
        onClick={() => {
          input.current?.focus({ preventScroll: true });
          input.current?.scrollIntoView?.({ block: "center" });
        }}
      >
        {t("টাকার ঘরে লিখুন")}
      </button>
      <div
        className="transaction-amount-control"
        data-compact={value.length > 9}
      >
        <span aria-hidden="true">৳</span>
        <MoneyInput
          ref={input}
          data-entry-amount
          id={inputId}
          aria-label={inputLabel ?? label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder ?? number(0)}
          required={required}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error || hint ? `${inputId}-hint` : undefined}
          autoComplete="off"
        />
      </div>
      {error || hint ? (
        <p
          id={`${inputId}-hint`}
          className={error ? "transaction-field-error" : "field-hint"}
        >
          {error || hint}
        </p>
      ) : null}
    </div>
  );
}

export function TransactionDetails({
  summary,
  children,
  defaultOpen = false,
  className = "",
}: {
  summary?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const { t } = useLanguageContext();
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);
  return (
    <details
      className={`transaction-details ${className}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>{summary ?? t("আরও তথ্য")}</span>
        <CaretDownIcon size={18} aria-hidden="true" />
      </summary>
      <div className="transaction-details-content">{children}</div>
    </details>
  );
}
