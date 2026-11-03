import { useSearchParams } from "react-router";
import { useRef } from "react";
import { useNotebook } from "../../app/NotebookProvider";
import { AppSelect } from "../../components/ui/AppSelect";
import { useLanguageContext } from "../../context/LanguageProvider";
import "./reconciliation.css";
import "./balance-adjustment.css";
import { TotalAdjustmentForm } from "./TotalAdjustmentForm";
import { AccountSchema } from "../../domain/model";
import { defaultContactAccount } from "../../domain/contacts";
import { accountLabels } from "../people/ContactIdentity";
import { getActiveOwner } from "../../data/database";

export function ReconciliationPage() {
  const { ledger, mode, go } = useNotebook();
  const { t, formatDigits } = useLanguageContext();
  const [params, setParams] = useSearchParams();
  const beforeClose = useRef<(() => Promise<boolean>) | null>(null);
  async function changeParams(next: Record<string, string>) {
    if (!beforeClose.current || (await beforeClose.current())) setParams(next);
  }
  async function back() {
    if (beforeClose.current && !(await beforeClose.current())) return;
    go(
      person
        ? `/people/${encodeURIComponent(person.id)}`
        : selected && target === "work"
          ? `/works/${encodeURIComponent(selected.id)}`
          : "/settings",
    );
  }
  const target =
    params.get("target") === "work" ||
    (!params.has("person") && params.has("work"))
      ? "work"
      : "person";
  const selectedId = params.get(target === "person" ? "person" : "work") ?? "";
  const records = (target === "person" ? ledger.people : ledger.works).filter(
    (record) => !record.archivedAt,
  );
  const selected = records.find((record) => record.id === selectedId);
  const person =
    target === "person"
      ? ledger.people.find((record) => record.id === selectedId)
      : undefined;
  const parsedAccount = AccountSchema.safeParse(params.get("account"));
  const account =
    target === "person"
      ? parsedAccount.success
        ? parsedAccount.data
        : person
          ? defaultContactAccount(person)
          : "materials"
      : null;
  const owner = mode === "real" ? getActiveOwner() : "demo";
  return (
    <div className="reconciliation-page page-flow">
      <header>
        <button
          type="button"
          className="text-button"
          onClick={() => void back()}
        >
          {t("ফিরুন")}
        </button>
        <h1>{t("হিসাব মিলিয়ে নিই")}</h1>
        <p>{t("সঠিক মোট লিখুন। পার্থক্যটি সমন্বয় হিসেবে থাকবে।")}</p>
      </header>
      <section className="reconciliation-choice">
        <label>
          {t("কার হিসাব")}
          <AppSelect
            value={target}
            onChange={(event) =>
              void changeParams({ target: event.target.value })
            }
          >
            <option value="person">{t("ব্যক্তি বা দোকান")}</option>
            <option value="work">{t("কাজের খাতা")}</option>
          </AppSelect>
        </label>
        <label>
          {t(
            target === "person" ? "ব্যক্তি বা দোকান বেছে নিন" : "খাতা বেছে নিন",
          )}
          <AppSelect
            value={selectedId}
            onChange={(event) =>
              void changeParams({
                target,
                [target === "person" ? "person" : "work"]: event.target.value,
              })
            }
          >
            <option value="">{t("একটি বেছে নিন")}</option>
            {records.map((record) => (
              <option key={record.id} value={record.id}>
                {formatDigits(record.name)}
              </option>
            ))}
          </AppSelect>
        </label>
        {person && account ? (
          <details className="adjustment-extra">
            <summary>{t(accountLabels[account])}</summary>
            <label>
              {t("হিসাবের খাত")}
              <AppSelect
                value={account}
                onChange={(event) =>
                  void changeParams({
                    target,
                    person: person.id,
                    account: event.target.value,
                  })
                }
              >
                {(["materials", "labour", "other"] as const).map((value) => (
                  <option key={value} value={value}>
                    {t(accountLabels[value])}
                  </option>
                ))}
              </AppSelect>
            </label>
            <small>{t("সব খাতা মিলিয়ে")}</small>
          </details>
        ) : null}
      </section>
      {selected ? (
        <TotalAdjustmentForm
          key={`${owner}:${target}:${selected.id}:${account}`}
          target={{ target, id: selected.id, account }}
          beforeCloseRef={beforeClose}
        />
      ) : null}
    </div>
  );
}
