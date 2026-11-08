import { useId, useMemo } from "react";
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
import { useComposedSearch } from "../../lib/useComposedSearch";
import { AppMenu } from "../../components/ui/AppMenu";
import { personKind } from "../../domain/contacts";
import { matchesContact } from "./people";
import { peopleBalances } from "./peopleBalances";
import { PersonMark, kindLabels } from "./ContactIdentity";
import { PeopleRoleTabs } from "./PeopleRoleTabs";
import { peopleRoles, roleKey, visibleRoleTabs } from "./peopleRoles";
import { usePeopleRoleTabs } from "./usePeopleRoleTabs";
import { contactRoles, contactPresets } from "./contactPresets";
import "./people.css";

function ContactBalances({
  balance,
}: {
  balance: ReturnType<typeof peopleBalances>;
}) {
  const { t, money } = useLanguageContext();
  const recordReviewId = useId();
  const recordReviewDescription = t(
    "কিছু বিল বা মালের ফেরতের তথ্য যাচাই বাকি। এর মানে টাকা বকেয়া আছে, এমন নয়।",
  );
  const states = [
    {
      kind: "due",
      amount: balance.valid ? balance.remaining : 0,
      label: balance.needsReview
        ? "জানা বাকি {{amount}}"
        : "আরও দিতে হবে {{amount}}",
    },
    { kind: "advance", amount: balance.advance, label: "অগ্রিম {{amount}}" },
    { kind: "extra", amount: balance.extra, label: "বেশি দিয়েছি {{amount}}" },
    { kind: "credit", amount: balance.credit, label: "আমার জমা {{amount}}" },
    {
      kind: "receivable",
      amount: balance.receivable,
      label: "ফেরত পাব {{amount}}",
    },
  ].filter(({ amount }) => amount > 0);
  if (!states.length && !balance.needsReview && !balance.recordReviewCount)
    return null;
  return (
    <span className="contact-row-statuses">
      {states.map(({ kind, amount, label }) => (
        <span
          className="contact-balance-status"
          data-balance-kind={kind}
          key={kind}
        >
          {t(label, { amount: money(amount) })}
        </span>
      ))}
      {balance.needsReview ? (
        <span className="contact-balance-status" data-balance-kind="review">
          {t("যাচাই বাকি")}
        </span>
      ) : null}
      {balance.recordReviewCount > 0 ? (
        <>
          <span
            className="contact-balance-status"
            data-balance-kind="record-review"
            title={recordReviewDescription}
            aria-describedby={recordReviewId}
          >
            {t("বিলের তথ্য যাচাই বাকি")}
          </span>
          <span className="visually-hidden" id={recordReviewId}>
            {recordReviewDescription}
          </span>
        </>
      ) : null}
    </span>
  );
}

