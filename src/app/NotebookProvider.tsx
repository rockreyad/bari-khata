import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useLedger } from "../data/useLedger";
import { getActiveOwner } from "../data/database";
import type { Ledger, Account, CostType } from "../domain/model";
import type { ReceiptInput } from "../data/repository";
import { useLanguageContext } from "../context/LanguageProvider";

export type AddOptions = {
  kind?: "expense" | "payment" | "refund" | "return" | "wage";
  workId?: string;
  personId?: string;
  editId?: string;
  account?: Account;
  costType?: CostType;
};
type NotebookContext = {
  ledger: Ledger;
  state: ReturnType<typeof useLedger>;
  mode: "real" | "demo";
  base: string;
  go: (path: string) => void;
  add: (options?: AddOptions) => void;
  quick: () => void;
  entity: (
    kind: "work" | "person" | "contract",
    id?: string,
    workId?: string,
    personId?: string,
  ) => void;
  detail: (id: string) => void;
  close: () => void;
  save: (
    change: Ledger | ((ledger: Ledger) => Ledger),
    files?: ReceiptInput[],
  ) => Promise<void>;
  notify: (text: string, error?: boolean) => void;
};
const Context = createContext<NotebookContext | null>(null);
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
          "_quick",
        ].forEach((key) => next.delete(key));
        return next;
      },
      { replace: true },
    );
  };
  const value: NotebookContext = {
    ledger,
    state,
    mode,
    base,
    go: (path) => {
      if (currentScope()) navigate(`${base}${path}`);
    },
    close,
    notify,
    quick: () => {
      if (!currentScope()) return;
      setSearch((previous) => {
        const next = new URLSearchParams(previous);
        [
          "_entry",
          "_entity",
          "_edit",
          "_add",
          "_work",
          "_person",
          "_account",
          "_type",
        ].forEach((key) => next.delete(key));
        next.set("_quick", "1");
        return next;
      });
    },
    add: (options) => {
      if (!currentScope()) return;
      setSearch((previous) => {
        const next = new URLSearchParams(previous);
        [
          "_entry",
          "_entity",
          "_edit",
          "_work",
          "_person",
          "_account",
          "_type",
          "_quick",
        ].forEach((key) => next.delete(key));
        next.set("_add", options?.kind ?? "expense");
        if (options?.workId) next.set("_work", options.workId);
        if (options?.personId) next.set("_person", options.personId);
        if (options?.editId) next.set("_edit", options.editId);
        if (options?.account) next.set("_account", options.account);
        if (options?.costType) next.set("_type", options.costType);
        return next;
      });
    },
    entity: (kind, id, workId, personId) => {
      if (!currentScope()) return;
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
    <Context.Provider value={value}>
      {children}
      {toast ? (
        <div
          className={`app-toast ${toast.error ? "is-error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.text}
        </div>
      ) : null}
    </Context.Provider>
  );
}
export function useNotebook() {
  const value = useContext(Context);
  if (!value) throw new Error("NotebookProvider is missing");
  return value;
}
