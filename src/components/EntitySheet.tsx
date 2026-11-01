import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
type Kind = "work" | "person" | "contract";
export type EntitySheetProps = {
  kind: Kind;
  ledger: Ledger;
  defaultWorkId?: string;
  defaultPersonId?: string;
  editId?: string;
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
  phone: z.string().default(""),
  workId: z.string().default(""),
  personId: z.string().default(""),
  newPersonId: z.string().default(""),
  newPersonName: z.string().default(""),
  title: z.string().default(""),
  basis: z.enum(["sqft", "day", "fixed"]).default("fixed"),
  quantity: z.string().default("1"),
  rate: z.string().default(""),
  total: z.string().default(""),
  notes: z.string().default(""),
  personContractId: z.string().default(""),
  personContractAmount: z.string().default(""),
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
function totalFor(quantity: string, rate: string) {
  const q = quantity
    .replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)))
    .replaceAll(",", "");
  if (!/^\d+(\.\d{1,4})?$/.test(q)) return 0;
  const [a, b = ""] = q.split(".");
  const divisor = 10n ** BigInt(b.length);
  const total = (BigInt(a + b) * BigInt(amount(rate)) + divisor / 2n) / divisor;
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : 0;
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
        rate: String(c.rate / 100),
        total: String(c.total / 100),
      });
  }
  return d;
}
export function EntitySheet({
  kind,
  ledger,
  defaultWorkId,
  defaultPersonId,
  editId,
  mode = "real",
  onSave,
  onClose,
}: EntitySheetProps) {
  const { t, money } = useLanguageContext();
  const storage = useMemo(() => createWorkspaceStorage(mode), [mode]);
  const [draft, setDraft] = useState(() =>
    initial(kind, ledger, editId, defaultWorkId, defaultPersonId),
  );
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const mounted = useRef(false);
  const latest = useRef(draft);
  latest.current = draft;
  const key = `entity:${kind}:${editId ?? defaultWorkId ?? "new"}:${defaultPersonId ?? "any"}`;
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
                  contactKind: initialValue.contactKind,
                  startedOn: initialValue.startedOn,
                  completedOn: initialValue.completedOn,
                  quickActions: initialValue.quickActions,
                  ...value,
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
            setDraft(parsed.data);
            setNotice(t("আগের লেখা ফিরিয়ে আনা হয়েছে।"));
          }
        }
        setReady(true);
      })
      .catch(() => {
        if (active) setError(t("আগের লেখা খোলা যায়নি। বন্ধ করে আবার খুলুন।"));
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [key, storage]);
  useEffect(() => {
    if (!ready || saving) return;
    const timeout = window.setTimeout(() => {
      void storage.saveDraft(key, draft).catch(() => {
        if (mounted.current) setError(t("লেখা রাখা যায়নি। আবার চেষ্টা করুন।"));
      });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [draft, key, storage, ready, saving, t]);
  const field = <K extends keyof Draft>(name: K, value: Draft[K]) => {
    setError("");
    setDraft((d) => ({ ...d, [name]: value }));
  };
  const total =
    draft.basis === "fixed"
      ? amount(draft.total)
      : totalFor(draft.quantity, draft.rate);
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
          phone: draft.phone.trim(),
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
          (!draft.workId || !amount(draft.personContractAmount))
        )
          throw new Error(t("চুক্তি রাখতে কাজ বেছে নিন ও মোট মজুরি লিখুন।"));
        next = savePersonWithContract(
          next,
          person,
          !editId && draft.contactKind === "worker"
            ? {
                id: draft.personContractId || `contract-${draft.id}`,
                workId: draft.workId,
                amount: draft.personContractAmount,
              }
            : undefined,
        );
      } else {
        if (!draft.workId || !total)
          throw new Error(t("কাজ বেছে নিন ও সঠিক টাকা লিখুন।"));
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
        if (!next.people.some((p) => p.id === personId))
          throw new Error(t("মিস্ত্রির নাম বেছে নিন।"));
        const previous = next.contracts.find((c) => c.id === editId);
        if (
          (!previous || previous.personId !== personId) &&
          personKind(next.people.find((p) => p.id === personId)!) !== "worker"
        )
          throw new Error(t("মজুরির দর রাখতে মিস্ত্রির নাম বেছে নিন।"));
        if (
          previous &&
          (previous.workId !== draft.workId ||
            previous.personId !== personId) &&
          next.entries.some((e) => e.contractId === previous.id)
        )
          throw new Error(
            t("এই দরে হিসাব আছে। কাজ বা নাম বদলাতে আলাদা দর রাখুন।"),
          );
        const contract = ContractSchema.parse({
          id: draft.id,
          workId: draft.workId,
          personId,
          title: draft.title.trim(),
          basis: draft.basis,
          quantity:
            draft.basis === "fixed"
              ? "1"
              : draft.quantity.replace(/[০-৯]/g, (d) =>
                  String("০১২৩৪৫৬৭৮৯".indexOf(d)),
                ),
          rate: draft.basis === "fixed" ? total : amount(draft.rate),
          total,
          notes: draft.notes,
          history: previous
            ? [
                ...previous.history,
                {
                  at: new Date().toISOString(),
                  total: previous.total,
                  note: previous.notes,
                },
              ]
            : [],
        });
        next.contracts = [
          ...next.contracts.filter((c) => c.id !== draft.id),
          contract,
        ];
      }
      await onSave(LedgerSchema.parse(next));
      try {
        await storage.removeDraft(key);
      } catch {}
      onClose();
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error && /[\u0980-\u09ff]/.test(cause.message)
            ? cause.message
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
      await storage.saveDraft(key, latest.current);
      onClose();
    } catch {
      setError(t("লেখা রাখা যায়নি। আবার চেষ্টা করুন।"));
      lock.current = false;
      setSaving(false);
    }
  }
  return (
    <Sheet
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
              ? "মজুরির দর বদলাই"
              : "মজুরির দর রাখি",
      )}
      onClose={() => void close()}
      footer={
        <button
          className="primary-button full-width"
          form="entity-form"
          type="submit"
          disabled={saving || !ready}
        >
          <CheckIcon size={19} />
          {t(saving ? "রাখছি…" : "রাখুন")}
        </button>
      }
    >
      <form id="entity-form" className="entity-form-v3" onSubmit={submit}>
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
                <input
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
                  <summary>{t("মোট মজুরি ঠিক করা আছে?")}</summary>
                  <div className="entity-extra-body">
                    <p className="field-hint">
                      {t(
                        "না থাকলে খালি রাখুন। শুধু মজুরির চুক্তি এখানে রাখবেন।",
                      )}
                    </p>
                    <label>
                      {t("কাজের খাতা")}
                      <AppSelect
                        value={draft.workId}
                        onChange={(e) => field("workId", e.target.value)}
                      >
                        <option value="">{t("খাতা বেছে নিন")}</option>
                        {ledger.works.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </AppSelect>
                    </label>
                    <label>
                      {t("মোট মজুরির চুক্তি")}
                      <MoneyInput
                        aria-label={t("মোট মজুরির চুক্তি")}
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
              <label>
                {t("কাজের খাতা")}
                <AppSelect
                  value={draft.workId}
                  onChange={(e) => field("workId", e.target.value)}
                  required
                >
                  <option value="">{t("খাতা বেছে নিন")}</option>
                  {ledger.works.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </AppSelect>
              </label>
              <label>
                {t("মিস্ত্রি")}
                <AppSelect
                  value={draft.personId}
                  onChange={(e) => field("personId", e.target.value)}
                  required
                >
                  <option value="">{t("নাম বেছে নিন")}</option>
                  {ledger.people
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
                {t("কী কাজের মজুরি")}
                <input
                  value={draft.title}
                  onChange={(e) => field("title", e.target.value)}
                  placeholder={t("যেমন: টাইলস বসানো")}
                />
              </label>
              <label>
                {t("মজুরির হিসাব")}
                <AppSelect
                  value={draft.basis}
                  onChange={(e) =>
                    field("basis", e.target.value as Draft["basis"])
                  }
                >
                  <option value="fixed">{t("এই কাজের মোট মজুরি")}</option>
                  <option value="sqft">{t("প্রতি বর্গফুট")}</option>
                  <option value="day">{t("প্রতি দিন")}</option>
                </AppSelect>
              </label>
              {draft.basis === "fixed" ? (
                <label>
                  {t("মোট মজুরি")}
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
                      <input
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
                    <span>{t("মোট মজুরি")}</span>
                    <strong>{money(total)}</strong>
                  </div>
                </>
              )}
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
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}