export function PeoplePage() {
  const { ledger, entity, go, mode } = useNotebook();
  const { t, money, formatDigits } = useLanguageContext();
  const scopeId = useId();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const rawRole = (params.get("role") ?? "").slice(0, 4000);
  const activeRole = roleKey(rawRole);
  const activeType = (params.get("contactType") ?? "").slice(0, 100);
  const rawKind = params.get("type") ?? "all";
  const kind =
    !activeRole && ["worker", "shop", "driver", "other"].includes(rawKind)
      ? (rawKind as keyof typeof kindLabels)
      : "all";
  const rawStatus = params.get("status") ?? "all";
  const status = ["due", "advance", "receivable"].includes(rawStatus)
    ? rawStatus
    : "all";
  const roles = useMemo(() => peopleRoles(ledger.people), [ledger.people]);
  const preferences = usePeopleRoleTabs(mode);
  const visibleTabs = visibleRoleTabs(roles, preferences.keys);
  const hiddenType =
    activeType && !visibleTabs.some((type) => type.key === activeType)
      ? (roles.find((type) => type.key === activeType)?.label ??
        contactPresets.find((type) => type.id === activeType)?.label ??
        activeType)
      : "";
  const rows = useMemo(
    () =>
      ledger.people
        .filter((person) => !person.archivedAt)
        .map((person) => ({ person, ...peopleBalances(ledger, person) })),
    [ledger],
  );
  const shown = rows
    .filter(
      ({ person, remaining, advance, extra, credit, receivable, valid }) =>
        matchesContact(person, query) &&
        (kind === "all" || personKind(person) === kind) &&
        (!activeType ||
          (contactRoles(person).length
            ? contactRoles(person).includes(activeType as never)
            : activeType === "custom")) &&
        (!activeRole || roleKey(person.role) === activeRole) &&
        (status === "all" ||
          (status === "due"
            ? valid && remaining > 0
            : status === "receivable"
              ? receivable > 0
              : advance > 0 || extra > 0 || credit > 0)),
    )
    .sort(
      (a, b) =>
        b.summary.reconciledNetPaid - a.summary.reconciledNetPaid ||
        a.person.name.localeCompare(b.person.name),
    );
  const filter = (key: string, value: string): void =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (key !== "q") {
          const latestQuery = search.getCommittedQuery();
          if (latestQuery) next.set("q", latestQuery);
          else next.delete("q");
        }
        if (value && (key === "q" || value !== "all")) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const search = useComposedSearch(query, (value) => filter("q", value));
  const selectType = (type: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        const latestQuery = search.getCommittedQuery();
        if (latestQuery) next.set("q", latestQuery);
        else next.delete("q");
        next.delete("type");
        next.delete("role");
        if (type) next.set("contactType", type);
        else next.delete("contactType");
        return next;
      },
      { replace: true },
    );
  const scopes = [
    ...(kind !== "all"
      ? [
          {
            key: "type",
            label: t("ধরন: {{kind}}", { kind: t(kindLabels[kind]) }),
            clear: t("ধরনের বাছাই মুছুন"),
          },
        ]
      : []),
    ...(activeRole
      ? [
          {
            key: "role",
            label: t("পরিচয়: {{role}}", { role: formatDigits(rawRole.trim()) }),
            clear: t("পরিচয়ের বাছাই মুছুন"),
          },
        ]
      : []),
    ...(hiddenType
      ? [
          {
            key: "contactType",
            label: t("ধরন: {{kind}}", {
              kind: t(activeType === "custom" ? "ধরন বাছা হয়নি" : hiddenType),
            }),
            clear: t("ধরনের বাছাই মুছুন"),
          },
        ]
      : []),
  ];
  return (
    <div className="contacts-page">
      <header className="page-heading">
        <div>
          <h1>{t("কর্মী")}</h1>
          <p>{t("দেওয়া টাকা, বাকি ও জমা এক নজরে।")}</p>
        </div>
        <button className="primary-button" onClick={() => entity("person")}>
          <PlusIcon size={19} />
          {t("নতুন কর্মী")}
        </button>
      </header>
      <button className="people-jobs-link" onClick={() => go("/works")}>
        <HardHatIcon size={21} weight="duotone" />
        <span>{t("সব কাজ")}</span>
        <ArrowRightIcon size={18} />
      </button>
      <div className="contacts-search">
        <MagnifyingGlassIcon size={21} />
        <input
          aria-label={t("নাম বা নম্বর খুঁজুন")}
          placeholder={t("নাম বা নম্বর খুঁজুন")}
          {...search.inputProps}
        />
        {search.value ? (
          <button
            className="icon-button"
            aria-label={t("খোঁজ মুছুন")}
            type="button"
            onClick={search.clear}
          >
            <XIcon size={17} />
          </button>
        ) : null}
        <AppMenu
          label={t("টাকার অবস্থা অনুযায়ী দেখুন")}
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
              label: t("অগ্রিম বা জমা আছে"),
              onSelect: () => filter("status", "advance"),
            },
            {
              label: t("ফেরত পাব"),
              onSelect: () => filter("status", "receivable"),
            },
          ]}
        />
      </div>
      <PeopleRoleTabs
        roles={roles}
        selectedKeys={preferences.keys}
        activeRole={activeType}
        allActive={!activeRole && !activeType && kind === "all"}
        ready={preferences.ready}
        saving={preferences.saving}
        error={preferences.error}
        onSelect={selectType}
        onSave={preferences.saveKeys}
        onRetry={preferences.retry}
      />
      {scopes.map((scope) => (
        <div className="people-active-scope" key={scope.key}>
          <span id={`${scopeId}-${scope.key}`}>{scope.label}</span>
          <button
            type="button"
            aria-label={scope.clear}
            aria-describedby={`${scopeId}-${scope.key}`}
            onClick={() => filter(scope.key, "")}
          >
            <XIcon size={17} aria-hidden="true" />
          </button>
        </div>
      ))}
      {shown.length ? (
        <section className="contacts-list" aria-label={t("কর্মীর তালিকা")}>
          <div className="contacts-list-caption">
            <span>{t("নাম")}</span>
            <span>{t("টাকা দিয়েছি")}</span>
          </div>
          {shown.map(({ person, summary, ...balance }) => (
            <button
              className="contact-row"
              key={person.id}
              onClick={() => go(`/parties/${encodeURIComponent(person.id)}`)}
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
              </span>
              <ArrowRightIcon className="contact-row-chevron" size={16} />
              <ContactBalances balance={{ summary, ...balance }} />
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
