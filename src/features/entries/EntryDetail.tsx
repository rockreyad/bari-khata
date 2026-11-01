import { useMemo, useState } from "react";
import {
  ArrowRightIcon,
  ArrowSquareOutIcon,
  ClockCounterClockwiseIcon,
  DotsThreeIcon,
  FileTextIcon,
  PencilSimpleIcon,
  ReceiptIcon,
  UserCircleIcon,
  WalletIcon,
} from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { Sheet } from "../../components/Sheet";
import { AppMenu } from "../../components/ui/AppMenu";
import { PaymentIcon } from "../../components/ui/Icons";
import { entryTotal, entryWorkIds, setEntryVoided } from "../../domain/ledger";
import type { Ledger } from "../../domain/model";
import { costNames, methodNames } from "../../lib/display";
import { createWorkspaceStorage } from "../../data/repository";
import {
  entryAudit,
  snapshotTotal,
  type AuditField,
  type EntrySnapshot,
} from "../history/audit";
import { entryKindLabels } from "../history/history";
import "../history/history.css";
import "../history/history-v4.css";
import "./entry-detail.css";
const auditLabels: Partial<Record<AuditField, string>> = {
  kind: "হিসাবের ধরন",
  date: "লেনদেনের তারিখ",
  note: "নোট",
  personId: "ব্যক্তি বা দোকান",
  account: "হিসাবের খাত",
  contractId: "ঠিক করা মজুরি",
  relatedEntryId: "যে বিলের টাকা",
  lines: "খরচের বিবরণ",
  allocations: "কাজে টাকার ভাগ",
  paymentParts: "টাকা দেওয়ার মাধ্যম",
  receipts: "ভাউচার",
  createdAt: "প্রথম লেখার সময়",
  voided: "হিসাবের অবস্থা",
  balanceImpact: "আগের খাতার হিসাব",
  reviewStatus: "তথ্য দেখা হয়েছে?",
  reviewReason: "তথ্য দেখার কারণ",
  source: "পুরোনো খাতার তথ্য",
  paymentPurposeId: "কিসের টাকা",
};
function SnapshotCard({
  snapshot,
  ledger,
}: {
  snapshot: EntrySnapshot;
  ledger: Ledger;
}) {
  const { t, money, date, formatDigits } = useLanguageContext();
  const person = ledger.people.find((p) => p.id === snapshot.personId);
  return (
    <div className="revision-snapshot-card">
      <div className="revision-snapshot-head">
        <strong>{money(snapshotTotal(snapshot))}</strong>
        <span>{t(entryKindLabels[snapshot.kind])}</span>
      </div>
      <div className="detail-v3-summary">
        <div>
          <span>{t("লেনদেনের তারিখ")}</span>
          <strong>{date(snapshot.date, { year: "numeric" })}</strong>
        </div>
        {person ? (
          <div>
            <span>{t("ব্যক্তি বা দোকান")}</span>
            <strong>{formatDigits(person.name)}</strong>
          </div>
        ) : null}
        <div>
          <span>{t("হিসাবের খাত")}</span>
          <strong>
            {t(
              snapshot.account === "labour"
                ? "মজুরি"
                : snapshot.account === "materials"
                  ? "মালের হিসাব"
                  : "অন্য হিসাব",
            )}
          </strong>
        </div>
        {snapshot.voided ? (
          <div>
            <span>{t("অবস্থা")}</span>
            <strong>{t("বাতিল")}</strong>
          </div>
        ) : null}
      </div>
      {snapshot.lines.map((line) => (
        <div className="detail-line" key={line.id}>
          <div>
            <strong>
              {formatDigits(
                line.label ||
                  ledger.items.find((i) => i.id === line.itemId)?.name ||
                  t(costNames[line.costType]),
              )}
            </strong>
            <small>
              {formatDigits(
                ledger.works.find((w) => w.id === line.workId)?.name ?? "",
              )}{" "}
              · {t(costNames[line.costType])}
            </small>
            {line.usage ? <small>{formatDigits(line.usage)}</small> : null}
            {line.quantity ? (
              <small>{formatDigits(`${line.quantity} ${line.unit}`)}</small>
            ) : null}
          </div>
          <strong>{money(line.amount)}</strong>
        </div>
      ))}
      {snapshot.allocations.map((allocation, index) => (
        <div className="amount-row" key={index}>
          <span>
            {formatDigits(
              ledger.works.find((w) => w.id === allocation.workId)?.name ?? "",
            )}
          </span>
          <strong>{money(allocation.amount)}</strong>
        </div>
      ))}
      {snapshot.paymentParts.map((part, index) => (
        <div className="amount-row" key={index}>
          <span>{t(methodNames[part.method])}</span>
          <strong>{money(part.amount)}</strong>
        </div>
      ))}
      {snapshot.note ? <p>{formatDigits(snapshot.note)}</p> : null}
      {snapshot.receipts.length ? (
        <p>
          {t("ভাউচার")}:{" "}
          {formatDigits(
            snapshot.receipts.map((receipt) => receipt.name).join(", "),
          )}
        </p>
      ) : null}
      {snapshot.source ? (
        <div className="detail-source">
          <p>
            {formatDigits(
              `${snapshot.source.file} · ${snapshot.source.sheet} · ${snapshot.source.cell}`,
            )}
          </p>
          <p>{formatDigits(snapshot.source.note)}</p>
        </div>
      ) : null}
    </div>
  );
}
export function EntryDetail({ id }: { id: string }) {
  const { ledger, mode, close, add, save, notify, go, detail } = useNotebook();
  const { t, money, date, language, formatDigits } = useLanguageContext();
  const storage = useMemo(() => createWorkspaceStorage(mode), [mode]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const entry = ledger.entries.find((e) => e.id === id);
  if (!entry) return null;
  const person = ledger.people.find((p) => p.id === entry.personId);
  const events = entryAudit(entry).filter(
    (event) => event.kind !== "created" && event.changes.length > 0,
  );
  const workIds = entryWorkIds(entry);
  const purpose = ledger.paymentPurposes.find(
    (value) => value.id === entry.paymentPurposeId,
  );
  const linked = ledger.entries
    .filter((row) => row.relatedEntryId === entry.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const linkedReturns = linked.some((row) => row.kind === "expense_credit");
  const linkedPaid = linked
    .filter((row) => !row.voided && row.kind === "payment")
    .reduce((sum, row) => sum + entryTotal(row), 0);
  const linkedRefund = linked
    .filter((row) => !row.voided && row.kind === "refund")
    .reduce((sum, row) => sum + entryTotal(row), 0);
  const amount = entryTotal(entry);
  const kind = entryKindLabels[entry.kind];
  const amountLabel =
    entry.kind === "expense"
      ? entry.account === "materials"
        ? "মালের বিল"
        : entry.account === "labour"
          ? "মজুরির বিল"
          : "খরচ"
      : kind;
  const relatedBill = ledger.entries.find(
    (row) => row.id === entry.relatedEntryId,
  );
  const showNote =
    entry.note &&
    !entry.lines.some((line) => line.label.trim() === entry.note.trim());
  const stamp = (value: string) => {
    const parsed = new Date(value);
    return value && Number.isFinite(parsed.getTime())
      ? new Intl.DateTimeFormat(language === "bn" ? "bn-BD" : "en-BD", {
          timeZone: "Asia/Dhaka",
          dateStyle: "medium",
          timeStyle: "short",
        }).format(parsed)
      : t("সময় লেখা নেই");
  };
  async function receipt(id: string, name: string) {
    try {
      const record = await storage.getReceipt(id);
      if (!record) throw new Error();
      const url = URL.createObjectURL(record.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      notify(t("ভাউচার এই ফোনে পাওয়া যায়নি। অনলাইনে সিঙ্ক করে দেখুন।"), true);
    }
  }
  function fieldText(field: AuditField, value: unknown): string {
    if (value === null || value === undefined || value === "")
      return t("লেখা নেই");
    if (field === "paymentPurposeId")
      return (
        ledger.paymentPurposes.find((purpose) => purpose.id === value)?.name ??
        t("লেখা নেই")
      );
    if (field === "date") return date(String(value), { year: "numeric" });
    if (field === "createdAt") return stamp(String(value));
    if (field === "personId")
      return (
        ledger.people.find((p) => p.id === value)?.name ?? t("নাম পাওয়া যায়নি")
      );
    if (field === "account")
      return t(
        value === "labour"
          ? "মজুরি"
          : value === "materials"
            ? "মালের হিসাব"
            : "অন্য হিসাব",
      );
    if (field === "kind")
      return t(
        entryKindLabels[value as keyof typeof entryKindLabels] ?? String(value),
      );
    if (field === "voided") return t(value ? "বাতিল" : "হিসাবে আছে");
    if (field === "reviewStatus")
      return t(value === "needs_review" ? "দেখে নেওয়া বাকি" : "দেখে নিয়েছি");
    if (field === "balanceImpact")
      return t(value === "historical" ? "আগের খাতার লেখা" : "এই অ্যাপে লেখা");
    if (field === "contractId")
      return (
        ledger.contracts.find((c) => c.id === value)?.title || t("মজুরির দর")
      );
    if (field === "relatedEntryId") {
      const related = ledger.entries.find((e) => e.id === value);
      return related?.lines[0]?.label ?? t("আগের বিল");
    }
    if (field === "lines")
      return (value as EntrySnapshot["lines"])
        .map((line) =>
          [
            line.label ||
              ledger.items.find((i) => i.id === line.itemId)?.name ||
              t(costNames[line.costType]),
            ledger.items.find((i) => i.id === line.itemId)?.brand,
            ledger.materialGroups.find(
              (g) =>
                g.id ===
                (line.materialGroupId ||
                  ledger.items.find((i) => i.id === line.itemId)
                    ?.materialGroupId),
            )?.name,
            t(costNames[line.costType]),
            money(line.amount),
            ledger.works.find((w) => w.id === line.workId)?.name,
            line.quantity ? `${line.quantity} ${line.unit}` : "",
            line.usage,
          ]
            .filter(Boolean)
            .join(" · "),
        )
        .join(" / ");
    if (field === "allocations")
      return (value as EntrySnapshot["allocations"])
        .map(
          (part) =>
            `${ledger.works.find((w) => w.id === part.workId)?.name ?? t("খাতা")} · ${money(part.amount)}`,
        )
        .join(" / ");
    if (field === "paymentParts")
      return (value as EntrySnapshot["paymentParts"])
        .map((part) => `${t(methodNames[part.method])} · ${money(part.amount)}`)
        .join(" / ");
    if (field === "receipts")
      return (
        (value as EntrySnapshot["receipts"])
          .map((file) => file.name)
          .join(" / ") || t("কোনো ভাউচার নেই")
      );
    if (field === "source") {
      const source = value as EntrySnapshot["source"];
      return source
        ? [source.file, source.sheet, source.cell, source.note]
            .filter(Boolean)
            .join(" · ")
        : t("লেখা নেই");
    }
    if (Array.isArray(value))
      return value.length ? String(value.length) : t("লেখা নেই");
    return String(value);
  }
  return (
    <Sheet
      title={t("লেনদেনের বিস্তারিত")}
      subtitle={date(entry.date, { year: "numeric" })}
      onClose={close}
      footer={
        <div className="detail-footer">
          <button
            className="secondary-button"
            onClick={() => add({ editId: entry.id })}
          >
            <PencilSimpleIcon size={18} />
            {t("সংশোধন করুন")}
          </button>
          <AppMenu
            trigger={
              <button className="secondary-button" aria-label={t("আরও")}>
                <DotsThreeIcon size={22} />
                {t("আরও")}
              </button>
            }
            items={[
              ...(person
                ? [
                    {
                      label: t("ব্যক্তি বা দোকানের পাতা"),
                      onSelect: () =>
                        go(
                          `/people/${encodeURIComponent(person.id)}?account=${entry.account}`,
                        ),
                    },
                    {
                      label: t("এই নামের সব হিসাব"),
                      onSelect: () =>
                        go(
                          `/ledger?person=${encodeURIComponent(person.id)}&account=${entry.account}&order=oldest`,
                        ),
                    },
                  ]
                : []),
              ...(workIds.length === 1
                ? [
                    {
                      label: t("এই খাতার সব হিসাব"),
                      onSelect: () =>
                        go(`/ledger?work=${encodeURIComponent(workIds[0])}`),
                    },
                  ]
                : []),
              ...(entry.reviewStatus === "needs_review"
                ? [
                    {
                      label: t("এই তথ্য ঠিক করি"),
                      onSelect: () =>
                        go(
                          `/review?q=${encodeURIComponent(entry.lines[0]?.label ?? entry.note)}`,
                        ),
                    },
                  ]
                : []),
              {
                separatorBefore: true,
                label: t(
                  entry.voided ? "হিসাবে ফিরিয়ে আনুন" : "হিসাব বাতিল করুন",
                ),
                danger: !entry.voided,
                onSelect: () => setConfirm(true),
              },
            ]}
          />
        </div>
      }
    >
      <div className="entry-detail detail-v3 transaction-detail-v5">
        <section
          className="entry-amount-card-v5"
          aria-label={t("টাকার পরিমাণ")}
        >
          <span className="entry-kind-v5">
            <ReceiptIcon size={17} weight="duotone" />
            {t(amountLabel)}
          </span>
          <strong>{money(amount)}</strong>
          {entry.voided ? (
            <span className="status-tag planned">{t("বাতিল")}</span>
          ) : null}
        </section>
        {person ? (
          <button
            className="entry-person-card-v5"
            aria-label={formatDigits(person.name)}
            onClick={() =>
              go(
                `/people/${encodeURIComponent(person.id)}?account=${entry.account}`,
              )
            }
          >
            <span className="entry-person-symbol-v5">
              <UserCircleIcon size={24} weight="duotone" />
            </span>
            <span>
              <small>
                {formatDigits(person.role || t("ব্যক্তি বা দোকান"))}
              </small>
              <strong>{formatDigits(person.name)}</strong>
            </span>
            <ArrowRightIcon size={18} />
          </button>
        ) : null}
        {purpose ? (
          <div className="detail-v3-summary">
            <div>
              <span>{t("কিসের টাকা")}</span>
              <strong>{formatDigits(purpose.name)}</strong>
            </div>
          </div>
        ) : null}
        {entry.lines.length ? (
          <section className="detail-v3-lines">
            {entry.lines.map((line) => {
              const item = ledger.items.find((i) => i.id === line.itemId);
              const group = ledger.materialGroups.find(
                (g) => g.id === (line.materialGroupId ?? item?.materialGroupId),
              );
              return (
                <div className="detail-line" key={line.id}>
                  <div>
                    <strong>
                      {formatDigits(
                        line.label || item?.name || t(costNames[line.costType]),
                      )}
                    </strong>
                    <small className="detail-line-context-v4">
                      <button
                        className="detail-entity-link-v4"
                        onClick={() =>
                          go(`/works/${encodeURIComponent(line.workId)}`)
                        }
                      >
                        {formatDigits(
                          ledger.works.find((w) => w.id === line.workId)
                            ?.name ?? "",
                        )}
                        <ArrowRightIcon size={13} />
                      </button>
                      <span>· {t(costNames[line.costType])}</span>
                    </small>
                    {item?.brand || line.usage || group ? (
                      <small>
                        {formatDigits(
                          [
                            ...new Set(
                              [item?.brand, line.usage, group?.name].filter(
                                Boolean,
                              ),
                            ),
                          ].join(" · "),
                        )}
                      </small>
                    ) : null}
                    {line.quantity ? (
                      <small>
                        {formatDigits(`${line.quantity} ${line.unit}`)}
                      </small>
                    ) : null}
                  </div>
                  {entry.lines.length > 1 ? (
                    <strong>{money(line.amount)}</strong>
                  ) : null}
                </div>
              );
            })}
          </section>
        ) : null}
        {entry.allocations.length ? (
          <div className="detail-v3-summary">
            {entry.allocations.map((part, index) => (
              <div key={index}>
                <button
                  className="detail-entity-link-v4"
                  onClick={() =>
                    go(`/works/${encodeURIComponent(part.workId)}`)
                  }
                >
                  {formatDigits(
                    ledger.works.find((w) => w.id === part.workId)?.name ?? "",
                  )}
                  <ArrowRightIcon size={14} />
                </button>
                {entry.allocations.length > 1 ? (
                  <strong>{money(part.amount)}</strong>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {entry.paymentParts.length ? (
          <div className="detail-v3-summary">
            {entry.paymentParts.map((part, index) => (
              <div key={index}>
                <span className="inline-label">
                  <PaymentIcon method={part.method} size={18} />
                  {t(methodNames[part.method])}
                </span>
                {entry.paymentParts.length > 1 ? (
                  <strong>{money(part.amount)}</strong>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {showNote ? (
          <p className="entry-note">{formatDigits(entry.note)}</p>
        ) : null}
        {linked.length ? (
          <details className="entry-payment-fold-v5">
            <summary>
              <WalletIcon size={21} weight="duotone" />
              <span>
                {t(
                  linkedReturns ? "বিলের লেনদেন" : "এই বিলের সঙ্গে রাখা পরিশোধ",
                )}
              </span>
              {!linkedReturns ? (
                <strong>{money(linkedPaid - linkedRefund)}</strong>
              ) : null}
              <span className="entry-fold-mark-v5" aria-hidden="true" />
            </summary>
            <div className="entry-payment-events-v5">
              {linked.map((row) => (
                <button
                  key={row.id}
                  className={`detail-linked-row ${row.voided ? "is-void" : ""}`}
                  onClick={() => detail(row.id)}
                >
                  <span>
                    <strong>
                      {t(entryKindLabels[row.kind])}
                      {row.voided ? ` · ${t("বাতিল")}` : ""}
                    </strong>
                    <small>
                      {[
                        row.date ? date(row.date, { year: "numeric" }) : "",
                        ...row.paymentParts.map((part) =>
                          t(methodNames[part.method]),
                        ),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </span>
                  <strong>{money(entryTotal(row))}</strong>
                  <ArrowRightIcon size={16} />
                </button>
              ))}
            </div>
          </details>
        ) : null}
        {relatedBill ? (
          <button
            className="entry-related-bill-v5"
            aria-label={`${t("মূল বিল")}: ${formatDigits(relatedBill.lines[0]?.label || t("খরচ"))}`}
            onClick={() => detail(relatedBill.id)}
          >
            <FileTextIcon size={20} weight="duotone" />
            <span>
              <small>{t("মূল বিল")}</small>
              <strong>
                {formatDigits(relatedBill.lines[0]?.label || t("খরচ"))}
              </strong>
            </span>
            <ArrowRightIcon size={16} />
          </button>
        ) : null}
        {entry.receipts.length ? (
          <details className="detail-fold" open>
            <summary>
              <ReceiptIcon size={19} weight="duotone" />
              {t("ভাউচার")}
            </summary>
            <section>
              {entry.receipts.map((file) => (
                <button
                  className="receipt-row"
                  key={file.id}
                  onClick={() => void receipt(file.id, file.name)}
                >
                  <ReceiptIcon size={20} />
                  <span>{formatDigits(file.name)}</span>
                  <ArrowSquareOutIcon size={17} />
                </button>
              ))}
            </section>
          </details>
        ) : null}
        {events.length ? (
          <details className="detail-fold">
            <summary>
              <ClockCounterClockwiseIcon size={19} />
              {t("কখন কী বদলেছে")}
            </summary>
            <div className="revision-timeline">
              {[...events].reverse().map((event) => (
                <article className="revision-event" key={event.id}>
                  <header className="revision-event-head">
                    <strong>
                      {t(
                        event.kind === "created"
                          ? entry.source
                            ? "পুরোনো খাতা থেকে এসেছে"
                            : "প্রথম লেখা হয়েছে"
                          : event.kind === "voided"
                            ? "হিসাব বাতিল করা হয়েছে"
                            : event.kind === "restored"
                              ? "আবার হিসাবে যোগ করা হয়েছে"
                              : "তথ্য বদলানো হয়েছে",
                      )}
                    </strong>
                    <time dateTime={event.at || undefined}>
                      {stamp(event.at)}
                    </time>
                  </header>
                  {event.before && event.changes.length ? (
                    <div className="revision-changes">
                      {snapshotTotal(event.before) !==
                      snapshotTotal(event.after) ? (
                        <div className="revision-change">
                          <span>{t("টাকার পরিমাণ")}</span>
                          <div className="revision-change-values">
                            <del>{money(snapshotTotal(event.before))}</del>
                            <ArrowRightIcon size={13} />
                            <ins>{money(snapshotTotal(event.after))}</ins>
                          </div>
                        </div>
                      ) : null}
                      {event.changes.map((change) => (
                        <div className="revision-change" key={change.field}>
                          <span>{t(auditLabels[change.field] ?? "তথ্য")}</span>
                          <div className="revision-change-values">
                            <del>
                              {formatDigits(
                                fieldText(change.field, change.before),
                              )}
                            </del>
                            <ArrowRightIcon size={13} />
                            <ins>
                              {formatDigits(
                                fieldText(change.field, change.after),
                              )}
                            </ins>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <details className="revision-snapshot">
                    <summary>{t("তখনকার পুরো হিসাব")}</summary>
                    <SnapshotCard snapshot={event.after} ledger={ledger} />
                  </details>
                </article>
              ))}
            </div>
          </details>
        ) : null}
        {entry.source ||
        entry.balanceImpact === "historical" ||
        entry.reviewStatus === "needs_review" ? (
          <details className="detail-fold">
            <summary>
              <FileTextIcon size={19} />
              {t(
                entry.source || entry.balanceImpact === "historical"
                  ? "পুরোনো খাতার তথ্য"
                  : "তথ্য যোগ করা বাকি",
              )}
            </summary>
            <div className="detail-source">
              {entry.source ? (
                <>
                  <p>
                    {formatDigits(
                      `${entry.source.file} · ${entry.source.sheet} · ${entry.source.cell}`,
                    )}
                  </p>
                  <p>{formatDigits(entry.source.note)}</p>
                </>
              ) : null}
              {entry.balanceImpact === "historical" ? (
                <p>
                  {t(
                    "এটি আগের খাতায় লেখা খরচ। কে কত পাবে, এই লেখা দিয়ে তা ধরে নেওয়া হয়নি।",
                  )}
                </p>
              ) : null}
              {entry.reviewStatus === "needs_review" ? (
                <button
                  className="detail-v3-review"
                  onClick={() => {
                    close();
                    go(
                      `/review?q=${encodeURIComponent(entry.lines[0]?.label ?? entry.note)}`,
                    );
                  }}
                >
                  {t("এই তথ্য দেখে নিন")}
                  <ArrowRightIcon size={16} />
                </button>
              ) : null}
            </div>
          </details>
        ) : null}
        {confirm ? (
          <div className="detail-void-confirm">
            <p>
              {t(
                entry.voided
                  ? "এই হিসাব আবার মোট খরচে যুক্ত হবে।"
                  : "বাতিল করলে মোট হিসাব থেকে বাদ যাবে। আগের তথ্য থাকবে।",
              )}
            </p>
            <div className="detail-footer">
              <button className="text-button" onClick={() => setConfirm(false)}>
                {t("ফিরে যাই")}
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await save((current) =>
                      setEntryVoided(current, entry.id, !entry.voided),
                    );
                    close();
                  } catch {
                    notify(t("বদলানো যায়নি। আবার চেষ্টা করুন।"), true);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("নিশ্চিত করুন")}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
