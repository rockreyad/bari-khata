import { useEffect, useMemo, useState } from "react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { getScopedRepository } from "../../data/repository";
import {
  createMigrationReview,
  type MigrationIssue,
  type MigrationReview,
} from "../../domain/migrationReview";
import "./migration-review.css";

const issueLabels: Record<MigrationIssue["code"], string> = {
  unclassified_cash:
    "কোন বিল বা কী কারণে টাকা দেওয়া হয়েছিল, তা নিশ্চিত করা দরকার",
  historical_balance_unknown:
    "পুরোনো খরচ আছে, পরিশোধ বা বর্তমান বাকি নিশ্চিত নয়",
  contract_commitment_bridge:
    "চুক্তির অবশিষ্ট টাকা ও হয়ে যাওয়া কাজের বাকি আলাদা হয়েছে",
  legacy_adjustment_review:
    "আগের চুক্তির বাকি কমানো হয়েছিল; কাজের বিল না দেখে সেটি অগ্রিম ধরা হয়নি",
};

export function MigrationReviewPage() {
  const { ledger, mode, go, detail } = useNotebook();
  const { t, money, number, formatDigits } = useLanguageContext();
  const report = useMemo(() => createMigrationReview(ledger), [ledger]);
  const [sources, setSources] = useState<MigrationReview[]>([]);
  const [sourceError, setSourceError] = useState(false);
  useEffect(() => {
    let active = true;
    setSources([]);
    setSourceError(false);
    getScopedRepository(mode)
      .migrationReview(mode)
      .then((result) => {
        if (active)
          setSources([
            ...new Map(
              result.sources.map((source) => [JSON.stringify(source), source]),
            ).values(),
          ]);
      })
      .catch(() => {
        if (active) setSourceError(true);
      });
    return () => {
      active = false;
    };
  }, [mode, ledger]);
  const unresolved = report.issues.filter(
    (issue) => issue.severity === "review",
  );
  return (
    <div className="migration-review-page">
      <header className="page-heading">
        <div>
          <h1>{t("পুরোনো হিসাব যাচাই")}</h1>
          <p>
            {t(
              "আগের অঙ্ক অক্ষত রেখে, হয়ে যাওয়া খরচ ও ভবিষ্যতের চুক্তি আলাদা করে দেখি।",
            )}
          </p>
        </div>
      </header>
      <section className="migration-review-explanation">
        <h2>{t("চুক্তির সব টাকা এখনও খরচ নয়")}</h2>
        <p>
          {t(
            "কাজের চুক্তি বাকি থাকলে আগে সেই টাকাও দিতে বাকি হিসেবে দেখা যেত। এখন পাওয়া মাল ও হয়ে যাওয়া কাজের বিল থেকে বাকি দেখাই। বাকি চুক্তির টাকা আলাদা থাকে।",
          )}
        </p>
        <p>
          {t(
            "অঙ্ক মেলানোর জন্য নতুন বিল, পরিশোধ বা অগ্রিম বানানো হয়নি। পুরোনো অস্পষ্ট তথ্য দেখে নেওয়ার জন্য রাখা আছে।",
          )}
        </p>
        <dl className="migration-review-totals">
          <div>
            <dt>{t("আগের নিয়মে বাকি দেখাত")}</dt>
            <dd>{money(report.legacyPayable)}</dd>
          </div>
          <div>
            <dt>{t("পাওয়া মাল ও কাজের বাকি")}</dt>
            <dd>{money(report.earnedPayable)}</dd>
          </div>
          <div>
            <dt>{t("বিলের চেয়ে বেশি দেওয়া")}</dt>
            <dd>{money(report.earnedAdvance)}</dd>
          </div>
        </dl>
      </section>
      {report.contracts.length > 0 && (
        <section>
          <h2>{t("চুক্তি ধরে পার্থক্য")}</h2>
          <div className="migration-review-table">
            <table>
              <thead>
                <tr>
                  <th>{t("চুক্তি")}</th>
                  <th>{t("আগে বাকি দেখাত")}</th>
                  <th>{t("হয়ে যাওয়া কাজ")}</th>
                  <th>{t("কাজের বিলের বাকি")}</th>
                  <th>{t("এখনও না হওয়া কাজ")}</th>
                </tr>
              </thead>
              <tbody>
                {report.contracts.map((contract) => (
                  <tr key={contract.contractId}>
                    <td>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() =>
                          go(`/jobs/${encodeURIComponent(contract.contractId)}`)
                        }
                      >
                        {formatDigits(
                          ledger.contracts.find(
                            (row) => row.id === contract.contractId,
                          )?.title || t("চুক্তি"),
                        )}
                      </button>
                    </td>
                    <td>{money(contract.legacyPayable)}</td>
                    <td>{money(contract.earned)}</td>
                    <td>{money(contract.earnedPayable)}</td>
                    <td>{money(contract.unearnedCommitment)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section>
        <h2>
          {t("যা দেখে নেওয়া দরকার")} · {number(unresolved.length)}
        </h2>
        {unresolved.length ? (
          <ul className="migration-review-issues">
            {unresolved.map((issue) => {
              const entry = ledger.entries.find(
                (row) => row.id === issue.entityIds[0],
              );
              return (
                <li key={issue.id}>
                  <div>
                    <strong>{t(issueLabels[issue.code])}</strong>
                    {entry && (
                      <p>
                        {formatDigits(
                          entry.note ||
                            entry.lines
                              .map((line) => line.label)
                              .filter(Boolean)
                              .join(" · ") ||
                            t("আগের লেখা"),
                        )}
                      </p>
                    )}
                  </div>
                  {entry && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => detail(entry.id)}
                    >
                      {t("লেখাটি দেখি")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p>{t("এই খাতায় এমন কোনো অমীমাংসিত লেখা পাওয়া যায়নি।")}</p>
        )}
        <p>
          {t(
            "দেখে নেওয়া ছাড়া পুরোনো খরচকে বর্তমান বাকি বা কোনো টাকা অগ্রিম ধরে নেওয়া হবে না।",
          )}
        </p>
        <button
          type="button"
          className="text-button"
          onClick={() => go("/review")}
        >
          {t("পুরোনো খরচের বিস্তারিত যাচাই করি")}
        </button>
      </section>
      {sourceError && (
        <p role="status">
          {t(
            "সংরক্ষিত পুরোনো প্রতিবেদন এখন পড়া যায়নি। বর্তমান খাতার হিসাব উপরে আছে।",
          )}
        </p>
      )}
      {sources.length > 0 && (
        <details className="migration-review-sources">
          <summary>
            {t("তথ্য আনার সময়ের সংরক্ষিত প্রতিবেদন")} · {number(sources.length)}
          </summary>
          <p>
            {t(
              "এই অঙ্কগুলো তথ্য আনার সময়কার কপি। পরে লেখা বদলালে বর্তমান অঙ্ক উপরে দেখানো হয়।",
            )}
          </p>
          {sources.map((source, index) => (
            <dl key={index}>
              <div>
                <dt>{t("আগের নিয়মে বাকি দেখাত")}</dt>
                <dd>{money(source.legacyPayable)}</dd>
              </div>
              <div>
                <dt>{t("পাওয়া মাল ও কাজের বাকি")}</dt>
                <dd>{money(source.earnedPayable)}</dd>
              </div>
              <div>
                <dt>{t("দেখে নেওয়ার লেখা")}</dt>
                <dd>
                  {number(
                    source.issues.filter((issue) => issue.severity === "review")
                      .length,
                  )}
                </dd>
              </div>
            </dl>
          ))}
        </details>
      )}
    </div>
  );
}
