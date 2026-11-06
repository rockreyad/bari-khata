import { useEffect, useRef, useState } from "react";
import { waitForLocalWrites } from "./localWriteBarrier";

const allowReload = () => true;

async function waitForInstallation(
  registration: ServiceWorkerRegistration | null,
) {
  const installing = registration?.installing;
  if (!installing) return true;
  if (installing.state === "installed" || installing.state === "activated")
    return true;
  if (installing.state === "redundant") return false;
  return new Promise<boolean>((resolve) => {
    const finish = (ready: boolean) => {
      clearTimeout(timeout);
      installing.removeEventListener("statechange", changed);
      resolve(ready);
    };
    const changed = () => {
      if (installing.state === "installed" || installing.state === "activated")
        finish(true);
      else if (installing.state === "redundant") finish(false);
    };
    const timeout = setTimeout(() => finish(false), 10_000);
    installing.addEventListener("statechange", changed);
    changed();
  });
}

export function usePwa(canReload = allowReload) {
  const [needRefresh, setNeedRefresh] = useState(false);
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  const reloadAllowed = useRef(canReload);
  reloadAllowed.current = canReload;
  const mounted = useRef(true);
  const reloadListeners = useRef(new Set<() => void>());
  useEffect(() => {
    mounted.current = true;
    let active = true;
    let checkTimer: ReturnType<typeof setInterval> | undefined;
    const announceBuild = () => {
      const build = document.querySelector<HTMLMetaElement>(
        'meta[name="bari-build"]',
      )?.content;
      if (build)
        navigator.serviceWorker.controller?.postMessage?.({
          type: "CLIENT_BUILD",
          build,
        });
    };
    const checkForUpdate = () => {
      if (active) void registration.current?.update().catch(() => {});
    };
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") {
        announceBuild();
        checkForUpdate();
      }
    };
    const requestBuild = (event: MessageEvent) => {
      if (event.data?.type === "REQUEST_CLIENT_BUILD") announceBuild();
    };
    const register = async () => {
      try {
        const worker = await navigator.serviceWorker.register("/sw.js", {
          updateViaCache: "none",
        });
        if (!active) return;
        registration.current = worker;
        announceBuild();
        if (worker.waiting) setNeedRefresh(true);
        worker.addEventListener("updatefound", () => {
          const installing = worker.installing;
          installing?.addEventListener("statechange", () => {
            if (
              active &&
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            )
              setNeedRefresh(true);
          });
        });
        checkForUpdate();
      } catch {
        /* a failed install keeps the current offline copy */
      }
    };
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      window.addEventListener("online", checkForUpdate);
      document.addEventListener("visibilitychange", checkWhenVisible);
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        announceBuild,
      );
      navigator.serviceWorker.addEventListener("message", requestBuild);
      checkTimer = setInterval(checkWhenVisible, 60 * 60 * 1000);
      void register();
    }
    return () => {
      active = false;
      mounted.current = false;
      window.removeEventListener("online", checkForUpdate);
      document.removeEventListener("visibilitychange", checkWhenVisible);
      navigator.serviceWorker?.removeEventListener(
        "controllerchange",
        announceBuild,
      );
      navigator.serviceWorker?.removeEventListener("message", requestBuild);
      clearInterval(checkTimer);
      for (const listener of reloadListeners.current)
        navigator.serviceWorker?.removeEventListener(
          "controllerchange",
          listener,
        );
      reloadListeners.current.clear();
    };
  }, []);
  async function updateServiceWorker(reload = true, required = false) {
    if (!mounted.current || (reload && !reloadAllowed.current())) return;
    await waitForLocalWrites();
    if (!mounted.current || (reload && !reloadAllowed.current())) return;
    if (!registration.current?.waiting && !needRefresh) {
      let failed = false;
      await registration.current?.update().catch(() => {
        failed = true;
      });
      if (failed || !(await waitForInstallation(registration.current)))
        return false;
      await waitForLocalWrites();
    }
    if (!mounted.current || (reload && !reloadAllowed.current())) return;
    const waiting = registration.current?.waiting;
    if (!waiting) {
      if (
        reload &&
        (needRefresh || required || !("serviceWorker" in navigator))
      ) {
        window.location.reload();
        return true;
      }
      return false;
    }
    if (reload) {
      const listener = () => {
        reloadListeners.current.delete(listener);
        if (!mounted.current) return;
        if (!reloadAllowed.current()) {
          setNeedRefresh(true);
          return;
        }
        void waitForLocalWrites()
          .then(() => {
            if (!mounted.current) return;
            if (reloadAllowed.current()) window.location.reload();
            else setNeedRefresh(true);
          })
          .catch(() => {
            if (mounted.current) setNeedRefresh(true);
          });
      };
      reloadListeners.current.add(listener);
      navigator.serviceWorker.addEventListener("controllerchange", listener, {
        once: true,
      });
    }
    waiting.postMessage({ type: "SKIP_WAITING" });
    setNeedRefresh(false);
    return true;
  }
  return {
    needRefresh: [needRefresh, setNeedRefresh] as const,
    updateServiceWorker,
  };
}
