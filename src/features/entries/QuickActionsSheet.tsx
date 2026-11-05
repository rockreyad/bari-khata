import { useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  HandCoinsIcon,
  HardHatIcon,
  PackageIcon,
  FolderPlusIcon,
  ReceiptIcon,
  UserPlusIcon,
} from "@phosphor-icons/react";
import "./entry-shortcuts.css";
import { LegacyEntryDrafts } from "../write/LegacyEntryDrafts";
import { Sheet } from "../../components/Sheet";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import type { Account } from "../../domain/model";
import { entryReturn } from "../../app/entryRoutes";
type PartyPaymentContext = {
  personId: string;
  workId?: string;
  account?: Account;
  contractId?: string;
  dueWork?: string;
  dueAccount?: Account | "all";
  back?: string;
};
export function QuickActionsSheet({
  partyPayment,
}: {
  partyPayment?: PartyPaymentContext;
}) {
  const { add, entity, close, go, ledger, base = "" } = useNotebook();
  const { t, formatDigits } = useLanguageContext();
  const [balanceChoices, setBalanceChoices] = useState(Boolean(partyPayment));
  const person = partyPayment
    ? ledger.people.find(
        (row) => row.id === partyPayment.personId && !row.archivedAt,
      )
    : null;
  const openBalance = (action: "advance" | "dues") => {
    if (!partyPayment) {
      if (action === "advance") add({ kind: "payment", purpose: "advance" });
      else go("/dues");
      return;
    }
    const params = new URLSearchParams({
      person: partyPayment.personId,
      back: entryReturn(partyPayment.back, base),
    });
    const work =
      action === "advance"
        ? partyPayment.workId
        : partyPayment.dueWork === "all"
          ? undefined
          : (partyPayment.dueWork ?? partyPayment.workId);
    const account =
      action === "advance"
        ? partyPayment.account
        : partyPayment.dueAccount === "all"
          ? undefined
          : (partyPayment.dueAccount ?? partyPayment.account);
    if (work) params.set("work", work);
    if (account) params.set("account", account);
    if (action === "advance" && partyPayment.contractId)
      params.set("contract", partyPayment.contractId);
    if (action === "advance") params.set("purpose", "advance");
    go(`${action === "advance" ? "/write/payment" : "/dues"}?${params}`);
  };
  const actions = balanceChoices
    ? [
        {
          label: "অগ্রিম দিই",
          hint: "কাজ বা মাল পাওয়ার আগে টাকা",
          Icon: HandCoinsIcon,
          tone: "orange",
          run: () => openBalance("advance"),
        },
        {
          label: "বাকি দেখি",
          hint: partyPayment ? "আগের বাকি হিসাব" : "কাকে কত দিতে হবে",
          Icon: ReceiptIcon,
          tone: "blue",
          run: () => openBalance("dues"),
        },
      ]
    : [
        {
          label: "মাল কিনেছি",
          hint: "ক্যাশে বা বাকিতে কেনা মাল",
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
      ];
  return (
    <Sheet
      title={t(balanceChoices ? "অগ্রিম বা বাকি" : "কী লিখবেন?")}
      onClose={close}
    >
      {partyPayment && (
        <p className="quick-choice-person">
          {person ? formatDigits(person.name) : t("এই নামটি খাতায় নেই")}
        </p>
      )}
      {balanceChoices && !partyPayment && (
        <button
          type="button"
          className="text-button quick-choice-back"
          onClick={() => setBalanceChoices(false)}
        >
          <ArrowLeftIcon size={18} aria-hidden="true" />
          {t("সব কাজ")}
        </button>
      )}
      {(!partyPayment || person) && (
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
      )}
      {!balanceChoices && <LegacyEntryDrafts />}
    </Sheet>
  );
}
