import { useMemo, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CaretDownIcon,
  DotsThreeIcon,
  PhoneCallIcon,
  PlusIcon,
  TruckIcon,
  WalletIcon,
} from "@phosphor-icons/react";
import { useEntityRemoval } from "../../components/EntityRemoval";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { EntryList } from "../../components/ui/EntryList";
import { SpendingChart } from "../../components/ui/SpendingChart";
import { AppMenu } from "../../components/ui/AppMenu";
import {
  allowedContactActions,
  contactAccountSummary,
  defaultContactAccount,
  personKind,
  sortContactEntries,
} from "../../domain/contacts";
import { contractAppliesToWork } from "../../domain/contracts";
import { personSummary } from "../../domain/ledger";
import { BalanceProgress } from "../../components/ui/BalanceProgress";
import { JobPreview } from "../jobs/JobPreview";
import { jobBalanceTotals } from "../jobs/jobView";
import type { Account } from "../../domain/model";
import { PersonMark, kindLabels, accountLabels } from "./ContactIdentity";
import { StatementSheet } from "./StatementSheet";
import { phoneLink } from "./people";
import { PersonNotebooks } from "./PersonNotebooks";
import { TotalAdjustmentSheet } from "../reconciliation/TotalAdjustmentSheet";
import "./people.css";
import "../reconciliation/balance-adjustment.css";
export function PersonPage() {
  const { ledger, go, add, entity, detail, base } = useNotebook();
  const { t, money, formatDigits } = useLanguageContext();
  const { id, personId } = useParams();
  const [params, setParams] = useSearchParams();
  const [shareOpen, setShareOpen] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const person = ledger.people.find((record) => record.id === (id ?? personId));
  const removal = useEntityRemoval("person", id ?? personId);
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
  const chartLedger = useMemo(
    () => ({ ...ledger, entries: summary?.entries ?? [] }),
    [ledger, summary],
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
  const actions = removal.archived ? [] : allowedContactActions(person);
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
          (c) =>
            c.personId === person.id &&
            (!workId || contractAppliesToWork(c, workId)),
        )
      : [];
  const uncontractedAdvance = personContracts.length
    ? personSummary(
        {
          ...ledger,
          entries: summary.entries.filter((entry) => !entry.contractId),
        },
        person.id,
        workId || undefined,
      ).advance
    : summary.reconciledAdvance;
  const jobTotals = jobBalanceTotals(ledger, personContracts);
  const hasJobs = personContracts.some((job) => !job.archivedAt);
  const isPurchase = account === "materials";
  const metrics = [
    ...((summary.reconciledCost !== 0 || summary.costCorrection !== 0) &&
    summary.reconciledCost !== summary.reconciledNetPaid
      ? [
          {
            label: isPurchase
              ? "মালের দাম"
              : account === "labour"
                ? "কাজের মজুরি"
                : "অন্য খরচ",
            amount: summary.reconciledCost,
            tone: "contact-expense",
          },
        ]
      : []),
    ...((summary.balanceAmbiguous
      ? summary.payable
      : summary.reconciledPayable) > 0
      ? [
          {
            label: summary.balanceAmbiguous ? "বিলের বাকি" : "দিতে বাকি",
            amount: summary.balanceAmbiguous
              ? summary.payable
              : summary.reconciledPayable,
            tone: "contact-due",
          },
        ]
      : []),
  ];
  if (
    kind === "shop" &&
    summary.confirmedCost > 0 &&
    summary.reconciledAdvance > 0
  )
    metrics.push({
      label: summary.owedCorrection !== 0 ? "আমার জমা" : "অগ্রিম",
      amount: summary.reconciledAdvance,
      tone: "contact-credit",
    });
  const menu = [
    {
      label: t("তথ্য ও বোতাম বদলাই"),
      onSelect: () => entity("person", person.id),
      disabled: removal.archived,
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
    removal.menuItem,
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
          <h1>{formatDigits(person.name)}</h1>
          <p>{formatDigits(person.role || t(kindLabels[kind]))}</p>
        </div>
        {href ? (
          <a className="icon-button" href={href} aria-label={t("ফোন করি")}>
            <PhoneCallIcon size={22} weight="duotone" />
          </a>
        ) : null}
        <AppMenu
          label={t("এই নামের আরও কাজ")}
          trigger={
            <button
              className="icon-button"
              aria-label={t("আরও")}
              ref={removal.triggerRef}
            >
              <DotsThreeIcon size={25} />
            </button>
          }
          items={menu}
        />
      </header>
      <PersonNotebooks
        ledger={ledger}
        person={person}
        selectedWorkId={workId}
        onSelect={(id) => filter("work", id)}
      />
      {removal.notice}
      {removal.dialog}
      <section
        className={`contact-summary-card contact-summary-${kind}`}
        aria-label={t("এই নামের মোট হিসাব")}
      >
        <div className="contact-summary-hero">
          <span>{t("মোট টাকা দিয়েছি")}</span>
          <strong>{money(summary.reconciledNetPaid)}</strong>
          {summary.paidCorrection !== 0 ||
          summary.costCorrection !== 0 ||
          summary.balanceCorrection !== 0 ? (
            <small>{t("সমন্বয়সহ")}</small>
          ) : null}
          {summary.refunds > 0 ? <small>{t("ফেরত বাদে")}</small> : null}
        </div>
        {metrics.length ? (
          <dl
            className="contact-summary-metrics"
            style={{
              gridTemplateColumns: `repeat(${metrics.length}, minmax(0, 1fr))`,
            }}
          >
            {metrics.map((metric) => (
              <div key={metric.label}>
                <dt>{t(metric.label)}</dt>
                <dd className={metric.tone}>{money(metric.amount)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {hasJobs ? (
          <div className="contact-job-totals">
            <h2>{t("সব কাজ মিলিয়ে")}</h2>
            {jobTotals.valid ? (
              <dl>
                <div>
                  <dt>{t("চুক্তির অবশিষ্ট")}</dt>
                  <dd className="contact-due">{money(jobTotals.remaining)}</dd>
                </div>
                {jobTotals.extra > 0 ? (
                  <div>
                    <dt>{t("বেশি দিয়েছি")}</dt>
                    <dd className="contact-credit">{money(jobTotals.extra)}</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p>{t("টাকার অঙ্ক বেশি হয়েছে।")}</p>
            )}
            <small>{t("কাজের মোট দর থেকে দেওয়া টাকা বাদে")}</small>
          </div>
        ) : null}
        {kind === "shop" &&
        account === "materials" &&
        summary.confirmedCost > 0 &&
        summary.payable > 0 ? (
          <div className="contact-bill-progress">
            <BalanceProgress
              total={summary.confirmedCost}
              paid={summary.netPaid}
              compact
              showAmounts={false}
              showStatus={false}
            />
          </div>
        ) : null}
        {uncontractedAdvance > 0 &&
        (kind !== "shop" || summary.confirmedCost <= 0) ? (
          <details className="contact-reconciliation">
            <summary>
              {t("আরও হিসাব")}
              <CaretDownIcon size={16} />
            </summary>
            <dl>
              <dt>
                {t(summary.owedCorrection !== 0 ? "আমার জমা" : "অগ্রিম দিয়েছি")}
              </dt>
              <dd>{money(uncontractedAdvance)}</dd>
            </dl>
          </details>
        ) : null}
        {workId || account !== defaultAccount ? (
          <div className="contact-account-note">
            <span>
              {workId
                ? formatDigits(
                    ledger.works.find((work) => work.id === workId)!.name,
                  )
                : t(accountLabels[account])}
            </span>
            <button onClick={() => filter(workId ? "work" : "account", "")}>
              {t(workId ? "সব কাজের হিসাব" : "মূল হিসাবে ফিরি")}
            </button>
          </div>
        ) : null}
        <SpendingChart
          ledger={chartLedger}
          personId={person.id}
          workId={workId || undefined}
          basis="paid"
          title="মাসের হিসাব"
          presentation="embedded"
        />
      </section>
      {!removal.archived ? (
        <div className="contact-adjustment-link">
          <button
            className="text-button"
            onClick={() => setAdjustmentOpen(true)}
          >
            {t("মোট হিসাব মেলাই")}
          </button>
        </div>
      ) : null}
      {account === defaultAccount ? (
        <div
          className={`contact-main-actions ${kind === "shop" ? "contact-shop-actions" : ""}`}
        >
          {kind === "shop" && actions.includes("purchase") ? (
            <button className="primary-button" onClick={addPurchase}>
              <PlusIcon size={20} />
              {t("মাল কিনলাম")}
            </button>
          ) : null}
          {actions.includes("payment") ? (
            <button
              className={
                kind === "shop" && actions.includes("purchase")
                  ? "secondary-button"
                  : "primary-button"
              }
              onClick={addPayment}
            >
              <WalletIcon size={20} weight="duotone" />
              {t("টাকা দিই")}
            </button>
          ) : null}
          {kind !== "shop" && actions.includes("purchase") ? (
            <button className="secondary-button" onClick={addPurchase}>
              <PlusIcon size={19} />
              {t("মাল কিনলাম")}
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
      {kind === "worker" && account === "labour" ? (
        <JobPreview
          ledger={ledger}
          contracts={personContracts}
          personId={person.id}
          allowCreate={!removal.archived}
          workId={workId || undefined}
        />
      ) : null}
      {summary.historicalCount ? (
        <p className="contact-old-note">
          {t(
            "পুরোনো খাতার পরিশোধ পরিষ্কার নয়। সেই তথ্য দিয়ে বাকি বা আগাম ধরে নেওয়া হয়নি।",
          )}
        </p>
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
          showKind
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
      {adjustmentOpen ? (
        <TotalAdjustmentSheet
          target={{ target: "person", id: person.id, account }}
          name={person.name}
          onClose={() => setAdjustmentOpen(false)}
        />
      ) : null}
    </div>
  );
}
