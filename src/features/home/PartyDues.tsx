import { useMemo } from "react";
import { ArrowLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { useLocation, useSearchParams } from "react-router";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { reconciledTotals } from "../../domain/adjustmentMath";
import { contactEntryPolicy } from "../../domain/contactEntryPolicy";
import { AccountSchema } from "../../domain/model";
import { partyLedger } from "../../domain/partyLedger";
import { partyDueItems, partyDuePaymentUrl } from "./partyDueItems";

export function PartyDues({ personId }: { personId: string }) {
  const { ledger, go, detail } = useNotebook();
  const { t, money, formatDigits, date } = useLanguageContext();
  const [params] = useSearchParams();
  const location = useLocation();
  const person = ledger.people.find((row) => row.id === personId);
  const workId = params.get("work") || undefined;
  const account = AccountSchema.safeParse(params.get("account")).data;
  const scopeInvalid = Boolean(
    (workId && !ledger.works.some((row) => row.id === workId)) ||
    (params.has("account") && !account),
  );
  const rows = useMemo(
    () =>
      scopeInvalid ? [] : partyDueItems(ledger, personId, { workId, account }),
    [ledger, personId, workId, account, scopeInvalid],
  );
  const unresolved =
    partyLedger(ledger, personId).creditAmbiguous ||
    reconciledTotals(ledger, {
      personId,
      ...(workId ? { workId } : {}),
      ...(account ? { account } : {}),
    }).balanceAmbiguous;
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const back = location.pathname + location.search + location.hash;
  if (!person || scopeInvalid)
    return (
      <div className="empty-panel">
        <h1>{t(!person ? "এই নামটি পাওয়া যাচ্ছে না।" : "খাতা পাওয়া যায়নি")}</h1>
        <button className="secondary-button" onClick={() => go("/dues")}>
          {t("বাকির হিসাব")}
        </button>
      </div>
    );
  return (
    <div className="home-dues-page page-flow">
      <header className="home-dues-heading">
        <button
          type="button"
          className="icon-button"
          aria-label={t("ফিরুন")}
          onClick={() => go(`/parties/${encodeURIComponent(personId)}`)}
        >
          <ArrowLeftIcon size={22} aria-hidden="true" />
        </button>
        <h1>
          {formatDigits(person.name)} · {t("বাকির হিসাব")}
        </h1>
      </header>
      <section className="panel home-dues-panel" aria-label={t("বাকির হিসাব")}>
        {unresolved && (
          <p role="status" className="field-hint">
            {t("বাকির হিসাব যাচাই বাকি")}
          </p>
        )}
        {rows.length > 0 && (
          <dl className="home-dues-total">
            <dt>{t(unresolved ? "জানা বাকি" : "মোট বাকি")}</dt>
            <dd>{money(total)}</dd>
          </dl>
        )}
        {rows.length ? (
          <ul className="home-dues-list">
            {rows.map((row) => {
              const work = ledger.works.find((item) => item.id === row.workId);
              const contract = ledger.contracts.find(
                (item) => item.id === row.contractId,
              );
              const label = row.billId
                ? formatDigits(row.label === "বিল" ? t("বিল") : row.label)
                : t(row.label);
              const context = [
                row.date ? date(row.date) : "",
                work?.name ? formatDigits(work.name) : "",
                contract?.title ? formatDigits(contract.title) : "",
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    className="home-dues-row"
                    onClick={() =>
                      row.billId
                        ? detail(row.billId)
                        : go(
                            `/ledger?${new URLSearchParams({ person: personId, account: row.account, ...(row.workId ? { work: row.workId } : {}) })}`,
                          )
                    }
                  >
                    <span className="home-dues-copy">
                      <strong>{label}</strong>
                      {context && <small>{context}</small>}
                    </span>
                    <strong className="home-dues-amount">
                      {money(row.amount)}
                    </strong>
                    <CaretRightIcon size={16} aria-hidden="true" />
                  </button>
                  {!person.archivedAt && contactEntryPolicy(person).payment && (
                    <button
                      type="button"
                      className="home-dues-pay"
                      aria-label={t("পরিশোধ: {{name}}", { name: label })}
                      onClick={() =>
                        go(partyDuePaymentUrl(row, back, { workId, account }))
                      }
                    >
                      {t("পরিশোধ")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          !unresolved && (
            <p className="home-dues-empty">{t("এখন কোনো বাকি নেই")}</p>
          )
        )}
      </section>
    </div>
  );
}
