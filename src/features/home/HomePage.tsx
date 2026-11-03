import {
  ArrowRightIcon,
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
      tone: "blue",
    },
    {
      label: "মিস্ত্রিকে দিয়েছি",
      value: paid.byAccount.labour,
      scope: "labour",
      Icon: HardHatIcon,
      tone: "purple",
    },
  ];
  return (
    <div className="home-v3 page-flow">
      <header className="page-heading home-heading-v3">
        <div>
          <p className="eyebrow">{formatDigits(ledger.project.name)}</p>
          <h1>{t("আমার হিসাব")}</h1>
        </div>
        <button
          className="icon-button"
          aria-label={t("আগের হিসাব খুঁজুন")}
          onClick={() => go("/ledger?focus=search")}
        >
          <MagnifyingGlassIcon size={23} />
        </button>
      </header>
      <div className="home-primary-actions">
        <button className="primary-button" onClick={() => add()}>
          <PlusIcon size={21} weight="bold" />
          {t("খরচ লিখি")}
        </button>
        <button
          className="secondary-button"
          onClick={() => add({ kind: "payment" })}
        >
          <CoinsIcon size={23} weight="duotone" />
          {t("টাকা দিলাম")}
        </button>
      </div>
      <section className="home-total-card" aria-label={t("মোট টাকা দিয়েছি")}>
        <div className="home-total-heading">
          <div>
            <span>{t("মোট টাকা দিয়েছি")}</span>
            <strong>{money(s.reconciledNetPaid)}</strong>
            {s.paidCorrection !== 0 ? (
              <small>
                {t("সমন্বয়")}: {money(s.paidCorrection)}
              </small>
            ) : null}
          </div>
          <button className="home-total-report" onClick={() => go("/reports")}>
            {t("ভাগ করে দেখি")}
            <ArrowRightIcon size={17} />
          </button>
        </div>
        <div className="home-total-breakdown">
          {cards.map(({ label, value, scope, Icon, tone }) => (
            <button key={scope} onClick={() => go(`/reports?account=${scope}`)}>
              <span className={`summary-symbol ${tone}`}>
                <Icon size={20} weight="duotone" />
              </span>
              <span>{t(label)}</span>
              <strong>{money(value)}</strong>
            </button>
          ))}
        </div>
        {paid.byAccount.other !== 0 ? (
          <button
            className="home-other-paid"
            onClick={() => go("/reports?account=other")}
          >
            <CoinsIcon size={17} weight="duotone" />
            <span>{t("অন্য কাজে দিয়েছি")}</span>
            <strong>{money(paid.byAccount.other)}</strong>
            <ArrowRightIcon size={15} />
          </button>
        ) : null}
        {s.reconciledPayable > 0 ? (
          <div className="home-known-due">
            <span>{t("দিতে বাকি")}</span>
            <strong>{money(s.reconciledPayable)}</strong>
          </div>
        ) : null}
      </section>
      <button
        className="home-jobs-link"
        aria-label={t("মিস্ত্রির কাজ")}
        aria-describedby="home-jobs-caption"
        onClick={() => go("/jobs")}
      >
        <span className="home-jobs-symbol">
          <HardHatIcon size={22} weight="duotone" />
        </span>
        <span>
          <strong>{t("মিস্ত্রির কাজ")}</strong>
          <small id="home-jobs-caption">{t("অবস্থা, বাকি ও দেওয়া টাকা")}</small>
        </span>
        <ArrowRightIcon size={19} />
      </button>
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
