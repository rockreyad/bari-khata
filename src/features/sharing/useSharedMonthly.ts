import { useCallback, useEffect, useRef, useState } from "react";
import { ZodError } from "zod";
import { readShare } from "./shareClient";
import type { SharedStatement } from "./shareModel";
import {
  readSharedMonthly,
  sharedMonthlyScope,
  type SharedMonthlyData,
} from "./sharedMonthly";

export type SharedMonthlyError =
  | ""
  | "share_request_failed"
  | "share_changed"
  | "share_unavailable"
  | "share_invalid_page"
  | "share_monthly_too_large";
type State = {
  key: string;
  data: SharedMonthlyData | null;
  busy: boolean;
  error: SharedMonthlyError;
};

export function useSharedMonthly(
  token: string,
  statement: SharedStatement | null,
  enabled = true,
) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({
    key: "",
    data: null,
    busy: false,
    error: "",
  });
  const scope =
    enabled && statement && /^[a-f0-9]{64}$/.test(token)
      ? `${token}:${sharedMonthlyScope(statement)}:${attempt}`
      : "";
  const active = useRef({ scope, token, statement });
  active.current = { scope, token, statement };
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    const source = active.current.statement;
    const capability = active.current.token;
    if (!scope || !source) return;
    const controller = new AbortController();
    const current = () =>
      !controller.signal.aborted &&
      active.current.scope === scope &&
      window.location.hash.slice(1) === capability;
    setState({ key: scope, data: null, busy: true, error: "" });
    void readSharedMonthly(capability, source, readShare, {
      signal: controller.signal,
    })
      .then((data) => {
        if (current()) setState({ key: scope, data, busy: false, error: "" });
      })
      .catch((cause) => {
        if (!current()) return;
        const message = cause instanceof Error ? cause.message : "";
        const error: SharedMonthlyError =
          cause instanceof ZodError
            ? "share_invalid_page"
            : message === "share_changed" ||
                message === "share_unavailable" ||
                message === "share_invalid_page" ||
                message === "share_monthly_too_large"
              ? message
              : "share_request_failed";
        setState({ key: scope, data: null, busy: false, error });
      });
    return () => controller.abort();
  }, [scope]);
  return {
    data: scope && state.key === scope ? state.data : null,
    busy: Boolean(scope) && (state.key !== scope || state.busy),
    error:
      scope && state.key === scope ? state.error : ("" as SharedMonthlyError),
    retry,
  };
}
