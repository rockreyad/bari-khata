import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { z } from "zod";
import { CheckIcon } from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { AppSelect } from "../../components/ui/AppSelect";
import { MoneyInput } from "../../components/ui/MoneyInput";
import { FormError, useFormError } from "../../components/ui/FormError";
import { createWorkspaceStorage } from "../../data/repository";
import { getActiveOwner } from "../../data/database";
import {
  appendBalanceAdjustment,
  readBalanceAdjustmentScope,
} from "../../domain/balanceAdjustments";
import { parseMoneyText } from "../../domain/money";
import { AccountSchema, type Account } from "../../domain/model";

const DraftSchema = z.object({
  basis: z.enum(["paid", "cost", "balance"]),
  position: z.enum(["due", "credit"]),
  amount: z.string().max(128),
  reason: z.string().max(2000),
  expectedBefore: z
    .number()
    .int()
    .min(-Number.MAX_SAFE_INTEGER)
    .max(Number.MAX_SAFE_INTEGER)
    .nullable(),
});
type Draft = z.infer<typeof DraftSchema>;
const blank: Draft = {
  basis: "paid",
  position: "due",
  amount: "",
  reason: "",
  expectedBefore: null,
};
export type TotalAdjustmentTarget = {
  target: "person" | "work";
  id: string;
  account: Account | null;
};

