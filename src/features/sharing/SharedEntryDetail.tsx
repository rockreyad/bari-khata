import { useEffect, useRef, useState } from "react";
import { Sheet } from "../../components/Sheet";
import { useLanguageContext } from "../../context/LanguageProvider";
import {
  readSharedEntry,
  readSharedReceipt,
  type SharedEntry,
} from "./shareClient";

export type SharedEntryDetailProps = {
  token: string;
  entryId: string;
  revision: number;
  onClose: () => void;
  onUnavailable: () => void;
  onStale: () => void;
};
const kinds = {
  expense: "বিল",
  payment: "পরিশোধ",
  expense_credit: "মাল ফেরত",
  refund: "টাকা ফেরত",
  adjustment: "হিসাবের সমন্বয়",
};
const methods = {
  cash: "নগদ",
  bkash: "বিকাশ",
  bank: "ব্যাংক",
  other: "অন্য মাধ্যমে",
};
const basis = { paid: "পরিশোধ", cost: "বিলের মোট", balance: "বাকি" };
const allowed = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
type Preview = { id: string; url: string; name: string; mime: string };

export function SharedEntryDetail(props: SharedEntryDetailProps) {
  return (
    <Detail
      key={`${props.token}:${props.entryId}:${props.revision}`}
      {...props}
    />
  );
}
function Detail({
  token,
  entryId,
  revision,
  onClose,
  onUnavailable,
  onStale,
}: SharedEntryDetailProps) {
  const { t, money, date, formatDigits } = useLanguageContext();
  const [entry, setEntry] = useState<SharedEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [receiptError, setReceiptError] = useState("");
  const [receiptBusy, setReceiptBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const alive = useRef(false);
  const detailAbort = useRef<AbortController | null>(null);
  const receiptAbort = useRef<AbortController | null>(null);
  const receiptLock = useRef(false);
  const url = useRef<string | null>(null);
  const callbacks = useRef({ onClose, onUnavailable, onStale });
  callbacks.current = { onClose, onUnavailable, onStale };
  function revoke() {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
  }
  function stop() {
    alive.current = false;
    detailAbort.current?.abort();
    receiptAbort.current?.abort();
    revoke();
  }
  function current() {
    return alive.current && token === window.location.hash.slice(1);
  }
  function close() {
    stop();
    callbacks.current.onClose();
  }
  function unavailable(stale: boolean) {
    stop();
    setLoading(false);
    setEntry(null);
    setPreview(null);
    setError(
      t(
        stale
          ? "নতুন হিসাব এসেছে। হালনাগাদ করে আবার দেখুন।"
          : "লিংকটি এখন কাজ করছে না",
      ),
    );
    if (stale) callbacks.current.onStale();
    else callbacks.current.onUnavailable();
  }
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    detailAbort.current = controller;
    void readSharedEntry(token, entryId, revision, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!current() || controller.signal.aborted) return;
        if (!value) {
          unavailable(false);
          return;
        }
        if (value.revision !== revision || value.key !== entryId) {
          unavailable(true);
          return;
        }
        setEntry(value);
      })
      .catch((cause) => {
        if (!current() || controller.signal.aborted) return;
        if (cause instanceof Error && cause.message === "share_changed")
          unavailable(true);
        else if (
          cause instanceof Error &&
          cause.message === "share_unavailable"
        )
          unavailable(false);
        else setError(t("হিসাব খোলা যায়নি। বন্ধ করে আবার চেষ্টা করুন।"));
      })
      .finally(() => {
        if (current() && !controller.signal.aborted) setLoading(false);
      });
    const hash = () => {
      if (token !== window.location.hash.slice(1)) {
        stop();
        setEntry(null);
        setPreview(null);
        callbacks.current.onClose();
      }
    };
    window.addEventListener("hashchange", hash);
    return () => {
      stop();
      window.removeEventListener("hashchange", hash);
    };
  }, [token, entryId, revision]);
  async function openReceipt(receipt: SharedEntry["receipts"][number]) {
    if (!current() || receiptLock.current || !entry) return;
    receiptLock.current = true;
    setReceiptBusy(receipt.id);
    setReceiptError("");
    revoke();
    setPreview(null);
    const controller = new AbortController();
    receiptAbort.current = controller;
    try {
      const blob = await readSharedReceipt(
        token,
        entryId,
        receipt.id,
        revision,
        { signal: controller.signal },
      );
      if (!current() || controller.signal.aborted) return;
      if (
        !allowed.has(blob.type) ||
        blob.type !== receipt.mime ||
        blob.size !== receipt.size ||
        !blob.size ||
        blob.size > 10 * 1024 * 1024
      )
        throw new Error("share_receipt_failed");
      const next = URL.createObjectURL(blob);
      url.current = next;
      setPreview({
        id: receipt.id,
        url: next,
        name: receipt.name,
        mime: blob.type,
      });
    } catch (cause) {
      if (!current() || controller.signal.aborted) return;
      const code = cause instanceof Error ? cause.message : "";
      if (code === "share_changed") unavailable(true);
      else if (code === "share_unavailable") unavailable(false);
      else
        setReceiptError(
          t(
            code === "share_receipt_too_large"
              ? "ভাউচারটি অনেক বড়। যিনি পাঠিয়েছেন তাঁর কাছ থেকে নিন।"
              : "ভাউচার খোলা যায়নি। আবার চেষ্টা করুন।",
          ),
        );
    } finally {
      receiptLock.current = false;
      if (current()) setReceiptBusy(null);
    }
  }
  const amount =
    entry?.kind === "adjustment"
      ? (entry.adjustment ?? 0)
      : entry?.charge || entry?.paid || 0;
  return (
    <Sheet title={t("লেনদেনের বিস্তারিত")} onClose={close}>
      <div className="shared-entry-detail" aria-busy={loading}>
        {error ? (
          <p role="alert">{error}</p>
        ) : loading ? (
          <p role="status">{t("হিসাব আসছে…")}</p>
        ) : null}
        {entry ? (
          <>
            <header className="shared-detail-summary">
              <span>{t(kinds[entry.kind])}</span>
              <strong>
                {entry.kind !== "adjustment" && amount < 0 ? "−" : ""}
                {money(entry.kind === "adjustment" ? amount : Math.abs(amount))}
              </strong>
              {entry.adjustmentBasis ? (
                <small>{t(basis[entry.adjustmentBasis])}</small>
              ) : null}
              <time dateTime={entry.date ?? undefined}>
                {date(entry.date, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </time>
              {entry.works ? <p>{formatDigits(entry.works)}</p> : null}
              {entry.historical ? (
                <p>{t("পুরোনো তথ্য; বর্তমান হিসাবে ধরা হয়নি")}</p>
              ) : null}
            </header>
            {entry.description && !entry.lines.length ? (
              <section>
                <h3>{t("বিবরণ")}</h3>
                <p className="shared-full-text">
                  {formatDigits(entry.description)}
                </p>
              </section>
            ) : null}
            {entry.note && entry.note.trim() !== entry.description.trim() ? (
              <section>
                <h3>{t("নোট")}</h3>
                <p className="shared-full-text">{formatDigits(entry.note)}</p>
              </section>
            ) : null}
            {entry.paymentParts.length || entry.paymentMethods.length ? (
              <section>
                <h3>{t("পরিশোধের মাধ্যম")}</h3>
                <dl>
                  {entry.paymentParts.length
                    ? entry.paymentParts.map((part, index) => (
                        <div key={index}>
                          <dt>{t(methods[part.method])}</dt>
                          <dd>{money(part.amount)}</dd>
                        </div>
                      ))
                    : entry.paymentMethods.map((method) => (
                        <div key={method}>
                          <dt>{t(methods[method])}</dt>
                        </div>
                      ))}
                </dl>
              </section>
            ) : null}
            {entry.lines.length ? (
              <section>
                <h3>{t("বিলের বিবরণ")}</h3>
                <dl>
                  {entry.lines.map((line, index) => (
                    <div key={index}>
                      <dt>
                        {formatDigits(line.label)}
                        {line.workName ? (
                          <small>{formatDigits(line.workName)}</small>
                        ) : null}
                      </dt>
                      <dd>{money(line.amount)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}
            {entry.receipts.length ? (
              <section>
                <h3>{t("ছবি ও ভাউচার")}</h3>
                <div className="shared-detail-receipts">
                  {entry.receipts.map((receipt) => (
                    <button
                      key={receipt.id}
                      className="secondary-button"
                      type="button"
                      disabled={receiptBusy !== null}
                      onClick={() => void openReceipt(receipt)}
                      aria-label={`${t("ভাউচার দেখি")}: ${formatDigits(receipt.name)}`}
                    >
                      {receiptBusy === receipt.id
                        ? t("অপেক্ষা করুন…")
                        : formatDigits(receipt.name)}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
            {receiptError ? <p role="alert">{receiptError}</p> : null}
            {preview ? (
              <section className="shared-detail-preview">
                {preview.mime.startsWith("image/") ? (
                  <img src={preview.url} alt={formatDigits(preview.name)} />
                ) : null}
                <a
                  href={preview.url}
                  download={preview.name}
                  className="secondary-button"
                >
                  {t("ভাউচার নামান")}
                </a>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
