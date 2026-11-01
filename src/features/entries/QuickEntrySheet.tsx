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
import { materialSuggestion } from "./materialSuggestion";
import { AppSelect } from "../../components/ui/AppSelect";
import { AppDatePicker } from "../../components/ui/AppDatePicker";
import { MoneyInput } from "../../components/ui/MoneyInput";
import { personKind, defaultContactAccount } from "../../domain/contacts";
import { Sheet } from "../../components/Sheet";
import { PaymentIcon } from "../../components/ui/Icons";
import {
  createWorkspaceStorage,
  type ReceiptInput,
} from "../../data/repository";
import {
  QuickSavedDraftSchema,
  buildQuickEntry,
  type QuickDraft,
} from "./quickEntry";
import {
  entryContext,
  entryContactChange,
  restoreEntryContext,
} from "./entryContext";
import { defaultTaxonomy } from "../../domain/importWallet";
import { parseAmount } from "../../domain/ledger";
import { getActiveOwner } from "../../data/database";
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
export function QuickEntrySheet({ options }: { options: AddOptions }) {
  const { ledger, mode, save, close, notify } = useNotebook();
  const { t, money } = useLanguageContext();
  const storage = useMemo(() => createWorkspaceStorage(mode), [mode]);
  const key = `quick-v2:${options.kind ?? "expense"}:${options.workId ?? "all"}:${options.personId ?? "all"}${options.costType ? `:${options.costType}` : ""}`;
  const [draft, setDraft] = useState(() => entryContext(ledger, options));
  const [ready, setReady] = useState(false);
  const [more, setMore] = useState(false);
  const [files, setFiles] = useState<ReceiptInput[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(false);
  const hydrated = useRef(false);
  const owner = useRef(getActiveOwner());
  const queue = useRef(Promise.resolve());
  const latest = useRef({ draft, files });
  latest.current = { draft, files };
  const finished = useRef(false);
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
    void storage
      .readDraft<unknown>(key)
      .then((value) => {
        if (!active) return;
        if (value !== null) {
          const parsed = QuickSavedDraftSchema.parse(value);
          if (!ledger.entries.some((entry) => entry.id === parsed.draft.id)) {
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
          ? {
              contractId:
                ledger.contracts.filter(
                  (c) => c.personId === d.personId && c.workId === value,
                ).length === 1 && d.account === "labour"
                  ? ledger.contracts.find(
                      (c) => c.personId === d.personId && c.workId === value,
                    )!.id
                  : "",
            }
          : name === "personId" || (name === "account" && value !== "labour")
            ? { contractId: "" }
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
  const cash = draft.kind === "refund" || (draft.kind === "payment" && !wage);
  let total = 0;
  try {
    total =
      cash || wage
        ? parseAmount(draft.amount)
        : draft.rows.reduce(
            (sum, r) => sum + (r.amount ? parseAmount(r.amount) : 0),
            0,
          );
  } catch {
    total = 0;
  }
  const groups = ledger.materialGroups.length
    ? ledger.materialGroups
    : defaultTaxonomy().materialGroups;
  const contracts = ledger.contracts.filter(
    (c) => c.workId === draft.workId && c.personId === draft.personId,
  );
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (locked.current || !ready || finished.current) return;
    locked.current = true;
    setSaving(true);
    setError("");
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
        );
      }, files);
      finished.current = true;
      try {
        await storage.removeDraft(key);
      } catch {
        if (mounted.current && sameOwner())
          notify(t("হিসাব রাখা হয়েছে। অসমাপ্ত লেখার পুরোনো কপি পরে সরবে।"));
      }
      if (mounted.current && sameOwner()) close();
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
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
  const selectedKind = selectedPerson ? personKind(selectedPerson) : null;
  const labour = wage || (!cash && draft.costType === "labour");
  const transport = ["transport", "unload"].includes(draft.costType);
  const returning = draft.kind === "return";
  const allowedPeople = ledger.people.filter((p) =>
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
  const chooseType = (type: QuickDraft["costType"]) =>
    setDraft((d) => ({
      ...d,
      costType: type,
      account:
        type === "labour"
          ? "labour"
          : ["transport", "unload", "rental", "other"].includes(type)
            ? "other"
            : "materials",
      personId: "",
      contractId: "",
      payment: d.payment === "worker" ? "full" : d.payment,
    }));
  const formId = "quick-entry";
  return (
    <Sheet
      title={t(
        returning
          ? "মাল ফেরত"
          : draft.kind === "refund"
            ? "টাকা ফেরতের হিসাব"
            : draft.kind === "payment"
              ? "টাকা দিলাম"
              : draft.kind === "wage"
                ? "মজুরি লিখি"
                : "খরচ লিখি",
      )}
      onClose={() => void requestClose()}
      footer={
        <div className="save-bar">
          <span>
            {t("মোট")}
            <strong>{money(total)}</strong>
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
      <form id={formId} className="entry-form-v3" onSubmit={submit}>
        <fieldset disabled={saving || !ready} className="entry-fields-v3">
          {!cash && !returning && draft.kind !== "wage" ? (
            <div className="expense-sections">
              {(
                [
                  ["material", "মাল কেনা", PackageIcon],
                  ["labour", "মজুরি", HardHatIcon],
                  ["transport", "আনা-নামানো", TruckIcon],
                ] as const
              ).map(([type, label, Icon]) => (
                <button
                  type="button"
                  key={type}
                  aria-pressed={
                    draft.costType === type ||
                    (type === "transport" && draft.costType === "unload")
                  }
                  className={
                    draft.costType === type ||
                    (type === "transport" && draft.costType === "unload")
                      ? "selected"
                      : ""
                  }
                  onClick={() => chooseType(type)}
                >
                  <Icon size={21} weight="duotone" />
                  {t(label)}
                </button>
              ))}
            </div>
          ) : null}
          {transport && !cash ? (
            <div className="small-switch">
              <button
                type="button"
                className={draft.costType === "transport" ? "selected" : ""}
                onClick={() => chooseType("transport")}
              >
                {t("গাড়িভাড়া")}
              </button>
              <button
                type="button"
                className={draft.costType === "unload" ? "selected" : ""}
                onClick={() => chooseType("unload")}
              >
                {t("মাল নামানোর খরচ")}
              </button>
            </div>
          ) : null}
          {cash || wage ? (
            <label className="entry-amount-label">
              {t("কত টাকা")}
              <div className="entry-amount-wrap">
                <span>৳</span>
                <MoneyInput
                  autoFocus
                  inputMode="decimal"
                  aria-label={t("কত টাকা")}
                  placeholder="0"
                  value={draft.amount}
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
                        : transport
                          ? "কী বাবদ খরচ"
                          : returning
                            ? "কোন মাল ফেরত দিলেন"
                            : "কী কিনলেন",
                    )}
                    <AppCombobox
                      suggestions={
                        labour || transport
                          ? []
                          : ledger.items.map((item) => ({
                              value: item.name,
                              description: [item.brand, item.usage]
                                .filter(Boolean)
                                .join(" · "),
                            }))
                      }
                      value={r.label}
                      placeholder={t(
                        labour
                          ? "যেমন: এই সপ্তাহের প্লাস্টার"
                          : transport
                            ? "যেমন: দরজা আনার ভাড়া"
                            : "যেমন: সিমেন্ট, টাইলসের আঠা",
                      )}
                      onChange={(e) => {
                        changeRow(
                          r.id,
                          materialSuggestion(ledger.items, e.target.value, r),
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
                      {t("এই মাল বাদ দিন")}
                    </button>
                  ) : null}
                  {!labour && r.unit ? (
                    <label>
                      {t("পরিমাণ")} · {r.unit}
                      <input
                        inputMode="decimal"
                        aria-label={t("পরিমাণ")}
                        value={r.quantity}
                        onChange={(e) =>
                          changeRow(r.id, { quantity: e.target.value })
                        }
                      />
                    </label>
                  ) : null}
                  {!labour ? (
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
                              <input
                                aria-label={t("পরিমাণ")}
                                value={r.quantity}
                                inputMode="decimal"
                                onChange={(e) =>
                                  changeRow(r.id, { quantity: e.target.value })
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

          {!cash && !wage && !labour && !transport ? (
            <button
              className="text-button add-line-v3"
              type="button"
              onClick={() => field("rows", [...draft.rows, row()])}
            >
              <PlusIcon size={17} />
              {t("আরেকটি মাল")}
            </button>
          ) : null}
          <div className="entry-assignment">
            <label>
              {t("কাজের খাতা")}
              <AppSelect
                value={draft.workId}
                onChange={(e) => field("workId", e.target.value)}
              >
                <option value="">
                  {t(cash ? "খাতা বেছে নিন" : "সাধারণ খরচ")}
                </option>
                {ledger.works.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </AppSelect>
            </label>
            <label>
              {t(
                cash
                  ? "কাকে দিলেন"
                  : labour
                    ? "কোন মিস্ত্রি"
                    : transport
                      ? "গাড়ির লোক / শ্রমিক"
                      : "কোন দোকান",
              )}
              <AppSelect
                value={draft.personId}
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
                    {selectedPerson.name}
                  </option>
                ) : null}
                <option value="__new__">{t("+ নাম লিখব")}</option>
              </AppSelect>
            </label>
          </div>
          {draft.personId === "__new__" ? (
            <label>
              {t(
                cash
                  ? "নাম"
                  : labour
                    ? "মিস্ত্রির নাম"
                    : transport
                      ? "নাম"
                      : "দোকানের নাম",
              )}
              <input
                value={draft.personName}
                onChange={(e) => field("personName", e.target.value)}
              />
            </label>
          ) : null}
          {cash ? (
            <section className="cash-purpose-v3">
              <div className="small-switch">
                <button
                  type="button"
                  className={draft.purpose === "settle" ? "selected" : ""}
                  onClick={() => field("purpose", "settle")}
                >
                  {t("বাকি শোধ")}
                </button>
                <button
                  type="button"
                  className={draft.purpose === "advance" ? "selected" : ""}
                  onClick={() => field("purpose", "advance")}
                >
                  {t("আগাম দিলাম")}
                </button>
              </div>
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
                      contractId:
                        custom && custom.account !== "labour"
                          ? ""
                          : d.contractId,
                    }));
                  }}
                >
                  {!selectedKind ||
                  selectedKind === "other" ||
                  selectedKind === "shop" ? (
                    <option value="materials">{t("মালের টাকা")}</option>
                  ) : null}
                  {!selectedKind ||
                  selectedKind === "other" ||
                  selectedKind === "worker" ? (
                    <option value="labour">{t("মজুরি")}</option>
                  ) : null}
                  {!selectedKind ||
                  selectedKind === "other" ||
                  selectedKind === "driver" ? (
                    <option value="other">{t("গাড়িভাড়া / অন্য খরচ")}</option>
                  ) : null}
                  {ledger.paymentPurposes
                    .filter(
                      (p) =>
                        !selectedKind ||
                        selectedKind === "other" ||
                        p.account === defaultContactAccount(selectedPerson!),
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
                <div className="field-grid payment-purpose-create">
                  <label>
                    {t("কিসের টাকা লিখুন")}
                    <input
                      value={draft.paymentPurposeName}
                      maxLength={200}
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
                            account: e.target.value as QuickDraft["account"],
                            contractId: "",
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
                  <p className="field-hint">
                    {t(
                      "টাকা রাখার সঙ্গে এই কারণও রাখা হবে। পরের বার তালিকায় পাবেন।",
                    )}
                  </p>
                </div>
              ) : null}
            </section>
          ) : !returning ? (
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
                          ? "কিছু দিয়েছি"
                          : "বাকি আছে",
                    )}
                  </button>
                ))}
              </div>
              {draft.payment === "partial" ? (
                <label>
                  {t("এখন কত দিলেন")}
                  <MoneyInput
                    value={draft.paid}
                    onChange={(e) => field("paid", e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                  />
                </label>
              ) : null}
            </section>
          ) : null}
          {cash ||
          wage ||
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
                {!cash && !labour && !returning ? (
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
              {(labour || draft.account === "labour") && contracts.length ? (
                <label>
                  {t("আগে ঠিক করা মজুরির দর")}
                  <AppSelect
                    value={draft.contractId}
                    onChange={(e) => field("contractId", e.target.value)}
                  >
                    <option value="">{t("আলাদা হিসাব")}</option>
                    {contracts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title || money(c.total)}
                      </option>
                    ))}
                  </AppSelect>
                </label>
              ) : null}
              {returning ? (
                <label>
                  {t("নগদ টাকা ফেরত পেলে লিখুন")}
                  <MoneyInput
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
                  <span>{f.name ?? t("ভাউচার")}</span>
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
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}
