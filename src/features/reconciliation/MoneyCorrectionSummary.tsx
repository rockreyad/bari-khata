import { useLanguageContext } from "../../context/LanguageProvider";
import "./reconciliation.css";

export function MoneyCorrectionSummary({
  before,
  after,
}: {
  before: number;
  after: number;
}) {
  const { t, money } = useLanguageContext();
  const valid = Number.isSafeInteger(after) && after >= 0;
  const change = valid ? after - before : 0;
  return (
    <section
      className="money-correction-summary"
      aria-label={t("অঙ্কের পরিবর্তন")}
    >
      <dl>
        <div>
          <dt>{t("আগের অঙ্ক")}</dt>
          <dd>{money(before)}</dd>
        </div>
        <div>
          <dt>{t("নতুন অঙ্ক")}</dt>
          <dd>{valid ? money(after) : t("সঠিক অঙ্ক লিখুন")}</dd>
        </div>
        <div>
          <dt>{t(change < 0 ? "কমছে" : change > 0 ? "বাড়ছে" : "পার্থক্য")}</dt>
          <dd>{valid ? money(Math.abs(change)) : "—"}</dd>
        </div>
      </dl>
    </section>
  );
}
