import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  CaretDownIcon,
  CaretRightIcon,
  CoinsIcon,
  HardHatIcon,
  MagnifyingGlassIcon,
  PackageIcon,
  PlusIcon,
  ClipboardTextIcon,
} from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { summarize } from "../../domain/ledger";
import { cashSummary } from "../../domain/cashSummary";
import { EntryList } from "../../components/ui/EntryList";
import { pendingReviewEntries } from "../import/bulkReview";
import { WorkCard } from "../works/WorksPages";
import { orderedWorks } from "../works/workOverview";
import "./home-summary.css";
export function HomePage() {
  const { ledger, add, go, detail } = useNotebook();
  const { t, money, number, formatDigits } = useLanguageContext();
  const s = summarize(ledger);
  const paid = cashSummary(ledger);
  const pending = pendingReviewEntries(ledger).length;
  const ongoingWorks = orderedWorks(ledger).filter(
    (work) => work.status === "ongoing",
  );
  const cards = [
    {
      label: "মাল কিনতে দিয়েছি",
      value: paid.byAccount.materials,
      scope: "materials",
      Icon: PackageIcon,
    },
    {
      label: "মিস্ত্রিকে দিয়েছি",
      value: paid.byAccount.labour,
      scope: "labour",
      Icon: HardHatIcon,
    },
    ...(paid.byAccount.other !== 0
      ? [
          {
            label: "অন্য কাজে দিয়েছি",
            value: paid.byAccount.other,
            scope: "other",
            Icon: CoinsIcon,
          },
        ]
      : []),
  ];
  return (
    <div className="home-v3 page-flow">
      <div className="home-overview">
        <header className="home-overview-heading">
          <div>
            <p className="home-overview-project">
              {formatDigits(ledger.project.name)}
            </p>
            <h1>{t("আমার হিসাব")}</h1>
          </div>
          <button
            className="home-overview-search"
            aria-label={t("আগের হিসাব খুঁজুন")}
            onClick={() => go("/ledger?focus=search")}
          >
            <MagnifyingGlassIcon size={23} />
          </button>
        </header>
        <section
          className="home-overview-card"
          aria-label={t("মোট টাকা দিয়েছি")}
        >
          <div className="home-overview-balance">
            <div className="home-overview-balance-heading">
              <dl className="home-overview-paid">
                <div className="home-overview-paid-total">
                  <dt>{t("মোট টাকা দিয়েছি")}</dt>
                  <dd>{money(s.reconciledNetPaid)}</dd>
                </div>
                {s.paidCorrection !== 0 ? (
                  <div className="home-overview-correction">
                    <dt>{t("সমন্বয়")}</dt>
                    <dd>{money(s.paidCorrection)}</dd>
                  </div>
                ) : null}
              </dl>
              <button
                className="home-overview-report"
                onClick={() => go("/reports")}
              >
                {t("রিপোর্ট")}
                <ArrowUpRightIcon size={16} aria-hidden="true" />
              </button>
            </div>
            {s.reconciledPayable > 0 ? (
              <dl className="home-overview-due">
                <dt>{t("দিতে বাকি")}</dt>
                <dd>{money(s.reconciledPayable)}</dd>
              </dl>
            ) : null}
          </div>
          <div className="home-overview-actions">
            <button className="home-overview-add" onClick={() => add()}>
              <PlusIcon size={20} aria-hidden="true" />
              {t("খরচ লিখি")}
            </button>
            <button
              className="home-overview-pay"
              onClick={() => add({ kind: "payment" })}
            >
              <ArrowUpRightIcon size={20} aria-hidden="true" />
              {t("টাকা দিলাম")}
            </button>
          </div>
          <details className="home-overview-details">
            <summary>
              {t("কোথায় কত দিয়েছি")}
              <CaretDownIcon size={17} aria-hidden="true" />
            </summary>
            {s.paidCorrection !== 0 ? (
              <p className="home-overview-cash-note">
                {t("এই ভাগে দেওয়া ও ফেরত পাওয়া টাকার হিসাব আছে।")}
              </p>
            ) : null}
            <div className="home-overview-breakdown">
              {cards.map(({ label, value, scope, Icon }) => (
                <button
                  key={scope}
                  onClick={() => go(`/reports?account=${scope}`)}
                >
                  <span className="home-overview-category">
                    <Icon size={18} aria-hidden="true" />
                    <span>{t(label)}</span>
                  </span>
                  <strong>{money(value)}</strong>
                  <CaretRightIcon size={15} aria-hidden="true" />
                </button>
              ))}
            </div>
          </details>
        </section>
        {pending > 0 ? (
          <button
            className="home-review-notice"
            onClick={() => go("/review?bulk=1")}
          >
            <span className="home-review-symbol">
              <ClipboardTextIcon size={22} weight="duotone" />
            </span>
            <span>
              <strong>
                {t("{{count}}টি হিসাবের তথ্য যোগ করা বাকি", {
                  count: number(pending),
                })}
              </strong>
              <small>{t("একসাথে দেখে ঠিক করুন")}</small>
            </span>
            <ArrowRightIcon size={18} />
          </button>
        ) : null}
      </div>
      <section className="panel home-history-v3">
        <div className="section-heading">
          <h2>{t("সাম্প্রতিক হিসাব")}</h2>
          <button className="text-button" onClick={() => go("/ledger")}>
            {t("সব হিসাব")}
            <ArrowRightIcon size={16} />
          </button>
        </div>
        <EntryList
          showKind
          ledger={ledger}
          entries={[...ledger.entries]
            .sort(
              (a, b) =>
                (b.date ?? "").localeCompare(a.date ?? "") ||
                b.createdAt.localeCompare(a.createdAt),
            )
            .slice(0, 12)}
          onEntry={detail}
        />
      </section>
      <section>
        <div className="section-heading">
          <h2>{t("কাজের খাতা")}</h2>
          <button className="text-button" onClick={() => go("/works")}>
            {t("সব খাতা")}
            <ArrowRightIcon size={16} />
          </button>
        </div>
        {ongoingWorks.length ? (
          <div className="work-carousel">
            {ongoingWorks.map((work) => (
              <WorkCard
                key={work.id}
                work={work}
                ledger={ledger}
                onOpen={() => go(`/works/${work.id}`)}
              />
            ))}
          </div>
        ) : (
          <button className="empty-panel" onClick={() => go("/works")}>
            <PlusIcon size={28} />
            {t(
              ledger.works.some((work) => !work.archivedAt)
                ? "এখন কোনো কাজ চলছে না। সব খাতা দেখুন"
                : "কাজের খাতা খুলুন",
            )}
          </button>
        )}
      </section>
      {s.historicalEntryCount ? (
        <details className="old-record-note">
          <summary>{t("পুরোনো খাতার টাকা সম্পর্কে")}</summary>
          <p>
            {t(
              "পুরোনো খরচ রাখা আছে। কোন টাকা দেওয়া হয়েছে আর কোনটি বাকি, সব জায়গায় লেখা ছিল না। তাই আগের বাকি ধরে নেওয়া হয়নি।",
            )}
          </p>
          <button className="text-button" onClick={() => go("/review")}>
            {t("পুরোনো হিসাব মিলিয়ে দেখি")}
            <ArrowRightIcon size={16} />
          </button>
        </details>
      ) : null}
    </div>
  );
}
