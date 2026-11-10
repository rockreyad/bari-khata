import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  DownloadSimpleIcon,
  FilePdfIcon,
  FileTextIcon,
  ImageIcon,
  XIcon,
} from "@phosphor-icons/react";
import { z } from "zod";
import { useLanguageContext } from "../context/LanguageProvider";
import { todayDhaka } from "../lib/display";
import "./receipt-gallery.css";

type GalleryReceipt = {
  id: string;
  name?: string;
  mime?: string;
  size?: number;
  file?: Blob;
};

type LoadFile = (
  receipt: GalleryReceipt,
  signal: AbortSignal,
) => Promise<Blob | null | undefined>;

const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

const isoDate = z.iso.date();

function voucherFilename(
  order: number,
  date: string | null | undefined,
  createdAt: string | undefined,
  mime: string,
) {
  const created = createdAt ? new Date(createdAt) : null;
  const localDate = isoDate.safeParse(date).success
    ? date
    : created && Number.isFinite(created.getTime())
      ? todayDhaka(created)
      : "undated";
  return `voucher-${order}-${localDate}.${extensions[mime] ?? "bin"}`;
}

function useObjectUrl(file?: Blob | null) {
  const [source, setSource] = useState<{ file: Blob; url: string }>();
  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== "function") return;
    const url = URL.createObjectURL(file);
    setSource({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return source?.file === file ? source?.url : undefined;
}

function ReceiptThumbnail({ receipt }: { receipt: GalleryReceipt }) {
  const mime = receipt.file?.type || receipt.mime;
  const image =
    mime && Object.hasOwn(extensions, mime) && mime.startsWith("image/");
  const url = useObjectUrl(image ? receipt.file : undefined);
  const Icon = image
    ? ImageIcon
    : mime === "application/pdf"
      ? FilePdfIcon
      : FileTextIcon;
  return (
    <span className="receipt-thumbnail" aria-hidden="true">
      {url ? <img src={url} alt="" /> : <Icon size={28} weight="duotone" />}
    </span>
  );
}

export function ReceiptGallery({
  receipts,
  date,
  createdAt,
  loadFile,
  onRemove,
  removeDisabled,
  loadError,
}: {
  receipts: GalleryReceipt[];
  date?: string | null;
  createdAt?: string;
  loadFile?: LoadFile;
  onRemove?: (id: string) => void;
  removeDisabled?: boolean;
  loadError?: (cause: unknown) => string;
}) {
  const { t, formatDigits } = useLanguageContext();
  const [selectedId, setSelectedId] = useState<string>();
  const [loaded, setLoaded] = useState<{
    id: string;
    file?: Blob;
    error?: string;
  }>();
  const pending = useRef<AbortController>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selectedIndex = receipts.findIndex((item) => item.id === selectedId);
  const selected = receipts[selectedIndex];
  const file = selected
    ? (selected.file ?? (loaded?.id === selectedId ? loaded?.file : undefined))
    : undefined;
  const error = loaded?.id === selectedId ? loaded?.error : undefined;
  const supported = file && Object.hasOwn(extensions, file.type);
  const previewUrl = useObjectUrl(supported ? file : undefined);

  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (selectedId && !selected) {
      pending.current?.abort();
      setSelectedId(undefined);
      setLoaded(undefined);
    }
  }, [selected, selectedId]);

  function close() {
    pending.current?.abort();
    setSelectedId(undefined);
    setLoaded(undefined);
  }

  async function open(receipt: GalleryReceipt, button: HTMLButtonElement) {
    pending.current?.abort();
    trigger.current = button;
    setSelectedId(receipt.id);
    setLoaded(undefined);
    if (receipt.file) return;
    const controller = new AbortController();
    pending.current = controller;
    try {
      const file = await loadFile?.(receipt, controller.signal);
      if (controller.signal.aborted) return;
      if (
        !file ||
        !Object.hasOwn(extensions, file.type) ||
        (receipt.mime && file.type !== receipt.mime) ||
        (receipt.size !== undefined && file.size !== receipt.size)
      )
        throw new Error("receipt_missing");
      setLoaded({ id: receipt.id, file });
    } catch (cause) {
      if (controller.signal.aborted) return;
      setLoaded({
        id: receipt.id,
        error:
          loadError?.(cause) ??
          t("ভাউচার এই ফোনে পাওয়া যায়নি। অনলাইনে সিঙ্ক করে দেখুন।"),
      });
    }
  }

  if (!receipts.length) return null;
  return (
    <Dialog.Root
      open={!!selected}
      onOpenChange={(isOpen) => !isOpen && close()}
    >
      <ul className="receipt-gallery" aria-label={t("ভাউচার")}>
        {receipts.map((receipt) => {
          const name = formatDigits(receipt.name ?? t("ভাউচার"));
          return (
            <li key={receipt.id} className="receipt-card">
              <button
                type="button"
                className="receipt-card-open"
                aria-haspopup="dialog"
                aria-label={`${t("ভাউচার দেখি")}: ${name}`}
                onClick={(event) => void open(receipt, event.currentTarget)}
              >
                <ReceiptThumbnail receipt={receipt} />
                <span className="receipt-card-name" title={name}>
                  {name}
                </span>
              </button>
              {onRemove && receipt.file ? (
                <button
                  type="button"
                  className="icon-button receipt-card-remove"
                  disabled={removeDisabled}
                  aria-label={t("সরান: {{name}}", { name })}
                  onClick={() => onRemove(receipt.id)}
                >
                  <XIcon size={17} aria-hidden="true" />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {selected ? (
        <Dialog.Portal>
          <Dialog.Overlay className="receipt-preview-overlay" />
          <Dialog.Content
            className="receipt-preview-dialog"
            aria-describedby={undefined}
            onCloseAutoFocus={(event) => {
              if (trigger.current?.isConnected) {
                event.preventDefault();
                trigger.current.focus();
              }
            }}
          >
            <header>
              <div>
                <Dialog.Title>{t("ভাউচার দেখি")}</Dialog.Title>
                <p>{formatDigits(selected.name ?? t("ভাউচার"))}</p>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("বন্ধ করুন")}
                >
                  <XIcon size={21} aria-hidden="true" />
                </button>
              </Dialog.Close>
            </header>
            <div className="receipt-preview-body">
              {previewUrl && file ? (
                file.type.startsWith("image/") ? (
                  <img
                    src={previewUrl}
                    alt={formatDigits(selected.name ?? t("ভাউচারের ছবি"))}
                  />
                ) : (
                  <object
                    data={previewUrl}
                    type="application/pdf"
                    aria-label={t("ভাউচার দেখি")}
                  >
                    <p>{t("PDF দেখতে ভাউচারটি নামান।")}</p>
                  </object>
                )
              ) : error ? (
                <p role="alert">{error}</p>
              ) : file &&
                (!supported || typeof URL.createObjectURL !== "function") ? (
                <p role="alert">{t("ভাউচার খোলা যায়নি। আবার চেষ্টা করুন।")}</p>
              ) : (
                <p role="status">{t("অপেক্ষা করুন…")}</p>
              )}
            </div>
            {previewUrl && file ? (
              <footer>
                <a
                  className="secondary-button"
                  href={previewUrl}
                  download={voucherFilename(
                    selectedIndex + 1,
                    date,
                    createdAt,
                    file.type,
                  )}
                >
                  <DownloadSimpleIcon size={19} aria-hidden="true" />
                  {t("ভাউচার নামান")}
                </a>
              </footer>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      ) : null}
    </Dialog.Root>
  );
}
