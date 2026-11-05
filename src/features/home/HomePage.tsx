import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  ClipboardTextIcon,
  HardHatIcon,
  MagnifyingGlassIcon,
  PackageIcon,
  PlusIcon,
  WalletIcon,
} from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { summarize } from "../../domain/ledger";
import { EntryList } from "../../components/ui/EntryList";
import { pendingReviewEntries } from "../import/bulkReview";
import { WorkCard } from "../works/WorksPages";
import { orderedWorks } from "../works/workOverview";
import "./home-summary.css";

export function HomePage() {
  const { ledger, go, detail } = useNotebook();
  const { t, money, number, formatDigits } = useLanguageContext();
  const summary = summarize(ledger);
  const pending = pendingReviewEntries(ledger).length;
  const works = orderedWorks(ledger)
    .filter((work) => work.status === "ongoing")
    .slice(0, 3);
  const actions = [
    {
      path: "/write/purchase",
      title: "মাল কিনেছি",
      description: "মালের দাম আর দেওয়া টাকা",
      Icon: PackageIcon,
    },
    {
      path: "/write/charge",
      title: "কাজের বিল",
      description: "যতটুকু কাজ হয়েছে, তার টাকা",
      Icon: HardHatIcon,
    },
    {
      path: "/write/payment",
      title: "টাকা দিয়েছি",
      description: "বাকি মেটানো বা আগাম দেওয়া",
      Icon: WalletIcon,
    },
  ];
  return (
    <div className="home-v3 house-home page-flow">
      <header className="home-overview-heading">
        <div>
          <p className="home-overview-project">
            {formatDigits(ledger.project.name)}
          </p>
          <h1>{t("বাড়ির হিসাব")}</h1>
        </div>
        <button
          type="button"
          className="home-overview-search"
          aria-label={t("আগের হিসাব খুঁজুন")}
          onClick={() => go("/history?focus=search")}
        >
          <MagnifyingGlassIcon size={23} />
        </button>
      </header>
      <section className="house-overview" aria-label={t("বাড়ির মোট হিসাব")}>
        <div className="house-cost">
          <span>{t("এ পর্যন্ত খরচ")}</span>
          <strong>{money(summary.cost + summary.costCorrection)}</strong>
          <button
            type="button"
            className="text-button"
            onClick={() => go("/reports?mode=cost&section=all")}
          >
            {t("খরচ দেখি")}
            <ArrowUpRightIcon size={16} />
          </button>
        </div>
        <div className="house-money-row">
          <button
            type="button"
            className="house-paid"
            onClick={() => go("/reports")}
          >
            <span>{t("মোট টাকা দিয়েছি")}</span>
            <strong>{money(summary.reconciledNetPaid)}</strong>
            <small>{t("ফেরত পাওয়া টাকা বাদে")}</small>
          </button>
          <button
            type="button"
            className="home-overview-due"
            onClick={() =>
              go(summary.balanceAmbiguous ? "/migration" : "/dues")
            }
          >
            <span>{t("দিতে বাকি")}</span>
            <strong>
              {summary.balanceAmbiguous
                ? t("যাচাই বাকি")
                : money(summary.reconciledPayable)}
            </strong>
            <small>
              {t(
                summary.balanceAmbiguous
                  ? "আগের তথ্য দেখে নিতে হবে"
                  : summary.reconciledPayable > 0
                    ? "কাকে কত, দেখে নিই"
                    : "এখন কোনো বাকি নেই",
              )}
            </small>
          </button>
        </div>
        {!summary.balanceAmbiguous && summary.reconciledAdvance > 0 ? (
          <p className="house-credit-note">
            {t("আগে দিয়ে রেখেছি {{amount}}", {
              amount: money(summary.reconciledAdvance),
            })}
          </p>
        ) : null}
      </section>
      <section className="house-write" aria-label={t("হিসাব লিখি")}>
        <div className="section-heading">
          <h2>{t("এখন কী লিখবেন?")}</h2>
        </div>
        <div className="house-write-actions">
          {actions.map(({ path, title, description, Icon }) => (
            <button type="button" key={path} onClick={() => go(path)}>
              <span className="house-action-icon">
                <Icon size={25} weight="duotone" />
              </span>
              <span>
                <strong>{t(title)}</strong>
                <small>{t(description)}</small>
              </span>
              <ArrowRightIcon size={18} />
            </button>
          ))}
        </div>
      </section>
      <section className="panel home-history-v3">
        <div className="section-heading">
          <h2>{t("সাম্প্রতিক হিসাব")}</h2>
          <button className="text-button" onClick={() => go("/history")}>
            {t("সব হিসাব")}
            <ArrowRightIcon size={16} />
          </button>
        </div>
        <EntryList
          showKind
          limit={5}
          ledger={ledger}
          entries={ledger.entries}
          onEntry={detail}
        />
        {!ledger.entries.length ? (
          <div className="house-first-entry">
            <ClipboardTextIcon size={29} weight="duotone" />
            <p>{t("প্রথম মাল কেনা বা টাকা দেওয়া লিখে শুরু করুন।")}</p>
          </div>
        ) : null}
      </section>
      <section>
        <div className="section-heading">
          <h2>{t("যে কাজগুলো চলছে")}</h2>
          <button className="text-button" onClick={() => go("/works")}>
            {t("সব কাজ")}
            <ArrowRightIcon size={16} />
          </button>
        </div>
        {works.length ? (
          <div className="work-carousel">
            {works.map((work) => (
              <WorkCard
                key={work.id}
                work={work}
                ledger={ledger}
                onOpen={() => go(`/works/${work.id}`)}
              />
            ))}
          </div>
        ) : (
          <button
            type="button"
            className="empty-panel"
            onClick={() => go("/works")}
          >
            <PlusIcon size={26} />
            {t("কাজের খাতা খুলুন")}
          </button>
        )}
      </section>
      {pending > 0 ? (
        <button
          type="button"
          className="home-review-notice"
          onClick={() => go("/review?bulk=1")}
        >
          <span className="home-review-symbol">
            <ClipboardTextIcon size={22} />
          </span>
          <span>
            <strong>
              {t("{{count}}টি লেখায় তথ্য যোগ করা বাকি", {
                count: number(pending),
              })}
            </strong>
            <small>{t("সময় হলে দেখে নিই")}</small>
          </span>
          <ArrowRightIcon size={18} />
        </button>
      ) : null}
      {summary.historicalEntryCount ? (
        <p className="house-history-note">
          {t(
            "পুরোনো খাতার খরচ রাখা আছে। সেই সময়ের দেওয়া আর বাকি টাকা পুরো জানা নেই।",
          )}
        </p>
      ) : null}
    </div>
  );
}
