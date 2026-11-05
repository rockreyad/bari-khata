import { useEffect, useState, type ReactNode } from "react";
import { CaretDownIcon, PaperclipIcon } from "@phosphor-icons/react";
import { useLanguageContext } from "../context/LanguageProvider";
import "./transaction-extras.css";

export type TransactionExtrasProps = {
  dateField: ReactNode;
  noteField?: ReactNode;
  children?: ReactNode;
  hasReceipts?: boolean;
};

export function TransactionExtras({
  dateField,
  noteField,
  children,
  hasReceipts = false,
}: TransactionExtrasProps) {
  const { t } = useLanguageContext();
  const [receiptsOpen, setReceiptsOpen] = useState(hasReceipts);
  useEffect(() => {
    if (hasReceipts) setReceiptsOpen(true);
  }, [hasReceipts]);
  return (
    <section className="transaction-extras" aria-label={t("তারিখ ও নোট")}>
      <h2>{t("তারিখ ও নোট")}</h2>
      <div className="transaction-extras-fields">
        <div className="transaction-extras-date">{dateField}</div>
        {noteField ? (
          <div className="transaction-extras-note">{noteField}</div>
        ) : null}
      </div>
      {children ? (
        <details
          className="transaction-extras-receipts"
          open={receiptsOpen}
          onToggle={(event) => setReceiptsOpen(event.currentTarget.open)}
        >
          <summary>
            <PaperclipIcon size={18} aria-hidden="true" />
            <span>{t("ছবি বা রসিদ")}</span>
            <small>{t("না দিলেও হবে")}</small>
            <CaretDownIcon size={16} aria-hidden="true" />
          </summary>
          <div className="transaction-extras-receipt-content">{children}</div>
        </details>
      ) : null}
    </section>
  );
}
