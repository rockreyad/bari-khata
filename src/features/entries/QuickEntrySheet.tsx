import { NumericInput } from "../../components/ui/NumericInput";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  CameraIcon,
  PackageIcon,
  CheckIcon,
  PlusIcon,
  TrashIcon,
  TruckIcon,
  HardHatIcon,
  CaretDownIcon,
} from "@phosphor-icons/react";
import { useNotebook, type AddOptions } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { AppCombobox } from "../../components/ui/AppCombobox";
import { materialItems, materialSuggestion } from "./materialSuggestion";
import { EntitySheet } from "../../components/EntitySheet";
import { AppSelect } from "../../components/ui/AppSelect";
import { AppDatePicker } from "../../components/ui/AppDatePicker";
import { MoneyInput } from "../../components/ui/MoneyInput";
import { FormError, useFormError } from "../../components/ui/FormError";
import {
  personKind,
  defaultContactAccount,
  contactAccountLedger,
} from "../../domain/contacts";
import { Sheet } from "../../components/Sheet";
import { EntryFrame } from "../../components/EntryFrame";
import { BalanceProgress } from "../../components/ui/BalanceProgress";
import { EntryPaymentPreview } from "./EntryPaymentPreview";
import { moneyInputValue } from "../../lib/numericFields";
import "./entry-page.css";
import { PaymentIcon } from "../../components/ui/Icons";
import {
  createWorkspaceStorage,
  type ReceiptInput,
} from "../../data/repository";
import {
  QuickSavedDraftSchema,
  buildQuickEntry,
  quickWageAmount,
  type QuickDraft,
} from "./quickEntry";
import {
  entryContext,
  entryContactChange,
  entryWorkChange,
  changeEntryType,
  restoreEntryContext,
  applicableQuickContracts,
  partyAccountBalance,
} from "./entryContext";
import { defaultTaxonomy } from "../../domain/importWallet";
import { parseAmount, contractSummary } from "../../domain/ledger";
import { contractAppliesToWork } from "../../domain/contracts";
import { getActiveOwner } from "../../data/database";
const draftFingerprint = (value: {
  draft: QuickDraft;
  files: ReceiptInput[];
}) =>
  JSON.stringify([
    value.draft,
    value.files.map(({ id, entryId, name, file }) => [
      id,
      entryId,
      name,
      file.type,
      file.size,
    ]),
  ]);
const row = () => ({
  id: crypto.randomUUID(),
  label: "",
  amount: "",
  groupId: "",
  groupName: "",
  autoItemName: "",
  brand: "",
  usage: "",
  quantity: "",
  unit: "",
});

