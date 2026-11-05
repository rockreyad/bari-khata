import { useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  HandCoinsIcon,
  HardHatIcon,
  PackageIcon,
  CoinsIcon,
  FolderPlusIcon,
  ReceiptIcon,
  UserPlusIcon,
} from "@phosphor-icons/react";
import "./entry-shortcuts.css";
import { LegacyEntryDrafts } from "../write/LegacyEntryDrafts";
import { Sheet } from "../../components/Sheet";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
export function QuickActionsSheet() {
  const { add, entity, close, go } = useNotebook();
  const { t } = useLanguageContext();
  const [balanceChoices, setBalanceChoices] = useState(false);
  const actions = balanceChoices
    ? [
        {
          label: "অগ্রিম দিই",
          hint: "কাজ বা মাল পাওয়ার আগে টাকা",
          Icon: HandCoinsIcon,
          tone: "orange",
          run: () => add({ kind: "payment", purpose: "advance" }),
        },
        {
          label: "বাকি দেখি",
          hint: "কাকে কত দিতে হবে",
          Icon: ReceiptIcon,
          tone: "blue",
          run: () => go("/dues"),
        },
      ]
    : [
        {
          label: "মাল কিনেছি",
          hint: "নগদে বা বাকিতে কেনা মাল",
          Icon: PackageIcon,
          tone: "blue",
          run: () =>
            add({
              kind: "expense",
              costType: "material",
              account: "materials",
            }),
        },
        {
          label: "কাজের বিল",
          hint: "মজুরি, ভাড়া বা সেবার বিল",
          Icon: HardHatIcon,
          tone: "green",
          run: () =>
            add({
              kind: "expense",
              purpose: "charge",
              costType: "labour",
              account: "labour",
            }),
        },
        {
          label: "অগ্রিম বা বাকি",
          hint: "আগাম টাকা ও বাকি হিসাব",
          Icon: HandCoinsIcon,
          tone: "orange",
          run: () => setBalanceChoices(true),
        },
        {
          label: "টাকা দিলাম",
          hint: "যাকে টাকা দিয়েছেন, তার নামে রাখুন",
          Icon: CoinsIcon,
          tone: "pink",
          run: () => add({ kind: "payment", purpose: "settle" }),
        },
      ];
  return (
    <Sheet
      title={t(balanceChoices ? "অগ্রিম বা বাকি" : "কী লিখবেন?")}
      onClose={close}
    >
      {balanceChoices && (
        <button
          type="button"
          className="text-button quick-choice-back"
          onClick={() => setBalanceChoices(false)}
        >
          <ArrowLeftIcon size={18} aria-hidden="true" />
          {t("সব কাজ")}
        </button>
      )}
      <div className="quick-launch">
        {actions.map(({ label, hint, Icon, tone, run }) => (
          <button type="button" key={label} onClick={run}>
            <span className={`launch-mark ${tone}`}>
              <Icon size={27} weight="duotone" aria-hidden="true" />
            </span>
            <span>
              <strong>{t(label)}</strong> <small>{t(hint)}</small>
            </span>
            <ArrowRightIcon size={20} aria-hidden="true" />
          </button>
        ))}
        {!balanceChoices && (
          <div className="launch-secondary">
            <button type="button" onClick={() => entity("work")}>
              <FolderPlusIcon size={22} aria-hidden="true" />
              {t("নতুন খাতা বানান")}
            </button>
            <button type="button" onClick={() => entity("person")}>
              <UserPlusIcon size={22} aria-hidden="true" />
              {t("নতুন কর্মী")}
            </button>
          </div>
        )}
      </div>
      {!balanceChoices && <LegacyEntryDrafts />}
    </Sheet>
  );
}
