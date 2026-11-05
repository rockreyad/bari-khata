import { useMemo, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DotsThreeIcon,
  NotePencilIcon,
  PhoneCallIcon,
  PlusIcon,
  WalletIcon,
} from "@phosphor-icons/react";
import { useEntityRemoval } from "../../components/EntityRemoval";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { EntryList } from "../../components/ui/EntryList";
import { AppMenu } from "../../components/ui/AppMenu";
import {
  contactSummary,
  personKind,
  sortContactEntries,
} from "../../domain/contacts";
import { contractAppliesToWork } from "../../domain/contracts";
import { partyLedger } from "../../domain/partyLedger";
import { PersonMark, kindLabels } from "./ContactIdentity";
import { StatementSheet } from "./StatementSheet";
import { phoneLink } from "./people";
import { PersonNotebooks } from "./PersonNotebooks";
import "./people.css";
import "./person-page.css";
import "./person-activity.css";
import "./person-simple.css";

export function PersonPage() {
  const { ledger, go, entity, detail, base } = useNotebook();
  const { t, money, formatDigits } = useLanguageContext();
  const { id, personId } = useParams();
  const [params, setParams] = useSearchParams();
  const [shareOpen, setShareOpen] = useState(false);
  const person = ledger.people.find((record) => record.id === (id ?? personId));
  const removal = useEntityRemoval("person", id ?? personId);
  const workId = ledger.works.some((work) => work.id === params.get("work"))
    ? params.get("work")!
    : "";
  const summary = useMemo(
    () => (person ? contactSummary(ledger, person, workId || undefined) : null),
    [ledger, person, workId],
  );
  const account = useMemo(
    () => (person ? partyLedger(ledger, person.id) : null),
    [ledger, person],
  );
  const entries = useMemo(
    () => sortContactEntries(summary?.entries ?? [], false),
    [summary],
  );
  if (!person || !summary || !account)
    return (
      <div className="empty-panel">
        <h1>{t("এই নামটি খাতায় নেই")}</h1>
        <button className="secondary-button" onClick={() => go("/people")}>
          {t("মানুষ ও দোকানে ফিরি")}
        </button>
      </div>
    );
  const history = new URLSearchParams({ person: person.id, order: "oldest" });
  if (workId) history.set("work", workId);
  const historyPath = `/history?${history}`;
  if (params.get("view") === "history")
    return <Navigate replace to={`${base ?? ""}${historyPath}`} />;
  const kind = personKind(person);
  const ambiguous = summary.balanceAmbiguous;
  const due = ambiguous ? 0 : summary.reconciledPayable;
  const advance = ambiguous ? 0 : summary.reconciledAdvance;
  const receivable = !workId
    ? account.receivable
    : account.payments
        .filter((payment) => payment.context === "receivable")
        .reduce(
          (sum, payment) =>
            sum +
            payment.works
              .filter((work) => work.workId === workId)
              .reduce((total, work) => total + work.available, 0),
          0,
        );
  const href = phoneLink(person.phone);
  const contracts = ledger.contracts.filter(
    (contract) =>
      contract.personId === person.id &&
      !contract.archivedAt &&
      (!workId || contractAppliesToWork(contract, workId)),
  );
  const write = (action?: "purchase" | "charge" | "payment") => {
    const query = new URLSearchParams({ person: person.id });
    if (workId) query.set("work", workId);
    go(`/write${action ? `/${action}` : ""}?${query}`);
  };
  const menu = [
    {
      label: t("তথ্য ও বোতাম বদলাই"),
      onSelect: () => entity("person", person.id),
      disabled: removal.archived,
    },
    { label: t("হিসাবের কপি পাঠাই"), onSelect: () => setShareOpen(true) },
    removal.menuItem,
  ];
  return (
    <div className="contacts-page contact-detail-page person-simple-page">
      <nav className="contact-navigation" aria-label={t("মানুষ ও দোকান")}>
        <button className="back-link" onClick={() => go("/people")}>
          <ArrowLeftIcon size={18} />
          {t("মানুষ ও দোকান")}
        </button>
        <div className="contact-navigation-actions">
          {href ? (
            <a className="icon-button" href={href} aria-label={t("ফোন করি")}>
              <PhoneCallIcon size={22} />
            </a>
          ) : null}
          <AppMenu
            label={t("এই নামের আরও কাজ")}
            trigger={
              <button
                type="button"
                className="icon-button"
                aria-label={t("আরও")}
                ref={removal.triggerRef}
              >
                <DotsThreeIcon size={25} />
              </button>
            }
            items={menu}
          />
        </div>
      </nav>
      <header className="contact-profile-header">
        <PersonMark person={person} large />
        <div>
          <h1>{formatDigits(person.name)}</h1>
          <div className="contact-profile-meta">
            <p>{formatDigits(person.role || t(kindLabels[kind]))}</p>
            <PersonNotebooks
              ledger={ledger}
              person={person}
              selectedWorkId={workId}
              onSelect={(next) =>
                setParams(
                  (previous) => {
                    const changed = new URLSearchParams(previous);
                    if (next) changed.set("work", next);
                    else changed.delete("work");
                    return changed;
                  },
                  { replace: true },
                )
              }
            />
          </div>
        </div>
      </header>
      {removal.notice}
      {removal.dialog}
      <section className="person-now-card" aria-label={t("এখনকার হিসাব")}>
        <div className="person-balance-head">
          <span>
            {t(
              ambiguous
                ? "বাকি এখনও পরিষ্কার নয়"
                : due > 0
                  ? "দিতে বাকি"
                  : advance > 0
                    ? "জমা আছে"
                    : receivable > 0
                      ? "ফেরত পাব"
                      : entries.length
                        ? "এখন কোনো বাকি নেই"
                        : "এখনও হিসাব লেখা হয়নি",
            )}
          </span>
          {!ambiguous && (due > 0 || advance > 0 || receivable > 0) ? (
            <strong className={due > 0 ? "contact-due" : "contact-credit"}>
              {money(due > 0 ? due : advance > 0 ? advance : receivable)}
            </strong>
          ) : null}
        </div>
        {ambiguous ? (
          <button
            type="button"
            className="text-button person-review-link"
            onClick={() =>
              go(`/migration?person=${encodeURIComponent(person.id)}`)
            }
          >
            {t("আগের হিসাব দেখে নিই")}
            <ArrowRightIcon size={16} />
          </button>
        ) : null}
        <dl className="person-money-details">
          {due > 0 && advance > 0 ? (
            <div>
              <dt>{t("জমা আছে")}</dt>
              <dd>{money(advance)}</dd>
            </div>
          ) : null}
          {receivable > 0 && (ambiguous || due > 0 || advance > 0) ? (
            <div>
              <dt>{t("ফেরত পাব")}</dt>
              <dd>{money(receivable)}</dd>
            </div>
          ) : null}
          <div>
            <dt>{t("মোট টাকা দিয়েছি")}</dt>
            <dd>{money(summary.reconciledNetPaid)}</dd>
          </div>
          {summary.reconciledCost !== 0 ? (
            <div>
              <dt>{t("মাল ও কাজ হয়েছে")}</dt>
              <dd>{money(summary.reconciledCost)}</dd>
            </div>
          ) : null}
        </dl>
        {!removal.archived ? (
          <div className="person-record-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => write("payment")}
            >
              <WalletIcon size={21} />
              {t("টাকা দিই")}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => write()}
            >
              <NotePencilIcon size={21} />
              {t("হিসাব লিখি")}
            </button>
          </div>
        ) : null}
      </section>
      <section className="contact-history">
        <div className="contact-history-heading">
          <div>
            <h2>{t("সাম্প্রতিক হিসাব")}</h2>
            <p>{t("এই নামের শেষ ৫টি লেখা")}</p>
          </div>
          <button className="text-button" onClick={() => go(historyPath)}>
            {t("পুরো হিসাব")}
            <ArrowRightIcon size={17} />
          </button>
        </div>
        <EntryList
          showKind
          ledger={ledger}
          entries={entries.slice(0, 5)}
          order="newest"
          hidePerson
          hideWork={Boolean(workId)}
          workId={workId || undefined}
          onEntry={detail}
        />
        {!entries.length ? (
          <div className="person-first-record">
            <NotePencilIcon size={28} weight="duotone" />
            <p>{t("মাল কেনা, কাজের বিল বা টাকা দেওয়া এখান থেকেই লিখুন।")}</p>
          </div>
        ) : null}
      </section>
      {contracts.length ? (
        <section className="person-agreements" aria-label={t("কাজের দর")}>
          <div className="section-heading">
            <h2>{t("কাজের দর")}</h2>
            {!removal.archived ? (
              <button
                className="text-button"
                onClick={() =>
                  entity("contract", undefined, workId || undefined, person.id)
                }
              >
                <PlusIcon size={17} />
                {t("যোগ করি")}
              </button>
            ) : null}
          </div>
          {contracts.map((contract) => (
            <button
              key={contract.id}
              className="person-agreement-row"
              onClick={() =>
                go(
                  `/jobs/${encodeURIComponent(contract.id)}?back=${encodeURIComponent(`${base ?? ""}/people/${person.id}`)}`,
                )
              }
            >
              <span>
                <strong>{formatDigits(contract.title || t("কাজ"))}</strong>
                <small>
                  {t("ঠিক করা দর")}: {money(contract.total)}
                </small>
              </span>
              <ArrowRightIcon size={18} />
            </button>
          ))}
        </section>
      ) : !removal.archived ? (
        <button
          className="text-button person-agreement-add"
          onClick={() =>
            entity("contract", undefined, workId || undefined, person.id)
          }
        >
          <PlusIcon size={16} />
          {t("কাজের দর ঠিক করা থাকলে রাখি")}
        </button>
      ) : null}
      {summary.historicalCount ? (
        <p className="contact-old-note">
          {t(
            "পুরোনো খাতার পরিশোধ পরিষ্কার নয়। সেই তথ্য দিয়ে বাকি বা আগাম ধরে নেওয়া হয়নি।",
          )}
        </p>
      ) : null}
      {shareOpen ? (
        <StatementSheet
          person={person}
          workId={workId || undefined}
          onClose={() => setShareOpen(false)}
        />
      ) : null}
    </div>
  );
}
