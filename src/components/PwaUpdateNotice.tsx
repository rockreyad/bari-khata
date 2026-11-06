import { ArrowCircleUpIcon, ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useLanguageContext } from "../context/LanguageProvider";
import { usePwa } from "../lib/usePwa";
import { useReleasePolicy } from "../lib/useReleasePolicy";
import { useEffect, useLayoutEffect, useState } from "react";
import "./pwa-update-notice.css";

export function PwaUpdateNotice({
  blocked,
  floating = false,
}: {
  blocked: boolean;
  floating?: boolean;
}) {
  const { t } = useLanguageContext();
  const policy = useReleasePolicy();
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [protectedEditor, setProtectedEditor] = useState(blocked);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const canReload = () =>
    !blocked &&
    (!floating ||
      !document.querySelector(
        'form, [role="dialog"], [role="alertdialog"], [contenteditable="true"]',
      ));
  useLayoutEffect(() => {
    const update = () => setProtectedEditor(!canReload());
    update();
    if (!floating || !policy.required) return;
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["role", "contenteditable"],
    });
    return () => observer.disconnect();
  }, [blocked, floating, policy.required]);
  const pwa = usePwa(canReload);
  if (!policy.required && (blocked || !pwa.needRefresh[0])) return null;
  const needsConnection = !online && !pwa.needRefresh[0];
  return (
    <aside
      className={`pwa-update-notice${floating ? " pwa-update-notice--floating" : ""}${policy.required ? " pwa-update-notice--required" : ""}`}
      role={policy.required ? "alert" : "status"}
    >
      <span className="pwa-update-notice-icon" aria-hidden="true">
        <ArrowCircleUpIcon size={24} weight="duotone" />
      </span>
      <span className="pwa-update-notice-title">
        {t(policy.required ? "চালিয়ে যেতে আপডেট করুন" : "নতুন আপডেট এসেছে")}
        {policy.required ? (
          <small>
            {t(
              protectedEditor
                ? "খোলা লেখা রেখে ফর্মটি বন্ধ করুন। তারপর আপডেট করুন।"
                : needsConnection
                  ? "সংযোগ এলে আপডেট করুন। ফোনের লেখা মুছবেন না।"
                  : "আগের হিসাব দেখা ও কপি নামানো যাবে; নতুন হিসাবের আগে আপডেট দরকার।",
            )}
          </small>
        ) : null}
        {error ? <small>{t(error)}</small> : null}
      </span>
      <button
        type="button"
        disabled={
          busy || (policy.required && (protectedEditor || needsConnection))
        }
        onClick={async () => {
          if (!canReload()) return;
          setBusy(true);
          setError("");
          try {
            const updated = await pwa.updateServiceWorker(
              true,
              policy.required,
            );
            if (updated === false)
              setError("আপডেটটি এখনও নামেনি। সংযোগ দেখে আবার চেষ্টা করুন।");
          } catch {
            setError("লেখা রাখা শেষ হয়নি। আগে সংরক্ষণ করে আবার চেষ্টা করুন।");
          } finally {
            setBusy(false);
          }
        }}
      >
        <ArrowClockwiseIcon size={16} aria-hidden="true" />
        {t("আপডেট করুন")}
      </button>
    </aside>
  );
}
