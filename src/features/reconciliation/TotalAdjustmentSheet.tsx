import { Sheet } from "../../components/Sheet";
import { useRef } from "react";
import { useNotebook } from "../../app/NotebookProvider";
import { getActiveOwner } from "../../data/database";
import { useLanguageContext } from "../../context/LanguageProvider";
import { accountLabels } from "../people/ContactIdentity";
import {
  TotalAdjustmentForm,
  type TotalAdjustmentTarget,
} from "./TotalAdjustmentForm";
import "./balance-adjustment.css";

export function TotalAdjustmentSheet({
  target,
  name,
  onClose,
}: {
  target: TotalAdjustmentTarget;
  name: string;
  onClose: () => void;
}) {
  const { mode, ledger } = useNotebook();
  const { t, formatDigits } = useLanguageContext();
  const owner = mode === "real" ? getActiveOwner() : "demo";
  const workName = target.workId
    ? ledger.works.find((work) => work.id === target.workId)?.name
    : null;
  const beforeClose = useRef<(() => Promise<boolean>) | null>(null);
  async function close() {
    if (!beforeClose.current || (await beforeClose.current())) onClose();
  }
  return (
    <Sheet
      title={t("মোট হিসাব মেলাই")}
      subtitle={`${formatDigits(name)} · ${t(accountLabels[target.account])} · ${target.workId ? formatDigits(workName ?? t("খাতা পাওয়া যায়নি")) : t("সব খাতা মিলিয়ে")}`}
      onClose={() => void close()}
    >
      <TotalAdjustmentForm
        key={JSON.stringify([
          owner,
          "person",
          target.id,
          target.account,
          target.workId ?? null,
        ])}
        target={target}
        onSaved={onClose}
        beforeCloseRef={beforeClose}
      />
    </Sheet>
  );
}
