import { useId } from "react";
import { useLanguageContext } from "../../context/LanguageProvider";
import { jobStatusNames } from "../jobs/jobView";
import type { SharedStatement } from "./shareModel";
import "./shared-contract-carousel.css";

export function SharedContractCarousel({
  contracts,
  ambiguous,
}: {
  contracts: SharedStatement["contracts"];
  ambiguous: boolean;
}) {
  const { t, money, formatDigits } = useLanguageContext();
  const titleId = useId();
  const orderedContracts = contracts
    .map((contract, index) => ({ contract, index }))
    .sort(
      (a, b) =>
        Number(b.contract.status === "ongoing") -
          Number(a.contract.status === "ongoing") ||
        b.contract.total - a.contract.total ||
        a.index - b.index,
    );

  if (!contracts.length) return null;
  return (
    <section className="shared-contract-carousel" aria-labelledby={titleId}>
      <div className="shared-contract-carousel-heading">
        <h2 id={titleId}>{t("কাজ ও চুক্তি")}</h2>
      </div>
      <div
        className={`shared-work-track${contracts.length === 1 ? " shared-work-track-single" : ""}`}
        role="group"
        aria-label={t("কাজের কার্ড")}
        tabIndex={contracts.length > 1 ? 0 : undefined}
      >
        {orderedContracts.map(({ contract, index }) => (
          <article
            key={index}
            className="shared-work-card"
            aria-labelledby={`${titleId}-work-${index}`}
          >
            <div className="shared-work-heading">
              <h3 id={`${titleId}-work-${index}`}>
                {formatDigits(contract.title || t("কাজের চুক্তি"))}
              </h3>
              <span
                className={`shared-work-status shared-work-status-${contract.status ?? "unknown"}`}
              >
                <i aria-hidden="true" />
                {contract.status === undefined
                  ? t("অবস্থা পাওয়া যায়নি")
                  : t(jobStatusNames[contract.status ?? "unknown"])}
              </span>
            </div>
            <dl className="shared-contract-balances">
              <div>
                <dt>{t("চুক্তির মোট")}</dt>
                <dd>{money(contract.total)}</dd>
              </div>
              <div>
                <dt>{t("পেয়েছেন")}</dt>
                <dd>{money(contract.netPaid)}</dd>
              </div>
              <div className="shared-work-due">
                <dt>{t("আর পাবেন")}</dt>
                <dd className={ambiguous ? "shared-work-pending" : undefined}>
                  {ambiguous
                    ? t("বাকি মেলানো বাকি")
                    : money(contract.remaining)}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
