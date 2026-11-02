import { useLanguageContext } from "../../context/LanguageProvider";
import type { ReactNode } from "react";
import type { Ledger } from "../../domain/model";
import { workColorChoices, workIconChoices } from "../../components/ui/Icons";
import {
  canReviewProposal,
  proposalCommands,
  type AssistantProposal,
} from "./mcpClient";

const commandLabels: Record<string, string> = {
  create_purchase: "মাল কেনার হিসাব",
  create_cost: "খরচের হিসাব",
  record_wage: "মজুরির হিসাব",
  record_payment: "টাকা দেওয়ার হিসাব",
  record_advance: "অগ্রিম দেওয়ার হিসাব",
  record_procurement: "অন্যের কেনা মালের হিসাব",
  record_reimbursement: "কেনা মালের টাকা মেটানো",
  record_material_return: "মাল ফেরতের হিসাব",
  record_cash_refund: "টাকা ফেরত পাওয়ার হিসাব",
  update_entry: "হিসাব সংশোধন",
  void_entry: "হিসাব বাতিল",
  restore_entry: "হিসাব ফিরিয়ে আনা",
  create_person: "নতুন ব্যক্তি",
  create_work: "নতুন কাজের খাতা",
  create_contract: "নতুন কাজের চুক্তি",
  update_person: "ব্যক্তির তথ্য বদলানো",
  update_work: "কাজের খাতা বদলানো",
  update_contract: "চুক্তি বদলানো",
  archive_entity: "তথ্য সরিয়ে রাখা",
  restore_entity: "তথ্য ফিরিয়ে আনা",
  create_material_group: "মালের নতুন ধরন",
  update_material_group: "মালের ধরন বদলানো",
  create_item: "মালের নতুন নাম",
  update_item: "মালের তথ্য বদলানো",
  create_payment_purpose: "টাকা দেওয়ার নতুন কারণ",
  update_payment_purpose: "টাকা দেওয়ার কারণ বদলানো",
  attach_receipt: "ভাউচার জোড়া দেওয়া",
  detach_receipt: "ভাউচার আলাদা করা",
};
const entityActionLabels: Record<string, Record<string, string>> = {
  person: {
    archive_entity: "ব্যক্তি সরিয়ে রাখা",
    restore_entity: "ব্যক্তি ফিরিয়ে আনা",
  },
  work: {
    archive_entity: "কাজের খাতা সরিয়ে রাখা",
    restore_entity: "কাজের খাতা ফিরিয়ে আনা",
  },
  contract: {
    archive_entity: "চুক্তি সরিয়ে রাখা",
    restore_entity: "চুক্তি ফিরিয়ে আনা",
  },
};
const fieldLabels: Record<string, string> = {
  type: "কাজের ধরন",
  date: "তারিখ",
  note: "নোট",
  reason: "কারণ",
  person_id: "ব্যক্তি বা দোকান",
  personId: "ব্যক্তি বা দোকান",
  work_id: "কাজের খাতা",
  workId: "কাজের খাতা",
  entry_id: "আগের হিসাব",
  entryId: "আগের হিসাব",
  related_entry_id: "যে হিসাবের সঙ্গে যুক্ত",
  entity_type: "কিসের তথ্য",
  entity_id: "যার তথ্য",
  name: "নাম",
  label: "মালের নাম",
  lines: "বিলের মাল",
  amount_paisa: "টাকা",
  amountPaisa: "টাকা",
  amount: "টাকা",
  payment: "দেওয়া টাকা",
  payment_parts: "টাকা দেওয়ার ভাগ",
  refund: "ফেরত পাওয়া টাকা",
  payment_state: "পরিশোধের অবস্থা",
  paymentState: "পরিশোধের অবস্থা",
  method: "টাকা দেওয়ার মাধ্যম",
  quantity: "পরিমাণ",
  days: "কত দিন",
  basis: "হিসাবের নিয়ম",
  rate_paisa: "দর",
  unit: "একক",
  cost_type: "খরচের ধরন",
  account: "হিসাবের খাত",
  title: "নাম",
  total_paisa: "মোট টাকা",
  totalPaisa: "মোট টাকা",
  contract_id: "চুক্তি",
  contractId: "চুক্তি",
  changes: "যা বদলাবে",
  kind: "ধরন",
  phone: "ফোন নম্বর",
  role: "পরিচয়",
  description: "বিবরণ",
  notes: "নোট",
  scope: "কোন খাতার চুক্তি",
  brand: "ব্র্যান্ড",
  usage: "কোথায় লাগবে",
  aliases: "অন্য নাম",
  color: "রং",
  icon: "চিহ্ন",
  agreed_total_paisa: "ঠিক করা টাকা",
  allocation: "কাজে ভাগ",
  allocations: "কাজে ভাগ",
  item_id: "মাল",
  material_group_id: "মালের ধরন",
  payment_purpose_id: "টাকা দেওয়ার কারণ",
  receipt_id: "ভাউচার",
  expected_updated_at: "আগের পরিবর্তনের সময়",
  status: "কাজের অবস্থা",
  start_date: "শুরুর তারিখ",
  end_date: "শেষের তারিখ",
  started_on: "শুরুর তারিখ",
  completed_on: "শেষের তারিখ",
  agreed_on: "চুক্তির তারিখ",
};
const valueLabels: Record<string, string> = {
  material: "মালামাল",
  materials: "মালামাল",
  labour: "মজুরি",
  transport: "গাড়িভাড়া",
  unload: "মাল নামানো",
  rental: "ভাড়া",
  other: "অন্যান্য",
  paid: "পুরো টাকা দেওয়া হয়েছে",
  partial: "কিছু টাকা দেওয়া হয়েছে",
  unpaid: "এখন টাকা দেওয়া হয়নি",
  cash: "নগদ",
  bkash: "বিকাশ",
  bank: "ব্যাংক",
  worker: "মিস্ত্রি",
  shop: "দোকান",
  driver: "গাড়িওয়ালা",
  person: "ব্যক্তি",
  work: "কাজের খাতা",
  contract: "চুক্তি",
  house: "পুরো বাড়ি",
  planned: "শুরু হয়নি",
  ongoing: "চলছে",
  done: "শেষ হয়েছে",
  sqft: "বর্গফুট ধরে",
  day: "দিন ধরে",
  fixed: "মোট টাকা ধরে",
  total: "মোট টাকা ধরে",
};

