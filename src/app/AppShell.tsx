import { lazy, Suspense, useEffect } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useSearchParams,
  useNavigate,
} from "react-router";
import {
  BookOpenIcon,
  ChartDonutIcon,
  CloudCheckIcon,
  CloudSlashIcon,
  GearSixIcon,
  HouseLineIcon,
  BookBookmarkIcon,
  ClockCounterClockwiseIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import {
  entryUrl,
  contractUrl,
  personUrl,
  entryReturn,
  isEntryPage,
} from "./entryRoutes";
import { NotebookNavLink, notebookSectionActive } from "./navigation";
import { useNotebook, type AddOptions } from "./NotebookProvider";
import { useLanguageContext } from "../context/LanguageProvider";
import { HomePage } from "../features/home/HomePage";
import { WorksPage, WorkPage } from "../features/works/WorksPages";
import { LedgerPage } from "../features/ledger/LedgerPage";

import { AccountSchema, CostTypeSchema } from "../domain/model";
import { QuickActionsSheet } from "../features/entries/QuickActionsSheet";
import { PwaUpdateNotice } from "../components/PwaUpdateNotice";
import { useParams } from "react-router";
const QuickEntrySheet = lazy(() =>
  import("../features/entries/QuickEntrySheet").then((m) => ({
    default: m.QuickEntrySheet,
  })),
);
const EntryDetail = lazy(() =>
  import("../features/entries/EntryDetail").then((m) => ({
    default: m.EntryDetail,
  })),
);
const EntrySheet = lazy(() =>
  import("../components/EntrySheet").then((m) => ({ default: m.EntrySheet })),
);
const EntitySheet = lazy(() =>
  import("../components/EntitySheet").then((m) => ({ default: m.EntitySheet })),
);
const AnalyticsPage = lazy(() =>
  import("../features/analytics/AnalyticsPage").then((m) => ({
    default: m.AnalyticsPage,
  })),
);
const PayablesPage = lazy(() =>
  import("../features/home/PayablesPage").then((m) => ({
    default: m.PayablesPage,
  })),
);
const PeoplePage = lazy(() =>
  import("../features/people/PeoplePages").then((m) => ({
    default: m.PeoplePage,
  })),
);
const PersonPage = lazy(() =>
  import("../features/people/PeoplePages").then((m) => ({
    default: m.PersonPage,
  })),
);
const ReviewPage = lazy(() =>
  import("../features/import/ReviewPage").then((m) => ({
    default: m.ReviewPage,
  })),
);
const TimelinePage = lazy(() =>
  import("../features/history/TimelinePage").then((module) => ({
    default: module.TimelinePage,
  })),
);
const JobsPage = lazy(() =>
  import("../features/jobs/JobPages").then((m) => ({ default: m.JobsPage })),
);
const JobPage = lazy(() =>
  import("../features/jobs/JobPages").then((m) => ({ default: m.JobPage })),
);
const AccountPage = lazy(() =>
  import("../features/settings/AccountPage").then((m) => ({
    default: m.AccountPage,
  })),
);
const AccountPasswordPage = lazy(() =>
  import("../features/settings/AccountPage").then((m) => ({
    default: m.AccountPasswordPage,
  })),
);
const RemovedItemsPage = lazy(() =>
  import("../features/settings/RemovedItemsPage").then((m) => ({
    default: m.RemovedItemsPage,
  })),
);
const SettingsPage = lazy(() =>
  import("../features/settings/SettingsPage").then((m) => ({
    default: m.SettingsPage,
  })),
);
const AssistantSettingsPage = lazy(() =>
  import("../features/integrations/AssistantSettingsPage").then((m) => ({
    default: m.AssistantSettingsPage,
  })),
);
function Reports() {
  const { ledger, detail } = useNotebook();
  const { groupId } = useParams();
  return (
    <AnalyticsPage
      ledger={ledger}
      onEntry={(entry) => detail(entry)}
      initialGroupId={groupId}
    />
  );
}
function EntryRoute() {
  const { entryId } = useParams();
  const [params] = useSearchParams();
  const { ledger, mode, close, save, base } = useNotebook();
  const navigate = useNavigate();
  const raw = params.get("kind") ?? "expense";
  const kind: AddOptions["kind"] = [
    "expense",
    "payment",
    "return",
    "refund",
    "wage",
  ].includes(raw)
    ? (raw as AddOptions["kind"])
    : "expense";
  const purpose = params.get("purpose");
  const options: AddOptions = {
    kind,
    workId: params.get("work") ?? undefined,
    personId: params.get("person") ?? undefined,
    account: AccountSchema.safeParse(params.get("account")).data,
    costType: CostTypeSchema.safeParse(params.get("type")).data,
    contractId: params.get("contract") ?? undefined,
    purpose:
      purpose && ["settle", "advance", "wage"].includes(purpose)
        ? (purpose as AddOptions["purpose"])
        : undefined,
  };
  return entryId ? (
    <EntrySheet
      presentation="page"
      key={entryId}
      ledger={ledger}
      mode={mode}
      editEntryId={entryId}
      onCorrectLinkedPayment={(id) => {
        navigate(
          entryUrl(base, { editId: id }, entryReturn(params.get("back"), base)),
        );
      }}
      onClose={close}
      onSave={async (next, attachments) =>
        save(
          next,
          attachments?.files.map((file) => ({
            ...file,
            entryId: attachments.entryId,
          })),
        )
      }
    />
  ) : (
    <QuickEntrySheet
      presentation="page"
      key={JSON.stringify(options)}
      options={options}
    />
  );
}
function ContractRoute() {
  const { contractId: legacyId, jobId } = useParams();
  const contractId = jobId ?? legacyId;
  const [params] = useSearchParams();
  const { ledger, mode, close, save } = useNotebook();
  return (
    <EntitySheet
      presentation="page"
      key={contractId ?? `new:${params.get("work")}:${params.get("person")}`}
      kind="contract"
      ledger={ledger}
      mode={mode}
      editId={contractId}
      defaultWorkId={params.get("work") ?? undefined}
      defaultPersonId={params.get("person") ?? undefined}
      onClose={close}
      onSave={save}
    />
  );
}
function PersonRoute() {
  const { personId } = useParams();
  const [params] = useSearchParams();
  const { ledger, mode, close, save } = useNotebook();
  return (
    <EntitySheet
      presentation="page"
      key={personId ?? `new:${params.get("work")}:${params.get("person")}`}
      kind="person"
      ledger={ledger}
      mode={mode}
      editId={personId}
      defaultWorkId={params.get("work") ?? undefined}
      defaultPersonId={params.get("person") ?? undefined}
      onClose={close}
      onSave={save}
    />
  );
}
export function AppShell() {
  const { ledger, state, mode, base, quick, go, close, save } = useNotebook();
  const { t, formatDigits } = useLanguageContext();
  const [params] = useSearchParams();
  const location = useLocation();
  const entryPage = isEntryPage(location.pathname);
  const formOpen =
    entryPage ||
    ["_add", "_entity", "_entry", "_quick"].some((key) => params.has(key));
  const updateBlocked =
    formOpen ||
    /\/settings\/(?:account\/password|assistants)\/?$/.test(location.pathname);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname]);
  const nav = [
    { to: "/", label: "এক নজরে", icon: HouseLineIcon },
    { to: "/works", label: "কাজের খাতা", icon: BookBookmarkIcon },
    { to: "/ledger", label: "আগের হিসাব", icon: ClockCounterClockwiseIcon },
    { to: "/people", label: "ব্যক্তি ও দোকান", icon: UsersIcon },
    { to: "/reports", label: "রিপোর্ট", icon: ChartDonutIcon },
  ];
  const rawKind = params.get("_add");
  const addKind =
    rawKind &&
    ["expense", "payment", "return", "refund", "wage"].includes(rawKind)
      ? (rawKind as AddOptions["kind"])
      : undefined;
  const editId = params.get("_edit") ?? undefined;
  const rawEntity = params.get("_entity");
  const entity =
    rawEntity && ["work", "person", "contract"].includes(rawEntity)
      ? (rawEntity as "work" | "person" | "contract")
      : null;
  const options = {
    kind: addKind,
    workId: params.get("_work") ?? undefined,
    personId: params.get("_person") ?? undefined,
    account: AccountSchema.safeParse(params.get("_account")).data,
    costType: CostTypeSchema.safeParse(params.get("_type")).data,
    purpose: ["settle", "advance", "wage"].includes(
      params.get("_purpose") ?? "",
    )
      ? (params.get("_purpose") as AddOptions["purpose"])
      : undefined,
  };
  return (
    <div
      className={`app-frame ${entryPage || addKind || entity === "contract" || entity === "person" ? "is-entry-page" : ""}`}
    >
      <aside className="app-sidebar">
        <button className="brand-lockup" onClick={() => go("/")}>
          <span className="brand-symbol">
            <BookOpenIcon size={28} weight="duotone" />
          </span>
          <span>
            {t("বাড়ির খাতা")}
            <small>{t("নিজের হিসাব, নিজের মতো")}</small>
          </span>
        </button>
        <p className="sidebar-caption">{t("আমার হিসাব")}</p>
        <nav>
          {nav.map((item) => (
            <NotebookNavLink key={item.to} {...item} base={base} />
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="private-notebook">
            <span className="privacy-dot" />
            <span>
              {t(mode === "demo" ? "নমুনার খাতা" : "ব্যক্তিগত খাতা")}
              <small>{formatDigits(ledger.project.name)}</small>
            </span>
          </div>
          <NotebookNavLink
            to="/settings"
            base={base}
            label="সেটিংস"
            icon={GearSixIcon}
            size={22}
          />
        </div>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <button className="mobile-brand" onClick={() => go("/")}>
            <BookOpenIcon size={25} weight="duotone" />
            {t("বাড়ির খাতা")}
          </button>
          <div className="project-title">
            <span className="privacy-dot" />
            {formatDigits(ledger.project.name)}
          </div>
          <div className="topbar-actions">
            <button
              className={`sync-indicator ${state.syncError || state.conflict ? "needs-attention" : ""}`}
              onClick={() => go("/settings")}
              title={t("সংরক্ষণের অবস্থা")}
            >
              {state.syncError ? (
                <CloudSlashIcon size={20} />
              ) : (
                <CloudCheckIcon size={20} />
              )}
              <span>
                {t(
                  state.conflict
                    ? "সিঙ্ক যাচাই করুন"
                    : state.syncing
                      ? "মিলিয়ে নিচ্ছি…"
                      : state.pending
                        ? "ফোনে রাখা আছে"
                        : "সংরক্ষিত",
                )}
              </span>
            </button>
            <button
              className={`icon-button settings-link ${notebookSectionActive(location.pathname, base, "/settings") ? "active" : ""}`}
              aria-current={
                notebookSectionActive(location.pathname, base, "/settings")
                  ? "page"
                  : undefined
              }
              onClick={() => go("/settings")}
              aria-label={t("সেটিংস")}
            >
              <GearSixIcon
                size={24}
                weight={
                  notebookSectionActive(location.pathname, base, "/settings")
                    ? "fill"
                    : "regular"
                }
              />
            </button>
          </div>
        </header>
        <main className="app-content">
          {mode === "demo" ? (
            <div className="demo-notice">
              <span>{t("নমুনা খাতা · নিজের হিসাব আলাদা")}</span>
              <button onClick={() => window.location.assign("/login")}>
                {t("নিজের খাতা খুলুন")}
              </button>
            </div>
          ) : null}
          <Suspense
            fallback={
              <div className="route-loading" role="status">
                {t("পাতা খুলছে…")}
              </div>
            }
          >
            {entity === "person" ? (
              <Navigate
                replace
                to={personUrl(
                  base,
                  editId,
                  options.workId,
                  options.personId,
                  entryPage
                    ? (params.get("back") ?? `${base}/people`)
                    : `${location.pathname}${location.search}`,
                )}
              />
            ) : addKind && !entryPage ? (
              <Navigate
                replace
                to={entryUrl(
                  base,
                  { ...options, editId },
                  `${location.pathname}${location.search}`,
                )}
              />
            ) : entity === "contract" && !entryPage ? (
              <Navigate
                replace
                to={contractUrl(
                  base,
                  editId,
                  options.workId,
                  options.personId,
                  `${location.pathname}${location.search}`,
                )}
              />
            ) : (
              <Routes>
                <Route path="entries/new" element={<EntryRoute />} />
                <Route path="entries/:entryId/edit" element={<EntryRoute />} />
                <Route path="jobs/new" element={<ContractRoute />} />
                <Route path="jobs/:jobId/edit" element={<ContractRoute />} />
                <Route path="jobs/:jobId" element={<JobPage />} />
                <Route path="jobs" element={<JobsPage />} />
                <Route path="contracts/new" element={<ContractRoute />} />
                <Route
                  path="contracts/:contractId/edit"
                  element={<ContractRoute />}
                />
                <Route index element={<HomePage />} />
                <Route path="dues" element={<PayablesPage />} />
                <Route path="works" element={<WorksPage />} />
                <Route path="works/:workId" element={<WorkPage />} />
                <Route path="ledger" element={<LedgerPage />} />
                <Route path="timeline" element={<TimelinePage />} />
                <Route path="people" element={<PeoplePage />} />
                <Route path="people/new" element={<PersonRoute />} />
                <Route path="people/:personId/edit" element={<PersonRoute />} />
                <Route path="people/:personId" element={<PersonPage />} />
                <Route path="reports" element={<Reports />} />
                <Route path="materials/:groupId" element={<Reports />} />
                <Route path="review" element={<ReviewPage />} />
                <Route
                  path="reconcile"
                  element={<Navigate replace to={`${base}/people`} />}
                />
                <Route path="settings" element={<SettingsPage />} />
                <Route
                  path="settings/assistants"
                  element={<AssistantSettingsPage />}
                />
                <Route path="settings/account" element={<AccountPage />} />
                <Route
                  path="settings/account/password"
                  element={<AccountPasswordPage />}
                />
                <Route path="settings/removed" element={<RemovedItemsPage />} />
                <Route
                  path="*"
                  element={
                    <div className="empty-panel">
                      <h2>{t("এই পাতা পাওয়া যায়নি")}</h2>
                      <button
                        className="primary-button"
                        onClick={() => go("/")}
                      >
                        {t("খাতায় ফিরুন")}
                      </button>
                    </div>
                  }
                />
              </Routes>
            )}
          </Suspense>
        </main>
      </div>
      <nav className="mobile-bottom-nav" aria-label={t("প্রধান মেনু")}>
        {[nav[0], nav[1]].map((item) => (
          <NotebookNavLink
            key={item.to}
            {...item}
            label={item.to === "/works" ? "খাতা" : item.label}
            base={base}
          />
        ))}
        <button
          className="mobile-add"
          onClick={quick}
          aria-label={t("হিসাব লিখি")}
        >
          <span className="mobile-add-icon">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeLinecap="round"
              />
            </svg>
          </span>
        </button>
        {[nav[2], nav[3]].map((item) => (
          <NotebookNavLink
            key={item.to}
            {...item}
            label={item.to === "/ledger" ? "ইতিহাস" : "মানুষ"}
            base={base}
          />
        ))}
      </nav>
      <PwaUpdateNotice blocked={updateBlocked} floating />
      {entity !== "person" && params.get("_quick") === "1" ? (
        <QuickActionsSheet />
      ) : null}
      <Suspense fallback={null}>
        {entity === "work" ? (
          <EntitySheet
            key={`${entity}:${editId}`}
            kind={entity}
            ledger={ledger}
            mode={mode}
            editId={editId}
            defaultWorkId={options.workId}
            defaultPersonId={options.personId}
            onClose={close}
            onSave={save}
          />
        ) : null}
        {entity !== "person" && params.get("_entry") ? (
          <EntryDetail key={params.get("_entry")} id={params.get("_entry")!} />
        ) : null}
      </Suspense>
    </div>
  );
}
