import { useEffect, useState } from "react";
import { FilePdfIcon, XIcon } from "@phosphor-icons/react";
import { ReceiptPicker } from "../../components/ReceiptPicker";
import type { ReceiptInput } from "../../data/repository";
import { useLanguageContext } from "../../context/LanguageProvider";
import { NEW_RECEIPT_MAX_BYTES } from "../../lib/attachmentLimits";

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
}: {
  files: ReceiptInput[];
  entryId: string;
  onChange: (files: ReceiptInput[]) => void;
  onError: (message: string) => void;
}) {
  const { t, formatDigits } = useLanguageContext();
  return (
    <div className="house-attachments">
      <ReceiptPicker
        onChange={(event) => {
          const selected = Array.from(event.target.files ?? []);
          if (
            selected.length + files.length > 20 ||
            selected.some(
              (file) =>
                ![
                  "image/jpeg",
                  "image/png",
                  "image/webp",
                  "application/pdf",
                ].includes(file.type) || file.size > NEW_RECEIPT_MAX_BYTES,
            )
          ) {
            onError(t("ছবি বা PDF দিন। প্রতিটি ২ MB-এর মধ্যে, সর্বোচ্চ ২০টি।"));
          } else
            onChange([
              ...files,
              ...selected.map((file) => ({
                id: crypto.randomUUID(),
                entryId,
                name: file.name,
                file,
              })),
            ]);
          event.target.value = "";
        }}
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
                aria-label={t("সরান: {{name}}", {
                  name: file.name ?? t("ভাউচার"),
                })}
                onClick={() =>
                  onChange(files.filter((row) => row.id !== file.id))
                }
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
