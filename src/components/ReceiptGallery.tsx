import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  CropIcon,
  DownloadSimpleIcon,
  FilePdfIcon,
  FileTextIcon,
  ImageIcon,
  MagnifyingGlassPlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useLanguageContext } from "../context/LanguageProvider";
import { canCropReceiptImage } from "../lib/cropReceiptImage";
import { voucherExtensions, voucherFilename } from "../lib/voucherFilename";
import { ReceiptCropDialog } from "./ReceiptCropDialog";
import { ReceiptPdfPreview } from "./ReceiptPdfPreview";
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

const canPreview = (mime: string) => Object.hasOwn(voucherExtensions, mime);

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
  const image = mime && canPreview(mime) && mime.startsWith("image/");
  const url = useObjectUrl(image ? receipt.file : undefined);
  const [failedUrl, setFailedUrl] = useState<string>();
  const Icon = image
    ? ImageIcon
    : mime === "application/pdf"
      ? FilePdfIcon
      : FileTextIcon;
  return (
    <span className="receipt-thumbnail" aria-hidden="true">
      {url && url !== failedUrl ? (
        <img src={url} alt="" onError={() => setFailedUrl(url)} />
      ) : (
        <Icon size={28} weight="duotone" />
      )}
    </span>
  );
}

function ReceiptPreviewModal({
  title,
  onClose,
  returnFocus,
  children,
}: {
  title: string;
  onClose: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const native =
    typeof HTMLDialogElement !== "undefined" &&
    typeof HTMLDialogElement.prototype.showModal === "function";

  useLayoutEffect(() => {
    const dialog = modal.current;
    if (!dialog) return;
    dialog.showModal();
    // Capture Escape before the surrounding sheet can dismiss itself.
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    }
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("keydown", escape, true);
      dialog.close();
      if (returnFocus.current?.isConnected)
        returnFocus.current.focus({ preventScroll: true });
    };
  }, [onClose, returnFocus]);

  if (native)
    return (
      <dialog
        ref={modal}
        className="receipt-preview-dialog"
        aria-labelledby={titleId}
        data-vaul-no-drag
        onCancel={(event) => {
          event.preventDefault();
          onClose();
        }}
      >
        <h2 id={titleId} className="receipt-preview-title">
          {title}
        </h2>
        {children}
      </dialog>
    );

  return (
    <Dialog.Root open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="receipt-preview-overlay" />
        <Dialog.Content
          className="receipt-preview-dialog"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            if (returnFocus.current?.isConnected) {
              event.preventDefault();
              returnFocus.current.focus();
            }
          }}
        >
          <Dialog.Title className="receipt-preview-title">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ReceiptImagePreview({ url, name }: { url: string; name: string }) {
  const { t } = useLanguageContext();
  const [failed, setFailed] = useState(false);
  return failed ? (
    <p className="receipt-preview-message" role="alert">
      {t("ভাউচার খোলা যায়নি। আবার চেষ্টা করুন।")}
    </p>
  ) : (
    <img src={url} alt={name} onError={() => setFailed(true)} />
  );
}

