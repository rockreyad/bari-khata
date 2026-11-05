import { NotebookContext, type NotebookContextValue } from "./NotebookContext";
export { useNotebook } from "./NotebookContext";
export type { AddOptions } from "./NotebookContext";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import {
  entryReturn,
  contractUrl,
  personUrl,
  isEntryPage,
  isPersonFormPage,
} from "./entryRoutes";
import { useLedger } from "../data/useLedger";
import { getActiveOwner } from "../data/database";
import { useLanguageContext } from "../context/LanguageProvider";
import { houseWriteUrl } from "./houseRoutes";

export function NotebookProvider({
  mode,
  children,
}: {
  mode: "real" | "demo";
  children: ReactNode;
}) {
  const state = useLedger(mode);
  const navigate = useNavigate();
  const location = useLocation();
  const [, setSearch] = useSearchParams();
  const { t } = useLanguageContext();
  const mounted = useRef(true);
  const owner = useRef(mode === "real" ? getActiveOwner() : null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const currentScope = () =>
    mounted.current &&
    (mode === "demo"
      ? window.location.pathname.startsWith("/sample")
      : getActiveOwner() === owner.current);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const base = location.pathname.startsWith("/sample") ? "/sample" : "";
  const notify = (text: string, error = false) => {
    if (!currentScope()) return;
    setToast({ text, error });
    window.setTimeout(() => {
      if (currentScope()) setToast(null);
    }, 4000);
  };
  if (state.error)
    return (
      <div className="app-splash">
        <h2>{t("খাতা পড়া যাচ্ছে না")}</h2>
        <p>{t("তথ্য মুছে যায়নি। আবার খুলে দেখুন।")}</p>
        <button
          className="primary-button"
          onClick={() => window.location.reload()}
        >
          {t("আবার চেষ্টা করুন")}
        </button>
      </div>
    );
  if (!state.ledger)
    return (
      <div className="app-splash">
        <div className="loading-orbit" />
        <h2>{t("খাতা খুলছে…")}</h2>
      </div>
    );
  const ledger = state.ledger;
  const close = () => {
    if (!currentScope()) return;
    const currentParams = new URLSearchParams(location.search);
    if (
      isEntryPage(location.pathname) &&
      !["_entity", "_entry", "_quick"].some((key) => currentParams.has(key))
    ) {
      const fallback = isPersonFormPage(location.pathname)
        ? `${base}/people`
        : `${base}/`;
      navigate(entryReturn(currentParams.get("back") ?? fallback, base), {
        replace: true,
      });
      return;
    }
    setSearch(
      (previous) => {
        const next = new URLSearchParams(previous);
        [
          "_add",
          "_work",
          "_person",
          "_entry",
          "_entity",
          "_edit",
          "_account",
          "_type",
          "_purpose",
          "_quick",
        ].forEach((key) => next.delete(key));
        return next;
      },
      { replace: true },
    );
  };
  const value: NotebookContextValue = {
    ledger,
    state,
    mode,
    base,
    go: (path, options) => {
      if (currentScope()) navigate(`${base}${path}`, options);
    },
    close,
    notify,
    quick: () => {
      if (!currentScope()) return;
      navigate(
        `${base}/write?${new URLSearchParams({ back: `${location.pathname}${location.search}` })}`,
      );
    },
    add: (options) => {
      if (!currentScope()) return;
      const previous = isEntryPage(location.pathname)
        ? (new URLSearchParams(location.search).get("back") ?? `${base}/`)
        : `${location.pathname}${location.search}`;
      navigate(houseWriteUrl(base, options, previous));
    },
    entity: (kind, id, workId, personId) => {
      if (!currentScope()) return;
      if (kind === "person") {
        const previous = isEntryPage(location.pathname)
          ? (new URLSearchParams(location.search).get("back") ??
            `${base}/people`)
          : `${location.pathname}${location.search}`;
        navigate(personUrl(base, id, workId, personId, previous));
        return;
      }
      if (kind === "contract") {
        navigate(
          contractUrl(
            base,
            id,
            workId,
            personId,
            `${location.pathname}${location.search}`,
          ),
        );
        return;
      }
      setSearch((previous) => {
        const next = new URLSearchParams(previous);
        [
          "_entry",
          "_add",
          "_edit",
          "_work",
          "_person",
          "_account",
          "_type",
          "_purpose",
          "_quick",
        ].forEach((key) => next.delete(key));
        next.set("_entity", kind);
        if (id) next.set("_edit", id);
        if (workId) next.set("_work", workId);
        if (personId) next.set("_person", personId);
        return next;
      });
    },
    detail: (id) => {
      if (!currentScope()) return;
      setSearch((previous) => {
        const next = new URLSearchParams(previous);
        [
          "_add",
          "_entity",
          "_edit",
          "_work",
          "_person",
          "_account",
          "_type",
          "_purpose",
          "_quick",
        ].forEach((key) => next.delete(key));
        next.set("_entry", id);
        return next;
      });
    },
    save: async (change, files) => {
      if (!currentScope()) throw new Error("account_changed");
      await state.save((current) => {
        if (!currentScope()) throw new Error("account_changed");
        if (typeof change === "function") return change(current);
        if (JSON.stringify(current) !== JSON.stringify(ledger))
          throw new Error(t("অন্য জায়গায় খাতা বদলেছে। লেখা রেখে আবার খুলুন।"));
        return change;
      }, files);
      notify(t("হিসাব রাখা হয়েছে"));
    },
  };
  return (
    <NotebookContext.Provider value={value}>
      {children}
      {toast ? (
        <div
          className={`app-toast ${toast.error ? "is-error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.text}
        </div>
      ) : null}
    </NotebookContext.Provider>
  );
}
