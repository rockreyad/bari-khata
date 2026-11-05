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
  CloudCheckIcon,
  CloudSlashIcon,
  GearSixIcon,
  HouseLineIcon,
  BookBookmarkIcon,
  ChartDonutIcon,
  ClockCounterClockwiseIcon,
  PlusIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import {
  entryUrl,
  contractUrl,
  personUrl,
  entryReturn,
  isEntryPage,
  sectorUrl,
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
const HouseWritePage = lazy(() =>
  import("../features/write/HouseWritePage").then((module) => ({
    default: module.HouseWritePage,
  })),
);
const HouseWriteChooser = lazy(() =>
  import("../features/write/HouseWritePage").then((module) => ({
    default: module.HouseWriteChooser,
  })),
);
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
const AppearancePage = lazy(() =>
  import("../features/settings/AppearancePage").then((m) => ({
    default: m.AppearancePage,
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
    milestoneId: params.get("milestone") ?? undefined,
    purpose:
      purpose && ["settle", "advance", "wage", "charge"].includes(purpose)
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
      resumeDraftKey={params.get("draftKey") ?? undefined}
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
function SectorRoute() {
  const { workId } = useParams();
  const { ledger, mode, close, save } = useNotebook();
  return (
    <EntitySheet
      presentation="page"
      key={workId ?? "new-sector"}
      kind="work"
      ledger={ledger}
      mode={mode}
      editId={workId}
      onClose={close}
      onSave={save}
    />
  );
}
function LegacyNotebookRoute({ from, to }: { from: string; to: string }) {
  const { base } = useNotebook();
  const location = useLocation();
  const path = base ? location.pathname.slice(base.length) : location.pathname;
  return (
    <Navigate
      replace
      to={`${base}${to}${path.slice(from.length)}${location.search}${location.hash}`}
    />
  );
}
function WorkDetailRoute() {
  const { jobId } = useParams();
  const { ledger, base } = useNotebook();
  const location = useLocation();
  if (
    !ledger.contracts.some((job) => job.id === jobId) &&
    ledger.works.some((sector) => sector.id === jobId)
  )
    return (
      <Navigate
        replace
        to={`${base}/sectors/${encodeURIComponent(jobId!)}${location.search}${location.hash}`}
      />
    );
  return <JobPage />;
}

export function AppShell() {
  const { ledger, state, mode, base, quick, go } = useNotebook();
  const { t, formatDigits } = useLanguageContext();
  const [params] = useSearchParams();
  const location = useLocation();
  const entryPage =
    isEntryPage(location.pathname) ||
    /\/write\/[^/]+\/?$/.test(location.pathname);
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
    { to: "/sectors", label: "সেক্টর", icon: BookBookmarkIcon },
    { to: "/ledger", label: "আগের হিসাব", icon: ClockCounterClockwiseIcon },
    { to: "/parties", label: "পক্ষ", icon: UsersIcon },
    { to: "/works", label: "কাজ", icon: BookBookmarkIcon },
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
    purpose: ["settle", "advance", "wage", "charge"].includes(
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
          <button type="button" className="sidebar-add" onClick={quick}>
            <PlusIcon size={22} weight="bold" aria-hidden="true" />
            {t("হিসাব লিখি")}
          </button>
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
            {entity === "work" ? (
              <Navigate
                replace
                to={sectorUrl(
                  base,
                  editId,
                  entryPage
                    ? (params.get("back") ?? `${base}/sectors`)
                    : `${location.pathname}${location.search}`,
                )}
              />
            ) : entity === "person" ? (
              <Navigate
                replace
                to={personUrl(
                  base,
                  editId,
                  options.workId,
                  options.personId,
                  entryPage
                    ? (params.get("back") ?? `${base}/parties`)
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
                <Route path="write" element={<HouseWriteChooser />} />
                <Route path="write/:action" element={<HouseWritePage />} />
                <Route
                  path="more"
                  element={<Navigate replace to={`${base}/reports`} />}
                />
                <Route
                  path="migration"
                  element={<Navigate replace to={`${base}/`} />}
                />
                <Route path="history" element={<LedgerPage />} />
                <Route path="entries/new" element={<EntryRoute />} />
                <Route path="entries/:entryId/edit" element={<EntryRoute />} />
                <Route path="sectors/new" element={<SectorRoute />} />
                <Route path="sectors/:workId/edit" element={<SectorRoute />} />
                <Route path="sectors" element={<WorksPage />} />
                <Route path="sectors/:workId" element={<WorkPage />} />
                <Route path="works/new" element={<ContractRoute />} />
                <Route path="works/:jobId/edit" element={<ContractRoute />} />
                <Route path="works/:jobId" element={<WorkDetailRoute />} />
                <Route path="works" element={<JobsPage />} />
                <Route path="parties" element={<PeoplePage />} />
                <Route path="parties/new" element={<PersonRoute />} />
                <Route
                  path="parties/:personId/edit"
                  element={<PersonRoute />}
                />
                <Route path="parties/:personId" element={<PersonPage />} />
                <Route
                  path="people/*"
                  element={<LegacyNotebookRoute from="/people" to="/parties" />}
                />
                <Route
                  path="jobs/*"
                  element={<LegacyNotebookRoute from="/jobs" to="/works" />}
                />
                <Route
                  path="contracts/*"
                  element={
                    <LegacyNotebookRoute from="/contracts" to="/works" />
                  }
                />
                <Route index element={<HomePage />} />
                <Route path="dues" element={<PayablesPage />} />
                <Route path="ledger" element={<LedgerPage />} />
                <Route path="timeline" element={<TimelinePage />} />
                <Route path="reports" element={<Reports />} />
                <Route path="materials/:groupId" element={<Reports />} />
                <Route path="review" element={<ReviewPage />} />
                <Route
                  path="reconcile"
                  element={<Navigate replace to={`${base}/parties`} />}
                />
                <Route path="settings" element={<SettingsPage />} />
                <Route
                  path="settings/appearance"
                  element={<AppearancePage />}
                />
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
          <NotebookNavLink key={item.to} {...item} base={base} />
        ))}
        <button
          type="button"
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
            label={item.to === "/ledger" ? "ইতিহাস" : item.label}
            base={base}
          />
        ))}
      </nav>
      <PwaUpdateNotice blocked={updateBlocked} floating />
      {entity !== "person" && params.get("_quick") === "1" ? (
        <QuickActionsSheet />
      ) : null}
      <Suspense fallback={null}>
        {entity !== "person" && params.get("_entry") ? (
          <EntryDetail key={params.get("_entry")} id={params.get("_entry")!} />
        ) : null}
      </Suspense>
    </div>
  );
}
