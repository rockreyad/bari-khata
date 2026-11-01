import { useMemo } from "react";
import { useSearchParams } from "react-router";
import {
  ArrowRightIcon,
  FunnelSimpleIcon,
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
import "./people.css";
export function PeoplePage() {
  const { ledger, entity, go } = useNotebook();
  const { t, money } = useLanguageContext();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const kind = params.get("type") ?? "all";
  const status = params.get("status") ?? "all";
  const rows = useMemo(
    () =>
      ledger.people.map((person) => ({
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
        (status === "all" ||
          (status === "due" ? summary.payable > 0 : summary.advance > 0)),
    )
    .sort(
      (a, b) =>
        b.summary.netPaid - a.summary.netPaid ||
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
              label: t("আগাম দিয়েছি"),
              onSelect: () => filter("status", "advance"),
            },
          ]}
        />
      </div>
      <div className="contacts-tabs" aria-label={t("নামের ধরন")}>
        {[
          { id: "all", label: "সবাই" },
          { id: "worker", label: "মিস্ত্রি" },
          { id: "shop", label: "দোকান" },
          { id: "driver", label: "গাড়িচালক" },
        ].map((tab) => (
          <button
            key={tab.id}
            className={kind === tab.id ? "active" : ""}
            aria-pressed={kind === tab.id}
            onClick={() => filter("type", tab.id)}
          >
            {t(tab.label)}
          </button>
        ))}
      </div>
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
                <strong>{person.name}</strong>
                <small>
                  {person.role || t(kindLabels[personKind(person)])}
                </small>
              </span>
              <span className="contact-row-money">
                <strong>
                  {summary.historicalCount &&
                  !summary.entries.some(
                    (entry) => entry.balanceImpact !== "historical",
                  )
                    ? t("যাচাই বাকি")
                    : money(summary.netPaid)}
                </strong>
                <span>
                  {summary.payable > 0 ? (
                    <small className="contact-due">
                      {t("বাকি {{amount}}", { amount: money(summary.payable) })}
                    </small>
                  ) : null}
                  {summary.advance > 0 ? (
                    <small className="contact-credit">
                      {t("আগাম {{amount}}", { amount: money(summary.advance) })}
                    </small>
                  ) : null}
                </span>
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
                ? "এই নামে কাউকে পাওয়া যায়নি"
                : "নাম যোগ করে শুরু করুন",
            )}
          </h3>
          <p>{t("নাম চাপলে তাঁর পুরো হিসাব দেখা যাবে।")}</p>
        </div>
      )}
    </div>
  );
}
