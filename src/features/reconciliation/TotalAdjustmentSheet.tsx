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
  const { mode } = useNotebook();
  const { t, formatDigits } = useLanguageContext();
  const owner = mode === "real" ? getActiveOwner() : "demo";
  const beforeClose = useRef<(() => Promise<boolean>) | null>(null);
  async function close() {
    if (!beforeClose.current || (await beforeClose.current())) onClose();
  }
  return (
    <Sheet
      title={t("মোট হিসাব মেলাই")}
      subtitle={`${formatDigits(name)} · ${t(target.account ? accountLabels[target.account] : "সব ধরনের হিসাব")}${target.target === "person" ? ` · ${t("সব খাতা মিলিয়ে")}` : ""}`}
      onClose={() => void close()}
    >
      <TotalAdjustmentForm
        key={`${owner}:${target.target}:${target.id}:${target.account}`}
        target={target}
        onSaved={onClose}
        beforeCloseRef={beforeClose}
      />
    </Sheet>
  );
}
