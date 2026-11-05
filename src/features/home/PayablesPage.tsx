import { useMemo } from "react";
import { ArrowLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { useSearchParams } from "react-router";
import { useNotebook } from "../../app/NotebookProvider";
import { contactEntryPolicy } from "../../domain/contactEntryPolicy";
import { LoadMore } from "../../components/ui/LoadMore";
import { useLanguageContext } from "../../context/LanguageProvider";
import { payableBreakdown, type PayableRow } from "./payableBreakdown";
import "./payables.css";

const PAGE_SIZE = 30;

export function PayablesPage() {
  const { ledger, go, detail, add } = useNotebook();
  const { t, money, formatDigits } = useLanguageContext();
  const [params, setParams] = useSearchParams();
  const { total, rows, people, works, entries } = useMemo(
    () => ({
      ...payableBreakdown(ledger),
      people: new Map(ledger.people.map((person) => [person.id, person])),
      works: new Map(ledger.works.map((work) => [work.id, work.name])),
      entries: new Map(ledger.entries.map((entry) => [entry.id, entry])),
    }),
    [ledger],
  );
  const requestedPage = Number(params.get("page") ?? "1");
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Number.isSafeInteger(requestedPage)
    ? Math.min(pages, Math.max(1, requestedPage))
    : 1;
  const count = page * PAGE_SIZE;
  const onOpen = (row: PayableRow) => {
    if (row.personId) {
      const personId = row.personId;
      const hasEntries = ledger.entries.some(
        (entry) =>
          entry.personId === personId &&
          !entry.voided &&
          entry.balanceImpact !== "historical",
      );
      go(
        hasEntries
          ? `/ledger?${new URLSearchParams({ person: personId, order: "oldest" })}`
          : `/parties/${encodeURIComponent(personId)}?account=labour`,
      );
    } else if (row.entryId) detail(row.entryId);
  };
  return (
    <div className="home-dues-page page-flow">
      <header className="home-dues-heading">
        <button
          type="button"
          className="icon-button"
          aria-label={t("এক নজরে")}
          onClick={() => go("/")}
        >
          <ArrowLeftIcon size={22} aria-hidden="true" />
        </button>
        <h1>{t("কোথায় কত বাকি")}</h1>
      </header>
      <section
        className="panel home-dues-panel"
        aria-label={t("কোথায় কত বাকি")}
      >
        <dl className="home-dues-total">
          <dt>{t("মোট বাকি")}</dt>
          <dd>{money(total)}</dd>
        </dl>
        {rows.length ? (
          <ul className="home-dues-list">
            {rows.slice(0, count).map((row) => {
              const person = row.personId
                ? people.get(row.personId)
                : undefined;
              const entry = row.entryId ? entries.get(row.entryId) : undefined;
              const name =
                person?.name || entry?.lines[0]?.label || entry?.note;
              const context = [
                !person && name ? t("নাম দেওয়া নেই") : "",
                ...row.workIds.map((id) => formatDigits(works.get(id) ?? "")),
                row.wholeHouse ? t("পুরো বাড়ি") : "",
                person?.archivedAt ? t("মুছে রাখা") : "",
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    className="home-dues-row"
                    onClick={() => onOpen(row)}
                  >
                    <span className="home-dues-copy">
                      <strong>
                        {name ? formatDigits(name) : t("নাম দেওয়া নেই")}
                      </strong>
                      {context ? <small>{context}</small> : null}
                    </span>
                    <strong className="home-dues-amount">
                      {money(row.amount)}
                    </strong>
                    <CaretRightIcon size={16} aria-hidden="true" />
                  </button>
                  {person &&
                    !person.archivedAt &&
                    contactEntryPolicy(person).payment && (
                      <button
                        type="button"
                        className="home-dues-pay"
                        aria-label={t("টাকা দিই: {{name}}", {
                          name: person.name,
                        })}
                        onClick={() =>
                          add({
                            kind: "payment",
                            purpose: "settle",
                            personId: person.id,
                          })
                        }
                      >
                        {t("টাকা দিই")}
                      </button>
                    )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="home-dues-empty">{t("এখন কোনো বাকি নেই")}</p>
        )}
        <LoadMore
          hasMore={count < rows.length}
          onLoadMore={() =>
            setParams(
              (previous) => {
                const next = new URLSearchParams(previous);
                next.set("page", String(page + 1));
                return next;
              },
              { replace: true, preventScrollReset: true },
            )
          }
        />
      </section>
    </div>
  );
}
