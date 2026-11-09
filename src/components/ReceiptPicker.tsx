import { useEffect, useRef, useState } from "react";
import { PaperclipIcon } from "@phosphor-icons/react";
import { useLanguageContext } from "../context/LanguageProvider";
import { prepareReceiptFile } from "../lib/prepareReceiptFile";
import { trackLocalWrite } from "../lib/localWriteBarrier";
import { getActiveOwner } from "../data/database";
import "./receipt-picker.css";

type ReceiptPickerProps = {
  existingCount: number;
  scopeKey: string;
  onFiles: (files: File[]) => void | Promise<void>;
  onError: (message: string) => void;
  onProcessingChange?: (busy: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
};

export function ReceiptPicker({
  existingCount,
  scopeKey,
  onFiles,
  onError,
  onProcessingChange,
  disabled = false,
  "aria-label": label,
}: ReceiptPickerProps) {
  const { t, number } = useLanguageContext();
  const [processing, setProcessing] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(false);
  const current = useRef({ scopeKey, onFiles, existingCount });
  current.current = { scopeKey, onFiles, existingCount };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const select = (input: HTMLInputElement) => {
    const incoming = Array.from(input.files ?? []);
    input.value = "";
    if (!incoming.length || locked.current || disabled) return;
    if (existingCount + incoming.length > 20) {
      onError(
        t("একটি হিসাবে সর্বোচ্চ {{limit}}টি ছবি বা ভাউচার রাখুন।", {
          limit: number(20),
        }),
      );
      return;
    }
    const owner = getActiveOwner();
    const selectedScope = scopeKey;
    locked.current = true;
    setProcessing(true);
    onProcessingChange?.(true);
    onError("");
    void trackLocalWrite(
      (async () => {
        try {
          const prepared: File[] = [];
          // Camera photos are decoded one at a time to keep memory bounded.
          for (const file of incoming)
            prepared.push(await prepareReceiptFile(file));
          if (
            mounted.current &&
            current.current.scopeKey === selectedScope &&
            getActiveOwner() === owner
          ) {
            if (current.current.existingCount + prepared.length > 20)
              throw new Error("receipt_count");
            await current.current.onFiles(prepared);
          }
        } catch (error) {
          if (mounted.current) {
            const code = error instanceof Error ? error.message : "";
            onError(
              t(
                code === "receipt_count"
                  ? "একটি হিসাবে সর্বোচ্চ {{limit}}টি ছবি বা ভাউচার রাখুন।"
                  : code === "receipt_too_large"
                    ? "ফাইলটি ৫ MB-এর মধ্যে রাখুন। বড় ছবি হলে ছোট করে আবার দিন।"
                    : code === "receipt_type_invalid"
                      ? "JPG, PNG, WebP ছবি বা PDF দিন।"
                      : code === "receipt_source_too_large" ||
                          code === "receipt_image_too_large"
                        ? "ছবিটি অনেক বড়। ছোট ছবি দিয়ে আবার চেষ্টা করুন।"
                        : code === "receipt_image_unreadable" ||
                            code === "receipt_empty"
                          ? "ফাইলটি পড়া যায়নি। অন্য ছবি বা PDF দিয়ে চেষ্টা করুন।"
                          : "ফাইলটি রাখা যায়নি। আবার চেষ্টা করুন।",
                { limit: number(20) },
              ),
            );
          }
        } finally {
          locked.current = false;
          if (mounted.current) {
            setProcessing(false);
            onProcessingChange?.(false);
          }
        }
      })(),
    );
  };
  return (
    <div className="receipt-upload-control" aria-busy={processing}>
      <label className="receipt-picker">
        <PaperclipIcon size={21} aria-hidden="true" />
        <span>
          {t("ভাউচার যোগ করুন")}
          <small>{t("ছবি বা PDF · সর্বোচ্চ ৫ MB")}</small>
        </span>
        <input
          type="file"
          aria-label={label ?? t("ভাউচার বা ছবি")}
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf"
          disabled={disabled || processing}
          onChange={(event) => select(event.currentTarget)}
        />
      </label>
      {processing && (
        <p className="receipt-upload-status" role="status">
          {t("ফাইল গুছিয়ে নিচ্ছি…")}
        </p>
      )}
    </div>
  );
}