export function AssistantProposalDetails({
  proposal,
  ledger,
}: {
  proposal: AssistantProposal;
  ledger: Ledger;
}) {
  const { t, money, date, number, formatDigits } = useLanguageContext();
  function show(
    value: unknown,
    key = "",
    depth = 0,
    fields: Record<string, unknown> = {},
  ): ReactNode {
    if (depth > 6 || value === undefined || value === null) return null;
    if (typeof value === "string") {
      const referenceType =
        key === "entity_id"
          ? fields.entity_type
          : ["person_id", "personId"].includes(key)
            ? "person"
            : ["work_id", "workId"].includes(key)
              ? "work"
              : ["contract_id", "contractId"].includes(key)
                ? "contract"
                : null;
      if (referenceType === "person")
        return formatDigits(
          ledger.people.find((person) => person.id === value)?.name ??
            t("এই ব্যক্তি এই ফোনের খাতায় পাওয়া যায়নি"),
        );
      if (referenceType === "work")
        return formatDigits(
          ledger.works.find((work) => work.id === value)?.name ??
            t("এই কাজের খাতা এই ফোনে পাওয়া যায়নি"),
        );
      if (referenceType === "contract") {
        const contract = ledger.contracts.find((item) => item.id === value);
        if (!contract) return t("এই চুক্তি এই ফোনের খাতায় পাওয়া যায়নি");
        const person = ledger.people.find(
          (item) => item.id === contract.personId,
        );
        return formatDigits(
          contract.title ||
            (person
              ? t("{{name}}-এর চুক্তি", { name: person.name })
              : t("নাম দেওয়া হয়নি এমন চুক্তি")),
        );
      }
      if (key === "entity_id") return t("কোন তথ্য বোঝানো হয়েছে জানা নেই");
      if (["entry_id", "entryId", "related_entry_id"].includes(key)) {
        const entry = ledger.entries.find((item) => item.id === value);
        return entry
          ? formatDigits(
              entry.note || t("{{date}}-এর হিসাব", { date: date(entry.date) }),
            )
          : t("এই হিসাব এই ফোনের খাতায় পাওয়া যায়নি");
      }
      if (key === "date" || key.endsWith("_date") || key.endsWith("_on"))
        return date(value);
      if (key === "item_id")
        return formatDigits(
          ledger.items.find((item) => item.id === value)?.name ??
            t("এই মাল এই ফোনের খাতায় পাওয়া যায়নি"),
        );
      if (key === "material_group_id")
        return formatDigits(
          ledger.materialGroups.find((group) => group.id === value)?.name ??
            t("মালের এই ধরন এই ফোনের খাতায় পাওয়া যায়নি"),
        );
      if (key === "payment_purpose_id")
        return formatDigits(
          ledger.paymentPurposes.find((purpose) => purpose.id === value)
            ?.name ?? t("টাকা দেওয়ার এই কারণ এই ফোনের খাতায় পাওয়া যায়নি"),
        );
      if (key === "receipt_id")
        return formatDigits(
          ledger.entries
            .flatMap((entry) => entry.receipts)
            .find((receipt) => receipt.id === value)?.name ??
            t("এই ভাউচার এই ফোনের খাতায় পাওয়া যায়নি"),
        );
      if (key === "type")
        return t(
          (typeof fields.entity_type === "string"
            ? entityActionLabels[fields.entity_type]?.[value]
            : undefined) ??
            commandLabels[value] ??
            "কাজের ধরন জানা নেই",
        );
      if (key === "color" || key === "icon") {
        const choices = key === "color" ? workColorChoices : workIconChoices;
        return t(
          choices.find((choice) => choice.id === value)?.label ?? "অন্য পছন্দ",
        );
      }
      if (
        [
          "account",
          "cost_type",
          "method",
          "payment_state",
          "kind",
          "status",
          "scope",
          "basis",
          "entity_type",
        ].includes(key)
      )
        return t(valueLabels[value] ?? "ধরন জানা নেই");
      return formatDigits(value);
    }
    if (typeof value === "number")
      return /(?:paisa|Paisa)$/.test(key) || key === "amount"
        ? money(value)
        : number(value);
    if (typeof value === "boolean") return t(value ? "হ্যাঁ" : "না");
    if (Array.isArray(value))
      return (
        <ul className="assistant-proposal-fields">
          {value.map((item, index) => (
            <li key={index}>{show(item, key, depth + 1, fields)}</li>
          ))}
        </ul>
      );
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      const details = ["archive_entity", "restore_entity"].includes(
        String(record.type),
      )
        ? {
            ...record,
            entity_type: record.entity_type ?? "",
            entity_id: record.entity_id ?? "",
          }
        : record;
      return (
        <dl className="assistant-proposal-fields">
          {Object.entries(details)
            .filter(
              ([name]) =>
                ![
                  "provenance",
                  "source_event_id",
                  "expected_revision",
                  "receipt_ids",
                  "expected_updated_at",
                  "id",
                ].includes(name),
            )
            .map(([name, item]) => (
              <div key={name}>
                <dt>{t(fieldLabels[name] ?? "অন্য তথ্য")}</dt>
                <dd>{show(item, name, depth + 1, details)}</dd>
              </div>
            ))}
        </dl>
      );
    }
    return null;
  }
  const commands = proposalCommands(proposal);
  return (
    <>
      <h3>{proposal.summary ? t(proposal.summary) : t("সহকারীর প্রস্তাব")}</h3>
      {proposal.actorName ? (
        <p className="assistant-muted">
          {t("সহকারী: {{name}}", { name: proposal.actorName })}
        </p>
      ) : null}
      {commands.map((command, index) => (
        <div key={index}>{show(command)}</div>
      ))}
      {proposal.result?.before && proposal.result.after ? (
        <div className="assistant-impact">
          <h4>{t("অনলাইনের হিসাবে যা বদলাবে")}</h4>
          <table>
            <thead>
              <tr>
                <th>{t("হিসাব")}</th>
                <th>{t("আগে")}</th>
                <th>{t("পরে")}</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["cost_paisa", "মোট খরচ"],
                  ["paid_paisa", "এ পর্যন্ত দিয়েছি"],
                  ["payable_paisa", "দিতে হবে"],
                  ["advance_paisa", "অগ্রিম"],
                ] as const
              ).map(([key, label]) => (
                <tr key={key}>
                  <th>{t(label)}</th>
                  <td>
                    {typeof proposal.result!.before![key] === "number"
                      ? money(proposal.result!.before![key])
                      : t("জানা নেই")}
                  </td>
                  <td>
                    {typeof proposal.result!.after![key] === "number"
                      ? money(proposal.result!.after![key])
                      : t("জানা নেই")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {!canReviewProposal(proposal) ? (
        <p className="assistant-error">
          {t("এই প্রস্তাবের পুরো বিবরণ নেই। সহকারীকে নতুন করে দেখতে বলুন।")}
        </p>
      ) : null}
      {proposal.expiresAt ? (
        <p className="assistant-muted">
          {t("অনুমোদনের সময় শেষ: {{date}}", {
            date: date(proposal.expiresAt, {
              hour: "numeric",
              minute: "2-digit",
            }),
          })}
        </p>
      ) : null}
    </>
  );
}
