import { useState } from "react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { EntryFrame } from "../../components/EntryFrame";
import { FormError } from "../../components/ui/FormError";

export function HouseSavedNotice({
  title,
  entryIds,
  onNew,
}: {
  title: string;
  entryIds: string[];
  onNew: () => Promise<void>;
}) {
  const { close, detail } = useNotebook();
  const { t } = useLanguageContext();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const start = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onNew();
    } catch {
      setError(
        t("নতুন লেখা খোলা যায়নি। আগের লেখা অক্ষত আছে; আবার চেষ্টা করুন।"),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <EntryFrame
      title={title}
      onClose={close}
      busy={busy}
      className="house-write-page"
    >
      <section className="house-saved-notice" role="status">
        <h2>{t("এই হিসাব আগেই রাখা হয়েছে।")}</h2>
        <p>
          {t("অসমাপ্ত লেখার কপি আবার খুলেছে। একই টাকা দ্বিতীয়বার রাখা হবে না।")}
        </p>
        <FormError id="house-saved-error" message={error} />
        {entryIds.map((id) => (
          <button
            key={id}
            type="button"
            className="secondary-button"
            onClick={() => detail(id)}
            disabled={busy}
          >
            {t("রাখা হিসাবটি দেখি")}
          </button>
        ))}
        <button
          type="button"
          className="primary-button"
          onClick={() => void start()}
          disabled={busy}
        >
          {t("নতুন হিসাব লিখি")}
        </button>
      </section>
    </EntryFrame>
  );
}
