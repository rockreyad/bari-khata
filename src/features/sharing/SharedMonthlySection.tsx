import { useEffect } from "react";
import type { SharedStatement } from "./shareModel";
import { useSharedMonthly } from "./useSharedMonthly";
import { SharedMonthlyChart } from "./SharedMonthlyChart";

export function SharedMonthlySection({
  token,
  statement,
  onUnavailable,
  onStale,
}: {
  token: string;
  statement: SharedStatement;
  onUnavailable: () => void;
  onStale: () => void;
}) {
  const monthly = useSharedMonthly(token, statement);
  useEffect(() => {
    if (monthly.error === "share_unavailable") onUnavailable();
    if (monthly.error === "share_changed") onStale();
  }, [monthly.error, onUnavailable, onStale]);
  return (
    <SharedMonthlyChart
      data={monthly.data}
      busy={monthly.busy}
      error={monthly.error}
      onRetry={monthly.retry}
      hasPaidCorrection={Boolean(statement.totals.paidCorrection)}
    />
  );
}
