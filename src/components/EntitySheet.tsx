import { saveContractChange } from "../domain/contracts";
import { contractSummary } from "../domain/ledger";
import { todayDhaka } from "../lib/display";
import { BalanceProgress } from "./ui/BalanceProgress";
import { EntryFrame } from "./EntryFrame";
import {
  numericDraftText,
  moneyInputValue,
  contractQuantity,
  contractTotal,
} from "../lib/numericFields";
import { NumericInput } from "./ui/NumericInput";
import { latinDigits } from "../lib/numerals";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  CheckIcon,
  HardHatIcon,
  StorefrontIcon,
  TruckIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { z } from "zod";
import { useLanguageContext } from "../context/LanguageProvider";
import { createWorkspaceStorage } from "../data/repository";
import {
  LedgerSchema,
  PersonSchema,
  WorkSchema,
  ContractSchema,
  type Ledger,
  type ContactAction,
  type WorkAction,
} from "../domain/model";
import { savePersonWithContract } from "../domain/personContract";
import { saveWorkChange } from "../domain/workActivity";
import {
  allowedContactActions,
  personKind,
  roleActions,
} from "../domain/contacts";
import { parseAmount } from "../domain/ledger";
import { Sheet } from "./Sheet";
import { WorkMark, workIconChoices, workColorChoices } from "./ui/Icons";
import { AppSelect } from "./ui/AppSelect";
import { AppDatePicker } from "./ui/AppDatePicker";
import { MoneyInput } from "./ui/MoneyInput";
import { ContactImport } from "./contacts/ContactImport";
import { FormError, useFormError } from "./ui/FormError";
import { MoneyCorrectionSummary } from "../features/reconciliation/MoneyCorrectionSummary";
type Kind = "work" | "person" | "contract";
export type EntitySheetProps = {
  presentation?: "sheet" | "page";
  kind: Kind;
  ledger: Ledger;
  defaultWorkId?: string;
  defaultPersonId?: string;
  editId?: string;
  reconciliation?: boolean;
  mode?: "real" | "demo";
  onSave: (ledger: Ledger) => Promise<void>;
  onClose: () => void;
};
const DraftSchema = z.object({
  id: z.string(),
  name: z.string().default(""),
  description: z.string().default(""),
  color: z.string().default("blue"),
  icon: z.string().default("home"),
  status: z.enum(["planned", "ongoing", "done"]).default("planned"),
  startedOn: z.string().nullable().default(null),
  completedOn: z.string().nullable().default(null),
  contactKind: z.enum(["worker", "shop", "driver", "other"]).default("shop"),
  quickActions: z.array(z.string()).nullable().default(null),
  role: z.string().default(""),
  phone: z.string().default("").transform(latinDigits),
  workId: z.string().default(""),
  personId: z.string().default(""),
  newPersonId: z.string().default(""),
  newPersonName: z.string().default(""),
  title: z.string().default(""),
  scope: z.enum(["work", "house"]).default("work"),
  agreedOn: z.string().nullable().default(null),
  contractReason: z.string().max(2000).default(""),
  jobStatus: z.enum(["planned", "ongoing", "done"]).nullable().default(null),
  jobStatusChanged: z.boolean().default(false),
  basis: z.enum(["sqft", "day", "fixed"]).default("fixed"),
  quantity: numericDraftText(60, "1"),
  rate: numericDraftText(),
  total: numericDraftText(),
  notes: z.string().default(""),
  personContractId: z.string().default(""),
  personContractAmount: numericDraftText(),
});
type Draft = z.infer<typeof DraftSchema>;
const personKinds = [
  { id: "shop", label: "দোকান", Icon: StorefrontIcon },
  { id: "worker", label: "মিস্ত্রি", Icon: HardHatIcon },
  { id: "driver", label: "গাড়ির লোক", Icon: TruckIcon },
  { id: "other", label: "অন্য ব্যক্তি", Icon: UserIcon },
] as const;
const personActionNames = {
  payment: "টাকা দিলাম",
  purchase: "মাল কেনা",
  return: "মাল ফেরত",
  transport: "আনার খরচ",
};
const workActionNames = {
  expense: "খরচ লিখি",
  payment: "টাকা দিলাম",
  labour: "মজুরি",
  transport: "আনা-নামানো",
};
function amount(value: string) {
  try {
    return parseAmount(value);
  } catch {
    return 0;
  }
}
function initial(
  kind: Kind,
  ledger: Ledger,
  editId?: string,
  workId?: string,
  personId?: string,
): Draft {
  let d = DraftSchema.parse({
    id: editId ?? crypto.randomUUID(),
    workId: workId ?? "",
    personId: personId ?? "",
    newPersonId: crypto.randomUUID(),
    personContractId: crypto.randomUUID(),
    scope: workId ? "work" : "house",
    agreedOn: todayDhaka(),
    jobStatus: kind === "contract" ? "ongoing" : null,
  });
  if (kind === "work") {
    const work = ledger.works.find((w) => w.id === editId);
    if (work) d = DraftSchema.parse({ ...d, ...work });
  }
  if (kind === "person") {
    const person = ledger.people.find((p) => p.id === editId);
    if (person)
      d = DraftSchema.parse({
        ...d,
        ...person,
        contactKind: personKind(person),
      });
  }
  if (kind === "contract") {
    const c = ledger.contracts.find((c) => c.id === editId);
    if (c)
      d = DraftSchema.parse({
        ...d,
        ...c,
        status: d.status,
        jobStatus: c.status ?? null,
        workId: c.workId ?? "",
        rate: moneyInputValue(c.rate),
        total: moneyInputValue(c.total),
      });
  }
  return d;
}
export function EntitySheet({
  presentation = "sheet",
  kind,
  ledger,
  defaultWorkId,
  defaultPersonId,
  editId,
  reconciliation = false,
  mode = "real",
  onSave,
  onClose,
}: EntitySheetProps) {
  const { t, money } = useLanguageContext();
  const storage = useMemo(() => createWorkspaceStorage(mode), [mode]);
  const originalContract =
    kind === "contract"
      ? ledger.contracts.find((contract) => contract.id === editId)
      : undefined;
  const identityLocked = Boolean(
    originalContract &&
    ledger.entries.some((entry) => entry.contractId === originalContract.id),
  );
  const [draft, setDraft] = useState(() =>
    initial(kind, ledger, editId, defaultWorkId, defaultPersonId),
  );
  const identityMismatch = Boolean(
    identityLocked &&
    originalContract &&
    (draft.personId !== originalContract.personId ||
      draft.scope !== originalContract.scope ||
      draft.workId !== (originalContract.workId ?? "")),
  );
  const notebookValue = draft.scope === "work" ? draft.workId : "";
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [, setError, errorNotice] = useFormError();
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const mounted = useRef(false);
  const hydrated = useRef(false);
  const finished = useRef(false);
  const queue = useRef(Promise.resolve());
  const latest = useRef(draft);
  latest.current = draft;
  const key = `entity:${kind}:${editId ?? defaultWorkId ?? "new"}:${defaultPersonId ?? "any"}`;
  const queueDraft = useCallback(
    (value: Draft) => {
      const next = queue.current
        .catch(() => {})
        .then(async () => {
          await storage.saveDraft(key, value);
        });
      queue.current = next;
      return next;
    },
    [key, storage],
  );
  useEffect(() => {
    mounted.current = true;
    let active = true;
    void storage
      .readDraft(key)
      .then((value) => {
        if (!active) return;
        if (value) {
          const initialValue = initial(
            kind,
            ledger,
            editId,
            defaultWorkId,
            defaultPersonId,
          );
          const parsed = DraftSchema.safeParse(
            typeof value === "object" && value && !Array.isArray(value)
              ? {
                  ...initialValue,
                  ...value,
                  ...(!("scope" in value) || value.scope === undefined
                    ? {
                        scope: editId
                          ? initialValue.scope
                          : (
                                "workId" in value
                                  ? value.workId
                                  : initialValue.workId
                              )
                            ? "work"
                            : "house",
                      }
                    : {}),
                  ...("workId" in value && value.workId === null
                    ? { workId: "" }
                    : {}),
                }
              : value,
          );
          if (
            parsed.success &&
            (!editId || parsed.data.id === editId) &&
            !(
              !editId &&
              [...ledger.works, ...ledger.people, ...ledger.contracts].some(
                (e) => e.id === parsed.data.id,
              )
            )
          ) {
            latest.current = parsed.data;
            setDraft(parsed.data);
            setNotice(t("আগের লেখা ফিরিয়ে আনা হয়েছে।"));
          }
        }
        hydrated.current = true;
        setReady(true);
      })
      .catch(() => {
        if (active) setError(t("আগের লেখা খোলা যায়নি। বন্ধ করে আবার খুলুন।"));
      });
    return () => {
      active = false;
      mounted.current = false;
      if (hydrated.current && !finished.current)
        void queueDraft(latest.current).catch(() => {});
    };
  }, [key, storage, queueDraft]);
  useEffect(() => {
    if (!ready || saving || finished.current) return;
    const timeout = window.setTimeout(() => {
      void queueDraft(draft).catch(() => {
        if (mounted.current) setError(t("লেখা রাখা যায়নি। আবার চেষ্টা করুন।"));
      });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [draft, queueDraft, ready, saving, t]);
  const field = <K extends keyof Draft>(name: K, value: Draft[K]) => {
    setError("");
    setDraft((d) => ({ ...d, [name]: value }));
  };
  const chooseNotebook = (workId: string) => {
    if (identityLocked) return;
    setError("");
    setDraft((current) => ({
      ...current,
      workId,
      scope: workId ? "work" : "house",
    }));
  };
  const restoreIdentity = () => {
    if (!originalContract) return;
    setError("");
    setDraft((current) => ({
      ...current,
      personId: originalContract.personId,
      workId: originalContract.workId ?? "",
      scope: originalContract.scope,
    }));
  };
  const total =
    draft.basis === "fixed"
      ? amount(draft.total)
      : contractTotal(draft.quantity, draft.rate);
  const allowed =
    kind === "person"
      ? roleActions[draft.contactKind]
      : Object.keys(workActionNames);
  const selected =
    draft.quickActions ??
    (kind === "person"
      ? allowedContactActions(
          PersonSchema.parse({
            id: draft.id,
            name: draft.name || "new",
            kind: draft.contactKind,
          }),
        )
      : ["expense", "payment"]);
  const toggle = (action: string) =>
    field(
      "quickActions",
      selected.includes(action)
        ? selected.filter((a) => a !== action)
        : [...selected, action],
    );
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (lock.current || !ready) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      if (identityMismatch)
        throw new Error(
          t("এই কাজে হিসাব আছে। মিস্ত্রি ও খাতা বদলানো যাবে না।"),
        );
      let next = structuredClone(ledger);
      if (kind !== "contract" && !draft.name.trim())
        throw new Error(t("নাম লিখুন।"));
      if (kind === "work") {
        const previous = next.works.find((w) => w.id === editId);
        const work = WorkSchema.parse({
          ...previous,
          id: draft.id,
          name: draft.name.trim(),
          description: draft.description.trim(),
          icon: draft.icon,
          color: draft.color,
          status: draft.status,
          startedOn: draft.startedOn || null,
          completedOn: draft.completedOn || null,
          quickActions: draft.quickActions as WorkAction[] | null,
        });
        next = saveWorkChange(next, work);
      } else if (kind === "person") {
        const person = PersonSchema.parse({
          ...next.people.find((p) => p.id === editId),
          id: draft.id,
          name: draft.name.trim(),
          phone: latinDigits(draft.phone.trim()),
          role: draft.role.trim(),
          kind: draft.contactKind,
          quickActions:
            draft.quickActions === null
              ? null
              : draft.quickActions.filter((a) =>
                  allowed.includes(a as ContactAction),
                ),
        });
        if (
          !editId &&
          draft.contactKind === "worker" &&
          draft.personContractAmount.trim() &&
          !amount(draft.personContractAmount)
        )
          throw new Error(t("কাজের সঠিক টাকা লিখুন।"));
        if (
          !editId &&
          draft.personContractAmount.trim() &&
          next.works.some(
            (work) => work.id === notebookValue && work.archivedAt,
          )
        )
          throw new Error(t("মুছে রাখা নাম, খাতা বা কাজ আগে ফিরিয়ে আনুন।"));
        next = savePersonWithContract(
          next,
          person,
          !editId && draft.contactKind === "worker"
            ? {
                id: draft.personContractId || `contract-${draft.id}`,
                workId: notebookValue || null,
                scope: notebookValue ? "work" : "house",
                agreedOn: draft.agreedOn,
                amount: draft.personContractAmount,
              }
            : undefined,
        );
      } else {
        if (reconciliation && editId && !draft.contractReason.trim())
          throw new Error(t("হিসাব মেলানোর কারণ লিখুন।"));
        if (!total) throw new Error(t("কাজের সঠিক টাকা লিখুন।"));
        let personId = draft.personId;
        if (personId === "__new__") {
          if (!draft.newPersonName.trim())
            throw new Error(t("মিস্ত্রির নাম লিখুন।"));
          personId = draft.newPersonId;
          next.people.push(
            PersonSchema.parse({
              id: personId,
              name: draft.newPersonName.trim(),
              kind: "worker",
              role: t("মিস্ত্রি"),
            }),
          );
        }
        if (
          !editId &&
          (next.people.some(
            (person) => person.id === personId && person.archivedAt,
          ) ||
            next.works.some(
              (work) => work.id === notebookValue && work.archivedAt,
            ))
        )
          throw new Error(t("মুছে রাখা নাম, খাতা বা কাজ আগে ফিরিয়ে আনুন।"));
        if (!next.people.some((p) => p.id === personId))
          throw new Error(t("মিস্ত্রির নাম বেছে নিন।"));
        const previous = next.contracts.find((c) => c.id === editId);
        if (
          (!previous || previous.personId !== personId) &&
          personKind(next.people.find((p) => p.id === personId)!) !== "worker"
        )
          throw new Error(t("মজুরির দর রাখতে মিস্ত্রির নাম বেছে নিন।"));
        const contract = ContractSchema.parse({
          id: draft.id,
          ...previous,
          workId:
            notebookValue ||
            (previous?.scope === "house" &&
            draft.scope === "house" &&
            draft.workId === (previous.workId ?? "")
              ? previous.workId
              : null),
          scope: notebookValue ? "work" : "house",
          agreedOn: draft.agreedOn || null,
          status:
            editId && !draft.jobStatusChanged
              ? (previous?.status ?? null)
              : draft.jobStatus,
          personId,
          title: draft.title.trim(),
          basis: draft.basis,
          quantity:
            draft.basis === "fixed"
              ? "1"
              : (contractQuantity(draft.quantity) ?? ""),
          rate: draft.basis === "fixed" ? total : amount(draft.rate),
          total,
          notes: draft.notes,
        });
        next = saveContractChange(next, contract, draft.contractReason);
      }
      await queueDraft(latest.current);
      await onSave(LedgerSchema.parse(next));
      finished.current = true;
      await queue.current.catch(() => {});
      try {
        await storage.removeDraft(key);
      } catch {}
      if (mounted.current) onClose();
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error && /[\u0980-\u09ff]/.test(cause.message)
            ? t(
                cause.message === "চুক্তি কেন বদলালেন, তা লিখুন।"
                  ? "কেন বদলালেন, তা লিখুন।"
                  : cause.message,
              )
            : t("তথ্য ঠিক হয়নি। নাম, তারিখ ও টাকা মিলিয়ে দেখুন।"),
        );
      lock.current = false;
      setSaving(false);
    }
  }
  async function close() {
    if (lock.current) return;
    if (!ready) {
      onClose();
      return;
    }
    lock.current = true;
    setSaving(true);
    try {
      await queueDraft(latest.current);
      finished.current = true;
      if (mounted.current) onClose();
    } catch {
      setError(t("লেখা রাখা যায়নি। আবার চেষ্টা করুন।"));
      lock.current = false;
      setSaving(false);
    }
  }
  const Frame = presentation === "page" ? EntryFrame : Sheet;
  return (
    <Frame
      title={t(
        kind === "work"
          ? editId
            ? "খাতার তথ্য"
            : "কাজের খাতা খুলব"
          : kind === "person"
            ? editId
              ? "নামের তথ্য"
              : "নাম যোগ করব"
            : editId
              ? "কাজ বদলাই"
              : "নতুন কাজ",
      )}
      onClose={() => void close()}
      footer={
        <button
          className="primary-button full-width"
          form="entity-form"
          type="submit"
          disabled={saving || !ready || identityMismatch}
        >
          <CheckIcon size={19} />
          {t(saving ? "রাখছি…" : "রাখুন")}
        </button>
      }
    >
      <form id="entity-form" className="entity-form-v3" onSubmit={submit}>
        <FormError {...errorNotice} className="form-error" />
        {notice ? (
          <p className="entity-notice" role="status">
            {notice}
          </p>
        ) : null}
        <fieldset disabled={!ready || saving} className="entity-fields-v3">
          {kind === "work" ? (
            <>
              <div className="work-preview">
                <WorkMark icon={draft.icon} color={draft.color} size={29} />
                <div>
                  <strong>{draft.name || t("আপনার কাজের খাতা")}</strong>
                  <span>{t("যেভাবে চিনতে সুবিধা হয়, সেভাবে সাজান।")}</span>
                </div>
              </div>
              <label>
                {t("কাজের নাম")}
                <input
                  autoFocus
                  placeholder={t("যেমন: বাথরুমের কাজ")}
                  value={draft.name}
                  maxLength={200}
                  required
                  onChange={(e) => field("name", e.target.value)}
                />
              </label>
              <section className="entity-section">
                <h3>{t("কাজ এখন কোন অবস্থায়?")}</h3>
                <div className="status-choices">
                  {(
                    [
                      ["planned", "শুরু হয়নি"],
                      ["ongoing", "চলছে"],
                      ["done", "শেষ"],
                    ] as const
                  ).map(([id, name]) => (
                    <button
                      type="button"
                      key={id}
                      aria-pressed={draft.status === id}
                      className={`${id} ${draft.status === id ? "selected" : ""}`}
                      onClick={() => field("status", id)}
                    >
                      <i />
                      {t(name)}
                      {draft.status === id ? <CheckIcon size={15} /> : null}
                    </button>
                  ))}
                </div>
              </section>
              <section className="entity-section">
                <h3>{t("চিহ্ন বেছে নিন")}</h3>
                <div className="work-icon-palette">
                  {workIconChoices.map((choice) => (
                    <button
                      type="button"
                      key={choice.id}
                      className={draft.icon === choice.id ? "selected" : ""}
                      aria-label={t(choice.label)}
                      aria-pressed={draft.icon === choice.id}
                      onClick={() => field("icon", choice.id)}
                    >
                      <WorkMark
                        icon={choice.id}
                        color={draft.color}
                        size={23}
                      />
                    </button>
                  ))}
                </div>
              </section>
              <section className="entity-section">
                <h3>{t("রং বেছে নিন")}</h3>
                <div className="work-color-palette">
                  {workColorChoices.map((choice) => (
                    <button
                      type="button"
                      key={choice.id}
                      style={
                        { "--swatch": choice.color } as React.CSSProperties
                      }
                      className={draft.color === choice.id ? "selected" : ""}
                      aria-label={t(choice.label)}
                      aria-pressed={draft.color === choice.id}
                      onClick={() => field("color", choice.id)}
                    >
                      {draft.color === choice.id ? (
                        <CheckIcon size={18} weight="bold" />
                      ) : null}
                    </button>
                  ))}
                </div>
              </section>
              <details className="entity-extra">
                <summary>{t("তারিখ, বিবরণ ও পছন্দের বোতাম")}</summary>
                <div className="entity-extra-body">
                  <div className="field-grid">
                    <label>
                      {t("কাজ শুরুর তারিখ")}
                      <AppDatePicker
                        value={draft.startedOn ?? ""}
                        onChange={(e) =>
                          field("startedOn", e.target.value || null)
                        }
                      />
                    </label>
                    <label>
                      {t("কাজ শেষের তারিখ")}
                      <AppDatePicker
                        value={draft.completedOn ?? ""}
                        min={draft.startedOn ?? undefined}
                        onChange={(e) =>
                          field("completedOn", e.target.value || null)
                        }
                      />
                    </label>
                  </div>
                  <label>
                    {t("আর কিছু লিখবেন?")}
                    <textarea
                      rows={2}
                      value={draft.description}
                      onChange={(e) => field("description", e.target.value)}
                    />
                  </label>
                  <h3>{t("এই খাতায় কোন বোতাম রাখবেন?")}</h3>
                  <div className="preset-options">
                    {Object.entries(workActionNames).map(([id, label]) => (
                      <button
                        type="button"
                        key={id}
                        aria-pressed={selected.includes(id)}
                        className={selected.includes(id) ? "selected" : ""}
                        onClick={() => toggle(id)}
                      >
                        <span>
                          {selected.includes(id) ? (
                            <CheckIcon size={14} />
                          ) : null}
                        </span>
                        {t(label)}
                      </button>
                    ))}
                  </div>
                </div>
              </details>
            </>
          ) : kind === "person" ? (
            <>
              <section className="contact-kind-choices">
                {personKinds.map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={draft.contactKind === id}
                    className={draft.contactKind === id ? "selected" : ""}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        contactKind: id,
                        quickActions: null,
                      }))
                    }
                  >
                    <Icon size={26} weight="duotone" />
                    <span>{t(label)}</span>
                  </button>
                ))}
              </section>
              <label>
                {t(draft.contactKind === "shop" ? "দোকানের নাম" : "নাম")}
                <input
                  autoFocus
                  value={draft.name}
                  onChange={(e) => field("name", e.target.value)}
                  required
                  maxLength={200}
                  placeholder={t("নাম লিখুন")}
                />
              </label>
              <label>
                {t("ফোন নম্বর")}
                <NumericInput
                  type="tel"
                  value={draft.phone}
                  onChange={(e) => field("phone", e.target.value)}
                  placeholder={t("না দিলেও হবে")}
                />
              </label>
              <ContactImport
                onPick={({ name, phone }) => {
                  setError("");
                  setDraft((current) => ({
                    ...current,
                    name: current.name.trim() ? current.name : name,
                    phone,
                  }));
                }}
              />
              {!editId && draft.contactKind === "worker" ? (
                <details className="entity-extra">
                  <summary>{t("কাজের টাকা")}</summary>
                  <div className="entity-extra-body">
                    <p className="field-hint">{t("না থাকলে খালি রাখুন।")}</p>
                    <label>
                      {t("কাজের খাতা")}
                      <AppSelect
                        value={notebookValue}
                        onChange={(event) => chooseNotebook(event.target.value)}
                      >
                        <option value="">{t("পরে বেছে নেব")}</option>
                        {ledger.works
                          .filter(
                            (work) =>
                              !work.archivedAt ||
                              (Boolean(editId) && work.id === notebookValue),
                          )
                          .map((work) => (
                            <option key={work.id} value={work.id}>
                              {work.name}
                            </option>
                          ))}
                      </AppSelect>
                    </label>
                    <label>
                      {t("কাজের টাকা")}
                      <MoneyInput
                        aria-label={t("কাজের টাকা")}
                        value={draft.personContractAmount}
                        onChange={(e) =>
                          field("personContractAmount", e.target.value)
                        }
                        placeholder={t("যেমন: ৬০০০০০")}
                      />
                    </label>
                  </div>
                </details>
              ) : null}
              <details className="entity-extra">
                <summary>{t("পরিচয় ও পছন্দের বোতাম")}</summary>
                <div className="entity-extra-body">
                  <label>
                    {t("কী কাজ করেন / কীসের দোকান")}
                    <input
                      value={draft.role}
                      onChange={(e) => field("role", e.target.value)}
                      placeholder={t("যেমন: টাইলস মিস্ত্রি / রডের দোকান")}
                    />
                  </label>
                  <h3>{t("এই নামে কোন বোতাম রাখবেন?")}</h3>
                  <div className="preset-options">
                    {(allowed as ContactAction[]).map((id) => (
                      <button
                        type="button"
                        key={id}
                        aria-pressed={selected.includes(id)}
                        className={selected.includes(id) ? "selected" : ""}
                        onClick={() => toggle(id)}
                      >
                        <span>
                          {selected.includes(id) ? (
                            <CheckIcon size={14} />
                          ) : null}
                        </span>
                        {t(personActionNames[id])}
                      </button>
                    ))}
                  </div>
                </div>
              </details>
            </>
          ) : (
            <>
              {identityMismatch ? (
                <div className="entity-notice" role="alert">
                  <p>
                    {t("এই কাজে হিসাব আছে। মিস্ত্রি ও খাতা বদলানো যাবে না।")}
                  </p>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={restoreIdentity}
                  >
                    {t("আগের মিস্ত্রি ও খাতা রাখি")}
                  </button>
                </div>
              ) : identityLocked ? (
                <p className="field-hint">
                  {t("এই কাজে হিসাব আছে। মিস্ত্রি ও খাতা বদলানো যাবে না।")}
                </p>
              ) : null}
              <label>
                {t("কাজের নাম")}
                <input
                  value={draft.title}
                  onChange={(event) => field("title", event.target.value)}
                  maxLength={300}
                  placeholder={t("যেমন: দরজা লাগানো")}
                />
              </label>
              <label>
                {t("কাজের অবস্থা")}
                <AppSelect
                  aria-label={t("কাজের অবস্থা")}
                  value={draft.jobStatus ?? ""}
                  onChange={(event) => {
                    field(
                      "jobStatus",
                      event.target.value
                        ? (event.target.value as Draft["jobStatus"])
                        : null,
                    );
                    field("jobStatusChanged", true);
                  }}
                >
                  <option value="">{t("অবস্থা দিন")}</option>
                  <option value="planned">{t("শুরু হয়নি")}</option>
                  <option value="ongoing">{t("চলছে")}</option>
                  <option value="done">{t("শেষ")}</option>
                </AppSelect>
              </label>
              <label>
                {t("কাজের খাতা")}
                <AppSelect
                  value={notebookValue}
                  onChange={(event) => chooseNotebook(event.target.value)}
                  disabled={identityLocked}
                >
                  <option value="">{t("পরে বেছে নেব")}</option>
                  {ledger.works
                    .filter(
                      (work) =>
                        !work.archivedAt ||
                        (Boolean(editId) && work.id === notebookValue),
                    )
                    .map((work) => (
                      <option key={work.id} value={work.id}>
                        {work.name}
                      </option>
                    ))}
                </AppSelect>
              </label>
              <label>
                {t("মিস্ত্রি")}
                <AppSelect
                  value={draft.personId}
                  onChange={(e) => {
                    if (!identityLocked) field("personId", e.target.value);
                  }}
                  disabled={identityLocked}
                  required
                >
                  <option value="">{t("নাম বেছে নিন")}</option>
                  {ledger.people
                    .filter(
                      (person) =>
                        !person.archivedAt ||
                        (Boolean(editId) && person.id === draft.personId),
                    )
                    .filter(
                      (p) =>
                        personKind(p) === "worker" || p.id === draft.personId,
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  <option value="__new__">{t("+ নাম লিখব")}</option>
                </AppSelect>
              </label>
              {draft.personId === "__new__" ? (
                <label>
                  {t("মিস্ত্রির নাম")}
                  <input
                    value={draft.newPersonName}
                    onChange={(e) => field("newPersonName", e.target.value)}
                    required
                  />
                </label>
              ) : null}
              <label>
                {t("দর ঠিক হয়েছে")}
                <AppSelect
                  value={draft.basis}
                  onChange={(e) =>
                    field("basis", e.target.value as Draft["basis"])
                  }
                >
                  <option value="fixed">{t("মোট টাকা")}</option>
                  <option value="sqft">{t("প্রতি বর্গফুট")}</option>
                  <option value="day">{t("প্রতি দিন")}</option>
                </AppSelect>
              </label>
              {draft.basis === "fixed" ? (
                <label>
                  {t("কাজের টাকা")}
                  <MoneyInput
                    inputMode="decimal"
                    value={draft.total}
                    onChange={(e) => field("total", e.target.value)}
                    placeholder="0"
                  />
                </label>
              ) : (
                <>
                  <div className="field-grid">
                    <label>
                      {t(draft.basis === "sqft" ? "কত বর্গফুট" : "কত দিন")}
                      <NumericInput
                        inputMode="decimal"
                        value={draft.quantity}
                        onChange={(e) => field("quantity", e.target.value)}
                      />
                    </label>
                    <label>
                      {t("প্রতি এককের দর")}
                      <MoneyInput
                        value={draft.rate}
                        onChange={(e) => field("rate", e.target.value)}
                        inputMode="decimal"
                      />
                    </label>
                  </div>
                  <div className="contract-calculation">
                    <span>{t("কাজের টাকা")}</span>
                    <strong>{money(total)}</strong>
                  </div>
                </>
              )}
              <label>
                {t("দর ঠিকের তারিখ")}
                <AppDatePicker
                  value={draft.agreedOn ?? ""}
                  onChange={(event) =>
                    field("agreedOn", event.target.value || null)
                  }
                />
              </label>
              {reconciliation && originalContract ? (
                <MoneyCorrectionSummary
                  before={originalContract.total}
                  after={total}
                />
              ) : null}
              {total > 0 ? (
                <BalanceProgress
                  total={total}
                  paid={editId ? contractSummary(ledger, editId).netPaid : 0}
                  label={t("দিয়েছি ও বাকি")}
                />
              ) : null}
              {editId ? (
                <label>
                  {t("কেন বদলালেন")}
                  <textarea
                    value={draft.contractReason}
                    onChange={(event) =>
                      field("contractReason", event.target.value)
                    }
                    placeholder={t("যেমন: সিঁড়ির কাজ যোগ হয়েছে")}
                    rows={2}
                  />
                </label>
              ) : null}
              <label>
                {t("নোট")}
                <textarea
                  value={draft.notes}
                  onChange={(e) => field("notes", e.target.value)}
                  rows={2}
                />
              </label>
            </>
          )}
        </fieldset>
      </form>
    </Frame>
  );
}
