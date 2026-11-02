import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useLanguageContext } from "../context/LanguageProvider";
import { usePwa } from "../lib/usePwa";
import "./pwa-update-notice.css";

export function PwaUpdateNotice({ blocked }: { blocked: boolean }) {
  const { t } = useLanguageContext();
  const pwa = usePwa(() => !blocked);
  if (blocked || !pwa.needRefresh[0]) return null;
  return (
    <aside className="pwa-update-notice" role="status">
      <span>{t("নতুন সংস্করণ প্রস্তুত।")}</span>
      <button
        type="button"
        onClick={() => {
          if (!blocked) void pwa.updateServiceWorker();
        }}
      >
        <ArrowClockwiseIcon size={16} aria-hidden="true" />
        {t("আপডেট")}
      </button>
    </aside>
  );
}
