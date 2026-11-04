import { useMemo } from "react";
import { useSearchParams } from "react-router";
import {
  ArrowRightIcon,
  FunnelSimpleIcon,
  HardHatIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  UserCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { AppMenu } from "../../components/ui/AppMenu";
import { contactAccountSummary, personKind } from "../../domain/contacts";
import { matchesContact } from "./people";
import { PersonMark, kindLabels } from "./ContactIdentity";
import { PeopleRoleTabs } from "./PeopleRoleTabs";
import { peopleRoles, roleKey, visibleRoleTabs } from "./peopleRoles";
import { usePeopleRoleTabs } from "./usePeopleRoleTabs";
import "./people.css";
export function PeoplePage() {
  const { ledger, entity, go, mode } = useNotebook();
  const { t, money, formatDigits } = useLanguageContext();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const rawRole = (params.get("role") ?? "").slice(0, 4000);
  const activeRole = roleKey(rawRole);
  const rawKind = params.get("type") ?? "all";
  const kind =
    !activeRole && ["worker", "shop", "driver", "other"].includes(rawKind)
      ? (rawKind as keyof typeof kindLabels)
      : "all";
  const rawStatus = params.get("status") ?? "all";
  const status = ["due", "advance"].includes(rawStatus) ? rawStatus : "all";
  const roles = useMemo(() => peopleRoles(ledger.people), [ledger.people]);
  const preferences = usePeopleRoleTabs(mode);
  const visibleTabs = visibleRoleTabs(roles, preferences.keys);
  const hiddenRole =
    activeRole && !visibleTabs.some((role) => role.key === activeRole)
      ? (roles.find((role) => role.key === activeRole)?.label ?? rawRole.trim())
      : "";
  const rows = useMemo(
    () =>
      ledger.people
        .filter((person) => !person.archivedAt)
        .map((person) => ({
          person,
          summary: contactAccountSummary(ledger, person),
        })),
    [ledger],
  );
  const shown = rows
    .filter(
      ({ person, summary }) =>
        matchesContact(person, query) &&
        (kind === "all" || personKind(person) === kind) &&
        (!activeRole || roleKey(person.role) === activeRole) &&
        (status === "all" ||
          (status === "due"
            ? summary.reconciledPayable > 0
            : summary.reconciledAdvance > 0)),
    )
    .sort(
      (a, b) =>
        b.summary.reconciledNetPaid - a.summary.reconciledNetPaid ||
        a.person.name.localeCompare(b.person.name),
    );
  const filter = (key: string, value: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value && value !== "all") next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const selectRole = (role: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("type");
        if (role)
          next.set(
            "role",
            roles.find((item) => item.key === role)?.label ?? role,
          );
        else next.delete("role");
        return next;
      },
      { replace: true },
    );
  return (
    <div className="contacts-page">
      <header className="page-heading">
        <div>
          <h1>{t("মানুষ ও দোকান")}</h1>
          <p>{t("কাকে কত দিয়েছি, এক নজরে।")}</p>
        </div>
        <button className="primary-button" onClick={() => entity("person")}>
          <PlusIcon size={19} />
          {t("নাম যোগ করি")}
        </button>
      </header>
      <button className="people-jobs-link" onClick={() => go("/jobs")}>
        <HardHatIcon size={21} weight="duotone" />
        <span>{t("মিস্ত্রির সব কাজ")}</span>
        <ArrowRightIcon size={18} />
      </button>
      <div className="contacts-search">
        <MagnifyingGlassIcon size={21} />
        <input
          aria-label={t("নাম বা নম্বর খুঁজুন")}
          placeholder={t("নাম বা নম্বর খুঁজুন")}
          value={query}
          onChange={(event) => filter("q", event.target.value)}
        />
        {query ? (
          <button
            className="icon-button"
            aria-label={t("খোঁজ মুছুন")}
            onClick={() => filter("q", "")}
          >
            <XIcon size={17} />
          </button>
        ) : null}
        <AppMenu
          label={t("বাকি অনুযায়ী দেখুন")}
          trigger={
            <button
              className={`icon-button ${status !== "all" ? "is-filtered" : ""}`}
              aria-label={t("বাছাই")}
            >
              <FunnelSimpleIcon size={21} />
            </button>
          }
          items={[
            { label: t("সবাই"), onSelect: () => filter("status", "all") },
            {
              label: t("দিতে বাকি আছে"),
              onSelect: () => filter("status", "due"),
            },
            {
              label: t("আমার জমা"),
              onSelect: () => filter("status", "advance"),
            },
          ]}
        />
      </div>
      <PeopleRoleTabs
        roles={roles}
        selectedKeys={preferences.keys}
        activeRole={activeRole}
        allActive={!activeRole && kind === "all"}
        ready={preferences.ready}
        saving={preferences.saving}
        error={preferences.error}
        onSelect={selectRole}
        onSave={preferences.saveKeys}
        onRetry={preferences.retry}
      />
      {kind !== "all" || hiddenRole ? (
        <div className="people-active-scope">
          <span>
            {kind !== "all"
              ? t("ধরন: {{kind}}", { kind: t(kindLabels[kind]) })
              : t("পরিচয়: {{role}}", { role: formatDigits(hiddenRole) })}
          </span>
          <button
            type="button"
            aria-label={t(
              kind !== "all" ? "ধরনের বাছাই মুছুন" : "পরিচয়ের বাছাই মুছুন",
            )}
            onClick={() => selectRole("")}
          >
            <XIcon size={17} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {shown.length ? (
        <section
          className="contacts-list"
          aria-label={t("মানুষ ও দোকানের তালিকা")}
        >
          <div className="contacts-list-caption">
            <span>{t("নাম")}</span>
            <span>{t("টাকা দিয়েছি")}</span>
          </div>
          {shown.map(({ person, summary }) => (
            <button
              className="contact-row"
              key={person.id}
              onClick={() => go(`/people/${encodeURIComponent(person.id)}`)}
            >
              <PersonMark person={person} />
              <span className="contact-row-name">
                <strong>{formatDigits(person.name)}</strong>
                <small>
                  {formatDigits(
                    person.role || t(kindLabels[personKind(person)]),
                  )}
                </small>
              </span>
              <span className="contact-row-money">
                <strong>
                  {summary.historicalCount &&
                  !summary.entries.some(
                    (entry) => entry.balanceImpact !== "historical",
                  ) ? (
                    t("যাচাই বাকি")
                  ) : (
                    <span className="contact-paid-amount">
                      {money(summary.reconciledNetPaid)}
                    </span>
                  )}
                </strong>
                {summary.reconciledPayable > 0 ? (
                  <small className="contact-due">
                    {t("বাকি {{amount}}", {
                      amount: money(summary.reconciledPayable),
                    })}
                  </small>
                ) : null}
              </span>
              <ArrowRightIcon className="contact-row-chevron" size={16} />
            </button>
          ))}
        </section>
      ) : (
        <div className="empty-panel">
          <UserCircleIcon size={38} weight="duotone" />
          <h3>
            {t(
              rows.length
                ? query
                  ? "এই নামে কাউকে পাওয়া যায়নি"
                  : "এই বাছাইয়ে কাউকে পাওয়া যায়নি"
                : "নাম যোগ করে শুরু করুন",
            )}
          </h3>
          <p>{t("নাম চাপলে তাঁর পুরো হিসাব দেখা যাবে।")}</p>
        </div>
      )}
    </div>
  );
}
