import { useEffect, useRef, useState } from "react";

const allowReload = () => true;

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
    const register = async () => {
      try {
        const worker = await navigator.serviceWorker.register("/sw.js", {
          updateViaCache: "none",
        });
        if (!active) return;
        registration.current = worker;
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
        void worker.update().catch(() => {});
      } catch {
        /* a failed install keeps the current offline copy */
      }
    };
    if (import.meta.env.PROD && "serviceWorker" in navigator) void register();
    return () => {
      active = false;
      mounted.current = false;
      for (const listener of reloadListeners.current)
        navigator.serviceWorker?.removeEventListener(
          "controllerchange",
          listener,
        );
      reloadListeners.current.clear();
    };
  }, []);
  async function updateServiceWorker(reload = true) {
    if (!mounted.current || (reload && !reloadAllowed.current())) return;
    const waiting = registration.current?.waiting;
    if (!waiting) {
      if (reload && needRefresh) window.location.reload();
      return;
    }
    if (reload) {
      const listener = () => {
        reloadListeners.current.delete(listener);
        if (!mounted.current) return;
        if (reloadAllowed.current()) window.location.reload();
        else setNeedRefresh(true);
      };
      reloadListeners.current.add(listener);
      navigator.serviceWorker.addEventListener("controllerchange", listener, {
        once: true,
      });
    }
    waiting.postMessage({ type: "SKIP_WAITING" });
    setNeedRefresh(false);
  }
  return {
    needRefresh: [needRefresh, setNeedRefresh] as const,
    updateServiceWorker,
  };
}
