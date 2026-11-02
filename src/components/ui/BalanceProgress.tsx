import { useLanguageContext } from "../../context/LanguageProvider";
import "./balance-progress.css";
export type BalanceProgressProps = {
  total: number;
  paid: number;
  label?: string;
  compact?: boolean;
  showAmounts?: boolean;
  showStatus?: boolean;
};
export function BalanceProgress({
  total,
  paid,
  label,
  compact = false,
  showAmounts = true,
  showStatus = true,
}: BalanceProgressProps) {
  const { t, money, number } = useLanguageContext();
  if (
    !Number.isSafeInteger(total) ||
    !Number.isSafeInteger(paid) ||
    !Number.isSafeInteger(Math.max(0, total) - paid)
  )
    return (
      <p className="form-error" role="alert">
        {t("টাকার অঙ্ক বেশি হয়েছে।")}
      </p>
    );
  const goal = Math.max(0, total);
  const settled = Math.max(0, paid);
  const remaining = Math.max(goal - paid, 0);
  const credit = Math.max(paid - goal, 0);
  const percent =
    goal > 0
      ? Number((BigInt(Math.min(settled, goal)) * 10000n) / BigInt(goal)) / 100
      : settled > 0
        ? 100
        : 0;
  return (
    <section
      className={`balance-progress ${compact ? "is-compact" : ""} ${credit ? "has-credit" : remaining === 0 ? "is-settled" : ""}`}
      aria-label={label ?? t("পরিশোধের অবস্থা")}
    >
      {label ? (
        <div className="balance-progress-heading">
          <span>{label}</span>
          <strong>{t("{{percent}}%", { percent: number(percent) })}</strong>
        </div>
      ) : null}
      <div
        className="balance-progress-track"
        role="progressbar"
        aria-label={label ?? t("পরিশোধের অবস্থা")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={t(
          credit
            ? "দিয়েছি {{paid}}, অগ্রিম {{advance}}"
            : "দিয়েছি {{paid}}, বাকি {{due}}",
          {
            paid: money(paid),
            due: money(remaining),
            advance: money(credit),
          },
        )}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      {showAmounts ? (
        <div className="balance-progress-amounts">
          <span>
            {t("মোট")}
            <strong>{money(goal)}</strong>
          </span>
          <span>
            {t("দিয়েছি")}
            <strong>{money(paid)}</strong>
          </span>
          <span>
            {t(credit ? "অগ্রিম" : "বাকি")}
            <strong>{money(credit || remaining)}</strong>
          </span>
        </div>
      ) : null}
      {showStatus && !remaining && !credit && goal > 0 ? (
        <small className="balance-progress-settled">{t("বাকি নেই")}</small>
      ) : null}
      {showStatus && credit > 0 ? (
        <small className="balance-progress-credit">
          {t("অগ্রিম {{amount}}", { amount: money(credit) })}
        </small>
      ) : null}
    </section>
  );
}