export function ReceiptGallery({
  receipts,
  date,
  createdAt,
  loadFile,
  onRemove,
  onCrop,
  removeDisabled,
  loadError,
}: {
  receipts: GalleryReceipt[];
  date?: string | null;
  createdAt?: string;
  loadFile?: LoadFile;
  onRemove?: (id: string) => void;
  onCrop?: (id: string, cropped: File, original: Blob) => void | Promise<void>;
  removeDisabled?: boolean;
  loadError?: (cause: unknown) => string;
}) {
  const { t } = useLanguageContext();
  const [selectedId, setSelectedId] = useState<string>();
  const [crop, setCrop] = useState<{
    id: string;
    file: File;
    original: Blob;
  }>();
  const [cropCommitting, setCropCommitting] = useState(false);
  const [loaded, setLoaded] = useState<{
    id: string;
    file?: Blob;
    error?: string;
  }>();
  const pending = useRef<AbortController>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selectedIndex = receipts.findIndex((item) => item.id === selectedId);
  const selected = receipts[selectedIndex];
  const cropReceipt =
    crop && receipts.find((receipt) => receipt.id === crop.id);
  const cropMatches = crop && cropReceipt?.file === crop.original;
  const file = selected
    ? (selected.file ?? (loaded?.id === selectedId ? loaded?.file : undefined))
    : undefined;
  const error = loaded?.id === selectedId ? loaded?.error : undefined;
  const supported = file && canPreview(file.type);
  const previewUrl = useObjectUrl(supported ? file : undefined);

  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (selectedId && !selected) {
      pending.current?.abort();
      setSelectedId(undefined);
      setLoaded(undefined);
    }
  }, [selected, selectedId]);
  useEffect(() => {
    if (crop && !cropMatches && !cropCommitting) setCrop(undefined);
  }, [crop, cropCommitting, cropMatches]);

  const close = useCallback(() => {
    pending.current?.abort();
    setSelectedId(undefined);
    setLoaded(undefined);
  }, []);

  function nameFor(receipt: GalleryReceipt, index: number) {
    return voucherFilename(
      index + 1,
      date,
      createdAt,
      receipt.file?.type ?? receipt.mime ?? "",
    );
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
        !canPreview(file.type) ||
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
  const name = selected && nameFor(selected, selectedIndex);
  const editable =
    onCrop &&
    !removeDisabled &&
    selected?.file &&
    canCropReceiptImage(selected.file)
      ? { id: selected.id, file: selected.file }
      : undefined;
  return (
    <>
      <ul
        className="receipt-gallery"
        aria-label={t("ভাউচার")}
        data-vaul-no-drag
      >
        {receipts.map((receipt, index) => {
          const name = nameFor(receipt, index);
          return (
            <li key={receipt.id} className="receipt-card">
              <button
                type="button"
                className="receipt-card-open"
                aria-haspopup="dialog"
                aria-label={`${t("ভাউচার দেখি")}: ${name}`}
                onClick={(event) => void open(receipt, event.currentTarget)}
              >
                <span className="receipt-card-stage">
                  <ReceiptThumbnail receipt={receipt} />
                  <span className="receipt-card-zoom" aria-hidden="true">
                    <MagnifyingGlassPlusIcon size={17} />
                  </span>
                </span>
                <span
                  className="receipt-card-name"
                  lang="en"
                  dir="ltr"
                  title={name}
                >
                  {name}
                </span>
              </button>
              {onRemove && receipt.file ? (
                <button
                  type="button"
                  className="icon-button receipt-card-remove"
                  disabled={removeDisabled}
                  aria-label={`${t("ভাউচার সরান")}: ${name}`}
                  onClick={() => onRemove(receipt.id)}
                >
                  <XIcon size={17} aria-hidden="true" />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {name ? (
        <ReceiptPreviewModal
          title={t("ভাউচার দেখি")}
          onClose={close}
          returnFocus={trigger}
        >
          <header className="receipt-preview-header">
            <div>
              <span aria-hidden="true">{t("ভাউচার দেখি")}</span>
              <strong lang="en" dir="ltr">
                {name}
              </strong>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label={t("বন্ধ করুন")}
              onClick={close}
            >
              <XIcon size={21} aria-hidden="true" />
            </button>
          </header>
          <div className="receipt-preview-body">
            {previewUrl && file ? (
              file.type.startsWith("image/") ? (
                <ReceiptImagePreview
                  key={previewUrl}
                  url={previewUrl}
                  name={name}
                />
              ) : typeof Worker === "function" ? (
                <ReceiptPdfPreview
                  key={previewUrl}
                  file={file}
                  url={previewUrl}
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
            <footer className="receipt-preview-actions">
              {editable ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    const original = editable.file;
                    setCrop({
                      id: editable.id,
                      original,
                      file:
                        original instanceof File
                          ? original
                          : new File([original], name, { type: original.type }),
                    });
                    close();
                  }}
                >
                  <CropIcon size={19} aria-hidden="true" />
                  {t("ভাউচারের ছবি কাটুন")}
                </button>
              ) : null}
              <a className="primary-button" href={previewUrl} download={name}>
                <DownloadSimpleIcon size={19} aria-hidden="true" />
                {t("ভাউচার নামান")}
              </a>
            </footer>
          ) : null}
        </ReceiptPreviewModal>
      ) : null}
      {crop && (cropMatches || cropCommitting) && onCrop ? (
        <ReceiptCropDialog
          file={crop.file}
          returnFocus={trigger}
          onClose={() => setCrop(undefined)}
          onCrop={async (cropped) => {
            if (!cropMatches || removeDisabled)
              throw new Error("receipt_changed");
            setCropCommitting(true);
            try {
              await onCrop(crop.id, cropped, crop.original);
              setCrop(undefined);
            } finally {
              setCropCommitting(false);
            }
          }}
        />
      ) : null}
    </>
  );
}
