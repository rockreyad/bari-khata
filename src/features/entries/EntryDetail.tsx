import { useMemo, useRef, useState } from "react";
import {
  ArrowRightIcon,
  ArrowsLeftRightIcon,
  ArrowSquareOutIcon,
  ClockCounterClockwiseIcon,
  DotsThreeIcon,
  FileTextIcon,
  PencilSimpleIcon,
  ReceiptIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { ConfirmationDialog } from "../../components/ui/ConfirmationDialog";
import { Sheet } from "../../components/Sheet";
import { AppMenu } from "../../components/ui/AppMenu";
import { PaymentIcon } from "../../components/ui/Icons";
import { entryTotal, entryWorkIds, setEntryVoided } from "../../domain/ledger";
import { paidPurchasePayment } from "../../domain/paidPurchaseEdit";
import { type EntryProvenance } from "../../domain/model";
import { costNames, methodNames } from "../../lib/display";
import { createWorkspaceStorage } from "../../data/repository";
import { entryAudit, type EntrySnapshot } from "../history/audit";
import {
  entryDisplayChanges,
  type EntryChangeField,
  type EntryDisplayChange,
} from "../history/entryChanges";
import { entryKindLabels } from "../history/history";
import { adjustmentBasisLabels } from "../history/adjustmentDisplay";
import "../history/history.css";
import "../history/history-v4.css";
import "./entry-detail.css";
import { PaymentBillMatch } from "./PaymentBillMatch";
const auditLabels: Partial<Record<EntryChangeField, string>> = {
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
  provenance: "যে সহকারী লিখেছে",
  amount: "টাকার পরিমাণ",
  workId: "কাজের খাতা",
  label: "মালের নাম",
  itemId: "মালের নাম",
  materialGroupId: "মালের ধরন",
  costType: "খরচের ধরন",
  quantity: "পরিমাণ",
  usage: "ব্যবহার",
  method: "টাকা দেওয়ার মাধ্যম",
  receiptName: "ভাউচার",
  "source.file": "মূল ফাইল",
  "source.sheet": "পাতা",
  "source.cell": "ঘর",
  "source.note": "পুরোনো খাতার নোট",
  "source.ledger": "পুরোনো খাতা",
  "provenance.actorName": "যে সহকারী লিখেছে",
  "provenance.origin": "যেভাবে লেখা হয়েছে",
  "provenance.reason": "কারণ",
  correctionReason: "হিসাব মেলানোর কারণ",
  "adjustment.before": "আগের হিসাব",
  "adjustment.after": "নতুন হিসাব",
  "adjustment.delta": "সমন্বয়ের অঙ্ক",
};
const operationLabels = {
  lines: { added: "খরচ যোগ হয়েছে", removed: "খরচ বাদ গেছে" },
  allocations: { added: "টাকার ভাগ যোগ হয়েছে", removed: "টাকার ভাগ বাদ গেছে" },
  paymentParts: {
    added: "টাকার মাধ্যম যোগ হয়েছে",
    removed: "টাকার মাধ্যম বাদ গেছে",
  },
  receipts: { added: "ভাউচার যোগ হয়েছে", removed: "ভাউচার বাদ গেছে" },
} as const;
const originLabels: Record<EntryProvenance["origin"], string> = {
  text: "লেখা নির্দেশ থেকে",
  image: "ছবির তথ্য থেকে",
  voice: "ভয়েসের নির্দেশ থেকে",
};
const referenceFields = new Set<EntryChangeField>([
  "personId",
  "workId",
  "itemId",
  "materialGroupId",
  "contractId",
  "relatedEntryId",
  "paymentPurposeId",
]);
function AssistantSource({ source }: { source: EntryProvenance }) {
  const { t, date, formatDigits } = useLanguageContext();
  return (
    <section className="detail-source" aria-label={t("সহকারীর লেখা")}>
      <p>
        <strong>{t("সহকারী: {{name}}", { name: source.actorName })}</strong>
      </p>
      <p>{t(originLabels[source.origin])}</p>
      <small>
        <time dateTime={source.recordedAt}>
          {date(source.recordedAt, {
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </time>
      </small>
      {source.reason ? (
        <p>{t("কারণ: {{reason}}", { reason: formatDigits(source.reason) })}</p>
      ) : null}
    </section>
  );
}
export function EntryDetail({ id }: { id: string }) {
  const { ledger, mode, close, add, save, notify, go, detail } = useNotebook();
  const { t, money, date, language, formatDigits } = useLanguageContext();
  const storage = useMemo(() => createWorkspaceStorage(mode), [mode]);
  const [confirm, setConfirm] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const entry = ledger.entries.find((e) => e.id === id);
  if (!entry) return null;
  const person = ledger.people.find((p) => p.id === entry.personId);
  const workIds = entryWorkIds(entry);
  const openMissingInformation = () => {
    if (
      !entry.voided &&
      entry.source &&
      entry.balanceImpact === "historical" &&
      (entry.kind === "expense" || entry.kind === "expense_credit")
    ) {
      close();
      go(
        `/review?q=${encodeURIComponent(entry.lines[0]?.label ?? entry.note)}`,
      );
    } else add({ editId: entry.id });
  };
  const purpose = ledger.paymentPurposes.find(
    (value) => value.id === entry.paymentPurposeId,
  );
  const linked = ledger.entries
    .filter((row) => row.relatedEntryId === entry.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const linkedReturns = linked.some((row) => row.kind === "expense_credit");
  const linkedRefunds = linked.some((row) => row.kind === "refund");
  const purchasePayment = paidPurchasePayment(ledger, entry.id);
  const linkedPaid = linked
    .filter((row) => !row.voided && row.kind === "payment")
    .reduce((sum, row) => sum + entryTotal(row), 0);
  const linkedRefund = linked
    .filter((row) => !row.voided && row.kind === "refund")
    .reduce((sum, row) => sum + entryTotal(row), 0);
  const amount = entryTotal(entry);
  const adjustment = entry.kind === "adjustment" ? entry.adjustment : null;
  const balanceText = (value: number) =>
    value === 0
      ? t("বাকি নেই")
      : `${t(value < 0 ? "আমার জমা" : "বাকি")} ${money(Math.abs(value))}`;
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
      ? formatDigits(
          new Intl.DateTimeFormat(language === "bn" ? "bn-BD" : "en-BD", {
            timeZone: "Asia/Dhaka",
            dateStyle: "medium",
            timeStyle: "short",
          }).format(parsed),
        )
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
  function fieldText(
    field: EntryChangeField,
    value: unknown,
    context = false,
  ): string {
    if (field === "correctionReason") return value == null ? "" : String(value);
    if (value === null || value === undefined || value === "")
      return t("লেখা নেই");
    if (field === "paymentPurposeId") {
      const purpose = ledger.paymentPurposes.find((row) => row.id === value);
      return purpose
        ? [purpose.name, context ? fieldText("account", purpose.account) : ""]
            .filter(Boolean)
            .join(" · ")
        : t("লেখা নেই");
    }
    if (field === "date") return date(String(value), { year: "numeric" });
    if (field === "amount") return money(Number(value));
    if (field === "adjustment.before" || field === "adjustment.after")
      return balanceText(Number(value));
    if (field === "adjustment.delta") return money(Number(value));
    if (field === "workId") {
      const work = ledger.works.find((row) => row.id === value);
      return work
        ? [work.name, context ? work.description : ""]
            .filter(Boolean)
            .join(" · ")
        : t("লেখা নেই");
    }
    if (field === "itemId") {
      const item = ledger.items.find((item) => item.id === value);
      return item
        ? [
            item.name,
            item.brand,
            context ? item.unit : "",
            context ? item.usage : "",
          ]
            .filter(Boolean)
            .join(" · ")
        : t("লেখা নেই");
    }
    if (field === "materialGroupId") {
      const group = ledger.materialGroups.find((row) => row.id === value);
      return group
        ? [group.name, context ? group.aliases.join(" · ") : ""]
            .filter(Boolean)
            .join(" · ")
        : t("লেখা নেই");
    }
    if (field === "costType")
      return t(costNames[value as keyof typeof costNames] ?? String(value));
    if (field === "method")
      return t(methodNames[value as keyof typeof methodNames] ?? String(value));
    if (field === "provenance.origin")
      return t(
        originLabels[value as EntryProvenance["origin"]] ?? String(value),
      );
    if (field === "createdAt") return stamp(String(value));
    if (field === "personId") {
      const person = ledger.people.find((row) => row.id === value);
      return person
        ? [person.name, context ? person.role : "", context ? person.phone : ""]
            .filter(Boolean)
            .join(" · ")
        : t("নাম পাওয়া যায়নি");
    }
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
    if (field === "contractId") {
      const contract = ledger.contracts.find((row) => row.id === value);
      if (!contract) return t("মজুরির দর");
      return [
        contract.title || t("মজুরির দর"),
        ...(context
          ? [
              fieldText("personId", contract.personId),
              contract.workId
                ? fieldText("workId", contract.workId)
                : t("পুরো বাড়ি"),
              money(contract.total),
            ]
          : []),
      ]
        .filter(Boolean)
        .join(" · ");
    }
    if (field === "relatedEntryId") {
      const related = ledger.entries.find((e) => e.id === value);
      return related
        ? [
            related.lines[0]?.label || t("আগের বিল"),
            ...(context
              ? [
                  date(related.date, { year: "numeric" }),
                  money(entryTotal(related)),
                  related.personId
                    ? fieldText("personId", related.personId)
                    : "",
                  ...entryWorkIds(related).map((id) => fieldText("workId", id)),
                ]
              : []),
          ]
            .filter(Boolean)
            .join(" · ")
        : t("আগের বিল");
    }
    return String(value);
  }
  const lineName = (line: EntrySnapshot["lines"][number]) =>
    line.label ||
    ledger.items.find((item) => item.id === line.itemId)?.name ||
    t(costNames[line.costType]);
  function changeValue(change: EntryDisplayChange, value: unknown) {
    if (change.format && value == null) return "";
    if (change.format === "line") {
      const line = value as EntrySnapshot["lines"][number];
      return [
        lineName(line),
        change.context?.workId ? fieldText("workId", line.workId) : "",
        money(line.amount),
      ]
        .filter(Boolean)
        .join(" · ");
    }
    if (change.format === "allocation") {
      const part = value as EntrySnapshot["allocations"][number];
      return `${fieldText("workId", part.workId)} · ${money(part.amount)}`;
    }
    if (change.format === "payment") {
      const part = value as EntrySnapshot["paymentParts"][number];
      return `${t(methodNames[part.method])} · ${money(part.amount)}`;
    }
    if (change.format === "receipt")
      return (value as EntrySnapshot["receipts"][number]).name;
    return fieldText(change.field, value);
  }
  function changeLabel(change: EntryDisplayChange) {
    if (change.operation && change.field in operationLabels)
      return t(
        operationLabels[change.field as keyof typeof operationLabels][
          change.operation
        ],
      );
    const context = change.context?.line
      ? lineName(change.context.line)
      : change.context?.workId
        ? fieldText("workId", change.context.workId)
        : change.context?.method
          ? t(methodNames[change.context.method])
          : "";
    if (context && change.field === "amount") return formatDigits(context);
    const label = t(auditLabels[change.field] ?? "তথ্য");
    return context ? `${formatDigits(context)} · ${label}` : label;
  }
  const events = entryAudit(entry)
    .filter((event) => event.kind !== "created" && event.before)
    .map((event) => ({
      ...event,
      changes: entryDisplayChanges(event.before!, event.after)
        .map((change) => {
          let before = formatDigits(changeValue(change, change.before));
          let after = formatDigits(changeValue(change, change.after));
          if (before === after && referenceFields.has(change.field)) {
            before = formatDigits(fieldText(change.field, change.before, true));
            after = formatDigits(fieldText(change.field, change.after, true));
            if (before === after) {
              before = "";
              after = t("নতুনটি বেছে নেওয়া হয়েছে");
            }
          }
          return { key: change.key, label: changeLabel(change), before, after };
        })
        .filter((change) => change.before !== change.after),
    }))
    .filter((event) => event.changes.length > 0);
  return (
    <Sheet
      title={t("লেনদেনের বিস্তারিত")}
      subtitle={date(entry.date, { year: "numeric" })}
      onClose={close}
      footer={
        <div className="detail-footer">
          {entry.kind !== "adjustment" ? (
            <button
              className="secondary-button"
              onClick={() => add({ editId: entry.id })}
            >
              <PencilSimpleIcon size={18} />
              {t("সংশোধন করুন")}
            </button>
          ) : null}
          <AppMenu
            trigger={
              <button
                className="secondary-button"
                aria-label={t("আরও")}
                ref={moreButton}
              >
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
                      onSelect: openMissingInformation,
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
          className={`entry-amount-card-v5${entry.voided ? " is-void" : ""}`}
          data-kind={entry.kind}
          aria-label={t("টাকার পরিমাণ")}
        >
          <span className="entry-kind-v5">
            {adjustment ? (
              <ArrowsLeftRightIcon size={17} />
            ) : (
              <ReceiptIcon size={17} weight="duotone" />
            )}
            {t(amountLabel)}
            {adjustment
              ? ` · ${t(adjustmentBasisLabels[adjustment.basis])}`
              : ""}
          </span>
          <strong>{money(adjustment?.delta ?? amount)}</strong>
          {entry.voided ? (
            <span className="status-tag voided">{t("বাতিল")}</span>
          ) : null}
        </section>
        {adjustment ? (
          <>
            <div className="detail-v3-summary entry-adjustment-summary">
              <div>
                <span>{t("আগের অঙ্ক")}</span>
                <strong>
                  {adjustment.basis === "balance"
                    ? balanceText(adjustment.before)
                    : money(adjustment.before)}
                </strong>
              </div>
              <div>
                <span>{t("নতুন অঙ্ক")}</span>
                <strong>
                  {adjustment.basis === "balance"
                    ? balanceText(adjustment.after)
                    : money(adjustment.after)}
                </strong>
              </div>
              <div>
                <span>{t("হিসাবের খাত")}</span>
                <strong>
                  {adjustment.account
                    ? fieldText("account", adjustment.account)
                    : t("সব হিসাব")}
                </strong>
              </div>
              <div>
                <span>{t("কাজের খাতা")}</span>
                <strong>
                  {adjustment.workId
                    ? fieldText("workId", adjustment.workId)
                    : t("সব খাতা")}
                </strong>
              </div>
            </div>
            <p className="helper-text">
              {t("আগের বিল বা টাকা দেওয়ার তথ্য বদলায়নি।")}
            </p>
          </>
        ) : null}
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
          <p className="entry-note">
            {adjustment
              ? t("কারণ: {{reason}}", { reason: formatDigits(entry.note) })
              : formatDigits(entry.note)}
          </p>
        ) : null}
        {purchasePayment ? (
          <button
            type="button"
            className="entry-paid-status-v5"
            aria-label={t("পরিশোধের বিস্তারিত")}
            aria-description={`${t("দিয়েছি {{amount}}", { amount: money(entryTotal(purchasePayment)) })} · ${balanceText(amount - entryTotal(purchasePayment))}`}
            onClick={() => detail(purchasePayment.id)}
          >
            <span className="entry-paid-status-copy-v5">
              <span>
                {t("দিয়েছি")}{" "}
                <strong>{money(entryTotal(purchasePayment))}</strong>
              </span>
              <small>{balanceText(amount - entryTotal(purchasePayment))}</small>
            </span>
            <ArrowRightIcon size={16} aria-hidden="true" />
          </button>
        ) : linked.length ? (
          <details className="entry-payment-fold-v5">
            <summary>
              <span>
                {t(
                  linkedReturns || linkedRefunds
                    ? "পরিশোধ ও ফেরত"
                    : "পরিশোধের ইতিহাস",
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
                  data-kind={row.kind}
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
        {entry.provenance ? (
          <AssistantSource source={entry.provenance} />
        ) : null}
        {events.length ? (
          <details className="detail-fold">
            <summary>
              <ClockCounterClockwiseIcon size={19} />
              {t("কখন কী বদলেছে")}
            </summary>
            <ol className="entry-revision-list">
              {[...events].reverse().map((event) => (
                <li className="entry-revision" key={event.id}>
                  <time dateTime={event.at || undefined}>
                    {stamp(event.at)}
                  </time>
                  <dl className="entry-revision-changes">
                    {event.changes.map((change) => (
                      <div className="entry-revision-change" key={change.key}>
                        <dt>{change.label}</dt>
                        <dd>
                          {change.before ? <del>{change.before}</del> : null}
                          {change.before && change.after ? (
                            <ArrowRightIcon size={12} aria-hidden="true" />
                          ) : null}
                          {change.after ? <ins>{change.after}</ins> : null}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ol>
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
                  onClick={openMissingInformation}
                >
                  {t("এই তথ্য দেখে নিন")}
                  <ArrowRightIcon size={16} />
                </button>
              ) : null}
            </div>
          </details>
        ) : null}
        {entry.kind === "payment" ? (
          <PaymentBillMatch key={entry.id} paymentId={entry.id} />
        ) : null}
        {confirm ? (
          <ConfirmationDialog
            title={t(entry.voided ? "হিসাবটি ফেরাবেন?" : "হিসাবটি বাদ দেবেন?")}
            description={t(
              entry.voided
                ? "আবার মোট হিসাবে যোগ হবে।"
                : "মোট হিসাব থেকে সরবে।",
            )}
            confirmLabel={t(
              entry.voided ? "হিসাবে ফিরিয়ে আনুন" : "হিসাব বাদ দিন",
            )}
            danger={!entry.voided}
            busy={busy}
            returnFocusRef={moreButton}
            onClose={() => setConfirm(false)}
            onConfirm={async () => {
              setBusy(true);
              try {
                await save((current) =>
                  setEntryVoided(current, entry.id, !entry.voided),
                );
                setConfirm(false);
                close();
              } catch {
                notify(t("বদলানো যায়নি। আবার চেষ্টা করুন।"), true);
                throw new Error("entry_change_failed");
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : null}
      </div>
    </Sheet>
  );
}
