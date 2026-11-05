import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import {
  allocatePayment,
  cancelPaymentAllocation,
  partyLedger,
} from "../../domain/partyLedger";
import { z } from "zod";
import { useInlineDraft } from "../entries/useInlineDraft";
import { parseAmount } from "../../domain/ledger";
import { AppSelect } from "../../components/ui/AppSelect";
import { MoneyInput } from "../../components/ui/MoneyInput";
import { FormError } from "../../components/ui/FormError";
import "./party-allocations.css";

const DraftSchema = z.object({
  paymentId: z.string().max(160),
  cancelId: z.string().max(160).default(""),
  cancelReason: z.string().max(2000).default(""),
  amounts: z.record(z.string().max(400), z.string().max(100)),
});
const empty: z.infer<typeof DraftSchema> = {
  paymentId: "",
  amounts: {},
  cancelId: "",
  cancelReason: "",
};

export function PartyAllocationPanel({
  personId,
  archived = false,
}: {
  personId: string;
  archived?: boolean;
}) {
  const { ledger, save, detail } = useNotebook();
  const { t, money, date, formatDigits } = useLanguageContext();
  const summary = useMemo(
    () => partyLedger(ledger, personId),
    [ledger, personId],
  );
  const {
    value: draft,
    update,
    clear,
    ready,
    failed,
  } = useInlineDraft(`payment-allocation:${personId}`, DraftSchema, empty);
  const { paymentId, amounts } = draft;
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const errorId = useId();
  const payments = summary.payments.filter(
    (payment) => payment.unallocated > 0,
  );
  const payment = payments.find((payment) => payment.entry.id === paymentId);
  const billName = (entry: (typeof ledger.entries)[number]) =>
    entry.note ||
    entry.lines
      .map((line) => line.label)
      .filter(Boolean)
      .join(" · ") ||
    t("বিল");
  const choices = payment
    ? summary.bills.flatMap((bill) => {
        if (
          bill.entry.account !== payment.entry.account ||
          bill.entry.contractId !== payment.entry.contractId
        )
          return [];
        return bill.works.flatMap((work) => {
          const source = payment.works.find(
            (source) => source.workId === work.workId,
          );
          const available = Math.min(work.outstanding, source?.available ?? 0);
          const workName =
            ledger.works.find((row) => row.id === work.workId)?.name ?? "";
          return available > 0
            ? [
                {
                  key: JSON.stringify([bill.entry.id, work.workId]),
                  billId: bill.entry.id,
                  workId: work.workId,
                  name: [billName(bill.entry), workName]
                    .filter(Boolean)
                    .join(" · "),
                  available,
                },
              ]
            : [];
        });
      })
    : [];
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || !ready || failed) return;
    setError("");
    try {
      const selected = choices.flatMap((choice) => {
        const value = amounts[choice.key]?.trim();
        return value
          ? [
              {
                billId: choice.billId,
                workId: choice.workId,
                amount: parseAmount(value),
              },
            ]
          : [];
      });
      if (
        !payment ||
        !selected.length ||
        selected.some((row) => row.amount <= 0)
      )
        throw new Error("amount");
      lock.current = true;
      setSaving(true);
      await save((current) => allocatePayment(current, paymentId, selected));
      await clear(empty);
    } catch {
      setError(
        t(
          "বিলের বাকি ও দেওয়া টাকার মধ্যে সঠিক অঙ্ক লিখুন। খাতা বদলে থাকলে আবার দেখে নিন।",
        ),
      );
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  async function cancel(event: FormEvent) {
    event.preventDefault();
    if (lock.current || !ready || failed || !draft.cancelReason.trim()) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      await save((current) =>
        cancelPaymentAllocation(
          current,
          draft.cancelId,
          draft.cancelReason.trim(),
        ),
      );
      await clear({ ...draft, cancelId: "", cancelReason: "" });
    } catch {
      setError(
        t("বিলে লাগানো টাকার সম্পর্ক বদলানো যায়নি। আবার দেখে চেষ্টা করুন।"),
      );
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  if (!summary.bills.length && !summary.payments.length) return null;
  return (
    <section
      className="party-allocation-panel"
      aria-label={t("বিল ও দেওয়া টাকা")}
    >
      <h2>{t("বিল ও দেওয়া টাকা")}</h2>
      <dl className="party-ledger-totals">
        <div>
          <dt>{t("চলতি হিসাবে দিতে বাকি")}</dt>
          <dd>{money(summary.payable)}</dd>
        </div>
        <div>
          <dt>{t("বিলে মেলানো বাকি")}</dt>
          <dd>{money(summary.billOutstanding)}</dd>
        </div>
        <div>
          <dt>{t("এখনও বিলে লাগাইনি")}</dt>
          <dd>{money(summary.unallocatedCash)}</dd>
        </div>
        <div>
          <dt>{t("এর মধ্যে অগ্রিম")}</dt>
          <dd>{money(summary.advance)}</dd>
        </div>
        <div>
          <dt>{t("ফেরত পাওয়ার টাকা")}</dt>
          <dd>{money(summary.receivable)}</dd>
        </div>
      </dl>
      <p className="field-hint">
        {t(
          "যে বিলের সঙ্গে টাকা মেলানো হয়নি, সেটি নিজে থেকে পরিশোধিত ধরা হয়নি।",
        )}
      </p>
      {summary.creditAmbiguous ||
      summary.legacyUnclassifiedCredit > 0 ||
      summary.unclassifiedRefunds > 0 ? (
        <p className="field-hint">
          {t(
            "পুরোনো কিছু টাকার বিল বা ফেরতের সম্পর্ক জানা নেই। নিজে থেকে মিলিয়ে দেওয়া হয়নি।",
          )}
        </p>
      ) : null}
      {summary.entries.some(
        (entry) =>
          entry.kind === "expense" &&
          !entry.voided &&
          entry.balanceImpact === "normal" &&
          entry.reviewStatus === "needs_review",
      ) ? (
        <p className="field-hint">
          {t("যাচাই বাকি বিল আগে দেখে নিন, তারপর টাকার সঙ্গে মেলান।")}
        </p>
      ) : null}
      {summary.bills.length ? (
        <ul className="party-bill-list">
          {summary.bills.map((bill) => (
            <li key={bill.entry.id}>
              <button
                type="button"
                className="text-button"
                onClick={() => detail(bill.entry.id)}
              >
                {formatDigits(
                  bill.entry.note ||
                    bill.entry.lines
                      .map((line) => line.label)
                      .filter(Boolean)
                      .join(" · ") ||
                    t("বিল"),
                )}
                <small>
                  {bill.entry.date
                    ? date(bill.entry.date)
                    : t("তারিখ দেওয়া নেই")}
                </small>
              </button>
              <span>
                {t("মেলানো বাকি {{amount}}", {
                  amount: money(bill.outstanding),
                })}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {ledger.paymentAllocations?.some((allocation) =>
        summary.payments.some(
          (payment) => payment.entry.id === allocation.paymentId,
        ),
      ) ? (
        <details>
          <summary>{t("কোন বিলে কত মিটিয়েছি")}</summary>
          <ul className="party-bill-list">
            {ledger.paymentAllocations
              .filter((allocation) =>
                summary.payments.some(
                  (payment) => payment.entry.id === allocation.paymentId,
                ),
              )
              .map((allocation) => {
                const bill = ledger.entries.find(
                  (entry) => entry.id === allocation.billId,
                );
                return (
                  <li key={allocation.id}>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => detail(allocation.billId)}
                    >
                      {formatDigits(
                        bill?.note ||
                          bill?.lines
                            .map((line) => line.label)
                            .filter(Boolean)
                            .join(" · ") ||
                          t("বিল"),
                      )}
                    </button>
                    <span>
                      {money(allocation.amount)}
                      {allocation.cancelledAt ? (
                        <small>
                          {t("সম্পর্ক বাতিল: {{date}}", {
                            date: date(allocation.cancelledAt),
                          })}{" "}
                          · {formatDigits(allocation.cancellationReason ?? "")}
                        </small>
                      ) : !archived ? (
                        <button
                          type="button"
                          className="text-button"
                          disabled={saving || !ready || failed}
                          onClick={() =>
                            update({
                              ...draft,
                              cancelId: allocation.id,
                              cancelReason: "",
                            })
                          }
                        >
                          {t("বিলের সম্পর্ক বাতিল করি")}
                        </button>
                      ) : null}
                    </span>
                  </li>
                );
              })}
          </ul>
          {draft.cancelId ? (
            <form onSubmit={(event) => void cancel(event)}>
              <label>
                {t("কেন সম্পর্ক বাতিল করছেন")}
                <input
                  aria-label={t("কেন সম্পর্ক বাতিল করছেন")}
                  maxLength={2000}
                  required
                  disabled={saving || !ready || failed}
                  value={draft.cancelReason}
                  onChange={(event) =>
                    update({ ...draft, cancelReason: event.target.value })
                  }
                />
              </label>
              <p>
                {t(
                  "বিল ও দেওয়া টাকা থাকবে। শুধু এই বিলে মেলানো সম্পর্কটি বাতিল হবে।",
                )}
              </p>
              <FormError id={`${errorId}-cancel`} message={error} />
              <button
                type="submit"
                className="secondary-button"
                disabled={
                  saving || !ready || failed || !draft.cancelReason.trim()
                }
              >
                {t("সম্পর্ক বাতিল রাখুন")}
              </button>
            </form>
          ) : null}
        </details>
      ) : null}
      {!archived &&
      payments.length &&
      summary.bills.some((bill) => bill.outstanding > 0) ? (
        <details>
          <summary>{t("দেওয়া টাকা বিলে লাগাই")}</summary>
          <form onSubmit={(event) => void submit(event)}>
            <p>
              {t(
                "আগে দেওয়া টাকা বা অগ্রিম থেকে বেছে নিন। এতে আবার টাকা দেওয়া বা নতুন খরচ হবে না।",
              )}
            </p>
            <FormError
              id={errorId}
              message={
                failed
                  ? t(
                      "অসমাপ্ত লেখা খোলা বা রাখা যাচ্ছে না। লেখা অক্ষত রেখে আবার খুলুন।",
                    )
                  : error
              }
            />
            <label>
              {t("কোন দেওয়া টাকা")}
              <AppSelect
                aria-label={t("কোন দেওয়া টাকা")}
                value={paymentId}
                disabled={saving || !ready || failed}
                onChange={(event) => {
                  update({
                    ...draft,
                    paymentId: event.target.value,
                    amounts: {},
                  });
                  setError("");
                }}
              >
                <option value="">{t("টাকা বেছে নিন")}</option>
                {payments.map((payment) => (
                  <option key={payment.entry.id} value={payment.entry.id}>
                    {[
                      payment.entry.date
                        ? date(payment.entry.date)
                        : t("তারিখ দেওয়া নেই"),
                      formatDigits(payment.entry.note),
                      money(payment.unallocated),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </option>
                ))}
              </AppSelect>
            </label>
            {choices.map((choice) => (
              <label key={choice.key}>
                {formatDigits(choice.name)}
                <small>
                  {t("লাগাতে পারি {{amount}}", {
                    amount: money(choice.available),
                  })}
                </small>
                <MoneyInput
                  aria-label={t("বিলে লাগাব: {{name}}", { name: choice.name })}
                  value={amounts[choice.key] ?? ""}
                  disabled={saving || !ready || failed}
                  onChange={(event) =>
                    update((current) => ({
                      ...current,
                      amounts: {
                        ...current.amounts,
                        [choice.key]: event.target.value,
                      },
                    }))
                  }
                />
              </label>
            ))}
            {payment && !choices.length ? (
              <p>{t("এই টাকার খাতা ও কাজের সঙ্গে মেলে এমন বিল নেই।")}</p>
            ) : null}
            <button
              type="submit"
              className="primary-button"
              disabled={
                saving || !ready || failed || !payment || !choices.length
              }
            >
              {t(saving ? "রাখছি…" : "বিলে লাগাই")}
            </button>
          </form>
        </details>
      ) : null}
    </section>
  );
}
