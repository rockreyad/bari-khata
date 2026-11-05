import { useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { z } from "zod";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { EntryFrame } from "../../components/EntryFrame";
import { EntitySheet } from "../../components/EntitySheet";
import { MoneyInput } from "../../components/ui/MoneyInput";
import { PaymentMethodField } from "../../components/PaymentMethodField";
import { AppSelect } from "../../components/ui/AppSelect";
import { AppDatePicker } from "../../components/ui/AppDatePicker";
import {
  TransactionAmount,
  TransactionDetails,
} from "../../components/TransactionFields";
import { FormError, useFormError } from "../../components/ui/FormError";
import { AccountSchema, MoneySchema, PersonSchema } from "../../domain/model";
import { parseAmount } from "../../domain/ledger";
import { partyLedger } from "../../domain/partyLedger";
import {
  contactEntryPolicy,
  getContactEntryDefaults,
} from "../../domain/contactEntryPolicy";
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
import { TransactionExtras } from "../../components/TransactionExtras";
import { paymentPresentation } from "./paymentPresentation";
import { partyDueItems } from "../home/partyDueItems";

const PaymentDraftSchema = z.object({
  id: z.string().min(1).max(150),
  personId: z.string().max(160),
  personName: z.string().max(200).default(""),
  newPersonId: z.string().max(160).default(""),
  amount: z.string().max(60),
  workId: z.string().max(160),
  account: z.union([AccountSchema, z.literal("")]),
  contractId: z.string().max(160),
  billId: z.string().max(160).default(""),
  intent: z.enum(["payment", "settlement", "advance", "receivable"]),
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
type PaymentFormIssue =
  HousePaymentIssue | "invalid_date" | "invalid_intent" | "exceeds_due";
const issueText: Record<PaymentFormIssue, string> = {
  invalid_intent: "টাকা দেওয়ার ধরন বেছে নিন।",
  exceeds_due: "এই বাকির চেয়ে বেশি টাকা লিখেছেন। অঙ্কটি কমিয়ে দিন।",
  invalid_date: "সঠিক তারিখ বেছে নিন।",
  invalid_person: "যাঁকে টাকা দিয়েছেন, তাঁর নাম বেছে নিন।",
  invalid_amount: "সঠিক টাকার অঙ্ক দিন।",
  invalid_work: "টাকা কোন কাজে দেওয়া হয়েছে, বেছে নিন।",
  invalid_contract: "কর্মী ও কাজের সঙ্গে চুক্তিটি মিলছে না।",
  invalid_account: "কোন খরচের টাকা, বেছে নিন।",
  choose_scope: "বাড়তি বা আগাম টাকা কোন কাজে লাগবে, নিচে বেছে নিন।",
  unassigned_cash:
    "আগে দেওয়া কিছু টাকার সঙ্গে বিলের সম্পর্ক জানা নেই। নিচের হিসাবটি দেখে নিন।",
  invalid_allocation: "বিলের বাকি ও মোট দেওয়া টাকার মধ্যে অঙ্ক লিখুন।",
  unresolved_balance:
    "পুরোনো চুক্তির হিসাব আগে যাচাই করতে হবে। এখন কত পাওনা, তা নিশ্চিত নয়।",
  contact_rules:
    "এই নামের নিয়মে এই টাকা দেওয়া রাখা যাবে না। নামের নিয়ম দেখে নিন।",
};
function amount(value: string) {
  try {
    return parseAmount(value);
  } catch {
    return 0;
  }
}

export function HousePaymentForm() {
  const { ledger, save, close, entity, notify, mode } = useNotebook();
  const { t, money, formatDigits, date } = useLanguageContext();
  const [params] = useSearchParams();
  const initial = useMemo<Draft>(() => {
    const person = ledger.people.find((row) => row.id === params.get("person"));
    const defaults = person
      ? getContactEntryDefaults(ledger, person, {
          workId: params.get("work") ?? undefined,
        })
      : null;
    const requestedIntent = params.get("intent") ?? params.get("purpose");
    const presetAmount =
      MoneySchema.safeParse(Number(params.get("amount"))).data ?? 0;
    const activeWorks = ledger.works.filter((work) => !work.archivedAt);
    const intent =
      requestedIntent === "advance" ||
      requestedIntent === "receivable" ||
      requestedIntent === "settlement"
        ? requestedIntent
        : "payment";
    return {
      id: crypto.randomUUID(),
      personId: params.get("person") ?? "",
      personName: "",
      newPersonId: crypto.randomUUID(),
      amount: presetAmount > 0 ? moneyInputValue(presetAmount) : "",
      workId:
        params.get("work") ??
        (intent === "advance"
          ? defaults?.workId ||
            (activeWorks.length === 1 ? activeWorks[0].id : "")
          : ""),
      account:
        AccountSchema.safeParse(params.get("account")).data ??
        (intent === "advance" ? (defaults?.account ?? "") : ""),
      contractId:
        params.get("contract") === "none" ? "" : (params.get("contract") ?? ""),
      billId: params.get("bill") ?? "",
      intent,
      date: todayDhaka(),
      method: "cash",
      note: "",
      allocations: null,
      confirmUnallocatedCash: false,
      confirmRemainderAdvance: false,
      confirmRemainderSignature: "",
      confirmCashSignature: "",
      files: [],
    };
  }, []);
  const key = `house-payment:${params.get("person") ?? "all"}:${params.get("work") ?? "all"}:${params.get("contract") ?? "all"}${initial.intent === "advance" || initial.intent === "receivable" ? `:${initial.intent}` : ""}${params.has("amount") ? `:due:${params.get("account") ?? "all"}:${params.get("bill") ?? "all"}` : ""}`;
  const {
    value: draft,
    update,
    clear,
    flush,
    ready,
    failed,
  } = useInlineDraft(key, PaymentDraftSchema, initial);
  // Old ordinary-payment drafts keep their contents and key; an explicit advance choice stays explicit.
  const intent =
    draft.intent === "settlement" &&
    (params.get("intent") ?? params.get("purpose")) !== "settlement" &&
    !draft.confirmRemainderAdvance
      ? "payment"
      : draft.intent;
  const [error, setError, errorNotice] = useFormError();
  const [invalidField, setInvalidField] = useState("");
  const [saving, setSaving] = useState(false);
  const [creatingWork, setCreatingWork] = useState(false);
  const lock = useRef(false);
  const finished = useRef(false);
  const total = amount(draft.amount);
  const newPerson = useMemo(
    () =>
      draft.personId === "__new__" &&
      draft.personName.trim() &&
      draft.newPersonId
        ? (PersonSchema.safeParse({
            id: draft.newPersonId,
            name: draft.personName.trim(),
            kind: "other",
            contactType: "custom",
            roles: [],
          }).data ?? null)
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
  const settlement = params.get("purpose") === "settle" && params.has("amount");
  const selectedBill = summary.bills.find(
    (bill) => bill.entry.id === draft.billId,
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
  let billAmountLeft = total;
  const presetAllocations = choices
    .filter((choice) => choice.billId === draft.billId)
    .flatMap((choice) => {
      const value = Math.min(billAmountLeft, choice.outstanding);
      billAmountLeft -= value;
      return value > 0
        ? [{ billId: choice.billId, workId: choice.workId, amount: value }]
        : [];
    });
  const request: HousePaymentRequest = {
    personId: resolvedPersonId,
    amount: total,
    intent,
    workId: draft.workId || undefined,
    account: draft.account || undefined,
    contractId:
      draft.contractId ||
      (intent === "advance" || params.get("contract") === "none"
        ? null
        : undefined),
    confirmUnallocatedCash: draft.confirmUnallocatedCash,
    ...(draft.billId
      ? {
          allocations: presetAllocations,
        }
      : settlement
        ? { allocations: [] }
        : draft.allocations
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
  const currentSettlementLimit = (current: typeof planningLedger) =>
    settlement
      ? partyDueItems(current, resolvedPersonId, {
          ...(params.get("dueWork") && params.get("dueWork") !== "all"
            ? { workId: params.get("dueWork")! }
            : {}),
          ...(AccountSchema.safeParse(params.get("dueAccount")).data
            ? { account: AccountSchema.parse(params.get("dueAccount")) }
            : {}),
        })
          .filter(
            (row) =>
              (params.get("balanceOnly") === "1"
                ? !row.billId
                : !draft.billId || row.billId === draft.billId) &&
              (!draft.workId || row.workId === draft.workId) &&
              (!draft.account || row.account === draft.account) &&
              (request.contractId === undefined ||
                row.contractId === request.contractId),
          )
          .reduce((sum, row) => sum + row.amount, 0)
      : null;
  const settlementLimit = currentSettlementLimit(planningLedger);
  const plan = planHousePayment(planningLedger, request);
  const presentation = paymentPresentation(planningLedger, request, plan, {
    date: draft.date,
    method: draft.method,
    balanceBasis: settlement ? "earned" : undefined,
  });
  const cashConfirmed =
    draft.confirmUnallocatedCash &&
    draft.confirmCashSignature === plan.signature;
  const remainderConfirmed =
    draft.confirmRemainderAdvance &&
    draft.confirmRemainderSignature === plan.signature;
  const person = planningLedger.people.find(
    (row) => row.id === resolvedPersonId,
  );
  const policy = person ? contactEntryPolicy(person) : null;
  const allowedAccounts = (["materials", "labour", "other"] as const).filter(
    (account) =>
      !policy ||
      policy.accounts.includes(account) ||
      ((intent === "settlement" || intent === "payment") &&
        summary.bills.some(
          (bill) => bill.outstanding > 0 && bill.entry.account === account,
        )),
  );
  const showAccount =
    allowedAccounts.length > 1 ||
    (draft.account && !allowedAccounts.includes(draft.account));
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
    const selected =
      key === "personId"
        ? ledger.people.find((row) => row.id === value)
        : person;
    const defaults = selected
      ? getContactEntryDefaults(ledger, selected, {
          workId: draft.workId || undefined,
        })
      : null;
    setError("");
    setInvalidField("");
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
            workId:
              intent !== "advance"
                ? current.workId
                : (defaults?.workId ?? current.workId),
            account: intent !== "advance" ? "" : (defaults?.account ?? ""),
            newPersonId: current.newPersonId || crypto.randomUUID(),
          }
        : {}),
      ...(key === "intent"
        ? {
            contractId: "",
            workId:
              value === "advance"
                ? current.workId || defaults?.workId || ""
                : current.workId,
            account: value === "advance" ? (defaults?.account ?? "") : "",
          }
        : {}),
    }));
  };
  const noMatchingBills =
    Boolean(person) && intent === "settlement" && !presentation.hasScopedBills;
  const showScope =
    Boolean(person) &&
    intent !== "receivable" &&
    (showAccount ||
      Boolean(draft.contractId) ||
      ledger.contracts.some(
        (row) => !row.archivedAt && row.personId === draft.personId,
      ));
  const showOutcome =
    Boolean(person) &&
    total > 0 &&
    presentation.canPreview &&
    !invalidAllocations &&
    (!plan.requiresCashReview || cashConfirmed) &&
    (intent !== "payment" || (presentation.beforeDue ?? 0) > 0) &&
    (intent === "payment" ||
      intent === "advance" ||
      plan.remainder === 0 ||
      remainderConfirmed);
  const contracts = ledger.contracts.filter(
    (row) =>
      (intent === "settlement" ||
        intent === "payment" ||
        (policy?.agreement ?? true)) &&
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
    setInvalidField("");
    try {
      if (intent === "receivable") throw new Error("invalid_intent");
      if (total <= 0) throw new Error("invalid_amount");
      if (
        (intent === "advance" || (settlement && plan.newWork)) &&
        !draft.workId
      )
        throw new Error("invalid_work");
      if (settlementLimit !== null && total > settlementLimit)
        throw new Error("exceeds_due");
      const timestamp = Date.parse(`${draft.date}T00:00:00Z`);
      if (
        !Number.isFinite(timestamp) ||
        new Date(timestamp).toISOString().slice(0, 10) !== draft.date
      )
        throw new Error("invalid_date");
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
          const latestLimit = currentSettlementLimit(next);
          if (latestLimit !== null && total > latestLimit)
            throw new Error("exceeds_due");
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
      const issue = code.replace(/^house_payment_/, "");
      setInvalidField(issue);
      setError(
        t(
          issue in issueText
            ? issueText[issue as PaymentFormIssue]
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
  if (creatingWork)
    return (
      <EntitySheet
        kind="work"
        presentation="page"
        ledger={ledger}
        mode={mode}
        onClose={() => setCreatingWork(false)}
        onSave={async (next) => {
          const created = next.works.find(
            (work) => !ledger.works.some((existing) => existing.id === work.id),
          );
          if (!created) throw new Error("invalid_work");
          await save((current) => {
            if (current.works.some((work) => work.id === created.id))
              throw new Error("duplicate");
            return { ...current, works: [...current.works, created] };
          });
          change("workId", created.id);
        }}
      />
    );
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
      focusAmountWhenReady={ready && !failed && !saving}
      title={t(
        intent === "advance"
          ? "অগ্রিম দিলাম"
          : settlement
            ? "বাকি পরিশোধ"
            : "টাকা দিলাম",
      )}
      className="house-write-page transaction-page"
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
        <div className="transaction-submit">
          <div>
            <small>{t("মোট টাকা")}</small>
            <strong>{money(total)}</strong>
          </div>
          <button
            className="primary-button"
            form="house-payment-form"
            type="submit"
            disabled={!ready || failed || saving}
          >
            {t(saving ? "রাখছি…" : "হিসাব রাখুন")}
          </button>
        </div>
      }
    >
      <form
        id="house-payment-form"
        className="house-form transaction-form"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <FormError
          id="house-payment-error"
          occurrence={errorNotice.occurrence}
          message={
            failed
              ? t(
                  "অসমাপ্ত লেখা খোলা বা রাখা যাচ্ছে না। লেখা অক্ষত রেখে আবার খুলুন।",
                )
              : error
          }
        />
        <fieldset disabled={!ready || failed || saving}>
          <div className="transaction-card">
            <label>
              {t("কাকে দিয়েছেন")}
              <AppSelect
                aria-label={t("কাকে দিয়েছেন")}
                aria-invalid={invalidField === "invalid_person"}
                aria-describedby={
                  invalidField === "invalid_person"
                    ? "house-payment-person-error"
                    : undefined
                }
                value={draft.personId}
                onChange={(event) => change("personId", event.target.value)}
              >
                <option value="">{t("নাম বেছে নিন")}</option>
                {ledger.people
                  .filter(
                    (person) =>
                      person.id === draft.personId ||
                      contactEntryPolicy(person).payment,
                  )
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
                  aria-invalid={invalidField === "invalid_person"}
                  aria-describedby={
                    invalidField === "invalid_person"
                      ? "house-payment-person-error"
                      : undefined
                  }
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
            {invalidField === "invalid_person" && (
              <p
                id="house-payment-person-error"
                className="transaction-field-error"
              >
                {error}
              </p>
            )}
            <label>
              {t("কোন খাতায়")}
              <AppSelect
                aria-label={t("কোন খাতায়")}
                required={intent === "advance"}
                value={draft.workId}
                aria-invalid={invalidField === "invalid_work"}
                aria-describedby={
                  invalidField === "invalid_work"
                    ? "house-payment-error"
                    : undefined
                }
                onChange={(event) => {
                  const workId = event.target.value;
                  if (workId === "__new__") {
                    void flush()
                      .then(() => setCreatingWork(true))
                      .catch(() =>
                        setError(
                          t(
                            "অসমাপ্ত লেখা রাখা যায়নি। বন্ধ করার আগে আবার চেষ্টা করুন।",
                          ),
                        ),
                      );
                  } else change("workId", workId);
                }}
              >
                <option value="">
                  {t(intent === "advance" ? "খাতা বেছে নিন" : "বিল অনুযায়ী")}
                </option>
                {ledger.works
                  .filter((work) => !work.archivedAt)
                  .map((work) => (
                    <option key={work.id} value={work.id}>
                      {formatDigits(work.name)}
                    </option>
                  ))}
                <option value="__new__">{t("+ নতুন খাতা")}</option>
              </AppSelect>
            </label>
            {person &&
              intent !== "advance" &&
              (presentation.beforeDue ?? 0) > 0 && (
                <p className="house-payment-balance">
                  {t("মোট বাকি {{amount}}", {
                    amount: money(presentation.beforeDue ?? 0),
                  })}
                </p>
              )}
            <TransactionAmount
              label={t("কত দিয়েছেন")}
              value={draft.amount}
              onChange={(value) => change("amount", value)}
              required
              hint={
                selectedBill
                  ? formatDigits(
                      selectedBill.entry.note ||
                        selectedBill.entry.lines
                          .map((line) => line.label)
                          .filter(Boolean)
                          .join(" · ") ||
                        t("বিল"),
                    )
                  : undefined
              }
              error={
                invalidField === "invalid_amount" ||
                invalidField === "exceeds_due"
                  ? error
                  : undefined
              }
            />
            {intent === "receivable" && (
              <div
                className="transaction-choice"
                role="group"
                aria-label={t("টাকা দেওয়ার কারণ")}
              >
                {(
                  [
                    ["payment", "টাকা দিলাম", "টাকা দিলাম"],
                    ["advance", "অগ্রিম দিলাম", "অগ্রিম — আগে টাকা দিলাম"],
                  ] as const
                ).map(([value, label, accessible]) => (
                  <button
                    type="button"
                    key={value}
                    aria-label={t(accessible)}
                    onClick={() => change("intent", value)}
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
            )}
            {intent === "receivable" && (
              <p className="field-hint">{t("টাকা দেওয়ার ধরন বেছে নিন।")}</p>
            )}
            {intent === "advance" && (
              <label>
                {t("কারণ")} <span className="field-hint">{t("ইচ্ছেমতো")}</span>
                <input
                  aria-label={t("কারণ")}
                  value={draft.note}
                  maxLength={10000}
                  onChange={(event) => change("note", event.target.value)}
                />
              </label>
            )}
            {showScope && (
              <TransactionDetails
                summary={t("খাতা ও কাজ")}
                className="house-payment-scope"
                defaultOpen={
                  (remainderConfirmed &&
                    plan.issues.includes("choose_scope")) ||
                  [
                    "choose_scope",
                    "invalid_work",
                    "invalid_account",
                    "invalid_contract",
                  ].includes(invalidField)
                }
              >
                <div className="transaction-grid">
                  {showAccount && (
                    <label>
                      {t("কী বাবদ")}
                      <AppSelect
                        aria-label={t("কী বাবদ")}
                        aria-invalid={
                          invalidField === "invalid_account" ||
                          (invalidField === "choose_scope" && !draft.account)
                        }
                        aria-describedby={
                          invalidField === "invalid_account" ||
                          invalidField === "choose_scope"
                            ? "house-payment-error"
                            : undefined
                        }
                        value={draft.account}
                        onChange={(event) =>
                          change(
                            "account",
                            event.target.value as Draft["account"],
                          )
                        }
                      >
                        <option value="">
                          {t(
                            intent === "settlement"
                              ? "বিল অনুযায়ী"
                              : "বেছে নিন",
                          )}
                        </option>
                        {allowedAccounts.includes("materials") && (
                          <option value="materials">{t("মালের টাকা")}</option>
                        )}
                        {allowedAccounts.includes("labour") && (
                          <option value="labour">{t("মজুরি")}</option>
                        )}
                        {allowedAccounts.includes("other") && (
                          <option value="other">{t("অন্য খরচ")}</option>
                        )}
                      </AppSelect>
                    </label>
                  )}
                </div>
                {(contracts.length > 0 || draft.contractId) && (
                  <label>
                    {t("কোন কাজের জন্য")}
                    <AppSelect
                      aria-label={t("কোন কাজের জন্য")}
                      value={draft.contractId}
                      onChange={(event) =>
                        change("contractId", event.target.value)
                      }
                    >
                      <option value="">
                        {t(
                          intent === "settlement" ? "বিল অনুযায়ী" : "বেছে নিন",
                        )}
                      </option>
                      {contracts.map((contract) => (
                        <option key={contract.id} value={contract.id}>
                          {formatDigits(contract.title || t("কাজ"))}
                        </option>
                      ))}
                    </AppSelect>
                  </label>
                )}
              </TransactionDetails>
            )}
          </div>
          {person &&
            total > 0 &&
            intent === "settlement" &&
            !noMatchingBills &&
            plan.remainder > 0 && (
              <div className="house-payment-question">
                <button
                  type="button"
                  className="transaction-secondary house-payment-advance"
                  aria-pressed={remainderConfirmed}
                  onClick={() => {
                    setError("");
                    setInvalidField("");
                    update((current) => ({
                      ...current,
                      confirmRemainderAdvance: !remainderConfirmed,
                      confirmRemainderSignature: !remainderConfirmed
                        ? plan.signature
                        : "",
                    }));
                  }}
                >
                  {presentation.excess !== null && presentation.excess > 0
                    ? t("বাড়তি {{amount}} অগ্রিম রাখি", {
                        amount: money(presentation.excess),
                      })
                    : t("বিলের বাইরে {{amount}} টাকাও রাখি", {
                        amount: money(plan.remainder),
                      })}
                </button>
              </div>
            )}
          {showOutcome && (
            <div
              className="house-payment-outcome"
              role="status"
              aria-label={t("টাকা দেওয়ার পরে")}
            >
              <strong>
                {intent === "advance"
                  ? t("আগাম দিলেন {{amount}}", { amount: money(total) })
                  : t("বাকি থাকবে {{amount}}", {
                      amount: money(presentation.afterDue ?? 0),
                    })}
              </strong>
              {intent === "settlement" &&
                presentation.excess !== null &&
                presentation.excess > 0 && (
                  <span>
                    {t("অগ্রিম {{amount}}", {
                      amount: money(presentation.excess),
                    })}
                  </span>
                )}
            </div>
          )}
          {person &&
            total > 0 &&
            intent === "settlement" &&
            plan.requiresCashReview && (
              <TransactionDetails
                summary={t("আগের টাকা মিলিয়ে দেখি")}
                defaultOpen={
                  !cashConfirmed || invalidField === "unassigned_cash"
                }
              >
                <p className="field-hint">
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
              </TransactionDetails>
            )}
          <PaymentMethodField
            value={draft.method}
            onChange={(method) => change("method", method)}
          />
          {person &&
            total > 0 &&
            (intent === "settlement" || intent === "payment") &&
            !settlement &&
            choices.length > 0 && (
              <TransactionDetails
                summary={t("কোন বিলে কত যাবে")}
                defaultOpen={
                  invalidAllocations || invalidField === "invalid_allocation"
                }
              >
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
                {draft.allocations ? (
                  <div className="house-allocation-edit">
                    {choices.map((choice) => (
                      <label key={choice.key}>
                        <span>
                          {formatDigits(choice.name || t("বিল"))}
                          <small>
                            {t("এই বিলে মেলানো যাবে {{amount}}", {
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
                ) : (
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
                )}
              </TransactionDetails>
            )}
          <TransactionExtras
            hasReceipts={draft.files.length > 0}
            dateField={
              <label>
                {t("তারিখ")}
                <AppDatePicker
                  aria-label={t("তারিখ")}
                  aria-invalid={invalidField === "invalid_date"}
                  aria-describedby={
                    invalidField === "invalid_date"
                      ? "house-payment-error"
                      : undefined
                  }
                  value={draft.date}
                  onChange={(event) => change("date", event.target.value)}
                />
              </label>
            }
            noteField={
              intent !== "advance" && (
                <label>
                  {t("বাড়তি কথা")}
                  <textarea
                    rows={2}
                    value={draft.note}
                    maxLength={10000}
                    onChange={(event) => change("note", event.target.value)}
                  />
                </label>
              )
            }
          >
            <HouseAttachments
              files={draft.files}
              entryId={draft.id}
              onChange={(files) => change("files", files)}
              onError={setError}
            />
          </TransactionExtras>
        </fieldset>
      </form>
    </EntryFrame>
  );
}
