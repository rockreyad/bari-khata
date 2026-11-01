import { useState, type FormEvent } from "react";
import { CheckCircleIcon } from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { Sheet } from "../../components/Sheet";
import { AppSelect } from "../../components/ui/AppSelect";
import { useLanguageContext } from "../../context/LanguageProvider";
import type { CostType, Entry } from "../../domain/model";
import { entryTotal } from "../../domain/ledger";
import { costNames } from "../../lib/display";
import { bulkOrganizeHistoricalEntries } from "./bulkReview";

export function BulkReviewSheet({
  entries,
  onClose,
  onSaved,
}: {
  entries: Entry[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { ledger, save } = useNotebook();
  const { t, number, money } = useLanguageContext();
  const [originals] = useState(() => structuredClone(entries));
  const [workId, setWorkId] = useState("");
  const [costType, setCostType] = useState<CostType | "">("");
  const [groupId, setGroupId] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reviewed || busy) return;
    setBusy(true);
    setError("");
    try {
      await save((current) =>
        bulkOrganizeHistoricalEntries(current, originals, {
          workId: workId || undefined,
          costType: costType || undefined,
          groupId: groupId || undefined,
        }),
      );
      onSaved();
    } catch (cause) {
      setError(
        t(
          cause instanceof Error && cause.message === "review_conflict"
            ? "বাছা কোনো হিসাব অন্য জায়গায় বদলেছে। বন্ধ করে আবার বেছে নিন।"
            : "তথ্য রাখা যায়নি। আবার চেষ্টা করুন।",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title={t("একসঙ্গে তথ্য ঠিক করি")}
      subtitle={t("{{count}}টি বাছা হিসাব", {
        count: number(originals.length),
      })}
      onClose={onClose}
      footer={
        <button
          type="submit"
          form="bulk-review-form"
          className="primary-button"
          disabled={!reviewed || busy}
        >
          <CheckCircleIcon size={20} />
          {t(busy ? "রাখছি…" : "তথ্য রাখুন")}
        </button>
      }
    >
      <form id="bulk-review-form" className="review-form" onSubmit={submit}>
        <p className="review-safety-note">
          {t("শুধু বাছা তথ্য বদলাবে। টাকা, তারিখ ও মূল খাতার লেখা একই থাকবে।")}
        </p>
        <label>
          {t("কাজের খাতা")}
          <AppSelect
            value={workId}
            onChange={(event) => setWorkId(event.target.value)}
          >
            <option value="">{t("আগের মতো থাকবে")}</option>
            {ledger.works.map((work) => (
              <option key={work.id} value={work.id}>
                {work.name}
              </option>
            ))}
          </AppSelect>
        </label>
        <label>
          {t("খরচের ধরন")}
          <AppSelect
            value={costType}
            onChange={(event) =>
              setCostType(event.target.value as CostType | "")
            }
          >
            <option value="">{t("আগের মতো থাকবে")}</option>
            {Object.entries(costNames).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </AppSelect>
        </label>
        <label>
          {t("মালের ধরন")}
          <AppSelect
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
          >
            <option value="">{t("আগের মতো থাকবে")}</option>
            {ledger.materialGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </AppSelect>
        </label>
        <p className="review-bulk-help">
          {t(
            "একই তথ্য যেগুলোতে প্রযোজ্য, শুধু সেগুলো বাছুন। আলাদা ব্র্যান্ড বা ব্যবহার হলে হিসাবটি খুলে ঠিক করুন।",
          )}
        </p>
        <div className="review-bulk-preview">
          {originals.slice(0, 6).map((entry) => (
            <div className="amount-row" key={entry.id}>
              <span>{entry.lines[0]?.label || entry.note}</span>
              <strong>
                {money(
                  entryTotal(entry) *
                    (entry.kind === "expense_credit" ? -1 : 1),
                )}
              </strong>
            </div>
          ))}
          {originals.length > 6 ? (
            <p>
              {t("আরও {{count}}টি হিসাব", {
                count: number(originals.length - 6),
              })}
            </p>
          ) : null}
        </div>
        <label className="review-bulk-all">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(event) => setReviewed(event.target.checked)}
          />
          <span>{t("বাছা প্রতিটি হিসাব দেখে নিয়েছি")}</span>
        </label>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}
