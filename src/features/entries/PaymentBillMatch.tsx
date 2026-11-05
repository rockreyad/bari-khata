import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import {
  allocatePayment,
  cancelPaymentAllocation,
  partyLedger,
} from "../../domain/partyLedger";
import { parseAmount } from "../../domain/ledger";
import { MoneyInput } from "../../components/ui/MoneyInput";
import { FormError } from "../../components/ui/FormError";
import { useInlineDraft } from "./useInlineDraft";

const MatchDraftSchema = z
  .object({
    version: z.literal(1),
    amounts: z
      .record(z.string().max(500), z.string().max(100))
      .refine((rows) => Object.keys(rows).length <= 1000),
    cancelling: z.string().min(1).max(160).nullable(),
    reason: z.string().max(2000),
    operationId: z.string().uuid().nullable(),
    recordedAt: z.string().datetime().nullable(),
  })
  .strict();
const emptyMatchDraft: z.infer<typeof MatchDraftSchema> = {
  version: 1,
  amounts: {},
  cancelling: null,
  reason: "",
  operationId: null,
  recordedAt: null,
};

export function PaymentBillMatch({ paymentId }: { paymentId: string }) {
  const { ledger, save, detail } = useNotebook();
  const { t, money, date, formatDigits } = useLanguageContext();
  const {
    value: draft,
    update,
    clear,
    ready,
    failed,
    flush,
  } = useInlineDraft(
    `payment-bill-match:${paymentId}`,
    MatchDraftSchema,
    emptyMatchDraft,
  );
  const { amounts, cancelling, reason } = draft;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const errorId = useId();
  const disabled = busy || !ready || failed;
  const entriesById = useMemo(
    () => new Map(ledger.entries.map((row) => [row.id, row])),
    [ledger.entries],
  );
  const worksById = useMemo(
    () => new Map(ledger.works.map((row) => [row.id, row])),
    [ledger.works],
  );
  const entry = entriesById.get(paymentId);
  const summary = useMemo(
    () =>
      entry?.kind === "payment" && entry.personId
        ? partyLedger(ledger, entry.personId)
        : null,
    [ledger, entry?.kind, entry?.personId],
  );
  const payment = summary?.payments.find((row) => row.id === paymentId);
  const choices = useMemo(
    () =>
      !summary || !entry || !payment
        ? []
        : summary.bills
            .filter(
              (bill) =>
                bill.entry.account === entry.account &&
                bill.entry.contractId === entry.contractId,
            )
            .flatMap((bill) =>
              bill.works
                .filter(
                  (work) =>
                    work.outstanding > 0 &&
                    payment.works.some(
                      (source) =>
                        source.workId === work.workId && source.available > 0,
                    ),
                )
                .map((work) => ({
                  bill,
                  work,
                  key: JSON.stringify([bill.entry.id, work.workId]),
                })),
            ),
    [summary, entry, payment],
  );
  if (
    !entry ||
    entry.kind !== "payment" ||
    !entry.personId ||
    entry.voided ||
    entry.balanceImpact !== "normal" ||
    !summary ||
    !payment
  )
    return null;
  const matches = summary.allocationHistory.filter(
    (row) => row.paymentId === paymentId,
  );
  const billName = (id: string) => {
    const bill = entriesById.get(id);
    return formatDigits(
      bill?.lines
        .map((line) => line.label)
        .filter(Boolean)
        .join(" · ") ||
        bill?.note ||
        t("বিল"),
    );
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || !ready || failed) return;
    setError("");
    try {
      const selected = choices.flatMap(({ bill, work, key }) =>
        amounts[key]?.trim()
          ? [
              {
                billId: bill.entry.id,
                workId: work.workId,
                amount: parseAmount(amounts[key]),
              },
            ]
          : [],
      );
      if (!selected.length || selected.some((row) => row.amount <= 0))
        throw new Error("amount");
      lock.current = true;
      setBusy(true);
      const operationId = draft.operationId ?? crypto.randomUUID();
      const recordedAt = draft.recordedAt ?? new Date().toISOString();
      update((current) => ({ ...current, operationId, recordedAt }));
      await flush();
      await save((current) =>
        allocatePayment(
          current,
          selected.map((row, index) => ({
            ...row,
            id: `${operationId}:${index}`,
            paymentId,
            createdAt: recordedAt,
          })),
        ),
      );
      try {
        await clear(emptyMatchDraft);
      } catch {
        setError(
          t(
            "মিল রাখা হয়েছে, তবে অসমাপ্ত লেখার কপিটি মুছতে পারিনি। আবার খুলে দেখুন।",
          ),
        );
      }
    } catch {
      setError(
        t(
          "বিলের বাকি ও এই দেওয়া টাকার মধ্যে সঠিক অঙ্ক লিখুন। খাতা বদলালে আবার দেখে নিন।",
        ),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function cancel() {
    if (lock.current || !cancelling || !ready || failed) return;
    if (!reason.trim()) {
      setError(t("কেন মিল বদলাচ্ছেন, ছোট করে লিখুন।"));
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await flush();
      await save((current) =>
        cancelPaymentAllocation(current, cancelling, reason),
      );
      try {
        await clear(emptyMatchDraft);
      } catch {
        setError(
          t(
            "মিল খুলে রাখা হয়েছে, তবে অসমাপ্ত লেখার কপিটি মুছতে পারিনি। আবার খুলে দেখুন।",
          ),
        );
      }
    } catch {
      setError(t("মিল বদলানো যায়নি। আবার দেখে চেষ্টা করুন।"));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <details className="detail-fold detail-payment-match">
      <summary>{t("কোন বিলে দেওয়া হয়েছিল")}</summary>
      <div className="detail-source">
        <p>
          {t("আগে দেওয়া টাকার সঙ্গে বিল মেলালে আবার টাকা দেওয়া বা খরচ হবে না।")}
        </p>
        <p>
          {t("এখনও বিলে লাগানো হয়নি: {{amount}}", {
            amount: money(payment.available),
          })}
        </p>
        {!ready && !failed ? <p>{t("আগের লেখা আনছি…")}</p> : null}
        <FormError
          id={errorId}
          message={
            failed
              ? t(
                  "অসমাপ্ত মিলের লেখা রাখা বা পড়া যায়নি। আবার খুলে চেষ্টা করুন।",
                )
              : error
          }
        />
        {matches.length ? (
          <ul>
            {matches.map((match) => (
              <li key={match.id}>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => detail(match.billId)}
                >
                  {billName(match.billId)}
                </button>
                <strong>{money(match.amount)}</strong>
                {match.cancelledAt ? (
                  <small>
                    {t("আগের মিল খুলেছি")} · {date(match.cancelledAt)} ·{" "}
                    {formatDigits(match.cancellationReason ?? "")}
                  </small>
                ) : (
                  <button
                    type="button"
                    className="text-button"
                    disabled={disabled}
                    onClick={() => {
                      update((current) => ({
                        ...current,
                        cancelling: match.id,
                        reason: "",
                      }));
                      setError("");
                    }}
                  >
                    {t("এই মিল বদলাই")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {cancelling ? (
          <div className="detail-match-cancel">
            <label>
              {t("কেন মিল বদলাচ্ছেন")}
              <textarea
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                value={reason}
                maxLength={2000}
                disabled={disabled}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))
                }
              />
            </label>
            <button
              type="button"
              disabled={disabled}
              onClick={() => void cancel()}
            >
              {t("মিল খুলে রাখি")}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={disabled}
              onClick={() =>
                update((current) => ({
                  ...current,
                  cancelling: null,
                  reason: "",
                }))
              }
            >
              {t("থাক")}
            </button>
          </div>
        ) : null}
        {payment.available > 0 && choices.length ? (
          <form onSubmit={(event) => void submit(event)}>
            {choices.map(({ bill, work, key }) => (
              <label key={key}>
                {billName(bill.entry.id)} ·{" "}
                {formatDigits(worksById.get(work.workId)?.name ?? "")}
                <small>
                  {t("বিলে বাকি {{amount}}", {
                    amount: money(work.outstanding),
                  })}
                </small>
                <MoneyInput
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? errorId : undefined}
                  aria-label={t("এই বিলে লাগাব: {{name}}", {
                    name: billName(bill.entry.id),
                  })}
                  value={amounts[key] ?? ""}
                  disabled={disabled}
                  onChange={(event) =>
                    update((current) => ({
                      ...current,
                      amounts: {
                        ...current.amounts,
                        [key]: event.target.value,
                      },
                      operationId: null,
                      recordedAt: null,
                    }))
                  }
                />
              </label>
            ))}
            <button
              type="submit"
              className="primary-button"
              disabled={disabled}
            >
              {t(busy ? "রাখছি…" : "এই বিলের সঙ্গে মিল রাখি")}
            </button>
          </form>
        ) : payment.available > 0 ? (
          <p>
            {t(
              "মেলানোর মতো যাচাই করা বিল পাওয়া যায়নি। আগে বিলের তথ্য দেখে নিন।",
            )}
          </p>
        ) : null}
      </div>
    </details>
  );
}
