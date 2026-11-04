import { ArrowCircleUpIcon, ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useLanguageContext } from "../context/LanguageProvider";
import { usePwa } from "../lib/usePwa";
import "./pwa-update-notice.css";

export function PwaUpdateNotice({
  blocked,
  floating = false,
}: {
  blocked: boolean;
  floating?: boolean;
}) {
  const { t } = useLanguageContext();
  const canReload = () =>
    !blocked &&
    (!floating ||
      !document.querySelector(
        'form, [role="dialog"], [role="alertdialog"], [contenteditable="true"]',
      ));
  const pwa = usePwa(canReload);
  if (blocked || !pwa.needRefresh[0]) return null;
  return (
    <aside
      className={`pwa-update-notice${floating ? " pwa-update-notice--floating" : ""}`}
      role="status"
    >
      <span className="pwa-update-notice-icon" aria-hidden="true">
        <ArrowCircleUpIcon size={24} weight="duotone" />
      </span>
      <span className="pwa-update-notice-title">{t("নতুন আপডেট এসেছে")}</span>
      <button
        type="button"
        onClick={() => {
          if (canReload()) void pwa.updateServiceWorker();
        }}
      >
        <ArrowClockwiseIcon size={16} aria-hidden="true" />
        {t("আপডেট করুন")}
      </button>
    </aside>
  );
}
