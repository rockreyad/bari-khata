import { useId, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { LedgerSchema, MilestoneSchema } from "../../domain/model";
import { parseAmount } from "../../domain/ledger";
import { AppDatePicker } from "../../components/ui/AppDatePicker";
import { AppSelect } from "../../components/ui/AppSelect";
import { MoneyInput } from "../../components/ui/MoneyInput";
import { FormError } from "../../components/ui/FormError";
import { useInlineDraft } from "../entries/useInlineDraft";
import "../people/party-allocations.css";
const DraftSchema = z.object({
  title: z.string().max(300),
  amount: z.string().max(100),
  dueOn: z.string().max(10),
});
const empty = { title: "", amount: "", dueOn: "" };
export function AgreementMilestones({
  contractId,
  archived = false,
}: {
  contractId: string;
  archived?: boolean;
}) {
  const { ledger, save, add } = useNotebook();
  const { t, money, date, formatDigits } = useLanguageContext();
  const {
    value: draft,
    update,
    clear,
    ready,
    failed,
  } = useInlineDraft(`milestone:${contractId}`, DraftSchema, empty);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const lock = useRef(false);
  const errorId = useId();
  const contract = ledger.contracts.find((row) => row.id === contractId);
  const milestones =
    ledger.milestones?.filter((row) => row.contractId === contractId) ?? [];
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || !ready) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      const milestone = MilestoneSchema.parse({
        id: crypto.randomUUID(),
        contractId,
        title: draft.title.trim(),
        amount: parseAmount(draft.amount),
        dueOn: draft.dueOn || null,
        status: "planned",
      });
      await save((current) => {
        if (current.contracts.find((row) => row.id === contractId)?.archivedAt)
          throw new Error("archived");
        return LedgerSchema.parse({
          ...current,
          milestones: [...(current.milestones ?? []), milestone],
        });
      });
      await clear(empty);
    } catch {
      setError(
        t(
          "ধাপের নাম, সঠিক টাকা ও তারিখ লিখুন। সব ধাপের টাকা চুক্তির টাকার মধ্যে রাখুন।",
        ),
      );
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  async function status(id: string, value: string) {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      await save((current) => {
        if (current.contracts.find((row) => row.id === contractId)?.archivedAt)
          throw new Error("archived");
        return LedgerSchema.parse({
          ...current,
          milestones: current.milestones?.map((row) =>
            row.id === id ? { ...row, status: value } : row,
          ),
        });
      });
    } catch {
      setError(t("ধাপের অবস্থা রাখা যায়নি। আবার চেষ্টা করুন।"));
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return (
    <section className="agreement-milestones" aria-label={t("কাজের ধাপ")}>
      <h2>{t("কাজের ধাপ")}</h2>
      <p>{t("চাইলে কাজ ভাগ করে রাখুন। ধাপ রাখলে নতুন বিল বা খরচ হবে না।")}</p>
      <FormError id={errorId} message={error} />
      {milestones.map((row) => (
        <div className="milestone-item" key={row.id}>
          <strong>{formatDigits(row.title)}</strong>
          <span>{money(row.amount)}</span>
          <small>{row.dueOn ? date(row.dueOn) : t("তারিখ দেওয়া নেই")}</small>
          <AppSelect
            aria-label={t("ধাপের অবস্থা: {{name}}", { name: row.title })}
            value={row.status}
            disabled={saving || archived}
            onChange={(event) => void status(row.id, event.target.value)}
          >
            <option value="planned">{t("শুরু করিনি")}</option>
            <option value="ongoing">{t("চলছে")}</option>
            <option value="done">{t("শেষ হয়েছে")}</option>
          </AppSelect>
          {!archived && contract ? (
            <button
              type="button"
              className="text-button"
              onClick={() =>
                add({
                  kind: "wage",
                  account: "labour",
                  personId: contract.personId,
                  workId: contract.workId ?? undefined,
                  contractId,
                  milestoneId: row.id,
                })
              }
            >
              {t("এই ধাপের বিল লিখি")}
            </button>
          ) : null}
        </div>
      ))}
      {!archived ? (
        <details onToggle={(event) => setFormOpen(event.currentTarget.open)}>
          <summary>{t("ধাপ যোগ করি")}</summary>
          <form onSubmit={(event) => void submit(event)}>
            <FormError
              id={`${errorId}-draft`}
              message={
                formOpen && failed
                  ? t(
                      "অসমাপ্ত লেখা খোলা বা রাখা যাচ্ছে না। লেখা অক্ষত রেখে আবার খুলুন।",
                    )
                  : ""
              }
            />
            <label>
              {t("ধাপের নাম")}
              <input
                aria-label={t("ধাপের নাম")}
                maxLength={300}
                required
                value={draft.title}
                disabled={!ready || saving}
                onChange={(event) =>
                  update({ ...draft, title: event.target.value })
                }
              />
            </label>
            <label>
              {t("এই ধাপের টাকা")}
              <MoneyInput
                aria-label={t("এই ধাপের টাকা")}
                required
                value={draft.amount}
                disabled={!ready || saving}
                onChange={(event) =>
                  update({ ...draft, amount: event.target.value })
                }
              />
            </label>
            <label>
              {t("শেষ করার তারিখ")}
              <AppDatePicker
                aria-label={t("শেষ করার তারিখ")}
                value={draft.dueOn}
                disabled={!ready || saving}
                onChange={(event) =>
                  update({ ...draft, dueOn: event.target.value })
                }
              />
            </label>
            <button
              type="submit"
              className="primary-button"
              disabled={!ready || saving || failed}
            >
              {t(saving ? "রাখছি…" : "ধাপ রাখুন")}
            </button>
          </form>
        </details>
      ) : null}
    </section>
  );
}
