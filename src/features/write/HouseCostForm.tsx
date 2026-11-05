import { useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { z } from "zod";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { EntryFrame } from "../../components/EntryFrame";
import { EntitySheet } from "../../components/EntitySheet";
import { PaymentMethodField } from "../../components/PaymentMethodField";
import { MoneyInput } from "../../components/ui/MoneyInput";
import { NumericInput } from "../../components/ui/NumericInput";
import { AppSelect } from "../../components/ui/AppSelect";
import { AppCombobox } from "../../components/ui/AppCombobox";
import { AppDatePicker } from "../../components/ui/AppDatePicker";
import { FormError, useFormError } from "../../components/ui/FormError";
import {
  TransactionAmount,
  TransactionDetails,
} from "../../components/TransactionFields";
import { CostTypeSchema, type CostType } from "../../domain/model";
import { parseAmount } from "../../domain/ledger";
import {
  canRecordContactCost,
  contactEntryPolicy,
  getContactEntryDefaults,
} from "../../domain/contactEntryPolicy";
import { moneyInputValue } from "../../lib/numericFields";
import { entryContext } from "../entries/entryContext";
import {
  QuickSavedDraftSchema,
  validQuickDate,
  type QuickDraft,
} from "../entries/quickEntry";
import { useInlineDraft } from "../entries/useInlineDraft";
import { recordHouseCost } from "./houseCost";
import { HouseSavedNotice } from "./HouseSavedNotice";
import { HouseAttachments } from "./HouseAttachments";
import { workDescriptionSuggestions } from "./workDescriptionSuggestions";
import {
  purchaseSuggestions,
  type PurchaseSuggestion,
} from "./purchaseSuggestions";
import {
  planHouseBillAdvance,
  applyHouseBillAdvance,
} from "../../domain/housePayments";

const readMoney = (value: string) => {
  try {
    return parseAmount(value);
  } catch {
    return 0;
  }
};
const contactSelectionSchema = z
  .object({
    id: z.string().max(160),
    name: z.string().max(200),
    newId: z.string().max(160),
  })
  .strict();
const savedSchema = QuickSavedDraftSchema.safeExtend({
  useAdvance: z.boolean().default(false),
  advanceSignature: z.string().max(1000000).default(""),
  purchaseContact: contactSelectionSchema.default(() => ({
    id: "",
    name: "",
    newId: "",
  })),
  payerContact: contactSelectionSchema.default(() => ({
    id: "",
    name: "",
    newId: "",
  })),
});

export function HouseCostForm({ action }: { action: "purchase" | "charge" }) {
  const { ledger, save, close, notify, mode } = useNotebook();
  const { t, money, formatDigits } = useLanguageContext();
  const [params] = useSearchParams();
  const paidEntry = action === "charge" && params.get("paid") === "yes";
  const initial = useMemo(() => {
    const requested = CostTypeSchema.safeParse(params.get("type")).data;
    const person = ledger.people.find((row) => row.id === params.get("person"));
    const policy = person ? contactEntryPolicy(person) : null;
    const costType =
      action === "purchase"
        ? "material"
        : requested && requested !== "material"
          ? requested
          : (policy?.chargeCostTypes[0] ?? "labour");
    const defaults = person
      ? getContactEntryDefaults(ledger, person, {
          workId: params.get("work") ?? undefined,
          contractId: params.get("contract") ?? undefined,
        })
      : null;
    const activeWorks = ledger.works.filter((work) => !work.archivedAt);
    const workId =
      params.get("work") ??
      (defaults?.workId || (activeWorks.length === 1 ? activeWorks[0].id : ""));
    const draft = entryContext(ledger, {
      kind: "expense",
      costType,
      account:
        costType === "material"
          ? "materials"
          : costType === "labour"
            ? "labour"
            : "other",
      personId: params.get("person") ?? undefined,
      workId: workId || undefined,
      contractId: params.get("contract") ?? undefined,
      milestoneId: params.get("milestone") ?? undefined,
    });
    return {
      draft: {
        ...draft,
        workId,
        rows: workId
          ? draft.rows
          : draft.rows.map((row) => ({
              ...row,
              label: "",
              groupId: "",
              groupName: "",
              unit: "",
            })),
        payment:
          action === "charge" && !paidEntry
            ? ("due" as const)
            : ("full" as const),
      },
      files: [],
      useAdvance: false,
      advanceSignature: "",
      purchaseContact: {
        id: draft.personId,
        name: draft.personName,
        newId: draft.personNewId,
      },
      payerContact: { id: "", name: "", newId: crypto.randomUUID() },
    };
  }, []);
  const key = `house-cost:${action}:${params.get("person") ?? "all"}:${params.get("work") ?? "all"}:${params.get("contract") ?? "none"}:${params.get("milestone") ?? "none"}${paidEntry ? ":paid" : ""}`;
  const { value, update, ready, failed, clear, flush } = useInlineDraft(
    key,
    savedSchema,
    initial,
  );
  const { draft, files } = value;
  const purchases = useMemo(
    () =>
      action === "purchase" ? purchaseSuggestions(ledger, draft.workId) : [],
    [action, ledger, draft.workId],
  );
  const descriptions = useMemo(
    () =>
      action === "charge"
        ? workDescriptionSuggestions(ledger, {
            costType: draft.costType,
            personId: draft.personId,
            workId: draft.workId,
            contractId: draft.contractId,
          })
        : [],
    [
      action,
      ledger,
      draft.costType,
      draft.personId,
      draft.workId,
      draft.contractId,
    ],
  );
  const person = ledger.people.find((row) => row.id === draft.personId);
  const policy = person ? contactEntryPolicy(person) : null;
  const compatible =
    !person ||
    canRecordContactCost(person, {
      costType: draft.costType,
      account: draft.account,
      reimbursement: draft.payment === "worker",
      contractId: draft.contractId,
    });
  const costTypes: CostType[] = policy?.chargeCostTypes ?? [
    "labour",
    "transport",
    "unload",
    "rental",
    "other",
  ];
  const [error, setError, errorNotice] = useFormError();
  const [invalidField, setInvalidField] = useState("");
  const [saving, setSaving] = useState(false);
  const [creatingWork, setCreatingWork] = useState(false);
  const lock = useRef(false);
  const finished = useRef(false);
  const field = <K extends keyof QuickDraft>(key: K, next: QuickDraft[K]) => {
    setError("");
    setInvalidField("");
    update((current) => ({
      ...current,
      draft: { ...current.draft, [key]: next },
    }));
  };
  const choosePayment = (payment: QuickDraft["payment"]) => {
    setError("");
    setInvalidField("");
    update((current) => {
      const wasPayer = current.draft.payment === "worker";
      const isPayer = payment === "worker";
      if (wasPayer === isPayer)
        return { ...current, draft: { ...current.draft, payment } };
      const selection = {
        id: current.draft.personId,
        name: current.draft.personName,
        newId: current.draft.personNewId,
      };
      const target = isPayer ? current.payerContact : current.purchaseContact;
      return {
        ...current,
        ...(wasPayer
          ? { payerContact: selection }
          : { purchaseContact: selection }),
        useAdvance: false,
        advanceSignature: "",
        draft: {
          ...current.draft,
          payment,
          personId: target.id,
          personName: target.name,
          personNewId: target.newId || crypto.randomUUID(),
          contractId: "",
          milestoneId: "",
        },
      };
    });
  };
  const choosePerson = (personId: string) => {
    const selected = ledger.people.find((row) => row.id === personId);
    const selectedPolicy = selected ? contactEntryPolicy(selected) : null;
    const defaults = selected
      ? getContactEntryDefaults(ledger, selected, {
          workId: draft.workId || undefined,
        })
      : null;
    const costType =
      action === "charge" &&
      selectedPolicy &&
      !selectedPolicy.chargeCostTypes.includes(draft.costType)
        ? (selectedPolicy.chargeCostTypes[0] ?? draft.costType)
        : draft.costType;
    setError("");
    setInvalidField("");
    update((current) => ({
      ...current,
      useAdvance: false,
      draft: {
        ...current.draft,
        personId,
        workId:
          defaults?.workId ||
          current.draft.workId ||
          (ledger.works.filter((work) => !work.archivedAt).length === 1
            ? ledger.works.find((work) => !work.archivedAt)!.id
            : ""),
        costType,
        account:
          costType === "material"
            ? "materials"
            : costType === "labour"
              ? "labour"
              : "other",
        contractId: "",
        milestoneId: "",
      },
    }));
  };
  const chooseWork = (workId: string) => {
    setError("");
    setInvalidField("");
    update((current) => {
      const contract = ledger.contracts.find(
        (row) =>
          row.id === current.draft.contractId &&
          !row.archivedAt &&
          (row.scope === "house" || row.workId === workId),
      );
      return {
        ...current,
        useAdvance: false,
        advanceSignature: "",
        draft: {
          ...current.draft,
          workId,
          contractId: contract?.id ?? "",
          milestoneId: contract ? current.draft.milestoneId : "",
        },
      };
    });
  };
  const newWork = async () => {
    try {
      await flush();
      setCreatingWork(true);
    } catch {
      setError(t("অসমাপ্ত লেখা রাখা যায়নি। বন্ধ করার আগে আবার চেষ্টা করুন।"));
    }
  };
  const total = draft.rows.reduce((sum, row) => sum + readMoney(row.amount), 0);
  const advance = useMemo(() => {
    if (
      !draft.personId ||
      draft.personId === "__new__" ||
      !draft.workId ||
      !Number.isSafeInteger(total) ||
      total <= 0
    )
      return null;
    return planHouseBillAdvance(ledger, {
      personId: draft.personId,
      workId: draft.workId,
      account: draft.account,
      contractId: draft.contractId || undefined,
      amount: total,
    });
  }, [
    ledger,
    draft.personId,
    draft.workId,
    draft.account,
    draft.contractId,
    total,
  ]);
  const advanceAccepted =
    value.useAdvance && value.advanceSignature === advance?.signature;
  const staleAdvance = value.useAdvance && !advanceAccepted;
  const advanceAmount = advanceAccepted ? (advance?.applied ?? 0) : 0;
  const payable = Math.max(0, total - advanceAmount);
  const paid =
    draft.payment === "full"
      ? payable
      : draft.payment === "partial"
        ? readMoney(draft.paid)
        : 0;
  const due = total - paid - advanceAmount;
  const contracts = ledger.contracts.filter(
    (row) =>
      (policy?.agreement ?? true) &&
      !row.archivedAt &&
      row.personId === draft.personId &&
      (row.scope === "house" || !draft.workId || row.workId === draft.workId),
  );
  const milestones =
    ledger.milestones?.filter((row) => row.contractId === draft.contractId) ??
    [];
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || !ready || failed || finished.current) return;
    lock.current = true;
    setSaving(true);
    setError("");
    setInvalidField("");
    let invalidTarget = "";
    try {
      for (const row of draft.rows) {
        if (readMoney(row.amount) <= 0) {
          invalidTarget = `amount:${row.id}`;
          throw new Error("amount");
        }
        if (!row.label.trim()) {
          invalidTarget = `label:${row.id}`;
          throw new Error("label");
        }
      }
      if (
        !draft.workId ||
        !ledger.works.some(
          (work) => work.id === draft.workId && !work.archivedAt,
        )
      ) {
        invalidTarget = "work";
        throw new Error("work");
      }
      if (!validQuickDate(draft.date)) throw new Error("date");
      if (staleAdvance) throw new Error("house_advance_changed");
      if (!compatible) throw new Error("contact_rules");
      if (
        ((draft.payment !== "full" || draft.costType === "labour") &&
          !draft.personId) ||
        (draft.personId === "__new__" && !draft.personName.trim())
      )
        throw new Error("person");
      if (
        !Number.isSafeInteger(total) ||
        total <= 0 ||
        due < 0 ||
        (draft.payment === "partial" && paid <= 0)
      )
        throw new Error("amount");
      await flush();
      await save((current) => {
        const normalized = {
          ...draft,
          kind: "expense" as const,
          payment:
            draft.payment === "worker"
              ? ("worker" as const)
              : paid === 0
                ? ("due" as const)
                : paid === total
                  ? ("full" as const)
                  : ("partial" as const),
          paid: moneyInputValue(paid),
        };
        let next = recordHouseCost(
          current,
          normalized,
          files.map((file) => ({
            id: file.id,
            name: file.name ?? t("ভাউচার"),
            mime: file.file.type,
            size: file.file.size,
          })),
          t("সাধারণ খরচ"),
        );
        if (advanceAmount && advance)
          next = applyHouseBillAdvance(next, draft.id, advance);
        return next;
      }, files);
      finished.current = true;
      try {
        await clear(initial);
      } catch {
        notify(t("হিসাব রাখা হয়েছে। অসমাপ্ত লেখার পুরোনো কপি পরে সরবে।"));
      }
      close();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      if (invalidTarget) setInvalidField(invalidTarget);
      else if (code === "person" || code === "contact_rules")
        setInvalidField("person");
      else if (code === "date") setInvalidField("date");
      else if (code === "amount" && draft.payment === "partial")
        setInvalidField("paid");
      setError(
        t(
          code === "contact_rules"
            ? "এই নামের নিয়মে এই হিসাব রাখা যাবে না। ধরন বা নাম বদলান।"
            : code === "house_advance_changed"
              ? "আগের অগ্রিম বদলেছে। নতুন প্রস্তাব দেখে আবার বেছে নিন।"
              : code === "duplicate"
                ? "এই হিসাব আগেই রাখা হয়েছে। আগের হিসাব খুলে দেখুন।"
                : code === "date"
                  ? "সঠিক তারিখ বেছে নিন।"
                  : code === "work"
                    ? "খাতা বেছে নিন।"
                    : code === "person"
                      ? draft.payment === "worker"
                        ? "কে দিয়েছেন, তাঁর নাম বেছে নিন।"
                        : "বাকি কার কাছে থাকবে, তাঁর নাম দিন।"
                      : code === "label"
                        ? "কী মাল বা কাজের বিল, লিখুন।"
                        : code === "amount"
                          ? "সঠিক টাকার অঙ্ক দিন। দেওয়া টাকা ও অগ্রিম যেন বিলের বেশি না হয়।"
                          : "খাতা বদলে থাকতে পারে। লেখা অক্ষত আছে; হিসাব দেখে আবার রাখুন।",
        ),
      );
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  const chooseType = (costType: CostType) =>
    update((current) => ({
      ...current,
      useAdvance: false,
      draft: {
        ...current.draft,
        costType,
        account: costType === "labour" ? "labour" : "other",
        contractId: "",
        milestoneId: "",
      },
    }));
  const savedEntryIds = [draft.id, draft.paymentId, draft.refundId].filter(
    (id) => ledger.entries.some((entry) => entry.id === id),
  );
  if (ready && savedEntryIds.length)
    return (
      <HouseSavedNotice
        title={t(action === "purchase" ? "মাল কিনেছি" : "কাজের বিল")}
        entryIds={savedEntryIds}
        onNew={async () => {
          const personNewId = crypto.randomUUID();
          await clear({
            ...initial,
            purchaseContact: { ...initial.purchaseContact, newId: personNewId },
            payerContact: { id: "", name: "", newId: crypto.randomUUID() },
            draft: {
              ...initial.draft,
              id: crypto.randomUUID(),
              paymentId: crypto.randomUUID(),
              refundId: crypto.randomUUID(),
              personNewId,
              rows: initial.draft.rows.map((row) => ({
                ...row,
                id: crypto.randomUUID(),
              })),
            },
          });
          finished.current = false;
          setError("");
        }}
      />
    );
  const closeSafely = async () => {
    try {
      await flush();
      close();
    } catch {
      setError(t("অসমাপ্ত লেখা রাখা যায়নি। বন্ধ করার আগে আবার চেষ্টা করুন।"));
    }
  };
  const rowField = (
    rowId: string,
    key: keyof QuickDraft["rows"][number],
    next: string,
  ) => {
    setError("");
    setInvalidField("");
    update((current) => ({
      ...current,
      draft: {
        ...current.draft,
        rows: current.draft.rows.map((row) =>
          row.id === rowId ? { ...row, [key]: next } : row,
        ),
      },
    }));
  };
  const choosePurchase = (rowId: string, choice: PurchaseSuggestion) => {
    setError("");
    setInvalidField("");
    update((current) => ({
      ...current,
      draft: {
        ...current.draft,
        rows: current.draft.rows.map((row) =>
          row.id === rowId
            ? {
                ...row,
                label: choice.value,
                groupId: choice.groupId,
                groupName: choice.groupName,
                brand: choice.brand,
                usage: choice.usage,
                quantity: choice.quantity,
                unit: choice.unit,
                autoItemName: choice.value,
              }
            : row,
        ),
      },
    }));
  };
  const errorId = "house-cost-error";
  const personLabel = action === "purchase" ? "কর্মী বা দোকান" : "কর্মী";
  const personInvalid = invalidField === "person";
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
            (work) => !ledger.works.some((previous) => previous.id === work.id),
          );
          if (!created) throw new Error("work");
          await save((current) => {
            if (current.works.some((work) => work.id === created.id))
              throw new Error("duplicate");
            return { ...current, works: [...current.works, created] };
          });
          chooseWork(created.id);
        }}
      />
    );
  return (
    <EntryFrame
      focusAmountWhenReady={ready && !failed && !saving}
      title={t(action === "purchase" ? "মাল কিনেছি" : "কাজের বিল")}
      onClose={() => void closeSafely()}
      busy={saving}
      className="transaction-page"
      footer={
        <div className="transaction-submit">
          <div>
            <small>{t("মোট টাকা")}</small>
            <strong>{money(Number.isSafeInteger(total) ? total : 0)}</strong>
          </div>
          <button
            className="primary-button"
            form="house-cost-form"
            type="submit"
            disabled={!ready || failed || saving}
          >
            {t(saving ? "রাখছি…" : "হিসাব রাখুন")}
          </button>
        </div>
      }
    >
      <form
        id="house-cost-form"
        className="transaction-form"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <FormError
          {...errorNotice}
          id={errorId}
          message={
            failed
              ? t(
                  "অসমাপ্ত লেখা খোলা বা রাখা যাচ্ছে না। লেখা অক্ষত রেখে আবার খুলুন।",
                )
              : error
          }
        />
        <fieldset disabled={!ready || failed || saving}>
          <div className="transaction-line-list">
            {draft.rows.map((row, index) => (
              <section
                className="transaction-line"
                key={row.id}
                aria-label={t(
                  action === "purchase" ? "মাল {{number}}" : "কাজ {{number}}",
                  { number: formatDigits(index + 1) },
                )}
              >
                {index === 0 ? (
                  <TransactionAmount
                    label={t(
                      action === "purchase" ? "মালের দাম" : "বিলের টাকা",
                    )}
                    inputLabel={t(
                      action === "purchase"
                        ? "মালের দাম {{number}}"
                        : "বিলের টাকা {{number}}",
                      {
                        number: formatDigits(index + 1),
                      },
                    )}
                    id={`house-cost-amount-${row.id}`}
                    value={row.amount}
                    onChange={(next) => rowField(row.id, "amount", next)}
                    required
                    error={
                      invalidField === `amount:${row.id}` ? error : undefined
                    }
                  />
                ) : null}
                <div
                  className={
                    index > 0 ? "transaction-grid" : "transaction-fields"
                  }
                >
                  <label>
                    {t(action === "purchase" ? "কী কিনেছেন" : "কী কাজ হয়েছে")}
                    {action === "charge" ? (
                      <AppCombobox
                        aria-label={t("কাজের বিবরণ {{number}}", {
                          number: formatDigits(index + 1),
                        })}
                        suggestions={descriptions}
                        required
                        maxLength={200}
                        value={row.label}
                        aria-invalid={invalidField === `label:${row.id}`}
                        aria-describedby={
                          invalidField === `label:${row.id}`
                            ? errorId
                            : descriptions.length
                              ? `work-description-hint-${row.id}`
                              : undefined
                        }
                        onChange={(event) =>
                          rowField(row.id, "label", event.target.value)
                        }
                      />
                    ) : (
                      <AppCombobox
                        suggestions={purchases}
                        fuzzy
                        onSuggestionSelect={(suggestion) => {
                          const choice = purchases.find(
                            (candidate) => candidate.id === suggestion.id,
                          );
                          if (choice) choosePurchase(row.id, choice);
                        }}
                        aria-label={t(
                          action === "purchase"
                            ? "মালের নাম {{number}}"
                            : "কাজের বিবরণ {{number}}",
                          { number: formatDigits(index + 1) },
                        )}
                        required
                        maxLength={200}
                        value={row.label}
                        aria-invalid={invalidField === `label:${row.id}`}
                        aria-describedby={
                          invalidField === `label:${row.id}`
                            ? errorId
                            : undefined
                        }
                        onChange={(event) =>
                          rowField(row.id, "label", event.target.value)
                        }
                      />
                    )}
                    {((action === "charge" && descriptions.length > 0) ||
                      (action === "purchase" && purchases.length > 0)) && (
                      <small
                        id={`work-description-hint-${row.id}`}
                        className="field-hint"
                      >
                        {t("আগের লেখা বেছে নিন বা নিজে লিখুন")}
                      </small>
                    )}
                  </label>
                  {index > 0 ? (
                    <label>
                      {t(action === "purchase" ? "মালের দাম" : "বিলের টাকা")}
                      <MoneyInput
                        aria-label={t(
                          action === "purchase"
                            ? "মালের দাম {{number}}"
                            : "বিলের টাকা {{number}}",
                          {
                            number: formatDigits(index + 1),
                          },
                        )}
                        required
                        value={row.amount}
                        aria-invalid={invalidField === `amount:${row.id}`}
                        aria-describedby={
                          invalidField === `amount:${row.id}`
                            ? errorId
                            : undefined
                        }
                        onChange={(event) =>
                          rowField(row.id, "amount", event.target.value)
                        }
                      />
                    </label>
                  ) : null}
                </div>
                {action === "purchase" && (
                  <TransactionDetails
                    summary={t("ব্র্যান্ড ও পরিমাণ")}
                    defaultOpen={Boolean(row.brand || row.quantity || row.unit)}
                  >
                    {action === "purchase" ? (
                      <label>
                        {t("ব্র্যান্ড")}
                        <input
                          aria-label={t("ব্র্যান্ড {{number}}", {
                            number: formatDigits(index + 1),
                          })}
                          maxLength={200}
                          value={row.brand}
                          onChange={(event) =>
                            rowField(row.id, "brand", event.target.value)
                          }
                        />
                      </label>
                    ) : null}
                    <div className="transaction-grid">
                      <label>
                        {t("পরিমাণ")}
                        <NumericInput
                          aria-label={t("পরিমাণ {{number}}", {
                            number: formatDigits(index + 1),
                          })}
                          maxLength={60}
                          value={row.quantity}
                          onChange={(event) =>
                            rowField(row.id, "quantity", event.target.value)
                          }
                        />
                      </label>
                      <label>
                        {t("একক")}
                        <input
                          aria-label={t("একক {{number}}", {
                            number: formatDigits(index + 1),
                          })}
                          maxLength={60}
                          value={row.unit}
                          onChange={(event) =>
                            rowField(row.id, "unit", event.target.value)
                          }
                          placeholder={t("যেমন: বস্তা, টি, দিন")}
                        />
                      </label>
                    </div>
                  </TransactionDetails>
                )}
                {draft.rows.length > 1 ? (
                  <button
                    type="button"
                    className="transaction-secondary"
                    aria-label={t("এই সারি সরান")}
                    onClick={() =>
                      field(
                        "rows",
                        draft.rows.filter((item) => item.id !== row.id),
                      )
                    }
                  >
                    <TrashIcon size={17} />
                    {t("সরান")}
                  </button>
                ) : null}
              </section>
            ))}
          </div>
          {action === "purchase" && (
            <button
              type="button"
              className="transaction-secondary"
              onClick={() =>
                field("rows", [
                  ...draft.rows,
                  {
                    ...initial.draft.rows[0],
                    id: crypto.randomUUID(),
                    label: "",
                    amount: "",
                    brand: "",
                    quantity: "",
                    unit: "",
                  },
                ])
              }
            >
              <PlusIcon size={17} />
              {t("আরও মাল")}
            </button>
          )}
          <div
            className={
              draft.payment === "worker"
                ? "transaction-fields"
                : "transaction-grid"
            }
          >
            {draft.payment !== "worker" && (
              <label>
                {t(personLabel)}
                <AppSelect
                  aria-label={t(personLabel)}
                  value={draft.personId}
                  aria-invalid={personInvalid}
                  aria-describedby={personInvalid ? errorId : undefined}
                  onChange={(event) => choosePerson(event.target.value)}
                >
                  <option value="">
                    {t(
                      action === "purchase" ? "না দিলেও হবে" : "কর্মী বেছে নিন",
                    )}
                  </option>
                  {ledger.people
                    .filter(
                      (row) =>
                        row.id === draft.personId ||
                        (!row.archivedAt &&
                          (action === "purchase"
                            ? canRecordContactCost(row, {
                                costType: "material",
                                account: "materials",
                              })
                            : contactEntryPolicy(row).chargeCostTypes.length >
                              0)),
                    )
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {formatDigits(row.name)}
                      </option>
                    ))}
                  <option value="__new__">{t("+ নাম লিখব")}</option>
                </AppSelect>
              </label>
            )}
            <label>
              {t("খাতা")}
              <AppSelect
                aria-label={t("খাতা")}
                required
                value={draft.workId}
                aria-invalid={invalidField === "work"}
                aria-describedby={invalidField === "work" ? errorId : undefined}
                onChange={(event) =>
                  event.target.value === "__new__"
                    ? void newWork()
                    : chooseWork(event.target.value)
                }
              >
                <option value="">{t("খাতা বেছে নিন")}</option>
                {ledger.works
                  .filter((work) => !work.archivedAt)
                  .map((work) => (
                    <option value={work.id} key={work.id}>
                      {formatDigits(work.name)}
                    </option>
                  ))}
                <option value="__new__">{t("+ নতুন খাতা বানান")}</option>
              </AppSelect>
            </label>
          </div>
          {draft.personId === "__new__" && draft.payment !== "worker" ? (
            <label>
              {t("নাম")}
              <input
                aria-label={t("নতুন নাম")}
                required
                maxLength={200}
                value={draft.personName}
                aria-invalid={personInvalid}
                aria-describedby={personInvalid ? errorId : undefined}
                onChange={(event) => field("personName", event.target.value)}
              />
            </label>
          ) : null}
          {action === "charge" ? (
            <label>
              {t("কীসের বিল")}
              <AppSelect
                aria-label={t("কীসের বিল")}
                value={draft.costType}
                onChange={(event) => chooseType(event.target.value as CostType)}
              >
                {[
                  ["labour", "মজুরি"],
                  ["transport", "গাড়িভাড়া"],
                  ["unload", "মাল নামানো"],
                  ["rental", "ভাড়া"],
                  ["other", "অন্য কাজ"],
                ]
                  .filter(([id]) => costTypes.includes(id as CostType))
                  .map(([id, label]) => (
                    <option key={id} value={id}>
                      {t(label)}
                    </option>
                  ))}
              </AppSelect>
            </label>
          ) : null}
          {draft.account === "labour" && contracts.length > 0 ? (
            <TransactionDetails
              summary={t("কাজ ও ধাপ")}
              defaultOpen={Boolean(draft.contractId)}
            >
              <label>
                {t("কোন কাজের জন্য")}
                <AppSelect
                  aria-label={t("কোন কাজের জন্য")}
                  value={draft.contractId}
                  onChange={(event) => {
                    const contract = contracts.find(
                      (row) => row.id === event.target.value,
                    );
                    update((current) => ({
                      ...current,
                      useAdvance: false,
                      draft: {
                        ...current.draft,
                        contractId: event.target.value,
                        milestoneId: "",
                        workId:
                          contract?.scope === "work"
                            ? contract.workId!
                            : current.draft.workId,
                      },
                    }));
                  }}
                >
                  <option value="">{t("চুক্তি ছাড়াই")}</option>
                  {contracts.map((contract) => (
                    <option key={contract.id} value={contract.id}>
                      {formatDigits(contract.title || t("কাজ"))}
                    </option>
                  ))}
                </AppSelect>
              </label>
              {milestones.length > 0 ? (
                <label>
                  {t("কাজের ধাপ")}
                  <AppSelect
                    aria-label={t("কাজের ধাপ")}
                    value={draft.milestoneId}
                    onChange={(event) =>
                      field("milestoneId", event.target.value)
                    }
                  >
                    <option value="">{t("ধাপ ছাড়াই বিল")}</option>
                    {milestones.map((step) => (
                      <option key={step.id} value={step.id}>
                        {formatDigits(step.title)}
                      </option>
                    ))}
                  </AppSelect>
                </label>
              ) : null}
            </TransactionDetails>
          ) : null}
          <div className="transaction-fields">
            <span className="transaction-label">{t("টাকা মিটিয়েছেন?")}</span>
            <div
              className="transaction-segments"
              role="group"
              aria-label={t("টাকা মিটিয়েছেন?")}
            >
              {(
                [
                  ["full", "পুরোটা", "পুরোটা দিয়েছি"],
                  ["partial", "কিছু", "কিছু দিয়েছি"],
                  ["due", "পরে দেব", "পরে দেব"],
                  ...(action === "purchase"
                    ? [["worker", "অন্যজন", "অন্যজন দিয়েছেন"]]
                    : []),
                ] as [QuickDraft["payment"], string, string][]
              ).map(([id, label, accessibleLabel]) => (
                <button
                  key={id}
                  type="button"
                  className={draft.payment === id ? "selected" : ""}
                  aria-pressed={draft.payment === id}
                  aria-label={t(accessibleLabel)}
                  onClick={() => choosePayment(id)}
                >
                  {t(label)}
                </button>
              ))}
            </div>
            {draft.payment === "worker" ? (
              <>
                <label>
                  {t("কে দিয়েছেন")}
                  <AppSelect
                    aria-label={t("কে দিয়েছেন")}
                    value={draft.personId}
                    aria-invalid={personInvalid}
                    aria-describedby={personInvalid ? errorId : undefined}
                    onChange={(event) => choosePerson(event.target.value)}
                  >
                    <option value="">{t("নাম বেছে নিন")}</option>
                    {ledger.people
                      .filter(
                        (row) =>
                          row.id === draft.personId ||
                          (!row.archivedAt &&
                            canRecordContactCost(row, {
                              costType: "material",
                              account: "materials",
                              reimbursement: true,
                            })),
                      )
                      .map((row) => (
                        <option key={row.id} value={row.id}>
                          {formatDigits(row.name)}
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
                      aria-invalid={personInvalid}
                      aria-describedby={personInvalid ? errorId : undefined}
                      onChange={(event) =>
                        field("personName", event.target.value)
                      }
                    />
                  </label>
                ) : null}
              </>
            ) : null}
            {draft.payment === "partial" ? (
              <label>
                {t("এখন কত দিয়েছি")}
                <MoneyInput
                  aria-label={t("এখন কত দিয়েছি")}
                  required
                  value={draft.paid}
                  aria-invalid={invalidField === "paid"}
                  aria-describedby={
                    invalidField === "paid" ? errorId : undefined
                  }
                  onChange={(event) => field("paid", event.target.value)}
                />
              </label>
            ) : null}
            {(draft.payment === "full" || draft.payment === "partial") && (
              <PaymentMethodField
                value={draft.method}
                onChange={(method) => field("method", method)}
                disabled={!ready || failed || saving}
              />
            )}
          </div>
          {staleAdvance ? (
            <div className="transaction-card">
              <p role="status">
                {t("আগের অগ্রিম বদলেছে। নতুন প্রস্তাব দেখে আবার বেছে নিন।")}
              </p>
              <button
                type="button"
                className="transaction-secondary"
                onClick={() =>
                  update({ ...value, useAdvance: false, advanceSignature: "" })
                }
              >
                {t("অগ্রিম না লাগিয়ে রাখি")}
              </button>
            </div>
          ) : null}
          {advance && advance.applied > 0 ? (
            <label className="transaction-check">
              <input
                type="checkbox"
                checked={advanceAccepted}
                onChange={(event) =>
                  update({
                    ...value,
                    useAdvance: event.target.checked,
                    advanceSignature: event.target.checked
                      ? advance.signature
                      : "",
                  })
                }
              />
              <span>
                {t("আগে দেওয়া অগ্রিম থেকে {{amount}} লাগাই", {
                  amount: money(advance.applied),
                })}
              </span>
            </label>
          ) : null}
          {!compatible ? (
            <p className="field-hint" role="status">
              {t("এই নামের নিয়মে এই হিসাব রাখা যাবে না। ধরন বা নাম বদলান।")}
            </p>
          ) : null}
          {total > 0 && (
            <section
              className="transaction-summary"
              aria-label={t("হিসাবের সারাংশ")}
              aria-live="polite"
            >
              <dl>
                <div>
                  <dt>{t("এখন টাকা গেছে")}</dt>
                  <dd>{money(paid)}</dd>
                </div>
                {advanceAmount > 0 ? (
                  <div>
                    <dt>{t("আগের অগ্রিম লাগবে")}</dt>
                    <dd>{money(advanceAmount)}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>{t("এই বিলে বাকি থাকবে")}</dt>
                  <dd>{money(Math.max(0, due))}</dd>
                </div>
              </dl>
            </section>
          )}
          <TransactionDetails
            summary={t("ভাউচার, নোট ও তারিখ")}
            defaultOpen={invalidField === "date"}
          >
            <HouseAttachments
              files={files}
              entryId={draft.id}
              onChange={(next) => update({ ...value, files: next })}
              onError={setError}
            />
            <label>
              {t("বাড়তি কথা")}
              <textarea
                maxLength={10000}
                value={draft.note}
                onChange={(event) => field("note", event.target.value)}
              />
            </label>
            <label>
              {t("তারিখ")}
              <AppDatePicker
                aria-label={t("তারিখ")}
                value={draft.date}
                aria-invalid={invalidField === "date"}
                aria-describedby={invalidField === "date" ? errorId : undefined}
                onChange={(event) => field("date", event.target.value)}
              />
            </label>
          </TransactionDetails>
        </fieldset>
      </form>
    </EntryFrame>
  );
}
