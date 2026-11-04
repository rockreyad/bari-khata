import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { useLanguageContext } from "../../context/LanguageProvider";
import { getActiveOwner, type WorkspaceMode } from "../../data/database";
import { createWorkspaceStorage } from "../../data/repository";
import { MAX_PEOPLE_ROLE_TABS, roleKey } from "./peopleRoles";

const preferenceKey = "view:people-role-tabs:v1";
const KeySchema = z
  .string()
  .max(4000)
  .transform(roleKey)
  .pipe(z.string().min(1).max(4000));
const KeysSchema = z
  .array(KeySchema)
  .max(MAX_PEOPLE_ROLE_TABS)
  .refine((keys) => new Set(keys).size === keys.length);
const PreferenceSchema = z
  .object({ version: z.literal(1), keys: KeysSchema })
  .strict();
type Scope = { mode: WorkspaceMode; owner: string | null };
type Failure = "read" | "write" | "invalid" | null;
type State = {
  scope: Scope;
  keys: string[] | null;
  ready: boolean;
  saving: boolean;
  error: Failure;
};
type Session = {
  scope: Scope;
  cancelled: boolean;
  ready: boolean;
  saving: boolean;
  storage: ReturnType<typeof createWorkspaceStorage> | null;
};
const blank = (scope: Scope): State => ({
  scope,
  keys: null,
  ready: false,
  saving: false,
  error: null,
});

export function usePeopleRoleTabs(mode: WorkspaceMode) {
  const { t } = useLanguageContext();
  const owner = mode === "real" ? getActiveOwner() : null;
  const scope = useMemo(() => ({ mode, owner }), [mode, owner]);
  const latestScope = useRef(scope);
  latestScope.current = scope;
  const sessionRef = useRef<Session | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>(() => blank(scope));
  const active = useCallback(
    (session: Session) =>
      !session.cancelled &&
      sessionRef.current === session &&
      latestScope.current === session.scope &&
      (session.scope.mode === "demo" ||
        (session.scope.owner !== null &&
          getActiveOwner() === session.scope.owner)),
    [],
  );

  useEffect(() => {
    const session: Session = {
      scope,
      cancelled: false,
      ready: false,
      saving: false,
      storage: null,
    };
    sessionRef.current = session;
    setState((current) =>
      current.scope === scope
        ? { ...current, ready: false, saving: false, error: null }
        : blank(scope),
    );
    void (async () => {
      try {
        if (!active(session)) return;
        session.storage = createWorkspaceStorage(scope.mode);
        const value = await session.storage.readDraft<unknown>(preferenceKey);
        const keys = value === null ? null : PreferenceSchema.parse(value).keys;
        if (!active(session)) return;
        session.ready = true;
        setState({ scope, keys, ready: true, saving: false, error: null });
      } catch {
        if (!active(session)) return;
        session.ready = true;
        setState((current) => ({
          ...current,
          scope,
          ready: true,
          saving: false,
          error: "read",
        }));
      }
    })();
    return () => {
      session.cancelled = true;
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [scope, attempt, active]);

  const saveKeys = useCallback(
    async (keys: string[]): Promise<boolean> => {
      const session = sessionRef.current;
      if (
        !session ||
        session.scope !== scope ||
        !active(session) ||
        !session.ready ||
        session.saving
      )
        return false;
      const parsed = KeysSchema.safeParse(keys);
      if (!parsed.success) {
        setState((current) => ({ ...current, error: "invalid" }));
        return false;
      }
      session.saving = true;
      setState((current) => ({ ...current, saving: true, error: null }));
      try {
        session.storage ??= createWorkspaceStorage(scope.mode);
        await session.storage.saveDraft(preferenceKey, {
          version: 1,
          keys: parsed.data,
        });
        if (!active(session)) return false;
        setState({
          scope,
          keys: parsed.data,
          ready: true,
          saving: false,
          error: null,
        });
        return true;
      } catch {
        if (active(session))
          setState((current) => ({
            ...current,
            saving: false,
            error: "write",
          }));
        return false;
      } finally {
        session.saving = false;
      }
    },
    [scope, active],
  );

  const retry = useCallback(() => {
    const session = sessionRef.current;
    if (
      !session ||
      session.scope !== scope ||
      !active(session) ||
      session.saving
    )
      return;
    session.cancelled = true;
    setState((current) => ({ ...current, ready: false, error: null }));
    setAttempt((current) => current + 1);
  }, [scope, active]);
  const visible = state.scope === scope ? state : blank(scope);
  const error =
    visible.error === "read"
      ? t(
          "আগের ট্যাবের পছন্দ পড়া যায়নি। আবার চেষ্টা করুন বা নতুন করে বেছে রাখুন।",
        )
      : visible.error === "write"
        ? t("ট্যাবের পছন্দ রাখা যায়নি। আবার চেষ্টা করুন।")
        : visible.error === "invalid"
          ? t("পছন্দের ট্যাবগুলো আবার বেছে নিন।")
          : "";
  return {
    keys: visible.keys,
    ready: visible.ready,
    saving: visible.saving,
    error,
    saveKeys,
    retry,
  };
}
