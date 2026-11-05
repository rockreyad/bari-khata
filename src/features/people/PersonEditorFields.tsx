import { useEffect, useId, useMemo, useState } from "react";
import {
  BookOpenIcon,
  CaretDownIcon,
  CheckIcon,
  HardHatIcon,
  MagnifyingGlassIcon,
  SlidersHorizontalIcon,
} from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import type { ContactAction, Ledger, PersonKind } from "../../domain/model";
import { contactActionChoices } from "../../domain/contacts";
import { ContactImport } from "../../components/contacts/ContactImport";
import { AppCombobox } from "../../components/ui/AppCombobox";
import { AppSelect } from "../../components/ui/AppSelect";
import { MoneyInput } from "../../components/ui/MoneyInput";
import { NumericInput } from "../../components/ui/NumericInput";
import {
  contactPresets,
  type ContactPreset,
  type ContactType,
} from "./contactPresets";
import "./person-editor.css";

export type PersonEditorValue = {
  contactKind: PersonKind;
  roles?: ContactType[];
  identityType?: "" | "person" | "organization";
  contactPresetId: string;
  name: string;
  role: string;
  phone: string;
  personWorkIds: string[];
  personContractAmount: string;
};
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
  agreementAllowed,
  allowedActions,
  selectedActions,
  notebookValue,
  onChange,
  onPreset,
  onNotebook,
  onToggleAction,
  onContactImport,
}: {
  value: PersonEditorValue;
  ledger: Ledger;
  editing: boolean;
  agreementAllowed: boolean;
  allowedActions: ContactAction[];
  selectedActions: string[];
  notebookValue: string;
  onChange: (patch: Partial<PersonEditorValue>) => void;
  onPreset: (preset: ContactPreset) => void;
  onNotebook: (id: string) => void;
  onToggleAction: (action: ContactAction) => void;
  onContactImport: (contact: { name: string; phone: string }) => void;
}) {
  const { t, formatDigits, number } = useLanguageContext();
  const actionRuleId = useId();
  const preset =
    contactPresets.find((choice) => choice.id === value.contactPresetId) ??
    contactPresets.find((choice) => choice.id === "custom")!;
  const supplier = preset.id === "supplier";
  const hasAgreementAmount = Boolean(value.personContractAmount.trim());
  const [agreementOpen, setAgreementOpen] = useState(hasAgreementAmount);
  useEffect(() => {
    if (hasAgreementAmount) setAgreementOpen(true);
  }, [hasAgreementAmount]);
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
      <section className="person-editor-section person-editor-identity">
        <h2 className="visually-hidden">{t("নাম ও পরিচয়")}</h2>
        <label className="person-editor-name">
          {t(supplier ? "দোকানের নাম" : "নাম")}
          <input
            value={value.name}
            onChange={(event) => onChange({ name: event.target.value })}
            required
            maxLength={200}
            autoComplete={supplier ? "organization" : "name"}
            placeholder={t(
              supplier ? "যেমন: রহমান ট্রেডার্স" : "যেমন: আব্দুল করিম",
            )}
          />
        </label>
        <label>
          <span className="person-editor-label">
            {t("ব্যক্তি না প্রতিষ্ঠান")}
            <small>{t("ইচ্ছেমতো")}</small>
          </span>
          <AppSelect
            aria-label={t("ব্যক্তি না প্রতিষ্ঠান")}
            value={value.identityType ?? ""}
            onChange={(event) =>
              onChange({
                identityType: event.target.value
                  ? (event.target.value as "person" | "organization")
                  : undefined,
              })
            }
          >
            <option value="">{t("পরে বেছে নেব")}</option>
            <option value="person">{t("ব্যক্তি")}</option>
            <option value="organization">{t("প্রতিষ্ঠান")}</option>
          </AppSelect>
        </label>
        <label>
          <span className="person-editor-label">
            {t("কীভাবে যুক্ত")}
            <small>{t("ইচ্ছেমতো")}</small>
          </span>
          <AppSelect
            aria-label={t("কীভাবে যুক্ত")}
            value={preset.id === "custom" ? "" : preset.id}
            onChange={(event) =>
              onPreset(
                contactPresets.find(
                  (choice) => choice.id === (event.target.value || "custom"),
                )!,
              )
            }
          >
            <option value="">{t("কাজ বা সম্পর্ক বেছে নিন")}</option>
            {contactPresets
              .filter((choice) => choice.id !== "custom")
              .map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {t(choice.label)}
                </option>
              ))}
          </AppSelect>
        </label>
        <label>
          <span className="person-editor-label">
            {t(supplier ? "কী বিক্রি করেন" : "পরিচয় / কী কাজ করেন")}
            <small>{t("ইচ্ছেমতো")}</small>
          </span>
          <AppCombobox
            aria-label={t(supplier ? "কী বিক্রি করেন" : "পরিচয় / কী কাজ করেন")}
            value={value.role}
            onChange={(event) => onChange({ role: event.target.value })}
            maxLength={200}
            placeholder={t(
              supplier ? "যেমন: রড ও সিমেন্ট" : "যেমন: বালু ভরাটের কাজ",
            )}
            suggestions={preset.roles.map((role) => ({ value: t(role) }))}
          />
        </label>
        <div className="person-editor-phone">
          <label>
            <span className="person-editor-label">
              {t("ফোন নম্বর")}
              <small>{t("ইচ্ছেমতো")}</small>
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

      <details className="person-editor-disclosure">
        <summary>
          <HardHatIcon size={21} aria-hidden="true" />
          <span>
            {t("আরও কাজ বা সম্পর্ক")}
            <small>{t("একই নামে একাধিক সম্পর্ক রাখা যায়")}</small>
          </span>
          <CaretDownIcon size={17} aria-hidden="true" />
        </summary>
        <div className="person-editor-disclosure-body">
          <fieldset className="person-editor-work-picker">
            <legend className="visually-hidden">{t("কাজ বা সম্পর্ক")}</legend>
            <div className="person-editor-work-options">
              {contactPresets
                .filter((preset) => preset.id !== "custom")
                .map((preset) => {
                  const roles =
                    value.roles ??
                    (value.contactPresetId === "custom"
                      ? []
                      : [value.contactPresetId as ContactType]);
                  return (
                    <label key={preset.id}>
                      <input
                        type="checkbox"
                        checked={roles.includes(preset.id)}
                        onChange={(event) =>
                          onChange({
                            roles: event.target.checked
                              ? [...roles, preset.id]
                              : roles.filter((role) => role !== preset.id),
                          })
                        }
                      />
                      <span>{t(preset.label)}</span>
                    </label>
                  );
                })}
            </div>
          </fieldset>
          <p>
            {t("সম্পর্ক না বাছলেও বিল ও টাকা রাখা যাবে। আগের হিসাব বদলাবে না।")}
          </p>
        </div>
      </details>

      <details className="person-editor-disclosure person-editor-notebooks">
        <summary>
          <BookOpenIcon size={21} aria-hidden="true" />
          <span>
            {t("সেক্টরে রাখি")}
            <small>
              {value.personWorkIds.length
                ? t("{{count}}টি সেক্টর বেছে রাখা আছে", {
                    count: number(value.personWorkIds.length),
                  })
                : t("প্রয়োজন হলে সেক্টর বেছে নিন")}
            </small>
          </span>
          <CaretDownIcon
            size={17}
            className="person-editor-caret"
            aria-hidden="true"
          />
        </summary>
        <div className="person-editor-disclosure-body">
          <fieldset className="person-editor-work-picker">
            <legend className="visually-hidden">{t("কোন কোন সেক্টরে")}</legend>
            {works.length > 5 ? (
              <div className="person-editor-search">
                <MagnifyingGlassIcon size={18} aria-hidden="true" />
                <input
                  aria-label={t("সেক্টর খুঁজুন")}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("সেক্টর খুঁজুন")}
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
                    ? "এই নামে কোনো সেক্টর নেই।"
                    : "সেক্টর যোগ করলে এখানে বেছে নিতে পারবেন।",
                )}
              </p>
            ) : null}
          </fieldset>
        </div>
      </details>

      {!editing && (agreementAllowed || hasAgreementAmount || agreementOpen) ? (
        <details
          className="person-editor-disclosure"
          open={agreementOpen}
          onToggle={(event) => setAgreementOpen(event.currentTarget.open)}
        >
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
              {t("সেক্টর")}
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
            {t("কোন হিসাব রাখবেন")}
            <small>{t("এই পক্ষের জন্য চালু রাখুন")}</small>
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
            aria-label={t("কোন হিসাব রাখবেন")}
            aria-describedby={actionRuleId}
          >
            {contactActionChoices.map((action) => (
              <button
                key={action}
                type="button"
                disabled={!allowedActions.includes(action)}
                aria-pressed={
                  allowedActions.includes(action) &&
                  selectedActions.includes(action)
                }
                onClick={() => onToggleAction(action)}
              >
                <span aria-hidden="true">
                  {allowedActions.includes(action) &&
                  selectedActions.includes(action) ? (
                    <CheckIcon size={13} weight="bold" />
                  ) : null}
                </span>
                {t(actionNames[action])}
              </button>
            ))}
          </div>
          <p id={actionRuleId}>
            {t("বেছে রাখা কাজগুলোই এই পক্ষের হিসাবে পাওয়া যাবে।")}
          </p>
        </div>
      </details>
    </>
  );
}
