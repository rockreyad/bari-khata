import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckIcon,
  MagnifyingGlassIcon,
  SlidersHorizontalIcon,
} from "@phosphor-icons/react";
import { Sheet } from "../../components/Sheet";
import { useLanguageContext } from "../../context/LanguageProvider";
import {
  MAX_PEOPLE_ROLE_TABS,
  roleKey,
  visibleRoleTabs,
  type PeopleRole,
} from "./peopleRoles";
import "./people-role-tabs.css";

export function PeopleRoleTabs({
  roles,
  selectedKeys,
  activeRole,
  allActive,
  ready,
  saving,
  error,
  onSelect,
  onSave,
  onRetry,
}: {
  roles: PeopleRole[];
  selectedKeys: string[] | null;
  activeRole: string;
  allActive: boolean;
  ready: boolean;
  saving: boolean;
  error: string;
  onSelect: (key: string) => void;
  onSave: (keys: string[]) => Promise<boolean>;
  onRetry: () => void;
}) {
  const { t, formatDigits, number } = useLanguageContext();
  const tabs = useMemo(
    () => visibleRoleTabs(roles, selectedKeys),
    [roles, selectedKeys],
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (editing) {
      const timer = window.setTimeout(() => {
        const option = picker.current?.querySelector<HTMLInputElement>(
          'input[type="checkbox"]:checked, input[type="checkbox"]:not(:disabled)',
        );
        (option ?? picker.current)?.focus({ preventScroll: true });
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    const timer = window.setTimeout(() => trigger.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [editing]);
  const available = useMemo(
    () => new Set(roles.map((role) => role.key)),
    [roles],
  );
  const chosen = draft.filter((key) => available.has(key));
  const shown = roles.filter((role) =>
    roleKey(t(role.label)).includes(roleKey(query)),
  );
  const close = () => {
    if (!saving) {
      restoreFocus.current = true;
      setEditing(false);
    }
  };
  return (
    <section
      className="people-role-filters"
      aria-label={t("ধরন অনুযায়ী বাছাই")}
    >
      <div className="people-role-heading">
        <span>{t("ধরন অনুযায়ী")}</span>
        <button
          ref={trigger}
          type="button"
          className="people-role-customize"
          aria-haspopup="dialog"
          aria-expanded={editing}
          disabled={!ready}
          onClick={() => {
            setDraft(tabs.map((role) => role.key));
            setQuery("");
            setEditing(true);
          }}
        >
          <SlidersHorizontalIcon size={17} aria-hidden="true" />
          {t("ট্যাব সাজাই")}
        </button>
      </div>
      <div
        className="contacts-tabs people-role-tabs"
        role="group"
        aria-label={t("ধরন অনুযায়ী")}
      >
        <button
          type="button"
          aria-pressed={allActive}
          className={allActive ? "active" : ""}
          onClick={() => onSelect("")}
        >
          {t("সবাই")}
        </button>
        {tabs.map((role) => (
          <button
            type="button"
            key={role.key}
            aria-pressed={activeRole === role.key}
            className={activeRole === role.key ? "active" : ""}
            onClick={() => onSelect(role.key)}
            title={formatDigits(t(role.label))}
          >
            {formatDigits(t(role.label))}
          </button>
        ))}
      </div>
      {error && !editing ? (
        <div className="people-role-storage-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={onRetry}>
            {t("আবার চেষ্টা করুন")}
          </button>
        </div>
      ) : null}
      {editing ? (
        <Sheet
          title={t("ট্যাব সাজাই")}
          subtitle={t("আগে যোগ করা নামগুলোর ধরন থেকে বেছে নিন।")}
          onClose={close}
          footer={
            <div className="people-role-picker-footer">
              <button
                type="button"
                className="secondary-button"
                disabled={saving}
                onClick={close}
              >
                {t("বাতিল")}
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={!ready || saving}
                onClick={async () => {
                  if (await onSave(chosen)) {
                    restoreFocus.current = true;
                    setEditing(false);
                  }
                }}
              >
                <CheckIcon size={18} aria-hidden="true" />
                {t(saving ? "রাখছি…" : "রাখুন")}
              </button>
            </div>
          }
        >
          <div
            ref={picker}
            tabIndex={-1}
            className="people-role-picker"
            aria-busy={saving}
          >
            <div className="people-role-picker-caption">
              <p>
                {t("সবাই-এর পাশে সর্বোচ্চ {{count}}টি ধরন রাখতে পারবেন।", {
                  count: number(MAX_PEOPLE_ROLE_TABS),
                })}
              </p>
              <strong>
                {number(chosen.length)} / {number(MAX_PEOPLE_ROLE_TABS)}
              </strong>
            </div>
            {error ? (
              <div className="people-role-storage-error" role="alert">
                <span>{error}</span>
                <button type="button" disabled={saving} onClick={onRetry}>
                  {t("আবার চেষ্টা করুন")}
                </button>
              </div>
            ) : null}
            <fieldset disabled={saving || !ready}>
              <legend className="people-role-picker-legend">
                {t("দেখাতে চাই")}
              </legend>
              {roles.length > 6 ? (
                <div className="people-role-picker-search">
                  <MagnifyingGlassIcon size={18} aria-hidden="true" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("ধরন খুঁজুন")}
                    aria-label={t("ধরন খুঁজুন")}
                  />
                </div>
              ) : null}
              <div className="people-role-options">
                {shown.map((role) => {
                  const selected = chosen.includes(role.key);
                  const disabled =
                    !selected && chosen.length >= MAX_PEOPLE_ROLE_TABS;
                  return (
                    <label
                      key={role.key}
                      className={disabled ? "is-disabled" : ""}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={disabled}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setDraft((current) => {
                            const valid = current.filter((key) =>
                              available.has(key),
                            );
                            if (!checked)
                              return valid.filter((key) => key !== role.key);
                            return valid.includes(role.key) ||
                              valid.length >= MAX_PEOPLE_ROLE_TABS
                              ? valid
                              : [...valid, role.key];
                          });
                        }}
                      />
                      <span>{formatDigits(t(role.label))}</span>
                      <small aria-hidden="true">
                        {t("{{count}} জন", { count: number(role.count) })}
                      </small>
                      <i aria-hidden="true">
                        {selected ? (
                          <CheckIcon size={14} weight="bold" />
                        ) : null}
                      </i>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {!shown.length ? (
              <p className="people-role-picker-empty">
                {t(
                  roles.length
                    ? "এই ধরনের কোনো নাম যোগ করা নেই।"
                    : "নাম যোগ করার সময় কীভাবে যুক্ত বেছে নিলে এখানে পাওয়া যাবে।",
                )}
              </p>
            ) : null}
            {chosen.length === MAX_PEOPLE_ROLE_TABS ? (
              <p className="people-role-limit" role="status">
                {t("অন্য ধরন রাখতে আগে একটি সরিয়ে নিন।")}
              </p>
            ) : null}
          </div>
        </Sheet>
      ) : null}
    </section>
  );
}
