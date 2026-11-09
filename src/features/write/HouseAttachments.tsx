import { useEffect, useState } from "react";
import { FilePdfIcon, XIcon } from "@phosphor-icons/react";
import { ReceiptPicker } from "../../components/ReceiptPicker";
import type { ReceiptInput } from "../../data/repository";
import { useLanguageContext } from "../../context/LanguageProvider";

function AttachmentPreview({ file }: { file: Blob }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file.type.startsWith("image/")) return;
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? (
    <img src={url} alt="" />
  ) : (
    <FilePdfIcon size={24} aria-hidden="true" />
  );
}

export function HouseAttachments({
  files,
  entryId,
  onChange,
  onError,
  onProcessingChange,
  disabled,
}: {
  files: ReceiptInput[];
  entryId: string;
  onChange: (files: ReceiptInput[]) => void | Promise<void>;
  onError: (message: string) => void;
  onProcessingChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const { t, formatDigits } = useLanguageContext();
  const [processing, setProcessing] = useState(false);
  const remove = async (id: string) => {
    try {
      await onChange(files.filter((row) => row.id !== id));
    } catch {
      onError(t("ফাইলটি রাখা যায়নি। আবার চেষ্টা করুন।"));
    }
  };
  return (
    <div className="house-attachments">
      <ReceiptPicker
        existingCount={files.length}
        scopeKey={entryId}
        onError={onError}
        onProcessingChange={(busy) => {
          setProcessing(busy);
          onProcessingChange?.(busy);
        }}
        disabled={disabled}
        onFiles={(selected) =>
          onChange([
            ...files,
            ...selected.map((file) => ({
              id: crypto.randomUUID(),
              entryId,
              name: file.name,
              file,
            })),
          ])
        }
      />
      {files.length > 0 && (
        <ul>
          {files.map((file) => (
            <li key={file.id}>
              <span className="house-attachment-preview">
                <AttachmentPreview file={file.file} />
              </span>
              <span>{formatDigits(file.name ?? t("ভাউচার"))}</span>
              <button
                type="button"
                className="icon-button"
                disabled={disabled || processing}
                aria-label={t("সরান: {{name}}", {
                  name: file.name ?? t("ভাউচার"),
                })}
                onClick={() => void remove(file.id)}
              >
                <XIcon size={18} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
