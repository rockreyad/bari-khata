import type { ComponentPropsWithRef } from "react";
import { PaperclipIcon } from "@phosphor-icons/react";
import { useLanguageContext } from "../context/LanguageProvider";
import "./receipt-picker.css";

type ReceiptPickerProps = Omit<
  ComponentPropsWithRef<"input">,
  "type" | "accept" | "multiple" | "className"
>;

export function ReceiptPicker(props: ReceiptPickerProps) {
  const { t } = useLanguageContext();
  return (
    <label className="receipt-picker">
      <PaperclipIcon size={21} aria-hidden="true" />
      <span>
        {t("ভাউচার যোগ করুন")}
        <small>{t("ছবি বা PDF · সর্বোচ্চ ২ MB")}</small>
      </span>
      <input
        {...props}
        type="file"
        aria-label={props["aria-label"] ?? t("ভাউচার বা ছবি")}
        multiple
        accept="image/jpeg,image/png,image/webp,application/pdf"
      />
    </label>
  );
}
