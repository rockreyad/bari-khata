import { useMemo, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUUpLeftIcon,
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
  canCreateContactJob,
  contactAccountLedger,
  contactSummary,
  contactPaymentAccount,
  personKind,
  sortContactEntries,
} from "../../domain/contacts";
import { getContactEntryDefaults } from "../../domain/contactEntryPolicy";
import type { Account } from "../../domain/model";
import { contractAppliesToWork } from "../../domain/contracts";
import { personSummary } from "../../domain/ledger";
import { partyLedger } from "../../domain/partyLedger";
import { JobPreview } from "../jobs/JobPreview";
import { jobBalanceTotals } from "../jobs/jobView";
import { PersonMark, kindLabels } from "./ContactIdentity";
import { StatementSheet } from "./StatementSheet";
import { phoneLink } from "./people";
import { PersonNotebooks } from "./PersonNotebooks";
import { TotalAdjustmentSheet } from "../reconciliation/TotalAdjustmentSheet";
import "./people.css";
import "./person-page.css";
import "./person-activity.css";
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
  const account = useMemo(
    () => (person ? partyLedger(ledger, person.id) : null),
    [ledger, person],
  );
  const defaultAccount = person
    ? contactPaymentAccount(ledger, person)
    : "materials";
  const workId = ledger.works.some((work) => work.id === params.get("work"))
    ? params.get("work")!
    : "";
  const full = params.get("view") === "history";
  const summary = useMemo(
    () => (person ? contactSummary(ledger, person, workId || undefined) : null),
    [ledger, person, workId],
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
        <button className="secondary-button" onClick={() => go("/parties")}>
          {t("কর্মীর তালিকায় ফিরি")}
        </button>
      </div>
    );
  if (full) {
    const scoped = new URLSearchParams(params);
    scoped.delete("view");
    scoped.delete("account");
    scoped.set("person", person.id);
    if (!scoped.has("order")) scoped.set("order", "oldest");
    return (
      <Navigate replace to={`${base ?? ""}/ledger?${scoped.toString()}`} />
    );
  }
  const historyQuery = new URLSearchParams({
    person: person.id,
    order: "oldest",
  });
  if (workId) historyQuery.set("work", workId);
  const fullHistoryPath = `/ledger?${historyQuery.toString()}`;
  const href = phoneLink(person.phone);
  const actions = removal.archived ? [] : allowedContactActions(person);
  const entryDefaults = (account: Account) =>
    getContactEntryDefaults(ledger, person, {
      workId: workId || undefined,
      account,
    });
  const addPayment = () => {
    const defaults = entryDefaults(defaultAccount);
    add({
      kind: "payment",
      personId: person.id,
      workId: defaults.workId || undefined,
      account: defaults.account,
      ...(defaults.contractId ? { contractId: defaults.contractId } : {}),
    });
  };
  const addPurchase = () => {
    const defaults = entryDefaults("materials");
    add({
      kind: "expense",
      personId: person.id,
      workId: defaults.workId || undefined,
      account: defaults.account,
      costType: "material",
    });
  };
  const addTransport = () => {
    const defaults = entryDefaults("other");
    add({
      kind: "expense",
      personId: person.id,
      workId: defaults.workId || undefined,
      account: defaults.account,
      costType: "transport",
    });
  };
  const addReturn = () => {
    const defaults = entryDefaults("materials");
    add({
      kind: "return",
      personId: person.id,
      workId: defaults.workId || undefined,
      account: defaults.account,
    });
  };
  const personContracts = ledger.contracts.filter(
    (c) =>
      c.personId === person.id && (!workId || contractAppliesToWork(c, workId)),
  );
  const receivable = !workId
    ? (account?.receivable ?? 0)
    : (account?.payments ?? [])
        .filter((payment) => payment.context === "receivable")
        .reduce(
          (sum, payment) =>
            sum +
            payment.works
              .filter((work) => work.workId === workId)
              .reduce((sum, work) => sum + work.available, 0),
          0,
        );
  const uncontractedCredit = summary.balanceAmbiguous
    ? 0
    : !workId && summary.owedCorrection !== 0 && summary.reconciledAdvance > 0
      ? summary.reconciledAdvance
      : personContracts.length
        ? personSummary(
            {
              ...ledger,
              entries: summary.entries.filter((entry) => !entry.contractId),
            },
            person.id,
            workId || undefined,
          ).advance
        : summary.reconciledAdvance;
  const advanceCash = (["materials", "labour", "other"] as const).reduce(
    (total, currentAccount) => {
      const available = (account?.payments ?? [])
        .filter(
          (payment) =>
            !payment.entry.contractId &&
            payment.entry.account === currentAccount &&
            (payment.context === "advance" || !payment.context),
        )
        .reduce(
          (sum, payment) =>
            sum +
            (workId
              ? (payment.works.find((work) => work.workId === workId)
                  ?.available ?? 0)
              : payment.available),
          0,
        );
      if (!available) return total;
      const scoped = contactAccountLedger(ledger, person, currentAccount);
      const credit = personSummary(
        {
          ...scoped,
          entries: scoped.entries.filter((entry) => !entry.contractId),
        },
        person.id,
        workId || undefined,
      ).advance;
      return total + Math.min(credit, available);
    },
    0,
  );
  const uncontractedAdvance =
    summary.owedCorrection !== 0
      ? uncontractedCredit
      : Math.min(uncontractedCredit, advanceCash);
  const jobTotals = jobBalanceTotals(ledger, personContracts);
  const hasJobs = personContracts.some((job) => !job.archivedAt);
  const costMetric =
    (summary.reconciledCost !== 0 || summary.costCorrection !== 0) &&
    summary.reconciledCost !== summary.reconciledNetPaid
      ? {
          label: "মাল ও কাজের খরচ",
          amount: summary.reconciledCost,
        }
      : null;
  const metrics = [
    ...(!summary.balanceAmbiguous && summary.reconciledPayable > 0
      ? [
          {
            label: "দিতে বাকি",
            amount: summary.reconciledPayable,
            tone: "contact-due",
          },
        ]
      : []),
    ...(receivable > 0
      ? [{ label: "ফেরত পাব", amount: receivable, tone: "contact-credit" }]
      : []),
  ];
  if (
    kind === "shop" &&
    summary.confirmedCost > 0 &&
    summary.reconciledAdvance > 0 &&
    !summary.balanceAmbiguous
  )
    metrics.push({
      label: summary.owedCorrection !== 0 ? "আমার জমা" : "অগ্রিম",
      amount: summary.reconciledAdvance,
      tone: "contact-credit",
    });
  const showJobDetails =
    hasJobs &&
    (!jobTotals.valid ||
      summary.balanceAmbiguous ||
      (workId &&
        personContracts.some(
          (job) => job.scope === "house" && !job.archivedAt,
        )) ||
      jobTotals.extra > 0 ||
      jobTotals.remaining !==
        (metrics.find((metric) => metric.tone === "contact-due")?.amount ?? 0));
  const showAdvanceDetails =
    uncontractedAdvance > 0 && (kind !== "shop" || summary.confirmedCost <= 0);
  const showMainActions = actions.some((action) =>
    ["payment", "purchase", "transport", "return"].includes(action),
  );
  const menu = [
    {
      label: t("তথ্য ও বোতাম বদলাই"),
      onSelect: () => entity("person", person.id),
      disabled: removal.archived,
    },
    {
      label: t("হিসাবের কপি পাঠাই"),
      onSelect: () => setShareOpen(true),
    },
    ...(!removal.archived
      ? [
          {
            label: t("মোট হিসাব মেলাই"),
            onSelect: () => setAdjustmentOpen(true),
          },
        ]
      : []),
    removal.menuItem,
  ];
  return (
    <div className="contacts-page contact-detail-page">
      <nav className="contact-navigation" aria-label={t("কর্মী")}>
        <button className="back-link" onClick={() => go("/parties")}>
          <ArrowLeftIcon size={18} />
          {t("কর্মী")}
        </button>
        <div className="contact-navigation-actions">
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
        </div>
      </nav>
      <header className="contact-profile-header">
        <PersonMark person={person} large />
        <div>
          <h1>{formatDigits(person.name)}</h1>
          <div className="contact-profile-meta">
            <p title={formatDigits(person.role || t(kindLabels[kind]))}>
              {formatDigits(person.role || t(kindLabels[kind]))}
            </p>
            <PersonNotebooks
              ledger={ledger}
              person={person}
              selectedWorkId={workId}
              onSelect={(id) => filter("work", id)}
            />
          </div>
        </div>
      </header>
      {removal.notice}
      {removal.dialog}
      <section
        className={`contact-summary-card contact-summary-${kind}`}
        aria-label={t("এই নামের মোট হিসাব")}
      >
        <div
          className={`contact-summary-top ${metrics.length ? "has-balance" : ""}`}
        >
          <div className="contact-summary-hero">
            <span>{t("মোট টাকা দিয়েছি")}</span>
            <strong>{money(summary.reconciledNetPaid)}</strong>
            {summary.refunds > 0 ? <small>{t("ফেরত বাদে")}</small> : null}
            {summary.balanceAmbiguous ? (
              <small role="status">{t("বাকির হিসাব যাচাই বাকি")}</small>
            ) : null}
          </div>
          {metrics.length ? (
            <dl className="contact-summary-metrics">
              {metrics.map((metric) => (
                <div key={metric.label}>
                  <dt>{t(metric.label)}</dt>
                  <dd className={metric.tone}>{money(metric.amount)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
        {showMainActions ? (
          <div
            className={`contact-main-actions ${kind === "shop" ? "contact-shop-actions" : ""}`}
            role="group"
            aria-label={t("হিসাব লেখার বোতাম")}
          >
            {kind === "shop" ? (
              <>
                {actions.includes("purchase") ? (
                  <button className="primary-button" onClick={addPurchase}>
                    <PlusIcon size={20} />
                    <span>{t("মাল কিনলাম")}</span>
                    <ArrowRightIcon
                      className="contact-action-arrow"
                      size={18}
                      aria-hidden="true"
                    />
                  </button>
                ) : null}
                {actions.includes("payment") ||
                actions.includes("transport") ||
                actions.includes("return") ? (
                  <div className="contact-shop-secondary">
                    {actions.includes("payment") ? (
                      <button className="secondary-button" onClick={addPayment}>
                        <WalletIcon size={18} />
                        {t("টাকা দিই")}
                      </button>
                    ) : null}
                    {actions.includes("transport") ? (
                      <button
                        className="secondary-button"
                        onClick={addTransport}
                      >
                        <TruckIcon size={18} />
                        {t("আনার খরচ লিখি")}
                      </button>
                    ) : null}
                    {actions.includes("return") ? (
                      <button className="secondary-button" onClick={addReturn}>
                        <ArrowUUpLeftIcon size={18} />
                        {t("মাল ফেরত দিই")}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                {actions.includes("payment") ? (
                  <button className="primary-button" onClick={addPayment}>
                    <WalletIcon size={20} weight="duotone" />
                    <span>{t("টাকা দিই")}</span>
                    <ArrowRightIcon
                      className="contact-action-arrow"
                      size={18}
                      aria-hidden="true"
                    />
                  </button>
                ) : null}
                {actions.includes("purchase") ? (
                  <button
                    className={
                      actions.includes("payment")
                        ? "secondary-button"
                        : "primary-button"
                    }
                    onClick={addPurchase}
                  >
                    <PlusIcon size={19} />
                    {t("মাল কিনলাম")}
                  </button>
                ) : null}
                {actions.includes("transport") ? (
                  <button
                    className={
                      actions.includes("payment") ||
                      actions.includes("purchase")
                        ? "secondary-button"
                        : "primary-button"
                    }
                    onClick={addTransport}
                  >
                    <TruckIcon size={20} />
                    {t("আনার খরচ লিখি")}
                  </button>
                ) : null}
                {actions.includes("return") ? (
                  <button
                    className={
                      actions.some((action) =>
                        ["payment", "purchase", "transport"].includes(action),
                      )
                        ? "secondary-button"
                        : "primary-button"
                    }
                    onClick={addReturn}
                  >
                    <ArrowUUpLeftIcon size={19} />
                    {t("মাল ফেরত দিই")}
                  </button>
                ) : null}
              </>
            )}
          </div>
        ) : null}
        {showAdvanceDetails || costMetric || showJobDetails ? (
          <details className="contact-reconciliation">
            <summary>
              {t("আরও হিসাব")}
              <CaretDownIcon size={16} />
            </summary>
            {showAdvanceDetails ? (
              <dl>
                <dt>
                  {t(
                    summary.owedCorrection !== 0 ? "আমার জমা" : "অগ্রিম দিয়েছি",
                  )}
                </dt>
                <dd>{money(uncontractedAdvance)}</dd>
              </dl>
            ) : null}
            {costMetric ? (
              <dl className="contact-detail-metrics">
                <dt>{t(costMetric.label)}</dt>
                <dd>{money(costMetric.amount)}</dd>
              </dl>
            ) : null}
            {showJobDetails ? (
              <div className="contact-job-totals">
                <h2>{t("সব কাজ মিলিয়ে")}</h2>
                {jobTotals.valid ? (
                  <dl>
                    <div>
                      <dt>{t("বিলের বাকি")}</dt>
                      <dd className="contact-due">
                        {money(jobTotals.remaining)}
                      </dd>
                    </div>
                    {jobTotals.extra > 0 ? (
                      <div>
                        <dt>{t("জমা আছে")}</dt>
                        <dd className="contact-credit">
                          {money(jobTotals.extra)}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                ) : (
                  <p>
                    {t(
                      summary.balanceAmbiguous
                        ? "যাচাই বাকি"
                        : "টাকার অঙ্ক বেশি হয়েছে।",
                    )}
                  </p>
                )}
                <small>{t("কাজের বিল থেকে দেওয়া টাকা বাদে")}</small>
              </div>
            ) : null}
          </details>
        ) : null}
      </section>
      <div className="contact-trend-card">
        <SpendingChart
          ledger={chartLedger}
          personId={person.id}
          workId={workId || undefined}
          basis="paid"
          title="মাসের হিসাব"
          presentation="embedded"
        />
      </div>
      {canCreateContactJob(person) || personContracts.length > 0 ? (
        <JobPreview
          ledger={ledger}
          contracts={personContracts}
          personId={person.id}
          allowCreate={canCreateContactJob(person)}
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
            <p>{t("সব হিসাব")}</p>
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
          hideWork={Boolean(workId)}
          workId={workId || undefined}
          onEntry={detail}
        />
      </section>
      {shareOpen ? (
        <StatementSheet
          person={person}
          workId={workId || undefined}
          onClose={() => setShareOpen(false)}
        />
      ) : null}
      {adjustmentOpen ? (
        <TotalAdjustmentSheet
          target={{
            target: "person",
            id: person.id,
            workId: workId || null,
          }}
          name={person.name}
          onClose={() => setAdjustmentOpen(false)}
        />
      ) : null}
    </div>
  );
}
