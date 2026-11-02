import { useLanguageContext } from "../../context/LanguageProvider";
import { BalanceProgress } from "../../components/ui/BalanceProgress";

export function EntryPaymentPreview({
  previousBalance,
  currentCost,
  payment,
}: {
  previousBalance: number;
  currentCost: number;
  payment: number;
}) {
  const { t, money } = useLanguageContext();
  const total = BigInt(Math.max(previousBalance, 0)) + BigInt(currentCost);
  const paid = BigInt(Math.max(-previousBalance, 0)) + BigInt(payment);
  const net = BigInt(previousBalance) + BigInt(currentCost) - BigInt(payment);
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  if (total > maximum || paid > maximum || net > maximum || net < -maximum)
    return (
      <p className="form-error" role="alert">
        {t("টাকার অঙ্ক বেশি হয়েছে।")}
      </p>
    );
  const remaining = Number(net);
  return (
    <section className="entry-balance-preview" aria-label={t("টাকার হিসাব")}>
      <dl className="entry-balance-items">
        {previousBalance !== 0 ? (
          <div>
            <dt>{t(previousBalance > 0 ? "আগের বাকি" : "আগে দেওয়া অগ্রিম")}</dt>
            <dd>{money(Math.abs(previousBalance))}</dd>
          </div>
        ) : null}
        {currentCost > 0 ? (
          <div>
            <dt>{t("এবারের দাম")}</dt>
            <dd>{money(currentCost)}</dd>
          </div>
        ) : null}
        <div>
          <dt>{t("এখন দিচ্ছি")}</dt>
          <dd>{money(payment)}</dd>
        </div>
      </dl>
      <BalanceProgress
        total={Number(total)}
        paid={Number(paid)}
        showAmounts={false}
        showStatus={false}
        compact
      />
      <div
        className={`entry-balance-result ${remaining < 0 ? "has-credit" : ""}`}
      >
        <span>{t(remaining < 0 ? "অগ্রিম থাকবে" : "বাকি থাকবে")}</span>
        <strong>{money(Math.abs(remaining))}</strong>
      </div>
    </section>
  );
}