const costNames = {
  material: "মালামাল",
  labour: "মজুরি",
  transport: "গাড়িভাড়া",
  unload: "মাল নামানো",
  rental: "ভাড়া",
  other: "অন্যান্য",
} as const;
export function QuickEntrySheet({
  options,
  presentation = "sheet",
}: {
  options: AddOptions;
  presentation?: "sheet" | "page";
}) {
  const { ledger, mode, save, close, notify } = useNotebook();
  const { t, money, formatDigits } = useLanguageContext();
  const storage = useMemo(() => createWorkspaceStorage(mode), [mode]);
  const baseDraftKey = `quick-v2:${options.kind ?? "expense"}:${options.workId ?? "all"}:${options.personId ?? "all"}${options.costType ? `:${options.costType}` : ""}`;
  const legacyKey = `${baseDraftKey}${options.purpose ? `:${options.purpose}` : ""}`;
  const accountDraftKey = `${legacyKey}${options.account ? `:account=${options.account}` : ""}`;
  const key = `${accountDraftKey}${options.contractId ? `:job=${options.contractId}` : ""}`;
  const [draft, setDraft] = useState(() => entryContext(ledger, options));
  const [ready, setReady] = useState(false);
  const [more, setMore] = useState(false);
  const [creatingWork, setCreatingWork] = useState(false);
  const [files, setFiles] = useState<ReceiptInput[]>([]);
  const [error, setError, errorNotice] = useFormError();
  const [invalidField, setInvalidField] = useState("");
  const [saving, setSaving] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(false);
  const hydrated = useRef(false);
  const owner = useRef(getActiveOwner());
  const queue = useRef(Promise.resolve());
  const latest = useRef({ draft, files });
  latest.current = { draft, files };
  const finished = useRef(false);
  const hydratedKeys = useRef(new Set([key]));
  const hydratedSources = useRef(new Map<string, string>());
  const queueDraft = useCallback(
    (value: { draft: QuickDraft; files: ReceiptInput[] }) => {
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
  const sameOwner = () => mode === "demo" || getActiveOwner() === owner.current;
  useEffect(() => {
    let active = true;
    void (async () => {
      const current = await storage.readDraft<unknown>(key);
      if (current != null) return current;
      for (const candidate of new Set([
        accountDraftKey,
        legacyKey,
        baseDraftKey,
      ])) {
        if (candidate === key) continue;
        const old = await storage.readDraft<unknown>(candidate);
        if (old == null) continue;
        const parsed = QuickSavedDraftSchema.parse(old);
        const context = entryContext(ledger, options);
        if (
          (!options.account || parsed.draft.account === context.account) &&
          (!options.purpose || parsed.draft.purpose === context.purpose) &&
          (!options.contractId ||
            parsed.draft.contractId === context.contractId)
        ) {
          hydratedKeys.current.add(candidate);
          hydratedSources.current.set(candidate, draftFingerprint(parsed));
          return old;
        }
      }
      return null;
    })()
      .then((value) => {
        if (!active) return;
        if (value !== null) {
          const parsed = QuickSavedDraftSchema.parse(value);
          const draftIds = [
            parsed.draft.id,
            parsed.draft.paymentId,
            parsed.draft.refundId,
          ].filter(Boolean);
          if (!ledger.entries.some((entry) => draftIds.includes(entry.id))) {
            const restored = restoreEntryContext(
              {
                ...parsed.draft,
                id: parsed.draft.id || draft.id,
                paymentId: parsed.draft.paymentId || draft.paymentId,
                refundId: parsed.draft.refundId || draft.refundId,
                personNewId: parsed.draft.personNewId || draft.personNewId,
                paymentPurposeNewId:
                  parsed.draft.paymentPurposeNewId || draft.paymentPurposeNewId,
              },
              draft,
            );
            latest.current = { draft: restored, files: parsed.files };
            setDraft(restored);
            setFiles(parsed.files);
          }
        }
        hydrated.current = true;
        setReady(true);
      })
      .catch(() => {
        if (active)
          setError(
            t(
              "আগের অসমাপ্ত লেখা খোলা যায়নি। তথ্য রাখা আছে; বন্ধ করে আবার খুলুন।",
            ),
          );
      });
    return () => {
      active = false;
    };
  }, [key, storage]);
  useEffect(() => {
    if (!ready || saving || finished.current) return;
    const timeout = window.setTimeout(() => {
      if (locked.current || finished.current) return;
      void queueDraft(latest.current).catch(() => {
        if (mounted.current) setError(t("অসমাপ্ত লেখা রাখা যাচ্ছে না।"));
      });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [draft, files, ready, saving, queueDraft, t]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (hydrated.current && !finished.current)
        void queueDraft(latest.current).catch(() => {});
    };
  }, [queueDraft]);
  const field = <K extends keyof QuickDraft>(name: K, value: QuickDraft[K]) => {
    setError("");
    setDraft((d) => ({
      ...d,
      [name]: value,
      ...(name === "personId" || name === "account"
        ? { paymentPurposeId: "", paymentPurposeName: "" }
        : {}),
      ...(name === "personId"
        ? entryContactChange(ledger, d, String(value))
        : name === "workId"
          ? entryWorkChange(ledger, d, String(value))
          : name === "personId" || (name === "account" && value !== "labour")
            ? { contractId: "" }
            : {}),
      ...(name === "personId" && options.purpose
        ? { purpose: options.purpose }
        : {}),
    }));
  };
  const changeRow = (id: string, change: Partial<QuickDraft["rows"][number]>) =>
    field(
      "rows",
      draft.rows.map((r) =>
        r.id === id
          ? {
              ...r,
              ...change,
              ...(!("autoItemName" in change) &&
              ["groupId", "brand", "usage", "unit"].some((key) => key in change)
                ? { autoItemName: "" }
                : {}),
            }
          : r,
      ),
    );
  const wage =
    draft.kind === "wage" ||
    (draft.kind === "payment" && draft.purpose === "wage");
  const charge = draft.kind === "payment" && draft.purpose === "charge";
  const cash =
    draft.kind === "refund" || (draft.kind === "payment" && !wage && !charge);
  let total = 0;
  try {
    total =
      cash || wage || charge
        ? wage
          ? quickWageAmount(draft)
          : parseAmount(draft.amount)
        : draft.rows.reduce(
            (sum, r) => sum + (r.amount ? parseAmount(r.amount) : 0),
            0,
          );
    if (!Number.isSafeInteger(total)) total = 0;
  } catch {
    total = 0;
  }
  const suggestedItems = useMemo(() => materialItems(ledger), [ledger]);
  const materialChoices = useMemo(
    () =>
      suggestedItems.flatMap((item) =>
        [item.name, ...item.aliases].map((name) => ({
          value: name,
          description: [
            name !== item.name ? item.name : "",
            item.brand,
            item.usage,
          ]
            .filter(Boolean)
            .join(" · "),
        })),
      ),
    [suggestedItems],
  );
  const groups = ledger.materialGroups.length
    ? ledger.materialGroups
    : defaultTaxonomy().materialGroups;
  const contracts = draft.personId
    ? applicableQuickContracts(ledger, draft.personId, draft.workId)
    : ledger.contracts.filter(
        (job) =>
          !job.archivedAt &&
          !ledger.people.find((person) => person.id === job.personId)
            ?.archivedAt &&
          (!draft.workId || contractAppliesToWork(job, draft.workId)),
      );
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (locked.current || !ready || finished.current) return;
    locked.current = true;
    setSaving(true);
    setError("");
    setInvalidField("");
    try {
      if (!sameOwner()) throw new Error("account_changed");
      await queueDraft({ draft, files });
      await save((current) => {
        if (!sameOwner()) throw new Error("account_changed");
        const enriched = current.materialGroups.length
          ? current
          : { ...current, materialGroups: groups };
        return buildQuickEntry(
          enriched,
          draft,
          files.map(({ id, file, name }) => ({
            id,
            name:
              typeof File !== "undefined" && file instanceof File
                ? file.name
                : (name ?? t("ভাউচার")),
            mime: file.type,
            size: file.size,
          })),
          t("সাধারণ খরচ"),
          t(
            draft.account === "labour"
              ? "মজুরি"
              : draft.account === "materials"
                ? "মালের দাম"
                : "কাজের বিল",
          ),
        );
      }, files);
      finished.current = true;
      await queue.current.catch(() => {});
      try {
        for (const draftKey of hydratedKeys.current) {
          const stored = await storage.readDraft<unknown>(draftKey);
          const parsed = QuickSavedDraftSchema.safeParse(stored);
          if (
            parsed.success &&
            (draftFingerprint(parsed.data) ===
              draftFingerprint({ draft, files }) ||
              hydratedSources.current.get(draftKey) ===
                draftFingerprint(parsed.data))
          )
            await storage.removeDraft(draftKey);
        }
      } catch {
        if (mounted.current && sameOwner())
          notify(t("হিসাব রাখা হয়েছে। অসমাপ্ত লেখার পুরোনো কপি পরে সরবে।"));
      }
      if (mounted.current && sameOwner()) close();
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      if (mounted.current) setInvalidField(code);
      if (mounted.current)
        setError(
          t(
            code === "person"
              ? "বাকি, অগ্রিম বা টাকা দেওয়ার হিসাব রাখতে ব্যক্তি বা দোকানের নাম দিন।"
              : code === "label"
                ? "কী বাবদ খরচ, ছোট করে লিখুন।"
                : code === "date"
                  ? "সঠিক তারিখ বেছে নিন।"
                  : code === "work"
                    ? "কোন কাজের খাতার টাকা, তা বেছে নিন।"
                    : code === "group"
                      ? "নতুন মালের ধরনটির নাম লিখুন।"
                      : code === "account_changed" ||
                          code === "account_inactive"
                        ? "খাতা বদলে গেছে। অসমাপ্ত লেখা আগের খাতায় রাখা আছে।"
                        : code === "refund"
                          ? "এই ফেরতের মূল্যের বেশি টাকা লিখেছেন। পুরোনো পাওনা পেলে আলাদা “টাকা ফেরত” লিখুন।"
                          : code === "duplicate"
                            ? "এই হিসাব আগেই রাখা হয়েছে। বন্ধ করে দেখুন।"
                            : code === "contract"
                              ? "মজুরির কাজ ও ব্যক্তির সঙ্গে নির্ধারিত দর মিলছে না।"
                              : code === "removed_entity"
                                ? "মুছে রাখা নাম, খাতা বা কাজ আগে ফিরিয়ে আনুন।"
                                : code === "person_kind"
                                  ? "মালের জন্য দোকান আর মজুরির জন্য মিস্ত্রির নাম বেছে নিন।"
                                  : "সঠিক টাকা ও প্রয়োজনীয় তথ্য দিন। হিসাব রাখা যায়নি।",
          ),
        );
    } finally {
      locked.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  async function requestClose() {
    if (locked.current) return;
    if (!hydrated.current) {
      close();
      return;
    }
    locked.current = true;
    setSaving(true);
    try {
      await queueDraft(latest.current);
      if (mounted.current && sameOwner()) close();
    } catch {
      if (mounted.current)
        setError(t("অসমাপ্ত লেখা রাখা যায়নি। বন্ধ করার আগে আবার চেষ্টা করুন।"));
    } finally {
      locked.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  const selectedPerson = ledger.people.find((p) => p.id === draft.personId);
  const removedJob = ledger.contracts.find(
    (job) => job.id === draft.contractId && job.archivedAt,
  );
  const removedSelection =
    selectedPerson?.archivedAt ||
    removedJob ||
    ledger.works.find((work) => work.id === draft.workId)?.archivedAt;
  const selectedKind = selectedPerson ? personKind(selectedPerson) : null;
  const canCreateWork = selectedKind !== "shop";
  const labour =
    wage ||
    (!cash &&
      (charge ? draft.account === "labour" : draft.costType === "labour"));
  const transport = ["transport", "unload"].includes(draft.costType);
  const material = draft.costType === "material";
  const returning = draft.kind === "return";
  const allowedPeople = ledger.people
    .filter((p) => !p.archivedAt)
    .filter((p) =>
      cash || draft.kind === "wage"
        ? true
        : labour
          ? personKind(p) === "worker" || personKind(p) === "other"
          : transport
            ? draft.costType === "transport"
              ? personKind(p) === "driver" || personKind(p) === "other"
              : personKind(p) === "other"
            : personKind(p) === "shop" || personKind(p) === "other",
    );
  const chooseType = (type: QuickDraft["costType"]) => {
    setError("");
    setDraft((current) => changeEntryType(ledger, current, type));
  };
  if (creatingWork)
    return (
      <EntitySheet
        kind="work"
        presentation={presentation}
        ledger={ledger}
        mode={mode}
        onClose={() => setCreatingWork(false)}
        onSave={async (next) => {
          const created = next.works.find(
            (work) => !ledger.works.some((existing) => existing.id === work.id),
          );
          if (!created) throw new Error("work");
          await save((current) => {
            if (!sameOwner()) throw new Error("account_changed");
            if (current.works.some((work) => work.id === created.id))
              throw new Error("duplicate");
            return { ...current, works: [...current.works, created] };
          });
          if (mounted.current && sameOwner()) field("workId", created.id);
        }}
      />
    );
  const formId = "quick-entry";
  const Frame = presentation === "page" ? EntryFrame : Sheet;
  const paidNow = cash
    ? total
    : draft.payment === "full"
      ? total
      : draft.payment === "partial"
        ? (() => {
            try {
              return parseAmount(draft.paid);
            } catch {
              return 0;
            }
          })()
        : 0;
  const prior = selectedPerson
    ? partyAccountBalance(
        contactAccountLedger(ledger, selectedPerson, draft.account),
        selectedPerson.id,
        draft.account,
        draft.contractId || null,
      )
    : null;
  const agreement = draft.contractId
    ? contractSummary(ledger, draft.contractId)
    : null;
  const title = returning
    ? "মাল ফেরত"
    : draft.kind === "refund"
      ? "টাকা ফেরত"
      : draft.kind === "payment"
        ? "টাকা দিই"
        : transport
          ? "গাড়িভাড়া দিই"
          : labour
            ? "মিস্ত্রির টাকা"
            : material
              ? "মাল কিনলাম"
              : "খরচ লিখি";
  return (
    <Frame
      title={t(title)}
      onClose={() => void requestClose()}
      footer={
        <div className="save-bar">
          <span>
            {t(returning ? "ফেরতের দাম" : "এখন দিচ্ছি")}
            <strong>{money(returning ? total : paidNow)}</strong>
          </span>
          <button
            className="primary-button"
            form={formId}
            type="submit"
            disabled={saving || !ready}
          >
            <CheckIcon size={19} />
            {t(saving ? "রাখছি…" : "রাখুন")}
          </button>
        </div>
      }
    >
      <form
        id={formId}
        className="entry-form-v3 entry-page-form"
        onSubmit={submit}
      >
        <FormError {...errorNotice} id={`${formId}-error`} />
        <fieldset disabled={saving || !ready} className="entry-fields-v3">
          {!cash &&
          !charge &&
          !returning &&
          draft.kind !== "wage" &&
          !["shop", "worker", "driver"].includes(selectedKind ?? "") ? (
            <div
              className="expense-sections"
              role="group"
              aria-label={t("হিসাবের ধরন")}
            >
              {(
                [
                  ["material", "মাল কেনা", PackageIcon],
                  ["labour", "মিস্ত্রির টাকা", HardHatIcon],
                  ["transport", "গাড়িভাড়া", TruckIcon],
                ] as const
              ).map(([type, label, Icon]) => {
                const selected =
                  draft.costType === type ||
                  (type === "transport" && draft.costType === "unload");
                return (
                  <button
                    type="button"
                    key={type}
                    aria-pressed={selected}
                    className={selected ? "selected" : ""}
                    onClick={() => chooseType(type)}
                  >
                    <Icon size={21} weight="duotone" aria-hidden="true" />
                    {t(label)}
                  </button>
                );
              })}
            </div>
          ) : null}
          {removedSelection ? (
            <p className="error-message" role="alert">
              {t("মুছে রাখা নাম, খাতা বা কাজ আগে ফিরিয়ে আনুন।")}
            </p>
          ) : null}
          <div className="entry-assignment">
            <label>
              {t("কাজের খাতা")}
              <AppSelect
                aria-label={t("কাজের খাতা")}
                aria-invalid={Boolean(error) && invalidField === "work"}
                aria-describedby={
                  error && invalidField === "work"
                    ? `${formId}-error`
                    : undefined
                }
                value={draft.workId}
                onChange={(e) => {
                  if (e.target.value === "__new__") setCreatingWork(true);
                  else field("workId", e.target.value);
                }}
              >
                <option value="">
                  {t(cash || wage ? "খাতা বেছে নিন" : "সাধারণ খরচ")}
                </option>
                {ledger.works
                  .filter((w) => !w.archivedAt || w.id === draft.workId)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {formatDigits(w.name)}
                      {w.archivedAt ? ` · ${t("মুছে রাখা")} ` : ""}
                    </option>
                  ))}
                {canCreateWork ? (
                  <option value="__new__">{t("+ নতুন খাতা খুলব")}</option>
                ) : null}
              </AppSelect>
            </label>
            <label>
              {t(
                cash || wage || charge
                  ? "কাকে দিচ্ছেন"
                  : labour
                    ? "কোন মিস্ত্রি"
                    : transport
                      ? "গাড়ির লোক / শ্রমিক"
                      : material
                        ? "কোন দোকান"
                        : "কার সঙ্গে হিসাব",
              )}
              <AppSelect
                value={draft.personId}
                aria-invalid={
                  Boolean(error) &&
                  ["person", "person_kind"].includes(invalidField)
                }
                aria-describedby={
                  error && ["person", "person_kind"].includes(invalidField)
                    ? `${formId}-error`
                    : undefined
                }
                onChange={(e) => field("personId", e.target.value)}
              >
                <option value="">
                  {t(cash || labour ? "নাম বেছে নিন" : "নাম না দিলেও হবে")}
                </option>
                {allowedPeople.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                {selectedPerson &&
                !allowedPeople.some((p) => p.id === selectedPerson.id) ? (
                  <option value={selectedPerson.id}>
                    {formatDigits(selectedPerson.name)}
                    {selectedPerson.archivedAt ? ` · ${t("মুছে রাখা")}` : ""}
                  </option>
                ) : null}
                <option value="__new__">{t("+ নাম লিখব")}</option>
              </AppSelect>
            </label>
          </div>
          {canCreateWork && !draft.workId ? (
            <button
              className="text-button"
              type="button"
              onClick={() => setCreatingWork(true)}
            >
              <PlusIcon size={17} />
              {t(
                ledger.works.some((work) => !work.archivedAt)
                  ? "নতুন কাজের খাতা খুলব"
                  : "আগে কাজের খাতা খুলুন",
              )}
            </button>
          ) : null}
          {draft.personId === "__new__" ? (
            <label>
              {t(
                cash
                  ? "নাম"
                  : labour
                    ? "মিস্ত্রির নাম"
                    : transport
                      ? "নাম"
                      : material
                        ? "দোকানের নাম"
                        : "নাম",
              )}
              <input
                value={draft.personName}
                onChange={(e) => field("personName", e.target.value)}
              />
            </label>
          ) : null}
          {((selectedKind === "worker" && draft.account === "labour") ||
            (draft.kind === "payment" && draft.account === "labour")) &&
          !returning ? (
            <section className="entry-worker-flow">
              {contracts.length || removedJob ? (
                <label>
                  {t("কাজ")}
                  <AppSelect
                    aria-label={t("কাজ")}
                    value={draft.contractId}
                    onChange={(e) => {
                      const job = contracts.find(
                        (job) => job.id === e.target.value,
                      );
                      setDraft((current) => ({
                        ...current,
                        personId: job?.personId ?? current.personId,
                        workId:
                          job?.scope === "work" ? job.workId! : current.workId,
                        contractId: job?.id ?? "",
                        kind: "payment",
                        purpose: "settle",
                        account: "labour",
                        costType: "labour",
                        payment: "full",
                      }));
                    }}
                  >
                    <option value="">{t("অন্য কাজ")}</option>
                    {removedJob ? (
                      <option value={removedJob.id}>
                        {formatDigits(removedJob.title || t("কাজ"))} ·{" "}
                        {t("মুছে রাখা")}
                      </option>
                    ) : null}
                    {contracts.map((contract) => (
                      <option key={contract.id} value={contract.id}>
                        {contract.title || money(contract.total)}
                        {!draft.personId
                          ? ` · ${ledger.people.find((person) => person.id === contract.personId)?.name ?? ""}`
                          : ""}
                      </option>
                    ))}
                  </AppSelect>
                </label>
              ) : null}
              {selectedKind === "worker" &&
              !draft.contractId &&
              !options.purpose ? (
                <div
                  className="entry-intent-options"
                  role="group"
                  aria-label={t("কিসের টাকা")}
                >
                  {(
                    [
                      ["wage", "কাজের টাকা"],
                      ["settle", "আগের বাকি"],
                      ["advance", "অগ্রিম"],
                    ] as const
                  ).map(([purpose, label]) => (
                    <button
                      key={purpose}
                      type="button"
                      aria-pressed={
                        draft.purpose === purpose ||
                        (draft.kind === "wage" && purpose === "wage")
                      }
                      className={
                        draft.purpose === purpose ||
                        (draft.kind === "wage" && purpose === "wage")
                          ? "selected"
                          : ""
                      }
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          kind: "payment",
                          purpose,
                          payment: "full",
                          account: "labour",
                          costType: "labour",
                        }))
                      }
                    >
                      {t(label)}
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
          {draft.kind === "payment" &&
          !draft.contractId &&
          !["worker", "shop"].includes(selectedKind ?? "") &&
          !options.purpose ? (
            <div
              className="entry-intent-options"
              role="group"
              aria-label={t("টাকার কারণ")}
            >
              {(
                [
                  ["charge", "নতুন বিল ও টাকা"],
                  ["settle", "বাকি মেটাই"],
                  ["advance", "অগ্রিম"],
                ] as const
              ).map(([purpose, label]) => (
                <button
                  key={purpose}
                  type="button"
                  aria-pressed={draft.purpose === purpose}
                  className={draft.purpose === purpose ? "selected" : ""}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      purpose,
                      contractId: "",
                      payment: "full",
                    }))
                  }
                >
                  {t(label)}
                </button>
              ))}
            </div>
          ) : null}
          {transport && !cash && selectedKind !== "driver" ? (
            <div
              className="small-switch"
              role="group"
              aria-label={t("খরচের ধরন")}
            >
              <button
                type="button"
                className={draft.costType === "transport" ? "selected" : ""}
                aria-pressed={draft.costType === "transport"}
                onClick={() => chooseType("transport")}
              >
                {t("গাড়িভাড়া")}
              </button>
              <button
                type="button"
                className={draft.costType === "unload" ? "selected" : ""}
                aria-pressed={draft.costType === "unload"}
                onClick={() => chooseType("unload")}
              >
                {t("মাল নামানোর খরচ")}
              </button>
            </div>
          ) : null}
          {wage && selectedKind === "worker" ? (
            <section className="entry-wage-basis">
              <div
                className="entry-intent-options"
                role="group"
                aria-label={t("মজুরির হিসাব")}
              >
                {(
                  [
                    ["total", "মোট টাকা"],
                    ["day", "দিন হিসাবে"],
                  ] as const
                ).map(([basis, label]) => (
                  <button
                    type="button"
                    key={basis}
                    className={draft.wageBasis === basis ? "selected" : ""}
                    aria-pressed={draft.wageBasis === basis}
                    onClick={() => field("wageBasis", basis)}
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
              {draft.wageBasis === "day" ? (
                <div className="field-grid">
                  <label>
                    {t("কত দিন")}
                    <NumericInput
                      aria-label={t("কত দিন")}
                      value={draft.wageDays}
                      onChange={(e) => field("wageDays", e.target.value)}
                    />
                  </label>
                  <label>
                    {t("দিনে কত টাকা")}
                    <MoneyInput
                      aria-label={t("দিনে কত টাকা")}
                      value={draft.wageRate}
                      onChange={(e) => field("wageRate", e.target.value)}
                    />
                  </label>
                </div>
              ) : null}
            </section>
          ) : null}
          {cash || wage || charge ? (
            <label className="entry-amount-label">
              {t("কত টাকা")}
              <div className="entry-amount-wrap">
                <span>৳</span>
                <MoneyInput
                  autoFocus
                  inputMode="decimal"
                  aria-label={t("কত টাকা")}
                  placeholder="0"
                  value={
                    wage && draft.wageBasis === "day"
                      ? moneyInputValue(total)
                      : draft.amount
                  }
                  readOnly={wage && draft.wageBasis === "day"}
                  onChange={(e) => field("amount", e.target.value)}
                />
              </div>
            </label>
          ) : (
            <div className="purchase-lines-v3">
              {draft.rows.map((r, index) => (
                <div className="purchase-line-v3" key={r.id}>
                  <label className="entry-amount-label">
                    {t("কত টাকা")}
                    <div className="entry-amount-wrap">
                      <span>৳</span>
                      <MoneyInput
                        autoFocus={!index}
                        aria-label={t("কত টাকা")}
                        value={r.amount}
                        placeholder="0"
                        onChange={(e) =>
                          changeRow(r.id, { amount: e.target.value })
                        }
                      />
                    </div>
                  </label>
                  <label>
                    {t(
                      labour
                        ? "কী কাজের মজুরি"
                        : !material
                          ? "কী বাবদ খরচ"
                          : returning
                            ? "কোন মাল ফেরত দিলেন"
                            : "কী কিনলেন",
                    )}
                    <AppCombobox
                      aria-invalid={
                        Boolean(error) &&
                        invalidField === "label" &&
                        !r.label.trim()
                      }
                      aria-describedby={
                        error && invalidField === "label" && !r.label.trim()
                          ? `${formId}-error`
                          : undefined
                      }
                      suggestions={material ? materialChoices : []}
                      value={r.label}
                      placeholder={t(
                        labour
                          ? "যেমন: এই সপ্তাহের প্লাস্টার"
                          : !material
                            ? transport
                              ? "যেমন: দরজা আনার ভাড়া"
                              : "যেমন: কাজের জায়গায় খাবার"
                            : "যেমন: সিমেন্ট, টাইলসের আঠা",
                      )}
                      onChange={(e) => {
                        changeRow(
                          r.id,
                          !material
                            ? { label: e.target.value }
                            : materialSuggestion(
                                suggestedItems,
                                e.target.value,
                                r,
                              ),
                        );
                      }}
                    />
                  </label>
                  {index ? (
                    <button
                      type="button"
                      className="text-button danger-text"
                      onClick={() =>
                        field(
                          "rows",
                          draft.rows.filter((v) => v.id !== r.id),
                        )
                      }
                    >
                      <TrashIcon size={15} />
                      {t(material ? "এই মাল বাদ দিন" : "এই খরচ বাদ দিন")}
                    </button>
                  ) : null}
                  {!labour && r.unit && (material || transport) ? (
                    <label>
                      {t("পরিমাণ")} · {formatDigits(r.unit)}
                      <NumericInput
                        inputMode="decimal"
                        aria-label={t("পরিমাণ")}
                        value={r.quantity}
                        onChange={(e) =>
                          changeRow(r.id, {
                            quantity: e.target.value,
                          })
                        }
                      />
                    </label>
                  ) : null}
                  {material || transport ? (
                    <details className="item-extra-v3">
                      <summary>
                        {t(
                          transport
                            ? "কিসের মাল এনেছেন"
                            : "ব্র্যান্ড ও পরিমাণ লিখি",
                        )}
                        <CaretDownIcon size={15} />
                      </summary>
                      <section className="line-meta-v3">
                        <div className="field-grid">
                          <label>
                            {t("মালের ধরন")}
                            <AppSelect
                              value={r.groupId}
                              onChange={(e) =>
                                changeRow(r.id, { groupId: e.target.value })
                              }
                            >
                              <option value="">{t("এখন দরকার নেই")}</option>
                              {groups.map((g) => (
                                <option key={g.id} value={g.id}>
                                  {g.name}
                                </option>
                              ))}
                              <option value="__new__">{t("+ নতুন ধরন")}</option>
                            </AppSelect>
                          </label>
                          {r.groupId === "__new__" ? (
                            <label>
                              {t("নতুন মালের ধরন")}
                              <input
                                value={r.groupName}
                                onChange={(e) =>
                                  changeRow(r.id, { groupName: e.target.value })
                                }
                              />
                            </label>
                          ) : (
                            <label>
                              {t("ব্র্যান্ড")}
                              <input
                                value={r.brand}
                                placeholder={t("যেমন: Crown")}
                                onChange={(e) =>
                                  changeRow(r.id, { brand: e.target.value })
                                }
                              />
                            </label>
                          )}
                          <label>
                            {t("কোথায় ব্যবহার হবে")}
                            <input
                              value={r.usage}
                              placeholder={t("যেমন: প্লাস্টারের বালু")}
                              onChange={(e) =>
                                changeRow(r.id, { usage: e.target.value })
                              }
                            />
                          </label>
                          <label>
                            {t("পরিমাণ ও একক")}
                            <div className="inline-fields">
                              <NumericInput
                                aria-label={t("পরিমাণ")}
                                value={r.quantity}
                                inputMode="decimal"
                                onChange={(e) =>
                                  changeRow(r.id, {
                                    quantity: e.target.value,
                                  })
                                }
                              />
                              <input
                                aria-label={t("একক")}
                                value={r.unit}
                                placeholder={t("বস্তা / ফুট")}
                                onChange={(e) =>
                                  changeRow(r.id, { unit: e.target.value })
                                }
                              />
                            </div>
                          </label>
                        </div>
                      </section>
                    </details>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {!cash && !wage && !charge && !labour && !transport ? (
            <button
              className="text-button add-line-v3"
              type="button"
              onClick={() => field("rows", [...draft.rows, row()])}
            >
              <PlusIcon size={17} />
              {t(material ? "আরেকটি মাল" : "আরেকটি খরচ")}
            </button>
          ) : null}
          {cash || charge ? (
            <section className="cash-purpose-v3">
              <details
                className="entry-cash-reason"
                open={
                  !selectedKind ||
                  selectedKind === "other" ||
                  !!draft.paymentPurposeId
                }
              >
                <summary>
                  {t("কারণ লিখি")}
                  <CaretDownIcon size={16} aria-hidden="true" />
                </summary>
                <div className="entry-cash-reason-body">
                  <label>
                    {t("কিসের টাকা")}
                    <AppSelect
                      value={draft.paymentPurposeId || draft.account}
                      onChange={(e) => {
                        const value = e.target.value;
                        const custom = ledger.paymentPurposes.find(
                          (p) => p.id === value,
                        );
                        setDraft((d) => ({
                          ...d,
                          paymentPurposeId: custom
                            ? custom.id
                            : value === "__new__"
                              ? value
                              : "",
                          paymentPurposeName: "",
                          account:
                            custom?.account ??
                            (["materials", "labour", "other"].includes(value)
                              ? (value as QuickDraft["account"])
                              : d.account),
                          contractId: "",
                          costType:
                            (custom?.account ?? value) === "labour"
                              ? "labour"
                              : (custom?.account ?? value) === "materials"
                                ? "material"
                                : selectedKind === "driver"
                                  ? "transport"
                                  : "other",
                        }));
                      }}
                    >
                      {!selectedKind ||
                      selectedKind === "other" ||
                      selectedKind === "shop" ||
                      draft.account === "materials" ? (
                        <option value="materials">{t("মালের টাকা")}</option>
                      ) : null}
                      {!selectedKind ||
                      selectedKind === "other" ||
                      selectedKind === "worker" ||
                      draft.account === "labour" ? (
                        <option value="labour">{t("মজুরি")}</option>
                      ) : null}
                      {!selectedKind ||
                      selectedKind === "other" ||
                      selectedKind === "driver" ||
                      draft.account === "other" ? (
                        <option value="other">
                          {t("গাড়িভাড়া / অন্য খরচ")}
                        </option>
                      ) : null}
                      {ledger.paymentPurposes
                        .filter(
                          (p) =>
                            !selectedKind ||
                            selectedKind === "other" ||
                            p.account ===
                              defaultContactAccount(selectedPerson!),
                        )
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      <option value="__new__">{t("+ নতুন কারণ লিখি")}</option>
                    </AppSelect>
                  </label>
                  {draft.paymentPurposeId === "__new__" ? (
                    <div className="payment-purpose-create">
                      <label>
                        {t("কিসের টাকা লিখুন")}
                        <input
                          value={draft.paymentPurposeName}
                          maxLength={200}
                          aria-describedby={`${formId}-purpose-hint`}
                          placeholder={t("যেমন: মাল নামানোর টাকা")}
                          onChange={(e) =>
                            field("paymentPurposeName", e.target.value)
                          }
                        />
                      </label>
                      {!selectedKind || selectedKind === "other" ? (
                        <label>
                          {t("কোন হিসাবের অংশ")}
                          <AppSelect
                            value={draft.account}
                            onChange={(e) =>
                              setDraft((d) => ({
                                ...d,
                                account: e.target
                                  .value as QuickDraft["account"],
                                contractId: "",
                                costType:
                                  e.target.value === "labour"
                                    ? "labour"
                                    : e.target.value === "materials"
                                      ? "material"
                                      : "other",
                              }))
                            }
                          >
                            <option value="materials">{t("মালের টাকা")}</option>
                            <option value="labour">{t("মজুরি")}</option>
                            <option value="other">{t("অন্য খরচ")}</option>
                          </AppSelect>
                        </label>
                      ) : (
                        <p className="account-label">
                          {t(
                            selectedKind === "worker"
                              ? "এটি মজুরির টাকা"
                              : selectedKind === "shop"
                                ? "এটি মালের টাকা"
                                : "এটি আনার খরচের টাকা",
                          )}
                        </p>
                      )}
                      <p className="field-hint" id={`${formId}-purpose-hint`}>
                        {t(
                          "টাকা রাখার সঙ্গে এই কারণও রাখা হবে। পরের বার তালিকায় পাবেন।",
                        )}
                      </p>
                    </div>
                  ) : null}
                </div>
              </details>
            </section>
          ) : null}
          {!cash && !returning ? (
            <section className="payment-state-v3">
              <span>{t("টাকা দিয়েছেন?")}</span>
              <div className="choice-chips">
                {(["full", "partial", "due"] as const).map((p) => (
                  <button
                    type="button"
                    key={p}
                    className={draft.payment === p ? "selected" : ""}
                    onClick={() => field("payment", p)}
                  >
                    {t(
                      p === "full"
                        ? "পুরো দিয়েছি"
                        : p === "partial"
                          ? "টাকা লিখি"
                          : "পরে দেব",
                    )}
                  </button>
                ))}
              </div>
              {draft.payment === "partial" ? (
                <label>
                  {t("এখন কত দিলেন")}
                  <MoneyInput
                    aria-label={t("এখন কত দিলেন")}
                    value={draft.paid}
                    onChange={(e) => field("paid", e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                  />
                </label>
              ) : null}
            </section>
          ) : null}
          {!returning && draft.kind !== "refund" && selectedPerson ? (
            agreement ? (
              <section className="entry-contract-progress">
                <h3>{t("কাজের হিসাব")}</h3>
                <BalanceProgress
                  total={agreement.agreed}
                  paid={agreement.netPaid + paidNow}
                />
              </section>
            ) : prior && (prior.balance !== 0 || total > 0 || paidNow > 0) ? (
              <EntryPaymentPreview
                previousBalance={prior.balance}
                currentCost={cash ? 0 : total}
                payment={paidNow}
              />
            ) : null
          ) : null}
          {cash ||
          (!returning && ["full", "partial"].includes(draft.payment)) ? (
            <div className="payment-methods compact-methods">
              {(["cash", "bkash", "bank"] as const).map((method) => (
                <button
                  type="button"
                  key={method}
                  className={draft.method === method ? "selected" : ""}
                  aria-pressed={draft.method === method}
                  onClick={() => field("method", method)}
                >
                  <PaymentIcon method={method} size={20} />
                  <span>
                    {t(
                      method === "cash"
                        ? "নগদ"
                        : method === "bkash"
                          ? "বিকাশ"
                          : "ব্যাংক",
                    )}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className="entry-more-toggle"
            onClick={() => setMore(!more)}
            aria-expanded={more}
          >
            {t(more ? "বাড়তি তথ্য বন্ধ করুন" : "আরও তথ্য যোগ করি")}
            <CaretDownIcon size={17} />
          </button>
          {more ? (
            <section className="entry-more-body">
              <div className="field-grid">
                <label>
                  {t("তারিখ")}
                  <AppDatePicker
                    required
                    value={draft.date}
                    onChange={(e) => field("date", e.target.value)}
                  />
                </label>
                {!cash &&
                !labour &&
                !returning &&
                (!selectedKind || selectedKind === "other") ? (
                  <label>
                    {t("খরচের ধরন")}
                    <AppSelect
                      value={draft.costType}
                      onChange={(e) =>
                        chooseType(e.target.value as QuickDraft["costType"])
                      }
                    >
                      {Object.entries(costNames).map(([id, label]) => (
                        <option key={id} value={id}>
                          {t(label)}
                        </option>
                      ))}
                    </AppSelect>
                  </label>
                ) : null}
              </div>
              <label>
                {t("নোট")}
                <textarea
                  rows={2}
                  value={draft.note}
                  onChange={(e) => field("note", e.target.value)}
                />
              </label>
              {returning ? (
                <label>
                  {t("নগদ টাকা ফেরত পেলে লিখুন")}
                  <MoneyInput
                    aria-label={t("নগদ টাকা ফেরত পেলে লিখুন")}
                    value={draft.refund}
                    placeholder="0"
                    onChange={(e) => field("refund", e.target.value)}
                  />
                </label>
              ) : null}
              <label className="attachment-button">
                <CameraIcon size={20} />
                {t("ভাউচারের ছবি / PDF")}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  multiple
                  onChange={(e) => {
                    const incoming = Array.from(e.target.files ?? []);
                    if (
                      incoming.some((file) => file.size > 10 * 1024 * 1024) ||
                      files.length + incoming.length > 20
                    ) {
                      setError(
                        t(
                          "প্রতিটি ভাউচার ১০ MB-এর মধ্যে রাখুন। সর্বোচ্চ ২০টি।",
                        ),
                      );
                      return;
                    }
                    setFiles([
                      ...files,
                      ...incoming.map((file) => ({
                        id: crypto.randomUUID(),
                        entryId: draft.id,
                        name: file.name,
                        file,
                      })),
                    ]);
                    e.target.value = "";
                  }}
                />
              </label>
              {files.map((f) => (
                <div className="attachment-row" key={f.id}>
                  <span>{formatDigits(f.name ?? t("ভাউচার"))}</span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t("বাদ দিন")}
                    onClick={() => setFiles(files.filter((v) => v.id !== f.id))}
                  >
                    <TrashIcon size={17} />
                  </button>
                </div>
              ))}
            </section>
          ) : null}
        </fieldset>
      </form>
    </Frame>
  );
}
