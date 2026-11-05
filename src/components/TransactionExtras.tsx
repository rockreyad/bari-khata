import { useEffect, useState, type ReactNode } from "react";
import { CaretDownIcon, PaperclipIcon } from "@phosphor-icons/react";
import { useLanguageContext } from "../context/LanguageProvider";
import "./transaction-extras.css";

export type TransactionExtrasProps = {
  dateField: ReactNode;
  noteField?: ReactNode;
  children?: ReactNode;
  hasReceipts?: boolean;
  defaultOpen?: boolean;
};

export function TransactionExtras({
  dateField,
  noteField,
  children,
  hasReceipts = false,
  defaultOpen = false,
}: TransactionExtrasProps) {
  const { t } = useLanguageContext();
  const [open, setOpen] = useState(hasReceipts || defaultOpen);
  useEffect(() => {
    if (hasReceipts || defaultOpen) setOpen(true);
  }, [hasReceipts, defaultOpen]);
  return (
    <details
      className="transaction-extras"
      aria-label={t("ভাউচার, নোট ও তারিখ")}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <PaperclipIcon size={18} aria-hidden="true" />
        <span>{t("ভাউচার, নোট ও তারিখ")}</span>
        {hasReceipts ? <small>{t("রসিদ আছে")}</small> : null}
        <CaretDownIcon size={16} aria-hidden="true" />
      </summary>
      <div className="transaction-extras-content">
        <div className="transaction-extras-fields">
          <div className="transaction-extras-date">{dateField}</div>
          {noteField ? (
            <div className="transaction-extras-note">{noteField}</div>
          ) : null}
        </div>
        {children ? (
          <div className="transaction-extras-receipts">{children}</div>
        ) : null}
      </div>
    </details>
  );
}