export function TotalAdjustmentForm({
  target,
  onSaved,
  beforeCloseRef,
}: {
  target: TotalAdjustmentTarget;
  onSaved?: () => void;
  beforeCloseRef?: RefObject<(() => Promise<boolean>) | null>;
}) {
  const { ledger, mode, save, go } = useNotebook();
  const { t, money } = useLanguageContext();
  const [owner] = useState(() => (mode === "real" ? getActiveOwner() : null));
  const storage = useMemo(() => createWorkspaceStorage(mode), [mode, owner]);
  const key = `total-adjustment:${target.target}:${target.id}:${target.account ?? "all"}`;
  const [draft, setDraft] = useState<Draft>(blank);
  const [ready, setReady] = useState(false),
    [saving, setSaving] = useState(false),
    [brokenDraft, setBrokenDraft] = useState(false);
  const [notice, setNotice] = useState("");
  const [, setError, errorNotice] = useFormError();
  const queue = useRef(Promise.resolve());
  const latest = useRef(draft);
  latest.current = draft;
  const mounted = useRef(false),
    finished = useRef(false),
    lock = useRef(false),
    hydrated = useRef(false);
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
    if (!beforeCloseRef) return;
    beforeCloseRef.current = async () => {
      if (lock.current) return false;
      if (!hydrated.current || finished.current) return true;
      try {
        await queueDraft(latest.current);
        finished.current = true;
        return true;
      } catch {
        if (mounted.current) setError(t("লেখা রাখা যায়নি। আবার চেষ্টা করুন।"));
        return false;
      }
    };
    return () => {
      beforeCloseRef.current = null;
    };
  }, [beforeCloseRef, queueDraft, t]);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    void storage
      .readDraft(key)
      .then((value) => {
        if (!active) return;
        if (value !== null) {
          const parsed = DraftSchema.safeParse(value);
          if (!parsed.success) {
            setBrokenDraft(true);
            setError(t("আগের লেখা খোলা যায়নি। বন্ধ করে আবার খুলুন।"));
            return;
          }
          latest.current = parsed.data;
          setDraft(parsed.data);
          setNotice(t("আগের লেখা ফিরিয়ে আনা হয়েছে।"));
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
    const timer = window.setTimeout(() => {
      void queueDraft(draft).catch(() => {
        if (mounted.current) setError(t("লেখা রাখা যায়নি। আবার চেষ্টা করুন।"));
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [ready, saving, draft, queueDraft, t]);
  const scopeInput = useMemo(
    () => ({
      target: target.target,
      basis: draft.basis,
      personId: target.target === "person" ? target.id : null,
      account:
        target.target === "person" ? AccountSchema.parse(target.account) : null,
      workId: target.target === "work" ? target.id : null,
      contractId: null,
    }),
    [target.target, target.id, target.account, draft.basis],
  );
  const scopeResult = useMemo(() => {
    try {
      return {
        scope: readBalanceAdjustmentScope(ledger, scopeInput),
        error: "",
      };
    } catch (cause) {
      return {
        scope: null,
        error: cause instanceof Error ? cause.message : "",
      };
    }
  }, [ledger, scopeInput]);
  const scope = scopeResult.scope;
  useEffect(() => {
    if (ready && scope && draft.expectedBefore === null)
      setDraft((previous) => ({
        ...previous,
        expectedBefore: scope.value,
        position: scope.value < 0 ? "credit" : "due",
      }));
  }, [ready, scope, draft.expectedBefore]);
  const before = draft.expectedBefore;
  let after: number | null = null;
  try {
    after = parseMoneyText(draft.amount);
    if (draft.basis === "balance" && draft.position === "credit")
      after = -after;
  } catch {}
  const delta =
    before !== null && after !== null && Number.isSafeInteger(after - before)
      ? after - before
      : null;
  const stale = scope && before !== null && scope.value !== before;
  const record =
    target.target === "person"
      ? ledger.people.find((person) => person.id === target.id)
      : ledger.works.find((work) => work.id === target.id);
  const archived = Boolean(record?.archivedAt);
  const changedOwner = mode === "real" && owner !== getActiveOwner();
  const current = () =>
    mounted.current &&
    !changedOwner &&
    (mode === "demo" || owner === getActiveOwner());
  const showValue = (value: number) =>
    draft.basis !== "balance"
      ? money(value)
      : value === 0
        ? t("বাকি নেই")
        : t(value < 0 ? "আমার জমা {{amount}}" : "দিতে বাকি {{amount}}", {
            amount: money(Math.abs(value)),
          });
  function field<K extends keyof Draft>(name: K, value: Draft[K]) {
    setError("");
    setDraft((previous) => ({ ...previous, [name]: value }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || !ready) return;
    setError("");
    if (!scope || before === null) {
      setError(t("হিসাবটি বেছে আবার চেষ্টা করুন।"));
      return;
    }
    if (archived) {
      setError(t("হিসাব বদলাতে আগে নাম বা কাজটি ফিরিয়ে আনুন।"));
      return;
    }
    if (stale) {
      setError(t("এই হিসাব আগে বদলেছে। নতুন হিসাব দেখে আবার মিলিয়ে নিন।"));
      return;
    }
    if (after === null || delta === null) {
      setError(t("সঠিক অঙ্ক লিখুন"));
      return;
    }
    if (!delta) {
      setError(t("হিসাবের অঙ্ক বদলায়নি।"));
      return;
    }
    if (!draft.reason.trim()) {
      setError(t("কেন বদলাচ্ছেন, তা লিখুন।"));
      return;
    }
    lock.current = true;
    setSaving(true);
    try {
      if (!current()) throw new Error("account_changed");
      await queueDraft(latest.current);
      await save((fresh) =>
        appendBalanceAdjustment(fresh, {
          ...scopeInput,
          expectedBefore: before,
          after,
          reason: draft.reason,
        }),
      );
      finished.current = true;
      await queue.current.catch(() => {});
      await storage.removeDraft(key).catch(() => {});
      if (current()) {
        if (onSaved) onSaved();
        else
          go(
            target.target === "person"
              ? `/people/${encodeURIComponent(target.id)}?${new URLSearchParams({ account: target.account! })}`
              : `/works/${encodeURIComponent(target.id)}`,
          );
      }
    } catch (cause) {
      const errors: Record<string, string> = {
        balance_adjustment_stale:
          "এই হিসাব আগে বদলেছে। নতুন হিসাব দেখে আবার মিলিয়ে নিন।",
        balance_adjustment_no_change: "হিসাবের অঙ্ক বদলায়নি।",
        balance_adjustment_reason_required: "কেন বদলাচ্ছেন, তা লিখুন।",
        balance_adjustment_invalid_scope: "হিসাবটি বেছে আবার চেষ্টা করুন।",
        balance_adjustment_archived:
          "হিসাব বদলাতে আগে নাম বা কাজটি ফিরিয়ে আনুন।",
        balance_adjustment_out_of_range: "হিসাবের অঙ্ক বেশি হয়েছে।",
        balance_adjustment_ambiguous:
          "বাকি নিশ্চিত নয়। দেওয়া টাকা বা খরচের মোট বেছে নিন।",
        account_changed: "অ্যাকাউন্ট বদলে গেছে। নিজের খাতা আবার খুলুন।",
      };
      if (current())
        setError(
          t(
            errors[cause instanceof Error ? cause.message : ""] ??
              "হিসাব মেলানো যায়নি। লেখা রেখে আবার চেষ্টা করুন।",
          ),
        );
      lock.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return (
    <form className="balance-adjustment-form" onSubmit={submit} noValidate>
      <FormError {...errorNotice} />
      {scopeResult.error ? (
        <p className="helper-text" role="status">
          {t(
            scopeResult.error === "balance_adjustment_ambiguous"
              ? "বাকি নিশ্চিত নয়। দেওয়া টাকা বা খরচের মোট বেছে নিন।"
              : "হিসাবটি বেছে আবার চেষ্টা করুন।",
          )}
        </p>
      ) : null}
      {brokenDraft ? (
        <button
          className="text-button"
          type="button"
          onClick={() => {
            void storage
              .removeDraft(key)
              .then(() => {
                setDraft(blank);
                setBrokenDraft(false);
                setError("");
                hydrated.current = true;
                setReady(true);
              })
              .catch(() => setError(t("লেখা রাখা যায়নি। আবার চেষ্টা করুন।")));
          }}
        >
          {t("অসমাপ্ত লেখা বাদ দিন")}
        </button>
      ) : null}
      {notice ? (
        <p className="helper-text" role="status">
          {notice}
        </p>
      ) : null}
      <fieldset disabled={!ready || saving || changedOwner}>
        <label>
          {t("যে মোট মিলাব")}
          <AppSelect
            value={draft.basis}
            onChange={(event) => {
              setError("");
              setDraft((previous) => ({
                ...previous,
                basis: event.target.value as Draft["basis"],
                amount: "",
                expectedBefore: null,
              }));
            }}
          >
            <option value="paid">{t("মোট দিয়েছি")}</option>
            <option value="cost">{t("মোট খরচ")}</option>
            <option value="balance">{t("দিতে বাকি")}</option>
          </AppSelect>
        </label>
        {before !== null && scope ? (
          <div className="adjustment-current">
            <span>{t("এখনকার অঙ্ক")}</span>
            <strong>{showValue(before)}</strong>
          </div>
        ) : null}
        {stale && !saving ? (
          <div className="adjustment-stale" role="status">
            <p>{t("খাতার নতুন হিসাব এসেছে। আপনার লেখা রাখা আছে।")}</p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setError("");
                field("expectedBefore", scope.value);
              }}
            >
              {t("নতুন হিসাব দেখি")}
            </button>
          </div>
        ) : null}
        {draft.basis === "balance" ? (
          <label>
            {t("সঠিক অবস্থাটি")}
            <AppSelect
              value={draft.position}
              onChange={(event) =>
                field("position", event.target.value as Draft["position"])
              }
            >
              <option value="due">{t("দিতে বাকি")}</option>
              <option value="credit">{t("আমার জমা")}</option>
            </AppSelect>
          </label>
        ) : null}
        <label>
          {t("সঠিক অঙ্ক")}
          <MoneyInput
            aria-label={t("সঠিক অঙ্ক")}
            maxLength={128}
            value={draft.amount}
            onChange={(event) => field("amount", event.target.value)}
          />
        </label>
        {after !== null && delta !== null && before !== null && scope ? (
          <div className="adjustment-preview">
            <div>
              <span>{t("নতুন অঙ্ক")}</span>
              <strong>{showValue(after)}</strong>
            </div>
            <div>
              <span>
                {t(delta > 0 ? "বাড়ছে" : delta < 0 ? "কমছে" : "পার্থক্য")}
              </span>
              <strong>{money(Math.abs(delta))}</strong>
            </div>
          </div>
        ) : null}
        <label>
          {t("কারণ")}
          <textarea
            aria-label={t("কারণ")}
            value={draft.reason}
            maxLength={2000}
            rows={3}
            onChange={(event) => field("reason", event.target.value)}
            placeholder={t("যেমন: দুই পক্ষের হিসাব মিলিয়ে মোট ঠিক করেছি")}
          />
        </label>
      </fieldset>
      <p className="helper-text">
        {t("পার্থক্যটি আলাদা সমন্বয় হিসেবে লেনদেনে থাকবে।")}
      </p>
      {archived ? (
        <p className="helper-text">
          {t("হিসাব বদলাতে আগে নাম বা কাজটি ফিরিয়ে আনুন।")}
        </p>
      ) : null}
      {changedOwner ? (
        <p className="form-error">
          {t("অ্যাকাউন্ট বদলে গেছে। নিজের খাতা আবার খুলুন।")}
        </p>
      ) : null}
      <button
        className="primary-button full-width"
        type="submit"
        disabled={
          !ready ||
          saving ||
          !scope ||
          Boolean(stale) ||
          archived ||
          changedOwner
        }
      >
        <CheckIcon size={18} />
        {t(saving ? "রাখছি…" : "সমন্বয় রাখুন")}
      </button>
    </form>
  );
}
