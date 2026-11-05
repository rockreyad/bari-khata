import { Sheet } from "../../components/Sheet";
import { useRef, useState } from "react";
import { useNotebook } from "../../app/NotebookProvider";
import { getActiveOwner } from "../../data/database";
import { useLanguageContext } from "../../context/LanguageProvider";
import { accountLabels } from "../people/ContactIdentity";
import { AppSelect } from "../../components/ui/AppSelect";
import type { Account } from "../../domain/model";
import { contactActionAccount } from "../people/contactActionAccounts";
import {
  TotalAdjustmentForm,
  type TotalAdjustmentTarget,
} from "./TotalAdjustmentForm";
import "./balance-adjustment.css";

type TotalAdjustmentSheetProps = {
  target: Omit<TotalAdjustmentTarget, "account"> & { account?: Account };
  name: string;
  onClose: () => void;
};

export function TotalAdjustmentSheet(props: TotalAdjustmentSheetProps) {
  return (
    <TotalAdjustmentScope
      key={JSON.stringify([
        props.target.id,
        props.target.account,
        props.target.workId,
      ])}
      {...props}
    />
  );
}

function TotalAdjustmentScope({
  target,
  name,
  onClose,
}: TotalAdjustmentSheetProps) {
  const { mode, ledger } = useNotebook();
  const { t, formatDigits } = useLanguageContext();
  const owner = mode === "real" ? getActiveOwner() : "demo";
  const [account, setAccount] = useState(() =>
    contactActionAccount(ledger, target.id, target.account),
  );
  const [switching, setSwitching] = useState(false);
  const changing = useRef(false);
  const workName = target.workId
    ? ledger.works.find((work) => work.id === target.workId)?.name
    : null;
  const beforeClose = useRef<(() => Promise<boolean>) | null>(null);
  async function close() {
    if (changing.current) return;
    if (!beforeClose.current || (await beforeClose.current())) onClose();
  }
  async function changeAccount(next: Account | "") {
    if (changing.current || next === account) return;
    changing.current = true;
    setSwitching(true);
    try {
      if (!beforeClose.current || (await beforeClose.current()))
        setAccount(next);
    } finally {
      changing.current = false;
      setSwitching(false);
    }
  }
  return (
    <Sheet
      title={t("মোট হিসাব মেলাই")}
      subtitle={`${formatDigits(name)}${account ? ` · ${t(accountLabels[account])}` : ""} · ${target.workId ? formatDigits(workName ?? t("খাতা পাওয়া যায়নি")) : t("সব খাতা মিলিয়ে")}`}
      onClose={() => void close()}
    >
      {!target.account ? (
        <label className="adjustment-account-select">
          {t("কোন হিসাব মেলাব")}
          <AppSelect
            value={account}
            disabled={switching}
            onChange={(event) =>
              void changeAccount(event.target.value as Account | "")
            }
          >
            <option value="">{t("হিসাব বেছে নিন")}</option>
            {(["materials", "labour", "other"] as const).map((value) => (
              <option key={value} value={value}>
                {t(accountLabels[value])}
              </option>
            ))}
          </AppSelect>
        </label>
      ) : null}
      {account ? (
        <div inert={switching} aria-busy={switching}>
          <TotalAdjustmentForm
            key={JSON.stringify([
              owner,
              "person",
              target.id,
              account,
              target.workId ?? null,
            ])}
            target={{ ...target, account }}
            onSaved={onClose}
            beforeCloseRef={beforeClose}
          />
        </div>
      ) : (
        <p className="adjustment-extra">
          {t("যে হিসাবের মোট মেলাবেন, সেটি বেছে নিন।")}
        </p>
      )}
    </Sheet>
  );
}
