import { useSearchParams } from "react-router";
import { useEffect, useMemo, useState } from "react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { createWorkspaceStorage } from "../../data/repository";
import { getActiveOwner } from "../../data/database";
import { QuickSavedDraftSchema, type QuickDraft } from "../entries/quickEntry";
import { entryUrl } from "../../app/entryRoutes";

export function LegacyEntryDrafts() {
  const { go, mode, ledger, base } = useNotebook();
  const { t, formatDigits } = useLanguageContext();
  const [params] = useSearchParams();
  const owner = getActiveOwner();
  const scope = JSON.stringify([mode, owner]);
  const storage = useMemo(() => {
    try {
      return createWorkspaceStorage(mode);
    } catch {
      return null;
    }
  }, [mode, owner]);
  const [state, setState] = useState<{
    scope: string;
    drafts: { key: string; draft: QuickDraft }[];
    failed: boolean;
  }>({ scope, drafts: [], failed: false });
  const drafts = state.scope === scope ? state.drafts : [];
  const draftError = state.scope === scope && state.failed;
  useEffect(() => {
    setState({ scope, drafts: [], failed: false });
    if (!storage) return;
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
          setState({
            scope,
            failed: false,
            drafts: results.filter(
              (value): value is { key: string; draft: QuickDraft } =>
                value !== null,
            ),
          });
      })
      .catch(() => {
        if (active) setState({ scope, drafts: [], failed: true });
      });
    return () => {
      active = false;
    };
  }, [storage, ledger.entries, scope]);
  return (
    <>
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
    </>
  );
}
