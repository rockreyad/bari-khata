import { useState } from "react";
import { ReceiptPicker } from "../../components/ReceiptPicker";
import { ReceiptGallery } from "../../components/ReceiptGallery";
import type { ReceiptInput } from "../../data/repository";
import { useLanguageContext } from "../../context/LanguageProvider";
import { replaceDraftReceipt } from "../../lib/replaceDraftReceipt";

export function HouseAttachments({
  files,
  entryId,
  date,
  onChange,
  onError,
  onProcessingChange,
  disabled,
}: {
  files: ReceiptInput[];
  entryId: string;
  date?: string;
  onChange: (files: ReceiptInput[]) => void | Promise<void>;
  onError: (message: string) => void;
  onProcessingChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useLanguageContext();
  const [processing, setProcessing] = useState(false);
  const setBusy = (busy: boolean) => {
    setProcessing(busy);
    onProcessingChange?.(busy);
  };
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
        onProcessingChange={setBusy}
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
      <ReceiptGallery
        key={entryId}
        receipts={files}
        date={date}
        onRemove={(id) => void remove(id)}
        onCrop={async (id, cropped, original) => {
          const next = replaceDraftReceipt(files, id, original, cropped);
          setBusy(true);
          try {
            await onChange(next);
          } catch (error) {
            try {
              await onChange(files);
            } catch {
              // The previous draft still has the original voucher on disk.
            }
            throw error;
          } finally {
            setBusy(false);
          }
        }}
        removeDisabled={disabled || processing}
      />
    </div>
  );
}
