import { lazy, Suspense, useEffect } from "react";
import { Route, Routes, useLocation, useSearchParams } from "react-router";
import {
  BookOpenIcon,
  ChartBarIcon,
  CloudCheckIcon,
  CloudSlashIcon,
  GearSixIcon,
  HouseLineIcon,
  NotebookIcon,
  PlusIcon,
  RowsIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { NotebookNavLink, notebookSectionActive } from "./navigation";
import { useNotebook, type AddOptions } from "./NotebookProvider";
import { useLanguageContext } from "../context/LanguageProvider";
import { HomePage } from "../features/home/HomePage";
import { WorksPage, WorkPage } from "../features/works/WorksPages";
import { LedgerPage } from "../features/ledger/LedgerPage";

import { AccountSchema, CostTypeSchema } from "../domain/model";
import { QuickActionsSheet } from "../features/entries/QuickActionsSheet";
import { usePwa } from "../lib/usePwa";
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
const SettingsPage = lazy(() =>
  import("../features/settings/SettingsPage").then((m) => ({
    default: m.SettingsPage,
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
export function AppShell() {
  const { ledger, state, mode, base, quick, go, close, save } = useNotebook();
  const { t, formatDigits } = useLanguageContext();
  const [params] = useSearchParams();
  const location = useLocation();
  const pwa = usePwa();
  const formOpen = ["_add", "_entity", "_entry", "_quick"].some((key) =>
    params.has(key),
  );
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname]);
  const nav = [
    { to: "/", label: "এক নজরে", icon: HouseLineIcon },
    { to: "/works", label: "কাজের খাতা", icon: NotebookIcon },
    { to: "/ledger", label: "আগের হিসাব", icon: RowsIcon },
    { to: "/people", label: "ব্যক্তি ও দোকান", icon: UsersThreeIcon },
    { to: "/reports", label: "রিপোর্ট", icon: ChartBarIcon },
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
  };
  return (
    <div className="app-frame">
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
            <Routes>
              <Route index element={<HomePage />} />
              <Route path="works" element={<WorksPage />} />
              <Route path="works/:workId" element={<WorkPage />} />
              <Route path="ledger" element={<LedgerPage />} />
              <Route path="people" element={<PeoplePage />} />
              <Route path="people/:personId" element={<PersonPage />} />
              <Route path="reports" element={<Reports />} />
              <Route path="materials/:groupId" element={<Reports />} />
              <Route path="review" element={<ReviewPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route
                path="*"
                element={
                  <div className="empty-panel">
                    <h2>{t("এই পাতা পাওয়া যায়নি")}</h2>
                    <button className="primary-button" onClick={() => go("/")}>
                      {t("খাতায় ফিরুন")}
                    </button>
                  </div>
                }
              />
            </Routes>
          </Suspense>
        </main>
      </div>
      <nav className="mobile-bottom-nav" aria-label={t("প্রধান মেনু")}>
        {[nav[0], nav[1]].map((item) => (
          <NotebookNavLink key={item.to} {...item} base={base} />
        ))}
        <button
          className="mobile-add"
          onClick={quick}
          aria-label={t("হিসাব লিখি")}
        >
          <PlusIcon size={27} weight="bold" />
        </button>
        {[nav[2], nav[3]].map((item) => (
          <NotebookNavLink key={item.to} {...item} base={base} />
        ))}
      </nav>
      {pwa.needRefresh[0] && !formOpen ? (
        <div className="update-banner">
          <span>
            {t("নতুন সংস্করণ এসেছে। অসমাপ্ত লেখা সংরক্ষণ করে আপডেট করুন।")}
          </span>
          <button onClick={() => void pwa.updateServiceWorker()}>
            {t("আপডেট")}
          </button>
        </div>
      ) : null}
      {params.get("_quick") === "1" ? <QuickActionsSheet /> : null}
      <Suspense fallback={null}>
        {addKind ? (
          editId ? (
            <EntrySheet
              key={editId}
              ledger={ledger}
              mode={mode}
              editEntryId={editId}
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
              key={`${addKind}:${options.workId}:${options.personId}:${options.costType}:${options.account}`}
              options={options}
            />
          )
        ) : null}
        {entity ? (
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
        {params.get("_entry") ? (
          <EntryDetail key={params.get("_entry")} id={params.get("_entry")!} />
        ) : null}
      </Suspense>
    </div>
  );
}
