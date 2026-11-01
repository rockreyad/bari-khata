import { useMemo, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DotsThreeIcon,
  PhoneCallIcon,
  PlusIcon,
  TruckIcon,
  WalletIcon,
} from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { EntryList } from "../../components/ui/EntryList";
import { AppMenu } from "../../components/ui/AppMenu";
import {
  allowedContactActions,
  contactAccountSummary,
  defaultContactAccount,
  personKind,
  sortContactEntries,
} from "../../domain/contacts";
import { contractSummary } from "../../domain/ledger";
import type { Account } from "../../domain/model";
import { PersonMark, kindLabels, accountLabels } from "./ContactIdentity";
import { StatementSheet } from "./StatementSheet";
import { phoneLink } from "./people";
import "./people.css";
export function PersonPage() {
  const { ledger, go, add, entity, detail, base } = useNotebook();
  const { t, money } = useLanguageContext();
  const { id, personId } = useParams();
  const [params, setParams] = useSearchParams();
  const [shareOpen, setShareOpen] = useState(false);
  const person = ledger.people.find((record) => record.id === (id ?? personId));
  const kind = person ? personKind(person) : "other";
  const defaultAccount = person ? defaultContactAccount(person) : "materials";
  const rawAccount = params.get("account");
  const account: Account =
    rawAccount && ["materials", "labour", "other"].includes(rawAccount)
      ? (rawAccount as Account)
      : defaultAccount;
  const workId = ledger.works.some((work) => work.id === params.get("work"))
    ? params.get("work")!
    : "";
  const full = params.get("view") === "history";
  const summary = useMemo(
    () =>
      person
        ? contactAccountSummary(ledger, person, account, workId || undefined)
        : null,
    [ledger, person, account, workId],
  );
  const entries = useMemo(
    () => sortContactEntries(summary?.entries ?? [], false),
    [summary],
  );
  const filter = (key: string, value: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  if (!person || !summary)
    return (
      <div className="empty-panel">
        <h1>{t("এই নামটি খাতায় নেই")}</h1>
        <button className="secondary-button" onClick={() => go("/people")}>
          {t("মানুষ ও দোকানে ফিরি")}
        </button>
      </div>
    );
  if (full) {
    const scoped = new URLSearchParams(params);
    scoped.delete("view");
    scoped.set("person", person.id);
    scoped.set("account", account);
    if (!scoped.has("order")) scoped.set("order", "oldest");
    return (
      <Navigate replace to={`${base ?? ""}/ledger?${scoped.toString()}`} />
    );
  }
  const historyQuery = new URLSearchParams({
    person: person.id,
    account,
    order: "oldest",
  });
  if (workId) historyQuery.set("work", workId);
  const fullHistoryPath = `/ledger?${historyQuery.toString()}`;
  const href = phoneLink(person.phone);
  const actions = allowedContactActions(person);
  const otherAccounts = (["materials", "labour", "other"] as Account[]).filter(
    (value) =>
      value !== account &&
      ledger.entries.some(
        (entry) => entry.personId === person.id && entry.account === value,
      ),
  );
  const addPayment = () =>
    add({
      kind: "payment",
      personId: person.id,
      workId: workId || undefined,
      account: defaultAccount,
    });
  const addPurchase = () =>
    add({
      kind: "expense",
      personId: person.id,
      workId: workId || undefined,
      account: "materials",
      costType: "material",
    });
  const addTransport = () =>
    add({
      kind: "expense",
      personId: person.id,
      workId: workId || undefined,
      account: "other",
      costType: "transport",
    });
  const personContracts =
    account === "labour"
      ? ledger.contracts.filter(
          (c) => c.personId === person.id && (!workId || c.workId === workId),
        )
      : [];
  const menu = [
    ...(kind === "worker"
      ? [
          {
            label: t("মজুরির বিল লিখি"),
            onSelect: () =>
              add({
                kind: "wage",
                personId: person.id,
                workId: workId || undefined,
                account: "labour",
                costType: "labour",
              }),
          },
          {
            label: t("মজুরির চুক্তি রাখি"),
            onSelect: () =>
              entity("contract", undefined, workId || undefined, person.id),
          },
        ]
      : []),
    {
      label: t("তথ্য ও বোতাম বদলাই"),
      onSelect: () => entity("person", person.id),
    },
    { label: t("হিসাবের কপি পাঠাই"), onSelect: () => setShareOpen(true) },
    ...(kind === "shop" && actions.includes("return")
      ? [
          {
            label: t("মাল ফেরত লিখি"),
            onSelect: () =>
              add({
                kind: "return",
                personId: person.id,
                account: "materials",
                workId: workId || undefined,
              }),
            separatorBefore: true,
          },
        ]
      : []),
    ...otherAccounts.map((value) => ({
      label: t(accountLabels[value]),
      onSelect: () => filter("account", value),
      separatorBefore: true,
    })),
  ];
  return (
    <div className="contacts-page contact-detail-page">
      <button className="back-link" onClick={() => go("/people")}>
        <ArrowLeftIcon size={17} />
        {t("মানুষ ও দোকান")}
      </button>
      <header className="contact-profile-header">
        <PersonMark person={person} large />
        <div>
          <h1>{person.name}</h1>
          <p>{person.role || t(kindLabels[kind])}</p>
        </div>
        {href ? (
          <a className="icon-button" href={href} aria-label={t("ফোন করি")}>
            <PhoneCallIcon size={22} weight="duotone" />
          </a>
        ) : null}
        <AppMenu
          label={t("এই নামের আরও কাজ")}
          trigger={
            <button className="icon-button" aria-label={t("আরও")}>
              <DotsThreeIcon size={25} />
            </button>
          }
          items={menu}
        />
      </header>
      <section className="contact-summary-card">
        <div className="contact-paid">
          <span>{t("টাকা দিয়েছি")}</span>
          <strong>{money(summary.netPaid)}</strong>
        </div>
        <div className="contact-balance-pair">
          <div>
            <small>{t("দিতে বাকি")}</small>
            <strong className={summary.payable ? "contact-due" : ""}>
              {money(summary.payable)}
            </strong>
          </div>
          <div>
            <small>{t("আগাম দিয়েছি")}</small>
            <strong className={summary.advance ? "contact-credit" : ""}>
              {money(summary.advance)}
            </strong>
          </div>
        </div>
        <div className="contact-account-note">
          <span>{t(accountLabels[account])}</span>
          {account !== defaultAccount ? (
            <button onClick={() => filter("account", "")}>
              {t("মূল হিসাবে ফিরি")}
            </button>
          ) : null}
        </div>
      </section>
      {personContracts.length ? (
        <details className="work-agreements contact-agreements">
          <summary>{t("মজুরির চুক্তি")}</summary>
          {personContracts.map((c) => {
            const agreement = contractSummary(ledger, c.id);
            return (
              <div className="wage-agreement-v3" key={c.id}>
                <strong>
                  {ledger.works.find((w) => w.id === c.workId)?.name}
                </strong>
                <div>
                  <span>{t("ঠিক করা মোট মজুরি")}</span>
                  <strong>{money(c.total)}</strong>
                </div>
                <div>
                  <span>{t("এই চুক্তিতে দিয়েছি")}</span>
                  <strong>{money(agreement.netPaid)}</strong>
                </div>
                <div>
                  <span>{t("চুক্তির আর বাকি")}</span>
                  <strong>{money(agreement.remaining)}</strong>
                </div>
                <button
                  className="text-button"
                  onClick={() => entity("contract", c.id, c.workId, person.id)}
                >
                  {t("চুক্তি বদলাই")}
                </button>
              </div>
            );
          })}
        </details>
      ) : null}
      {summary.historicalCount ? (
        <p className="contact-old-note">
          {t(
            "পুরোনো খাতার পরিশোধ পরিষ্কার নয়। সেই তথ্য দিয়ে বাকি বা আগাম ধরে নেওয়া হয়নি।",
          )}
        </p>
      ) : null}
      {account === defaultAccount ? (
        <div className="contact-main-actions">
          {actions.includes("payment") ? (
            <button className="primary-button" onClick={addPayment}>
              <WalletIcon size={20} weight="duotone" />
              {t("টাকা দিলাম")}
            </button>
          ) : null}
          {actions.includes("purchase") ? (
            <button className="secondary-button" onClick={addPurchase}>
              <PlusIcon size={19} />
              {t("মাল কিনেছি")}
            </button>
          ) : null}
          {actions.includes("transport") ? (
            <button className="secondary-button" onClick={addTransport}>
              <TruckIcon size={20} />
              {t("আনার খরচ লিখি")}
            </button>
          ) : null}
        </div>
      ) : null}
      <section className="contact-history">
        <div className="contact-history-heading">
          <div>
            <h2>{t("শেষ ৫টি লেনদেন")}</h2>
            <p>{t(accountLabels[account])}</p>
          </div>
          <button className="text-button" onClick={() => go(fullHistoryPath)}>
            {t("পুরো হিসাব")}
            <ArrowRightIcon size={17} />
          </button>
        </div>
        <EntryList
          ledger={ledger}
          entries={entries.slice(0, 5)}
          order="newest"
          hidePerson
          workId={workId || undefined}
          onEntry={detail}
        />
        {entries.length > 5 ? (
          <button
            className="contact-all-history"
            onClick={() => go(fullHistoryPath)}
          >
            {t("শুরু থেকে সব লেনদেন দেখুন")}
            <ArrowRightIcon size={18} />
          </button>
        ) : null}
      </section>
      {shareOpen ? (
        <StatementSheet
          person={person}
          account={account}
          workId={workId || undefined}
          onClose={() => setShareOpen(false)}
        />
      ) : null}
    </div>
  );
}
