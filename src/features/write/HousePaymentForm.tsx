import { useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { z } from "zod";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { EntryFrame } from "../../components/EntryFrame";
import { MoneyInput } from "../../components/ui/MoneyInput";
import { AppSelect } from "../../components/ui/AppSelect";
import { AppDatePicker } from "../../components/ui/AppDatePicker";
import { FormError } from "../../components/ui/FormError";
import { AccountSchema, PersonSchema } from "../../domain/model";
import { parseAmount } from "../../domain/ledger";
import { partyLedger } from "../../domain/partyLedger";
import {
  planHousePayment,
  recordHousePayment,
  type HousePaymentRequest,
  type HousePaymentIssue,
} from "../../domain/housePayments";
import { todayDhaka } from "../../lib/display";
import { moneyInputValue } from "../../lib/numericFields";
import { useInlineDraft } from "../entries/useInlineDraft";
import { QuickSavedDraftSchema } from "../entries/quickEntry";
import { HouseSavedNotice } from "./HouseSavedNotice";
import { HouseAttachments } from "./HouseAttachments";

const PaymentDraftSchema = z.object({
  id: z.string().min(1).max(150),
  personId: z.string().max(160),
  personName: z.string().max(200).default(""),
  newPersonId: z.string().max(160).default(""),
  amount: z.string().max(60),
  workId: z.string().max(160),
  account: z.union([AccountSchema, z.literal("")]),
  contractId: z.string().max(160),
  intent: z.enum(["settlement", "advance", "receivable"]),
  date: z.string().max(10),
  method: z.enum(["cash", "bkash", "bank", "other"]),
  note: z.string().max(10000),
  allocations: z.record(z.string().max(400), z.string().max(60)).nullable(),
  confirmUnallocatedCash: z.boolean(),
  confirmRemainderAdvance: z.boolean(),
  confirmRemainderSignature: z.string().max(1000000).default(""),
  confirmCashSignature: z.string().max(1000000).default(""),
  files: QuickSavedDraftSchema.shape.files,
});
type Draft = z.infer<typeof PaymentDraftSchema>;
const issueText: Record<HousePaymentIssue, string> = {
  invalid_person: "যাঁকে টাকা দিয়েছেন, তাঁর নাম বেছে নিন।",
  invalid_amount: "সঠিক টাকার অঙ্ক দিন।",
  invalid_work: "টাকা কোন কাজে দেওয়া হয়েছে, বেছে নিন।",
  invalid_contract: "ব্যক্তি ও কাজের সঙ্গে চুক্তিটি মিলছে না।",
  invalid_account: "কোন খরচের টাকা, বেছে নিন।",
  choose_scope: "বাড়তি বা আগাম টাকা কোন কাজে লাগবে, নিচে বেছে নিন।",
  unassigned_cash:
    "আগে দেওয়া কিছু টাকার সঙ্গে বিলের সম্পর্ক জানা নেই। নিচের হিসাবটি দেখে নিন।",
  invalid_allocation: "বিলের বাকি ও মোট দেওয়া টাকার মধ্যে অঙ্ক লিখুন।",
  unresolved_balance:
    "পুরোনো চুক্তির হিসাব আগে যাচাই করতে হবে। এখন কত পাওনা, তা নিশ্চিত নয়।",
};
function amount(value: string) {
  try {
    return parseAmount(value);
  } catch {
    return 0;
  }
}

export function HousePaymentForm() {
  const { ledger, save, close, entity, notify } = useNotebook();
  const { t, money, formatDigits, date } = useLanguageContext();
  const [params] = useSearchParams();
  const initial = useMemo<Draft>(
    () => ({
      id: crypto.randomUUID(),
      personId: params.get("person") ?? "",
      personName: "",
      newPersonId: crypto.randomUUID(),
      amount: "",
      workId: params.get("work") ?? "",
      account: AccountSchema.safeParse(params.get("account")).data ?? "",
      contractId: params.get("contract") ?? "",
      intent: params.get("purpose") === "advance" ? "advance" : "settlement",
      date: todayDhaka(),
      method: "cash",
      note: "",
      allocations: null,
      confirmUnallocatedCash: false,
      confirmRemainderAdvance: false,
      confirmRemainderSignature: "",
      confirmCashSignature: "",
      files: [],
    }),
    [],
  );
  const key = `house-payment:${params.get("person") ?? "all"}:${params.get("work") ?? "all"}:${params.get("contract") ?? "all"}`;
  const {
    value: draft,
    update,
    clear,
    flush,
    ready,
    failed,
  } = useInlineDraft(key, PaymentDraftSchema, initial);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const finished = useRef(false);
  const total = amount(draft.amount);
  const newPerson = useMemo(
    () =>
      draft.personId === "__new__" &&
      draft.personName.trim() &&
      draft.newPersonId
        ? PersonSchema.parse({
            id: draft.newPersonId,
            name: draft.personName.trim(),
            kind: "other",
            contactType: "custom",
            roles: [],
          })
        : null,
    [draft.personId, draft.personName, draft.newPersonId],
  );
  const planningLedger = useMemo(
    () =>
      newPerson ? { ...ledger, people: [...ledger.people, newPerson] } : ledger,
    [ledger, newPerson],
  );
  const resolvedPersonId =
    draft.personId === "__new__" ? draft.newPersonId : draft.personId;
  const summary = useMemo(
    () => partyLedger(planningLedger, resolvedPersonId),
    [planningLedger, resolvedPersonId],
  );
  const choices = summary.bills.flatMap((bill) =>
    bill.works
      .filter(
        (work) =>
          work.outstanding > 0 &&
          (!draft.workId || draft.workId === work.workId) &&
          (!draft.account || draft.account === bill.entry.account) &&
          (!draft.contractId || draft.contractId === bill.entry.contractId),
      )
      .map((work) => ({
        key: JSON.stringify([bill.entry.id, work.workId]),
        billId: bill.entry.id,
        workId: work.workId,
        outstanding: work.outstanding,
        name:
          bill.entry.note ||
          bill.entry.lines.map((line) => line.label).join(" · "),
        date: bill.entry.date,
      })),
  );
  const request: HousePaymentRequest = {
    personId: resolvedPersonId,
    amount: total,
    intent: draft.intent,
    workId: draft.workId || undefined,
    account: draft.account || undefined,
    contractId: draft.contractId || undefined,
    confirmUnallocatedCash: draft.confirmUnallocatedCash,
    ...(draft.allocations
      ? {
          allocations: choices.flatMap((choice) => {
            const value = amount(draft.allocations?.[choice.key] ?? "");
            return value > 0
              ? [
                  {
                    billId: choice.billId,
                    workId: choice.workId,
                    amount: value,
                  },
                ]
              : [];
          }),
        }
      : {}),
  };
  const plan = planHousePayment(planningLedger, request);
  const cashConfirmed =
    draft.confirmUnallocatedCash &&
    draft.confirmCashSignature === plan.signature;
  const remainderConfirmed =
    draft.confirmRemainderAdvance &&
    draft.confirmRemainderSignature === plan.signature;
  const person = planningLedger.people.find(
    (row) => row.id === resolvedPersonId,
  );
  const invalidAllocations = Object.values(draft.allocations ?? {}).some(
    (value) => {
      if (!value.trim()) return false;
      try {
        return parseAmount(value) < 0;
      } catch {
        return true;
      }
    },
  );
  const change = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setError("");
    update((current) => ({
      ...current,
      [key]: value,
      ...([
        "personId",
        "amount",
        "workId",
        "account",
        "contractId",
        "intent",
        "allocations",
      ].includes(key)
        ? {
            ...(key !== "allocations" ? { allocations: null } : {}),
            confirmUnallocatedCash: false,
            confirmRemainderAdvance: false,
            confirmRemainderSignature: "",
            confirmCashSignature: "",
          }
        : {}),
      ...(key === "personId"
        ? {
            contractId: "",
            account: "",
            newPersonId: current.newPersonId || crypto.randomUUID(),
          }
        : {}),
    }));
  };
  const selectedTotal = plan.allocations.reduce(
    (sum, row) => sum + row.amount,
    0,
  );
  const showScope =
    draft.intent !== "settlement" ||
    plan.remainder > 0 ||
    Boolean(draft.workId || draft.account || draft.contractId);
  const contracts = ledger.contracts.filter(
    (row) =>
      !row.archivedAt &&
      row.personId === draft.personId &&
      (!draft.workId || row.scope === "house" || row.workId === draft.workId),
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || !ready || failed || finished.current) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      if (invalidAllocations) throw new Error("invalid_allocation");
      if (draft.personId === "__new__" && !newPerson)
        throw new Error("invalid_person");
      if (plan.requiresCashReview && !cashConfirmed)
        throw new Error("unassigned_cash");
      if (plan.issues.length) throw new Error(plan.issues[0]);
      await flush();
      const firstId = plan.groups.length > 1 ? `${draft.id}:0` : draft.id;
      await save(
        (current) => {
          if (
            newPerson &&
            current.people.some((person) => person.id === newPerson.id)
          )
            throw new Error("house_person_changed");
          const next = newPerson
            ? { ...current, people: [...current.people, newPerson] }
            : current;
          return recordHousePayment(
            next,
            {
              ...request,
              id: draft.id,
              date: draft.date,
              method: draft.method,
              note: draft.note,
              confirmRemainderAdvance: remainderConfirmed,
              receipts: draft.files.map((file) => ({
                id: file.id,
                name: file.name ?? t("ভাউচার"),
                mime: file.file.type,
                size: file.file.size,
              })),
            },
            plan,
          );
        },
        draft.files.map((file) => ({ ...file, entryId: firstId })),
      );
      finished.current = true;
      try {
        await clear(initial);
      } catch {
        notify(t("হিসাব রাখা হয়েছে। অসমাপ্ত লেখার পুরোনো কপি পরে সরবে।"));
      }
      close();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(
        t(
          code in issueText
            ? issueText[code as HousePaymentIssue]
            : code === "house_payment_confirm_advance"
              ? "বাড়তি টাকা অগ্রিম থাকবে কি না, নিশ্চিত করুন।"
              : "খাতা বদলে থাকতে পারে। লেখা অক্ষত আছে; হিসাব দেখে আবার রাখুন।",
        ),
      );
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  const savedEntryIds = ledger.entries
    .filter(
      (entry) => entry.id === draft.id || entry.id.startsWith(`${draft.id}:`),
    )
    .map((entry) => entry.id);
  if (ready && savedEntryIds.length)
    return (
      <HouseSavedNotice
        title={t("টাকা দিয়েছি")}
        entryIds={savedEntryIds}
        onNew={async () => {
          await clear({
            ...initial,
            id: crypto.randomUUID(),
            newPersonId: crypto.randomUUID(),
          });
          finished.current = false;
          setError("");
        }}
      />
    );
  return (
    <EntryFrame
      title={t("টাকা দিয়েছি")}
      subtitle={t("কাকে কত দিলেন লিখুন। কোন বাকি মিটবে, রাখার আগে দেখুন।")}
      className="house-write-page"
      busy={saving}
      onClose={() =>
        void flush()
          .then(close)
          .catch(() =>
            setError(
              t("অসমাপ্ত লেখা রাখা যায়নি। বন্ধ করার আগে আবার চেষ্টা করুন।"),
            ),
          )
      }
      footer={
        <button
          className="primary-button"
          form="house-payment-form"
          type="submit"
          disabled={!ready || failed || saving}
        >
          {t(saving ? "রাখছি…" : "হিসাব রাখুন")}
        </button>
      }
    >
      <form
        id="house-payment-form"
        className="house-form"
        onSubmit={(event) => void submit(event)}
      >
        <FormError
          id="house-payment-error"
          message={
            failed
              ? t(
                  "অসমাপ্ত লেখা খোলা বা রাখা যাচ্ছে না। লেখা অক্ষত রেখে আবার খুলুন।",
                )
              : error
          }
        />
        <fieldset disabled={!ready || failed || saving}>
          <label>
            {t("কাকে দিয়েছেন")}
            <AppSelect
              aria-label={t("কাকে দিয়েছেন")}
              value={draft.personId}
              onChange={(event) => change("personId", event.target.value)}
            >
              <option value="">{t("নাম বেছে নিন")}</option>
              {ledger.people
                .filter((person) => !person.archivedAt)
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {formatDigits(person.name)}
                  </option>
                ))}
              <option value="__new__">{t("+ নাম লিখব")}</option>
            </AppSelect>
          </label>
          {draft.personId === "__new__" ? (
            <label>
              {t("নাম")}
              <input
                aria-label={t("নতুন নাম")}
                required
                maxLength={200}
                value={draft.personName}
                onChange={(event) => change("personName", event.target.value)}
              />
            </label>
          ) : null}
          {!ledger.people.some((person) => !person.archivedAt) && (
            <button
              type="button"
              className="text-button"
              onClick={() => void flush().then(() => entity("person"))}
            >
              {t("আগে নাম যোগ করুন")}
            </button>
          )}
          <label className="house-amount">
            {t("কত দিয়েছেন")}
            <MoneyInput
              aria-label={t("কত দিয়েছেন")}
              required
              value={draft.amount}
              onChange={(event) => change("amount", event.target.value)}
            />
          </label>
          <label>
            {t("টাকা দেওয়ার কারণ")}
            <AppSelect
              aria-label={t("টাকা দেওয়ার কারণ")}
              value={draft.intent}
              onChange={(event) =>
                change("intent", event.target.value as Draft["intent"])
              }
            >
              <option value="settlement">{t("বাকি মেটালাম")}</option>
              <option value="advance">{t("আগে টাকা দিলাম")}</option>
              <option value="receivable">{t("ফেরতযোগ্য জামানত দিলাম")}</option>
            </AppSelect>
          </label>
          {person && total > 0 && (
            <section
              className="house-payment-preview"
              aria-label={t("রাখলে যা হবে")}
            >
              {invalidAllocations ? (
                <p className="field-hint" role="status">
                  {t("বিলের বাকি ও মোট দেওয়া টাকার মধ্যে অঙ্ক লিখুন।")}
                </p>
              ) : null}
              <div className="house-preview-heading">
                <h2>{t("রাখলে যা হবে")}</h2>
                {draft.intent === "settlement" && choices.length > 0 && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      change(
                        "allocations",
                        draft.allocations
                          ? null
                          : Object.fromEntries(
                              choices.map((choice) => [
                                choice.key,
                                moneyInputValue(
                                  plan.allocations.find(
                                    (row) =>
                                      row.billId === choice.billId &&
                                      row.workId === choice.workId,
                                  )?.amount ?? 0,
                                ),
                              ]),
                            ),
                      )
                    }
                  >
                    {t(draft.allocations ? "আগের প্রস্তাবে ফিরি" : "বদলাই")}
                  </button>
                )}
              </div>
              {draft.allocations ? (
                <div className="house-allocation-edit">
                  {choices.map((choice) => (
                    <label key={choice.key}>
                      <span>
                        {formatDigits(choice.name || t("বিল"))}
                        <small>
                          {t("বাকি {{amount}}", {
                            amount: money(choice.outstanding),
                          })}
                        </small>
                      </span>
                      <MoneyInput
                        aria-label={t("এই বিলে দিচ্ছি: {{name}}", {
                          name: choice.name || t("বিল"),
                        })}
                        value={draft.allocations?.[choice.key] ?? ""}
                        onChange={(event) =>
                          change("allocations", {
                            ...draft.allocations,
                            [choice.key]: event.target.value,
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              ) : plan.allocations.length > 0 ? (
                <ul className="house-allocation-preview">
                  {plan.allocations.map((row) => {
                    const choice = choices.find(
                      (choice) =>
                        choice.billId === row.billId &&
                        choice.workId === row.workId,
                    );
                    return (
                      <li key={JSON.stringify([row.billId, row.workId])}>
                        <span>
                          {formatDigits(choice?.name || t("বিল"))}
                          {choice?.date && <small>{date(choice.date)}</small>}
                        </span>
                        <strong>{money(row.amount)}</strong>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p>
                  {t(
                    draft.intent === "receivable"
                      ? "এই টাকা ফেরত পাওয়ার হিসাবে থাকবে।"
                      : draft.intent === "advance"
                        ? "পরের বিলের জন্য অগ্রিম থাকবে।"
                        : "এই টাকার জন্য মেলানো যায় এমন বিল নেই।",
                  )}
                </p>
              )}
              <dl aria-live="polite">
                <div>
                  <dt>{t("এখন টাকা গেছে")}</dt>
                  <dd>{money(total)}</dd>
                </div>
                {draft.intent === "settlement" && (
                  <div className="house-result">
                    <dt>{t("এর পরে দিতে হবে")}</dt>
                    <dd>
                      {plan.earnedPayable === null
                        ? t("যাচাই বাকি")
                        : money(
                            Math.max(0, plan.earnedPayable - selectedTotal),
                          )}
                    </dd>
                  </div>
                )}
                {plan.remainder > 0 && (
                  <div>
                    <dt>
                      {t(
                        draft.intent === "receivable"
                          ? "ফেরত পাব"
                          : "অগ্রিম থাকবে",
                      )}
                    </dt>
                    <dd>{money(plan.remainder)}</dd>
                  </div>
                )}
              </dl>
              <p className="field-hint">{t("এতে নতুন খরচ যোগ হবে না।")}</p>
              {plan.requiresCashReview && (
                <div className="house-legacy-notice">
                  <p>
                    {t(
                      "আগে দেওয়া {{amount}} টাকার বিলের সম্পর্ক জানা নেই। এগুলো অক্ষত আছে।",
                      { amount: money(plan.existingUnallocatedCash) },
                    )}
                  </p>
                  <label className="house-check">
                    <input
                      type="checkbox"
                      checked={cashConfirmed}
                      onChange={(event) =>
                        update((current) => ({
                          ...current,
                          confirmUnallocatedCash: event.target.checked,
                          confirmCashSignature: event.target.checked
                            ? planHousePayment(planningLedger, {
                                ...request,
                                confirmUnallocatedCash: true,
                              }).signature
                            : "",
                        }))
                      }
                    />
                    <span>{t("দেখেছি—এটি নতুন করে দেওয়া টাকা।")}</span>
                  </label>
                </div>
              )}
              {draft.intent === "settlement" && plan.remainder > 0 && (
                <label className="house-check">
                  <input
                    type="checkbox"
                    checked={remainderConfirmed}
                    onChange={(event) =>
                      update((current) => ({
                        ...current,
                        confirmRemainderAdvance: event.target.checked,
                        confirmRemainderSignature: event.target.checked
                          ? plan.signature
                          : "",
                      }))
                    }
                  />
                  <span>
                    {t("বাড়তি {{amount}} পরের বিলের অগ্রিম হিসেবে রাখি", {
                      amount: money(plan.remainder),
                    })}
                  </span>
                </label>
              )}
            </section>
          )}
          {showScope && (
            <div className="house-payment-scope">
              <p className="field-hint">{t("এই টাকা কোন কাজে লাগবে")}</p>
              <div className="house-field-pair">
                <label>
                  {t("কোন কাজে")}
                  <AppSelect
                    aria-label={t("কোন কাজে")}
                    value={draft.workId}
                    onChange={(event) => change("workId", event.target.value)}
                  >
                    <option value="">{t("বিল অনুযায়ী")}</option>
                    {ledger.works
                      .filter((work) => !work.archivedAt)
                      .map((work) => (
                        <option key={work.id} value={work.id}>
                          {formatDigits(work.name)}
                        </option>
                      ))}
                  </AppSelect>
                </label>
                <label>
                  {t("কী বাবদ")}
                  <AppSelect
                    aria-label={t("কী বাবদ")}
                    value={draft.account}
                    onChange={(event) =>
                      change("account", event.target.value as Draft["account"])
                    }
                  >
                    <option value="">{t("বিল অনুযায়ী")}</option>
                    <option value="materials">{t("মালের টাকা")}</option>
                    <option value="labour">{t("মজুরি")}</option>
                    <option value="other">{t("অন্য খরচ")}</option>
                  </AppSelect>
                </label>
              </div>
              {contracts.length > 0 && (
                <label>
                  {t("কোন চুক্তির কাজ")}
                  <AppSelect
                    aria-label={t("কোন চুক্তির কাজ")}
                    value={draft.contractId}
                    onChange={(event) =>
                      change("contractId", event.target.value)
                    }
                  >
                    <option value="">{t("বিল অনুযায়ী")}</option>
                    {contracts.map((contract) => (
                      <option key={contract.id} value={contract.id}>
                        {formatDigits(contract.title || t("কাজ"))}
                      </option>
                    ))}
                  </AppSelect>
                </label>
              )}
            </div>
          )}
          {draft.personId &&
            total > 0 &&
            plan.issues
              .filter((issue) => issue !== "unassigned_cash")
              .map((issue) => (
                <p className="field-hint" key={issue} role="status">
                  {t(issueText[issue])}
                </p>
              ))}
          <details className="house-details">
            <summary>{t("তারিখ, ভাউচার ও বাড়তি কথা")}</summary>
            <label>
              {t("তারিখ")}
              <AppDatePicker
                aria-label={t("তারিখ")}
                value={draft.date}
                onChange={(event) => change("date", event.target.value)}
              />
            </label>
            <label>
              {t("কীভাবে দিয়েছি")}
              <AppSelect
                aria-label={t("কীভাবে দিয়েছি")}
                value={draft.method}
                onChange={(event) =>
                  change("method", event.target.value as Draft["method"])
                }
              >
                {[
                  ["cash", "নগদ"],
                  ["bkash", "বিকাশ"],
                  ["bank", "ব্যাংক"],
                  ["other", "অন্যভাবে"],
                ].map(([id, label]) => (
                  <option key={id} value={id}>
                    {t(label)}
                  </option>
                ))}
              </AppSelect>
            </label>
            <label>
              {t("বাড়তি কথা")}
              <textarea
                value={draft.note}
                maxLength={10000}
                onChange={(event) => change("note", event.target.value)}
              />
            </label>
            <HouseAttachments
              files={draft.files}
              entryId={draft.id}
              onChange={(files) => change("files", files)}
              onError={setError}
            />
          </details>
        </fieldset>
      </form>
    </EntryFrame>
  );
}
