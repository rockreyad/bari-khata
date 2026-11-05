import type { ReceiptInput } from "../../data/repository";
import { useLanguageContext } from "../../context/LanguageProvider";

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
      <label>
        {t("ভাউচার বা ছবি")}
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf"
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
                  ].includes(file.type) || file.size > 10 * 1024 * 1024,
              )
            ) {
              onError(
                t("ছবি বা PDF দিন। প্রতিটি ১০ MB-এর মধ্যে, সর্বোচ্চ ২০টি।"),
              );
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
      </label>
      {files.length > 0 && (
        <ul>
          {files.map((file) => (
            <li key={file.id}>
              <span>{formatDigits(file.name ?? t("ভাউচার"))}</span>
              <button
                type="button"
                className="text-button"
                aria-label={t("সরান: {{name}}", {
                  name: file.name ?? t("ভাউচার"),
                })}
                onClick={() =>
                  onChange(files.filter((row) => row.id !== file.id))
                }
              >
                {t("সরান")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
