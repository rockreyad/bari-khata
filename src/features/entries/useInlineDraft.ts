import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import type { z } from "zod";
import { useNotebook } from "../../app/NotebookProvider";
import { getActiveOwner } from "../../data/database";
import { createWorkspaceStorage } from "../../data/repository";

export function useInlineDraft<T>(
  key: string,
  schema: z.ZodType<T>,
  initial: T,
) {
  const { mode } = useNotebook();
  const activeOwner = getActiveOwner();
  const scope = JSON.stringify([mode, activeOwner, key]);
  const storage = useMemo(() => {
    try {
      return createWorkspaceStorage(mode);
    } catch {
      return null;
    }
  }, [mode, activeOwner]);
  const [state, setState] = useState({
    scope,
    value: initial,
    ready: false,
    failed: !storage,
  });
  const current =
    state.scope === scope
      ? state
      : { scope, value: initial, ready: false, failed: !storage };
  const queue = useRef(Promise.resolve());
  const writeFailure = useRef<{ scope: string; error: unknown } | null>(null);
  const latest = useRef(current.value);
  latest.current = current.value;
  useEffect(() => {
    setState({ scope, value: initial, ready: false, failed: !storage });
    if (!storage) return;
    let active = true;
    void storage
      .readDraft(key)
      .then((saved) => {
        if (!active) return;
        setState({
          scope,
          value: saved === null ? initial : schema.parse(saved),
          ready: true,
          failed: false,
        });
      })
      .catch(() => {
        if (active)
          setState({ scope, value: initial, ready: false, failed: true });
      });
    return () => {
      active = false;
    };
  }, [scope, key, storage, schema, initial]);
  const update = (change: SetStateAction<T>) => {
    if (!current.ready || !storage) return;
    const next =
      typeof change === "function"
        ? (change as (current: T) => T)(latest.current)
        : change;
    latest.current = next;
    setState((previous) =>
      previous.scope === scope ? { ...previous, value: next } : previous,
    );
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        if (mode === "real" && getActiveOwner() !== activeOwner)
          throw new Error("account_changed");
        await storage.saveDraft(key, schema.parse(next));
        if (writeFailure.current?.scope === scope) {
          writeFailure.current = null;
          setState((previous) =>
            previous.scope === scope
              ? { ...previous, failed: false }
              : previous,
          );
        }
      })
      .catch((error) => {
        writeFailure.current = { scope, error };
        setState((previous) =>
          previous.scope === scope ? { ...previous, failed: true } : previous,
        );
      });
  };
  const clear = async (next: T) => {
    if (!storage) throw new Error("authentication_required");
    await queue.current;
    if (writeFailure.current?.scope === scope) throw writeFailure.current.error;
    if (mode === "real" && getActiveOwner() !== activeOwner)
      throw new Error("account_changed");
    await storage.removeDraft(key);
    setState((previous) =>
      previous.scope === scope ? { ...previous, value: next } : previous,
    );
  };
  return {
    value: current.value,
    update,
    clear,
    ready: current.ready,
    failed: current.failed,
    flush: async () => {
      await queue.current;
      if (writeFailure.current?.scope === scope)
        throw writeFailure.current.error;
    },
  };
}
