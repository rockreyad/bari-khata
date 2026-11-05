import { useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { z } from "zod";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { EntryFrame } from "../../components/EntryFrame";
import { MoneyInput } from "../../components/ui/MoneyInput";
import { AppSelect } from "../../components/ui/AppSelect";
import { AppDatePicker } from "../../components/ui/AppDatePicker";
import { FormError } from "../../components/ui/FormError";
import { CostTypeSchema, type CostType } from "../../domain/model";
import { parseAmount } from "../../domain/ledger";
import { moneyInputValue } from "../../lib/numericFields";
import { entryContext } from "../entries/entryContext";
import { QuickSavedDraftSchema, type QuickDraft } from "../entries/quickEntry";
import { useInlineDraft } from "../entries/useInlineDraft";
import { recordHouseCost } from "./houseCost";
import { HouseSavedNotice } from "./HouseSavedNotice";
import { HouseAttachments } from "./HouseAttachments";
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
const savedSchema = QuickSavedDraftSchema.safeExtend({
  useAdvance: z.boolean().default(false),
  advanceSignature: z.string().max(1000000).default(""),
});

export function HouseCostForm({ action }: { action: "purchase" | "charge" }) {
  const { ledger, save, close, notify } = useNotebook();
  const { t, money, formatDigits } = useLanguageContext();
  const [params] = useSearchParams();
  const initial = useMemo(() => {
    const requested = CostTypeSchema.safeParse(params.get("type")).data;
    const costType =
      action === "purchase"
        ? "material"
        : requested && requested !== "material"
          ? requested
          : "labour";
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
      workId: params.get("work") ?? undefined,
      contractId: params.get("contract") ?? undefined,
      milestoneId: params.get("milestone") ?? undefined,
    });
    return {
      draft: {
        ...draft,
        payment: action === "charge" ? ("due" as const) : ("full" as const),
      },
      files: [],
      useAdvance: false,
      advanceSignature: "",
    };
  }, []);
  const key = `house-cost:${action}:${params.get("person") ?? "all"}:${params.get("work") ?? "all"}:${params.get("contract") ?? "none"}:${params.get("milestone") ?? "none"}`;
  const { value, update, ready, failed, clear, flush } = useInlineDraft(
    key,
    savedSchema,
    initial,
  );
  const { draft, files } = value;
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const finished = useRef(false);
  const field = <K extends keyof QuickDraft>(key: K, next: QuickDraft[K]) => {
    setError("");
    update((current) => ({
      ...current,
      draft: { ...current.draft, [key]: next },
    }));
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
    try {
      if (staleAdvance) throw new Error("house_advance_changed");
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
            paid === 0
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
      setError(
        t(
          code === "house_advance_changed"
            ? "আগের অগ্রিম বদলেছে। নতুন প্রস্তাব দেখে আবার বেছে নিন।"
            : code === "duplicate"
              ? "এই হিসাব আগেই রাখা হয়েছে। আগের হিসাব খুলে দেখুন।"
              : code === "person"
                ? "বাকি কার কাছে থাকবে, তাঁর নাম দিন।"
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
          await clear({
            ...initial,
            draft: {
              ...initial.draft,
              id: crypto.randomUUID(),
              paymentId: crypto.randomUUID(),
              refundId: crypto.randomUUID(),
              personNewId: crypto.randomUUID(),
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
  return (
    <EntryFrame
      title={t(action === "purchase" ? "মাল কিনেছি" : "কাজের বিল")}
      subtitle={t(
        action === "purchase"
          ? "মালের দাম একবারই খরচে যোগ হবে।"
          : "যতটুকু কাজের পাওনা হয়েছে, শুধু সেই বিল লিখুন।",
      )}
      onClose={() => void closeSafely()}
      busy={saving}
      className="house-write-page"
      footer={
        <button
          className="primary-button"
          form="house-cost-form"
          type="submit"
          disabled={!ready || failed || saving}
        >
          {t(saving ? "রাখছি…" : "হিসাব রাখুন")}
        </button>
      }
    >
      <form
        id="house-cost-form"
        className="house-form"
        onSubmit={(event) => void submit(event)}
      >
        <FormError
          id="house-cost-error"
          message={
            failed
              ? t(
                  "অসমাপ্ত লেখা খোলা বা রাখা যাচ্ছে না। লেখা অক্ষত রেখে আবার খুলুন।",
                )
              : error
          }
        />
        <fieldset disabled={!ready || failed || saving}>
          {action === "charge" && (
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
                ].map(([id, name]) => (
                  <option key={id} value={id}>
                    {t(name)}
                  </option>
                ))}
              </AppSelect>
            </label>
          )}
          <div className="house-cost-lines">
            {draft.rows.map((row, index) => (
              <div className="house-cost-line" key={row.id}>
                <label>
                  {t(action === "purchase" ? "কী মাল" : "কী কাজ হয়েছে")}
                  <input
                    aria-label={t(
                      action === "purchase"
                        ? "মালের নাম {{number}}"
                        : "কাজের বিবরণ {{number}}",
                      { number: formatDigits(index + 1) },
                    )}
                    required
                    maxLength={200}
                    value={row.label}
                    onChange={(event) =>
                      field(
                        "rows",
                        draft.rows.map((item) =>
                          item.id === row.id
                            ? { ...item, label: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  {t(action === "purchase" ? "মালের দাম" : "বিলের টাকা")}
                  <MoneyInput
                    aria-label={t("টাকা {{number}}", {
                      number: formatDigits(index + 1),
                    })}
                    required
                    value={row.amount}
                    onChange={(event) =>
                      field(
                        "rows",
                        draft.rows.map((item) =>
                          item.id === row.id
                            ? { ...item, amount: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
                {draft.rows.length > 1 && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t("এই সারি সরান")}
                    onClick={() =>
                      field(
                        "rows",
                        draft.rows.filter((item) => item.id !== row.id),
                      )
                    }
                  >
                    <TrashIcon size={19} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="text-button"
            onClick={() =>
              field("rows", [
                ...draft.rows,
                {
                  ...initial.draft.rows[0],
                  id: crypto.randomUUID(),
                  label: "",
                  amount: "",
                },
              ])
            }
          >
            <PlusIcon size={17} />
            {t(action === "purchase" ? "আরও মাল" : "আরও কাজ")}
          </button>
          <div className="house-field-pair">
            <label>
              {t(
                draft.payment === "worker"
                  ? "কাকে ফেরত দেবেন"
                  : "কার সঙ্গে হিসাব",
              )}
              <AppSelect
                aria-label={t("কার সঙ্গে হিসাব")}
                value={draft.personId}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    useAdvance: false,
                    draft: {
                      ...current.draft,
                      personId: event.target.value,
                      contractId: "",
                      milestoneId: "",
                    },
                  }))
                }
              >
                <option value="">{t("নাম না দিলেও হবে")}</option>
                {ledger.people
                  .filter((person) => !person.archivedAt)
                  .map((person) => (
                    <option value={person.id} key={person.id}>
                      {formatDigits(person.name)}
                    </option>
                  ))}
                <option value="__new__">{t("+ নাম লিখব")}</option>
              </AppSelect>
            </label>
            <label>
              {t("কোন কাজে")}
              <AppSelect
                aria-label={t("কোন কাজে")}
                value={draft.workId}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    useAdvance: false,
                    draft: {
                      ...current.draft,
                      workId: event.target.value,
                      contractId: "",
                      milestoneId: "",
                    },
                  }))
                }
              >
                <option value="">{t("সাধারণ খরচ")}</option>
                {ledger.works
                  .filter((work) => !work.archivedAt)
                  .map((work) => (
                    <option value={work.id} key={work.id}>
                      {formatDigits(work.name)}
                    </option>
                  ))}
              </AppSelect>
            </label>
          </div>
          {draft.personId === "__new__" && (
            <label>
              {t("নাম")}
              <input
                aria-label={t("নতুন নাম")}
                required
                maxLength={200}
                value={draft.personName}
                onChange={(event) => field("personName", event.target.value)}
              />
            </label>
          )}
          {draft.account === "labour" && contracts.length > 0 && (
            <label>
              {t("কোন চুক্তির কাজ")}
              <AppSelect
                aria-label={t("কোন চুক্তির কাজ")}
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
          )}
          {milestones.length > 0 && (
            <label>
              {t("কাজের ধাপ")}
              <AppSelect
                aria-label={t("কাজের ধাপ")}
                value={draft.milestoneId}
                onChange={(event) => field("milestoneId", event.target.value)}
              >
                <option value="">{t("ধাপ ছাড়াই বিল")}</option>
                {milestones.map((step) => (
                  <option key={step.id} value={step.id}>
                    {formatDigits(step.title)}
                  </option>
                ))}
              </AppSelect>
            </label>
          )}
          {staleAdvance ? (
            <div className="house-legacy-notice">
              <p role="status">
                {t("আগের অগ্রিম বদলেছে। নতুন প্রস্তাব দেখে আবার বেছে নিন।")}
              </p>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  update({ ...value, useAdvance: false, advanceSignature: "" })
                }
              >
                {t("অগ্রিম না লাগিয়ে রাখি")}
              </button>
            </div>
          ) : null}
          {advance && advance.applied > 0 && (
            <label className="house-check">
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
          )}
          <label>
            {t("টাকা মিটিয়েছেন?")}
            <AppSelect
              aria-label={t("টাকা মিটিয়েছেন?")}
              value={draft.payment}
              onChange={(event) =>
                field("payment", event.target.value as QuickDraft["payment"])
              }
            >
              <option value="full">{t("পুরোটা দিয়েছি")}</option>
              <option value="partial">{t("কিছু দিয়েছি")}</option>
              <option value="due">{t("পরে দেব")}</option>
              {action === "purchase" && (
                <option value="worker">
                  {t("অন্য কেউ নিজের টাকায় কিনেছেন")}
                </option>
              )}
            </AppSelect>
          </label>
          {draft.payment === "worker" && (
            <p className="field-hint">
              {t(
                "যিনি নিজের টাকা খরচ করেছেন, তাঁর নাম দিন। তাঁকে ফেরত দেওয়ার বাকি থাকবে; এটি মজুরি হবে না।",
              )}
            </p>
          )}
          {draft.payment === "partial" && (
            <label>
              {t("এখন কত দিয়েছি")}
              <MoneyInput
                aria-label={t("এখন কত দিয়েছি")}
                required
                value={draft.paid}
                onChange={(event) => field("paid", event.target.value)}
              />
            </label>
          )}
          <section
            className="house-payment-preview"
            aria-label={t("রাখলে যা হবে")}
            aria-live="polite"
          >
            <dl>
              <div>
                <dt>{t("খরচে যোগ হবে")}</dt>
                <dd>{money(Number.isSafeInteger(total) ? total : 0)}</dd>
              </div>
              {advanceAmount > 0 && (
                <div>
                  <dt>{t("আগের অগ্রিম লাগবে")}</dt>
                  <dd>{money(advanceAmount)}</dd>
                </div>
              )}
              <div>
                <dt>{t("এখন টাকা গেছে")}</dt>
                <dd>{money(paid)}</dd>
              </div>
              <div className="house-result">
                <dt>{t("এই বিলে বাকি থাকবে")}</dt>
                <dd>{money(Math.max(0, due))}</dd>
              </div>
            </dl>
          </section>
          <details className="house-details">
            <summary>{t("তারিখ, ভাউচার ও বাড়তি কথা")}</summary>
            <label>
              {t("তারিখ")}
              <AppDatePicker
                aria-label={t("তারিখ")}
                value={draft.date}
                onChange={(event) => field("date", event.target.value)}
              />
            </label>
            <label>
              {t("কীভাবে দিয়েছি")}
              <AppSelect
                aria-label={t("কীভাবে দিয়েছি")}
                value={draft.method}
                onChange={(event) =>
                  field("method", event.target.value as QuickDraft["method"])
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
                maxLength={10000}
                value={draft.note}
                onChange={(event) => field("note", event.target.value)}
              />
            </label>
            <HouseAttachments
              files={files}
              entryId={draft.id}
              onChange={(files) => update({ ...value, files })}
              onError={setError}
            />
          </details>
        </fieldset>
      </form>
    </EntryFrame>
  );
}
