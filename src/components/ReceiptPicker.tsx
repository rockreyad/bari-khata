import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { CloudArrowUpIcon } from "@phosphor-icons/react";
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
  const hintId = useId();
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
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
  const select = (incoming: File[]) => {
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
  const fileDrag = (event: DragEvent) =>
    Array.from(event.dataTransfer.types).includes("Files");
  const blocked = disabled || processing;
  return (
    <div className="receipt-upload-control" aria-busy={processing}>
      <label
        className={`receipt-picker${dragging && !blocked ? " is-dragging" : ""}`}
        data-vaul-no-drag
        onDragEnter={(event) => {
          if (!fileDrag(event)) return;
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDragOver={(event) => {
          if (!fileDrag(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = blocked ? "none" : "copy";
        }}
        onDrop={(event) => {
          if (!fileDrag(event) && !event.dataTransfer.files.length) return;
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          select(Array.from(event.dataTransfer.files));
        }}
      >
        <span className="receipt-picker-icon">
          <CloudArrowUpIcon size={24} aria-hidden="true" />
        </span>
        <span className="receipt-picker-copy">
          <strong>{t("ভাউচার যোগ করুন")}</strong>
          <small id={hintId}>
            {t("ছবি বা PDF টেনে দিন · প্রতি ফাইল ৫ MB")}
          </small>
        </span>
        <span className="receipt-picker-action" aria-hidden="true">
          {t("ফাইল বাছুন")}
        </span>
        <input
          type="file"
          aria-label={label ?? t("ভাউচার বা ছবি")}
          aria-describedby={hintId}
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf"
          disabled={blocked}
          onChange={(event) => {
            const incoming = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            select(incoming);
          }}
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
