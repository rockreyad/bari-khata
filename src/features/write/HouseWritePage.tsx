import { useParams, useSearchParams } from "react-router";
import { useEffect, useMemo, useState } from "react";
import {
  PackageIcon,
  HardHatIcon,
  MoneyIcon,
  ArrowRightIcon,
} from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { HouseCostForm } from "./HouseCostForm";
import { HousePaymentForm } from "./HousePaymentForm";
import "./house-write.css";
import { createWorkspaceStorage } from "../../data/repository";
import { QuickSavedDraftSchema, type QuickDraft } from "../entries/quickEntry";
import { entryUrl } from "../../app/entryRoutes";

export function HouseWriteChooser() {
  const { go, mode, ledger, base } = useNotebook();
  const { t, formatDigits } = useLanguageContext();
  const [params] = useSearchParams();
  const storage = useMemo(() => createWorkspaceStorage(mode), [mode]);
  const [drafts, setDrafts] = useState<{ key: string; draft: QuickDraft }[]>(
    [],
  );
  const [draftError, setDraftError] = useState(false);
  useEffect(() => {
    let active = true;
    void storage
      .listDraftKeys()
      .then(async (keys) => {
        const results = await Promise.all(
          keys
            .filter((key) => key.startsWith("quick-v2:"))
            .map(async (key) => {
              const value = QuickSavedDraftSchema.parse(
                await storage.readDraft(key),
              );
              const draft = value.draft;
              if (
                ledger.entries.some((entry) =>
                  [draft.id, draft.paymentId, draft.refundId].includes(
                    entry.id,
                  ),
                ) ||
                !(
                  draft.amount ||
                  draft.paid ||
                  draft.note ||
                  value.files.length ||
                  draft.rows.some((row) => row.label || row.amount)
                )
              )
                return null;
              return { key, draft };
            }),
        );
        if (active)
          setDrafts(
            results.filter(
              (value): value is { key: string; draft: QuickDraft } =>
                value !== null,
            ),
          );
      })
      .catch(() => {
        if (active) setDraftError(true);
      });
    return () => {
      active = false;
    };
  }, [storage, ledger.entries]);
  const choices = [
    {
      action: "purchase",
      label: "মাল কিনেছি",
      hint: "নগদে, বাকিতে বা অন্যের নিজের টাকায়",
      Icon: PackageIcon,
    },
    {
      action: "charge",
      label: "কাজের বিল",
      hint: "মজুরি, গাড়িভাড়া বা অন্য কাজের পাওনা",
      Icon: HardHatIcon,
    },
    {
      action: "payment",
      label: "টাকা দিয়েছি",
      hint: "আগের বাকি মেটানো, অগ্রিম বা জামানত",
      Icon: MoneyIcon,
    },
  ];
  return (
    <div className="house-write-chooser">
      <header>
        <span className="eyebrow">{t("হিসাব লিখি")}</span>
        <h1>{t("কী হয়েছে?")}</h1>
        <p>{t("ঘটনা বেছে নিন। বাকি হিসাব আমরা দেখিয়ে দেব।")}</p>
      </header>
      <div className="house-write-choices">
        {choices.map(({ action, label, hint, Icon }) => (
          <button
            type="button"
            key={action}
            onClick={() => go(`/write/${action}?${params}`)}
          >
            <span className="house-action-icon">
              <Icon size={25} weight="duotone" aria-hidden="true" />
            </span>
            <span>
              <strong>{t(label)}</strong>
              <small>{t(hint)}</small>
            </span>
            <ArrowRightIcon size={20} aria-hidden="true" />
          </button>
        ))}
      </div>
      {drafts.length > 0 && (
        <section
          className="house-draft-list"
          aria-label={t("আগের অসমাপ্ত লেখা")}
        >
          <h2>{t("আগের অসমাপ্ত লেখা")}</h2>
          {drafts.map(({ key, draft }) => (
            <button
              type="button"
              className="text-button"
              key={key}
              onClick={() => {
                const path = entryUrl(
                  base,
                  {
                    kind: draft.kind,
                    workId: draft.workId || undefined,
                    personId: draft.personId || undefined,
                    account: draft.account,
                    costType: draft.costType,
                    purpose: draft.purpose,
                    contractId: draft.contractId || undefined,
                    milestoneId: draft.milestoneId || undefined,
                  },
                  params.get("back") ?? `${base}/`,
                );
                go(
                  `${path.slice(base.length)}&${new URLSearchParams({ draftKey: key })}`,
                );
              }}
            >
              {formatDigits(
                draft.note ||
                  draft.rows
                    .map((row) => row.label)
                    .filter(Boolean)
                    .join(" · ") ||
                  t(draft.kind === "payment" ? "টাকা দিয়েছি" : "মাল কিনেছি"),
              )}
            </button>
          ))}
        </section>
      )}
      {draftError && (
        <p role="status">
          {t("আগের অসমাপ্ত লেখার তালিকা খোলা যায়নি। লেখাগুলো রাখা আছে।")}
        </p>
      )}
      <p className="house-write-note">
        {t("মাল ফেরত বা ভুল ঠিক করতে আগের হিসাবটি খুলুন।")}
      </p>
      <button
        type="button"
        className="text-button"
        onClick={() => go("/ledger")}
      >
        {t("আগের হিসাব খুলুন")}
      </button>
    </div>
  );
}

export function HouseWritePage() {
  const { action } = useParams();
  const [params] = useSearchParams();
  const key = `${action}:${params.toString()}`;
  if (action === "payment") return <HousePaymentForm key={key} />;
  if (action === "purchase" || action === "charge")
    return <HouseCostForm key={key} action={action} />;
  return <HouseWriteChooser />;
}
