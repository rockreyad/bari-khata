import { useEffect, useSyncExternalStore } from "react";
import {
  checkReleasePolicy,
  getReleaseState,
  subscribeReleasePolicy,
} from "./releasePolicy";

export function useReleasePolicy() {
  const policy = useSyncExternalStore(
    subscribeReleasePolicy,
    getReleaseState,
    getReleaseState,
  );
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const check = () => {
      if (document.visibilityState === "visible") void checkReleasePolicy();
    };
    check();
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    const timer = window.setInterval(check, 60 * 60 * 1000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  return policy;
}
