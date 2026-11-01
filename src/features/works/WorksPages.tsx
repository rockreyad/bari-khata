import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ClockCounterClockwiseIcon,
  DotsThreeIcon,
  FolderOpenIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { summarize, entryWorkIds, contractSummary } from "../../domain/ledger";
import type { Ledger, Work, WorkSnapshot } from "../../domain/model";
import { workChanges } from "../../domain/workActivity";
import {
  WorkMark,
  workColorChoices,
  workIconChoices,
} from "../../components/ui/Icons";
import { EntryList } from "../../components/ui/EntryList";
import { AppSelect } from "../../components/ui/AppSelect";
import { sortHistory } from "../history/history";
import { AppMenu } from "../../components/ui/AppMenu";
const statusNames = {
  planned: "শুরু হয়নি",
  ongoing: "কাজ চলছে",
  done: "কাজ শেষ",
};
const fields: Record<keyof WorkSnapshot, string> = {
  name: "নাম",
  description: "বিবরণ",
  color: "রং",
  icon: "চিহ্ন",
  status: "অবস্থা",
  startedOn: "শুরুর তারিখ",
  completedOn: "শেষের তারিখ",
  quickActions: "পছন্দের বোতাম",
};
export function WorkCard({
  work,
  ledger,
  onOpen,
}: {
  work: Work;
  ledger: Ledger;
  onOpen: () => void;
}) {
  const { t, money } = useLanguageContext();
  const s = summarize(ledger, work.id);
  const actions = work.quickActions ?? ["expense", "payment"];
  const rows = [
    {
      label: "মাল",
      amount: s.byType.material,
      show: actions.includes("expense"),
    },
    {
      label: "মজুরি",
      amount: s.byType.labour,
      show: actions.includes("labour"),
    },
    {
      label: "আনা-নামানো",
      amount: s.byType.transport + s.byType.unload,
      show: actions.includes("transport"),
    },
    {
      label: "অন্য খরচ",
      amount: s.byType.other + s.byType.rental,
      show: false,
    },
  ]
    .filter((row) => row.amount !== 0 || row.show)
    .slice(0, 2);
  return (
    <button className="notebook-card notebook-card-v3" onClick={onOpen}>
      <div className="notebook-card-top">
        <WorkMark icon={work.icon} color={work.color} />
        <span className={`status-tag ${work.status}`}>
          <i />
          {t(statusNames[work.status])}
        </span>
      </div>
      <h3>{work.name}</h3>
      <div className="notebook-amounts">
        {rows.map((row) => (
          <span key={row.label}>
            {t(row.label)}
            <strong>{money(row.amount)}</strong>
          </span>
        ))}
      </div>
      <footer>
        <span>{t("খাতা খুলুন")}</span>
        <ArrowRightIcon size={17} />
      </footer>
    </button>
  );
}
export function WorksPage() {
  const { ledger, go, entity } = useNotebook();
  const { t } = useLanguageContext();
  const [search, setSearch] = useState("");
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "all";
  const works = ledger.works.filter(
    (w) =>
      (status === "all" || w.status === status) &&
      w.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="page-flow">
      <header className="page-heading">
        <div>
          <h1>{t("কাজের খাতা")}</h1>
          <p>{t("যে কাজের হিসাব দরকার, সেটি খুলুন।")}</p>
        </div>
        <button className="primary-button" onClick={() => entity("work")}>
          <PlusIcon size={19} />
          {t("খাতা খুলব")}
        </button>
      </header>
      <div className="work-filter-v3">
        <input
          aria-label={t("খাতা খুঁজুন")}
          placeholder={t("খাতার নাম লিখুন")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <AppSelect
          aria-label={t("কাজের অবস্থা")}
          value={status}
          onChange={(e) =>
            setParams(
              e.target.value === "all" ? {} : { status: e.target.value },
            )
          }
        >
          <option value="all">{t("সব খাতা")}</option>
          {Object.entries(statusNames).map(([id, name]) => (
            <option key={id} value={id}>
              {t(name)}
            </option>
          ))}
        </AppSelect>
      </div>
      <div className="notebook-grid">
        {works.map((w) => (
          <WorkCard
            key={w.id}
            work={w}
            ledger={ledger}
            onOpen={() => go(`/works/${w.id}`)}
          />
        ))}
      </div>
      {!works.length ? (
        <div className="empty-panel">
          <FolderOpenIcon size={36} />
          <h3>{t("কোনো খাতা পাওয়া যায়নি")}</h3>
        </div>
      ) : null}
    </div>
  );
}
export function WorkPage() {
  const { workId } = useParams();
  const { ledger, go, entity, add, detail } = useNotebook();
  const { t, money, date, language } = useLanguageContext();
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") ?? "material";
  const tab = ["material", "labour", "transport", "other", "activity"].includes(
    raw,
  )
    ? raw
    : "material";
  const work = ledger.works.find((w) => w.id === workId);
  if (!work)
    return (
      <div className="empty-panel">
        <h2>{t("খাতা পাওয়া যায়নি")}</h2>
        <button onClick={() => go("/works")}>{t("সব খাতা")}</button>
      </div>
    );
  const s = summarize(ledger, work.id);
  const typeMatches = (type: string) =>
    tab === "labour"
      ? type === "labour"
      : tab === "transport"
        ? ["transport", "unload"].includes(type)
        : tab === "other"
          ? ["rental", "other"].includes(type)
          : type === "material";
  const costEntries = s.entries.filter((e) =>
    e.lines.some((l) => l.workId === work.id && typeMatches(l.costType)),
  );
  const account =
    tab === "labour"
      ? "labour"
      : ["transport", "other"].includes(tab)
        ? "other"
        : "materials";
  const entries = sortHistory(costEntries).slice(0, 10);
  const amounts = Object.fromEntries(
    costEntries.map((e) => [
      e.id,
      e.lines
        .filter((l) => l.workId === work.id && typeMatches(l.costType))
        .reduce((sum, l) => sum + l.amount, 0) *
        (e.kind === "expense_credit" ? -1 : 1),
    ]),
  );
  const titles = Object.fromEntries(
    costEntries.map((e) => [
      e.id,
      e.lines
        .filter((l) => l.workId === work.id && typeMatches(l.costType))
        .map((l) => l.label)
        .join(" · "),
    ]),
  );
  const amount = costEntries.reduce(
    (sum, e) =>
      sum +
      e.lines
        .filter((l) => l.workId === work.id && typeMatches(l.costType))
        .reduce((n, l) => n + l.amount, 0) *
        (e.kind === "expense_credit" ? -1 : 1),
    0,
  );
  const actions = work.quickActions ?? ["expense", "payment"];
  const timestamp = (at: string) =>
    new Intl.DateTimeFormat(language === "bn" ? "bn-BD" : "en-BD", {
      timeZone: "Asia/Dhaka",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(at));
  const showValue = (key: keyof WorkSnapshot, value: unknown) =>
    key === "status"
      ? t(statusNames[value as keyof typeof statusNames])
      : key === "startedOn" || key === "completedOn"
        ? value
          ? date(String(value), { year: "numeric" })
          : t("লেখা নেই")
        : key === "quickActions"
          ? Array.isArray(value)
            ? value
                .map((v) =>
                  t(
                    (
                      {
                        expense: "খরচ লিখি",
                        payment: "টাকা দিলাম",
                        labour: "মজুরি",
                        transport: "আনা-নামানো",
                      } as Record<string, string>
                    )[v] ?? v,
                  ),
                )
                .join(" · ") || t("কোনো বোতাম নেই")
            : t("সাধারণ বোতাম")
          : key === "color"
            ? t(
                workColorChoices.find((c) => c.id === value)?.label ??
                  String(value),
              )
            : key === "icon"
              ? t(
                  workIconChoices.find((c) => c.id === value)?.label ??
                    String(value),
                )
              : String(value ?? t("লেখা নেই"));
  return (
    <div className="page-flow work-page-v3">
      <button className="back-link" onClick={() => go("/works")}>
        <ArrowLeftIcon size={17} />
        {t("কাজের খাতা")}
      </button>
      <header className="page-heading">
        <div className="work-title">
          <WorkMark icon={work.icon} color={work.color} size={29} />
          <div>
            <h1>{work.name}</h1>
            <span className={`status-tag ${work.status}`}>
              <i />
              {t(statusNames[work.status])}
            </span>
          </div>
        </div>
        <AppMenu
          trigger={
            <button className="icon-button" aria-label={t("খাতার আরও কাজ")}>
              <DotsThreeIcon size={25} />
            </button>
          }
          items={[
            {
              label: t("খাতার তথ্য বদলাই"),
              onSelect: () => entity("work", work.id),
            },
            {
              label: t("মজুরির দর রাখি"),
              onSelect: () => entity("contract", undefined, work.id),
            },
            {
              label: t("সব লেনদেন দেখি"),
              onSelect: () => go(`/ledger?work=${work.id}`),
            },
          ]}
        />
      </header>
      <div className="work-tabs-v3">
        {(
          [
            ["material", "মাল"],
            ["labour", "মজুরি"],
            ["transport", "আনা-নামানো"],
            ["other", "অন্য খরচ"],
            ["activity", "কাজের খবর"],
          ] as const
        ).map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-pressed={tab === id}
            className={tab === id ? "selected" : ""}
            onClick={() => setParams({ tab: id })}
          >
            {t(label)}
          </button>
        ))}
      </div>
      {tab === "activity" ? (
        <>
          <section className="panel work-facts-v3">
            {work.description ? <p>{work.description}</p> : null}
            <div>
              <span>{t("কাজ শুরুর তারিখ")}</span>
              <strong>
                {work.startedOn
                  ? date(work.startedOn, { year: "numeric" })
                  : t("লেখা নেই")}
              </strong>
            </div>
            <div>
              <span>{t("কাজ শেষের তারিখ")}</span>
              <strong>
                {work.completedOn
                  ? date(work.completedOn, { year: "numeric" })
                  : t("লেখা নেই")}
              </strong>
            </div>
            <button
              className="text-button"
              onClick={() => entity("work", work.id)}
            >
              {t("তারিখ বা তথ্য যোগ করি")}
            </button>
          </section>
          <section className="panel">
            <div className="section-heading">
              <h2>{t("কখন কী বদলেছে")}</h2>
              <ClockCounterClockwiseIcon size={22} />
            </div>
            {!work.activity.length ? (
              <p className="helper-text">
                {t("আগের পরিবর্তনের সময় লেখা ছিল না। এখন থেকে এখানে থাকবে।")}
              </p>
            ) : (
              <ol className="work-activity-list">
                {[...work.activity].reverse().map((event) => (
                  <li key={event.id}>
                    <span className="activity-pin" />
                    <div>
                      <strong>
                        {t(
                          event.before
                            ? "খাতার তথ্য বদলেছে"
                            : "খাতা খোলা হয়েছে",
                        )}
                      </strong>
                      <time>{timestamp(event.at)}</time>
                      {event.before ? (
                        <dl>
                          {workChanges(event.before, event.after).map((key) => (
                            <div key={key}>
                              <dt>{t(fields[key])}</dt>
                              <dd>
                                <span>
                                  {showValue(key, event.before![key])}
                                </span>
                                <ArrowRightIcon size={13} />
                                <strong>
                                  {showValue(key, event.after[key])}
                                </strong>
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p>
                          {event.after.name} ·{" "}
                          {t(statusNames[event.after.status])}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      ) : (
        <>
          <section className="work-scope-summary">
            <span>
              {t(
                tab === "labour"
                  ? "মজুরির খরচ"
                  : tab === "transport"
                    ? "আনা-নামানোর খরচ"
                    : tab === "other"
                      ? "অন্য খরচ"
                      : "মাল কেনার খরচ",
              )}
            </span>
            <strong>{money(amount)}</strong>
            <button
              className="text-button"
              onClick={() => go(`/reports?section=${tab}&work=${work.id}`)}
            >
              {t("বিস্তারিত হিসাব")}
              <ArrowRightIcon size={15} />
            </button>
          </section>
          <div className="work-action-buttons">
            {actions.includes("expense") ? (
              <button
                className="primary-button"
                onClick={() =>
                  add({
                    workId: work.id,
                    costType:
                      tab === "labour"
                        ? "labour"
                        : tab === "transport"
                          ? "transport"
                          : tab === "other"
                            ? "other"
                            : "material",
                    account,
                  })
                }
              >
                <PlusIcon size={18} />
                {t("খরচ লিখি")}
              </button>
            ) : null}
            {actions.includes("payment") ? (
              <button
                className="secondary-button"
                onClick={() =>
                  add({ kind: "payment", workId: work.id, account })
                }
              >
                {t("টাকা দিলাম")}
              </button>
            ) : null}
            {actions.includes("labour") ? (
              <button
                className="secondary-button"
                onClick={() =>
                  add({
                    workId: work.id,
                    costType: "labour",
                    account: "labour",
                  })
                }
              >
                {t("মজুরি লিখি")}
              </button>
            ) : null}
            {actions.includes("transport") ? (
              <button
                className="secondary-button"
                onClick={() =>
                  add({
                    workId: work.id,
                    costType: "transport",
                    account: "other",
                  })
                }
              >
                {t("আনার খরচ")}
              </button>
            ) : null}
          </div>
          {tab === "labour" &&
          ledger.contracts.some((c) => c.workId === work.id) ? (
            <details className="work-agreements">
              <summary>{t("আগে ঠিক করা মজুরি")}</summary>
              {ledger.contracts
                .filter((c) => c.workId === work.id)
                .map((c) => {
                  const cs = contractSummary(ledger, c.id);
                  return (
                    <div className="wage-agreement-v3" key={c.id}>
                      <strong>
                        {ledger.people.find((p) => p.id === c.personId)?.name}
                      </strong>
                      <p>{c.title}</p>
                      <div>
                        <span>{t("ঠিক করা মোট মজুরি")}</span>
                        <strong>{money(c.total)}</strong>
                      </div>
                      <div>
                        <span>{t("দিয়েছি")}</span>
                        <strong>{money(cs.netPaid)}</strong>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => entity("contract", c.id, work.id)}
                      >
                        {t("দর বদলাই")}
                      </button>
                    </div>
                  );
                })}
            </details>
          ) : null}
          <section className="panel">
            <div className="section-heading">
              <h2>{t("সাম্প্রতিক হিসাব")}</h2>
              <button
                className="text-button"
                onClick={() => go(`/ledger?work=${work.id}&account=${account}`)}
              >
                {t("সব লেনদেন")}
                <ArrowRightIcon size={15} />
              </button>
            </div>
            <EntryList
              ledger={ledger}
              entries={entries.filter((e) => entryWorkIds(e).includes(work.id))}
              workId={work.id}
              amounts={amounts}
              titles={titles}
              hideWork
              onEntry={detail}
            />
          </section>
        </>
      )}
    </div>
  );
}
