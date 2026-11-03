import { useNavigate, useSearchParams } from "react-router";
import { useMemo } from "react";
import { useNotebook } from "../../app/NotebookProvider";
import { AppSelect } from "../../components/ui/AppSelect";
import { useLanguageContext } from "../../context/LanguageProvider";
import { entryTotal } from "../../domain/ledger";
import {
  sortHistory,
  entryKindLabels,
  historyTitle,
  historySubtitle,
} from "../history/history";
import { jobName } from "../jobs/jobView";
import {
  reconciliationEditUrl,
  type ReconciliationType,
} from "./reconciliation";
import "./reconciliation.css";

export function ReconciliationPage() {
  const { ledger, base, go } = useNotebook();
  const { t, money, date, formatDigits } = useLanguageContext();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const raw = params.get("type");
  const type: ReconciliationType =
    raw === "payment" || raw === "contract" ? raw : "bill";
  const selectedId = params.get("id") ?? "";
  const records = useMemo(
    () =>
      type === "contract"
        ? ledger.contracts
            .filter((contract) => !contract.archivedAt)
            .map((contract) => ({
              id: contract.id,
              total: contract.total,
              label: `${formatDigits(jobName(contract, t))} · ${formatDigits(ledger.people.find((person) => person.id === contract.personId)?.name ?? "")} · ${formatDigits(ledger.works.find((work) => work.id === contract.workId)?.name ?? t("সব খাতা"))} · ${money(contract.total)}`,
            }))
        : sortHistory(
            ledger.entries.filter(
              (entry) =>
                !entry.voided &&
                (type === "payment"
                  ? entry.kind === "payment" || entry.kind === "refund"
                  : entry.kind === "expense" ||
                    entry.kind === "expense_credit"),
            ),
          ).map((entry) => ({
            id: entry.id,
            total: entryTotal(entry),
            label: `${t(entryKindLabels[entry.kind])} · ${formatDigits(historyTitle(ledger, entry))} · ${formatDigits(historySubtitle(ledger, entry, {}))} · ${date(entry.date, { year: "numeric" })} · ${money(entryTotal(entry))}`,
          })),
    [ledger, type, t, formatDigits, money, date],
  );
  const selected = records.find((record) => record.id === selectedId);
  return (
    <div className="reconciliation-page page-flow">
      <header>
        <button
          type="button"
          className="text-button"
          onClick={() => go("/settings")}
        >
          {t("ফিরুন")}
        </button>
        <h1>{t("হিসাব মিলিয়ে নিই")}</h1>
        <p>{t("আগের ভুল অঙ্কটি ঠিক করুন। কেন বদলালেন, তা ইতিহাসে থাকবে।")}</p>
      </header>
      <section className="reconciliation-choice">
        <label>
          {t("কোন অঙ্ক ঠিক করবেন")}
          <AppSelect
            value={type}
            onChange={(event) => setParams({ type: event.target.value })}
          >
            <option value="bill">{t("বিলের খরচ")}</option>
            <option value="payment">{t("দেওয়া বা ফেরত পাওয়া টাকা")}</option>
            <option value="contract">{t("কাজের চুক্তির টাকা")}</option>
          </AppSelect>
        </label>
        <label>
          {t("যে হিসাবটি বদলাবেন")}
          <AppSelect
            value={selectedId}
            onChange={(event) => setParams({ type, id: event.target.value })}
          >
            <option value="">{t("হিসাব বেছে নিন")}</option>
            {records.map((record) => (
              <option key={record.id} value={record.id}>
                {record.label}
              </option>
            ))}
          </AppSelect>
        </label>
        {!records.length ? (
          <p>{t("এখানে বদলানোর মতো কোনো হিসাব নেই।")}</p>
        ) : null}
        {selected ? (
          <p>
            {t("আগের অঙ্ক")} <strong>{money(selected.total)}</strong>
          </p>
        ) : null}
        <button
          type="button"
          className="primary-button"
          disabled={!selected}
          onClick={() => {
            if (selected)
              navigate(
                reconciliationEditUrl(
                  base,
                  type,
                  selected.id,
                  `${base}/reconcile?${new URLSearchParams({ type, id: selected.id })}`,
                ),
              );
          }}
        >
          {t("এই হিসাব ঠিক করি")}
        </button>
      </section>
    </div>
  );
}
