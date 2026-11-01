import { useEffect, useRef, useState } from "react";

export function usePwa() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
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
    void register();
    return () => {
      active = false;
    };
  }, []);
  async function updateServiceWorker(reload = true) {
    const waiting = registration.current?.waiting;
    if (!waiting) return;
    if (reload)
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => window.location.reload(),
        { once: true },
      );
    waiting.postMessage({ type: "SKIP_WAITING" });
    setNeedRefresh(false);
  }
  return {
    needRefresh: [needRefresh, setNeedRefresh] as const,
    updateServiceWorker,
  };
}
