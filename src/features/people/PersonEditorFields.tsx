import { useMemo, useState } from "react";
import {
  BookOpenIcon,
  CaretDownIcon,
  CheckIcon,
  HardHatIcon,
  MagnifyingGlassIcon,
  SlidersHorizontalIcon,
  StorefrontIcon,
  TruckIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import type { ContactAction, Ledger, PersonKind } from "../../domain/model";
import { ContactImport } from "../../components/contacts/ContactImport";
import {
  AppCombobox,
  type AppSuggestion,
} from "../../components/ui/AppCombobox";
import { AppSelect } from "../../components/ui/AppSelect";
import { MoneyInput } from "../../components/ui/MoneyInput";
import { NumericInput } from "../../components/ui/NumericInput";
import "./person-editor.css";

export type PersonEditorValue = {
  contactKind: PersonKind;
  name: string;
  role: string;
  phone: string;
  personWorkIds: string[];
  personContractAmount: string;
};
const personKinds = [
  { id: "shop", label: "দোকান", Icon: StorefrontIcon },
  { id: "worker", label: "মিস্ত্রি", Icon: HardHatIcon },
  { id: "driver", label: "গাড়ির লোক", Icon: TruckIcon },
  { id: "other", label: "অন্য ব্যক্তি", Icon: UserIcon },
] as const;
const actionNames = {
  payment: "টাকা দিলাম",
  purchase: "মাল কেনা",
  return: "মাল ফেরত",
  transport: "আনার খরচ",
};

export function PersonEditorFields({
  value,
  ledger,
  editing,
  roleChoices,
  allowedActions,
  selectedActions,
  notebookValue,
  onChange,
  onKind,
  onNotebook,
  onToggleAction,
  onContactImport,
}: {
  value: PersonEditorValue;
  ledger: Ledger;
  editing: boolean;
  roleChoices: AppSuggestion[];
  allowedActions: ContactAction[];
  selectedActions: string[];
  notebookValue: string;
  onChange: (patch: Partial<PersonEditorValue>) => void;
  onKind: (kind: PersonKind) => void;
  onNotebook: (id: string) => void;
  onToggleAction: (action: ContactAction) => void;
  onContactImport: (contact: { name: string; phone: string }) => void;
}) {
  const { t, formatDigits, number } = useLanguageContext();
  const [query, setQuery] = useState("");
  const works = useMemo(
    () =>
      ledger.works.filter(
        (work) => !work.archivedAt || value.personWorkIds.includes(work.id),
      ),
    [ledger.works, value.personWorkIds],
  );
  const shownWorks = works.filter((work) =>
    work.name
      .normalize("NFKC")
      .toLocaleLowerCase()
      .includes(query.normalize("NFKC").trim().toLocaleLowerCase()),
  );
  return (
    <>
      <fieldset className="person-editor-kind">
        <legend>{t("নামের ধরন")}</legend>
        {editing ? (
          <p>{t("পরিচয় বদলালেও আগের বিল ও দেওয়া টাকার হিসাব বদলাবে না।")}</p>
        ) : null}
        <div className="person-editor-kind-options">
          {personKinds.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={value.contactKind === id}
              onClick={() => onKind(id)}
            >
              <Icon size={23} weight="duotone" aria-hidden="true" />
              <span>{t(label)}</span>
              <span className="person-editor-kind-check" aria-hidden="true">
                {value.contactKind === id ? (
                  <CheckIcon size={12} weight="bold" />
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      <section className="person-editor-section person-editor-identity">
        <header>
          <h2>{t("নাম ও পরিচয়")}</h2>
          <span>{t("শুধু নাম দিলেই হবে")}</span>
        </header>
        <label className="person-editor-name">
          {t(value.contactKind === "shop" ? "দোকানের নাম" : "নাম")}
          <input
            value={value.name}
            onChange={(event) => onChange({ name: event.target.value })}
            required
            maxLength={200}
            autoComplete={
              value.contactKind === "shop" ? "organization" : "name"
            }
            placeholder={t(
              value.contactKind === "shop"
                ? "যেমন: রহমান ট্রেডার্স"
                : value.contactKind === "worker"
                  ? "যেমন: রহিম মিস্ত্রি"
                  : "যেমন: আব্দুল করিম",
            )}
          />
        </label>
        <label>
          <span className="person-editor-label">
            {t("পরিচয় / কী কাজ করেন")}
            <small aria-hidden="true">{t("ইচ্ছেমতো")}</small>
          </span>
          <AppCombobox
            aria-label={t("পরিচয় / কী কাজ করেন")}
            value={value.role}
            onChange={(event) => onChange({ role: event.target.value })}
            maxLength={200}
            placeholder={t(
              value.contactKind === "shop"
                ? "যেমন: সিমেন্ট ডিলার"
                : value.contactKind === "worker"
                  ? "যেমন: রাজমিস্ত্রি"
                  : value.contactKind === "driver"
                    ? "যেমন: ট্রাকচালক"
                    : "যেমন: ইঞ্জিনিয়ার",
            )}
            suggestions={roleChoices}
          />
        </label>
        <div className="person-editor-phone">
          <label>
            <span className="person-editor-label">
              {t("ফোন নম্বর")}
              <small aria-hidden="true">{t("ইচ্ছেমতো")}</small>
            </span>
            <NumericInput
              aria-label={t("ফোন নম্বর")}
              type="tel"
              autoComplete="tel"
              maxLength={60}
              value={value.phone}
              onChange={(event) => onChange({ phone: event.target.value })}
              placeholder={t("না দিলেও হবে")}
            />
          </label>
          <ContactImport onPick={onContactImport} />
        </div>
      </section>

      <section className="person-editor-section person-editor-notebooks">
        <header>
          <div>
            <h2>
              <BookOpenIcon size={18} aria-hidden="true" />
              {t("খাতায় রাখি")}
            </h2>
            <p>{t("একাধিক খাতা বেছে নিতে পারেন। পরে বাছলেও হবে।")}</p>
          </div>
          {value.personWorkIds.length ? (
            <span className="person-editor-count">
              {t("{{count}}টি", { count: number(value.personWorkIds.length) })}
            </span>
          ) : null}
        </header>
        <fieldset className="person-editor-work-picker">
          <legend className="sr-only">{t("কোন কোন খাতায়")}</legend>
          {works.length > 5 ? (
            <div className="person-editor-search">
              <MagnifyingGlassIcon size={18} aria-hidden="true" />
              <input
                aria-label={t("খাতা খুঁজুন")}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("খাতা খুঁজুন")}
              />
            </div>
          ) : null}
          <div className="person-editor-work-options">
            {shownWorks.map((work) => (
              <label key={work.id}>
                <input
                  type="checkbox"
                  checked={value.personWorkIds.includes(work.id)}
                  onChange={(event) =>
                    onChange({
                      personWorkIds: event.target.checked
                        ? [...value.personWorkIds, work.id]
                        : value.personWorkIds.filter((id) => id !== work.id),
                    })
                  }
                />
                <span>
                  {work.archivedAt
                    ? t("{{name}} (সরানো)", { name: formatDigits(work.name) })
                    : formatDigits(work.name)}
                </span>
                <span className="person-editor-work-check" aria-hidden="true">
                  {value.personWorkIds.includes(work.id) ? (
                    <CheckIcon size={13} weight="bold" />
                  ) : null}
                </span>
              </label>
            ))}
          </div>
          {!shownWorks.length ? (
            <p className="person-editor-empty">
              {t(
                works.length
                  ? "এই নামে কোনো খাতা নেই।"
                  : "খাতা যোগ করলে এখানে বেছে নিতে পারবেন।",
              )}
            </p>
          ) : null}
        </fieldset>
      </section>

      {!editing && value.contactKind === "worker" ? (
        <details className="person-editor-disclosure">
          <summary>
            <HardHatIcon size={21} aria-hidden="true" />
            <span>
              {t("কাজের টাকা")}
              <small>{t("দর ঠিক করা থাকলে লিখুন")}</small>
            </span>
            <CaretDownIcon
              size={17}
              className="person-editor-caret"
              aria-hidden="true"
            />
          </summary>
          <div className="person-editor-disclosure-body">
            <label>
              {t("কাজের খাতা")}
              <AppSelect
                value={notebookValue}
                onChange={(event) => onNotebook(event.target.value)}
              >
                <option value="">{t("পরে বেছে নেব")}</option>
                {ledger.works
                  .filter((work) => !work.archivedAt)
                  .map((work) => (
                    <option key={work.id} value={work.id}>
                      {formatDigits(work.name)}
                    </option>
                  ))}
              </AppSelect>
            </label>
            <label>
              {t("কাজের টাকা")}
              <MoneyInput
                aria-label={t("কাজের টাকা")}
                value={value.personContractAmount}
                onChange={(event) =>
                  onChange({ personContractAmount: event.target.value })
                }
                placeholder={t("যেমন: ৬০০০০০")}
              />
            </label>
            <p>{t("এটি কাজের দর। টাকা দেওয়া হলে আলাদা করে লিখবেন।")}</p>
          </div>
        </details>
      ) : null}

      <details className="person-editor-disclosure">
        <summary>
          <SlidersHorizontalIcon size={21} aria-hidden="true" />
          <span>
            {t("পছন্দের বোতাম")}
            <small>{t("যে কাজগুলো সামনে রাখতে চান")}</small>
          </span>
          <CaretDownIcon
            size={17}
            className="person-editor-caret"
            aria-hidden="true"
          />
        </summary>
        <div className="person-editor-disclosure-body">
          <div
            className="person-editor-action-options"
            role="group"
            aria-label={t("এই নামে কোন বোতাম রাখবেন?")}
          >
            {allowedActions.map((action) => (
              <button
                key={action}
                type="button"
                aria-pressed={selectedActions.includes(action)}
                onClick={() => onToggleAction(action)}
              >
                <span aria-hidden="true">
                  {selectedActions.includes(action) ? (
                    <CheckIcon size={13} weight="bold" />
                  ) : null}
                </span>
                {t(actionNames[action])}
              </button>
            ))}
          </div>
        </div>
      </details>
    </>
  );
}
