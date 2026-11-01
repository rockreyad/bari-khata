import { CaretDownIcon } from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import "./load-more.css";

export function LoadMore({
  hasMore,
  onLoadMore,
}: {
  hasMore: boolean;
  onLoadMore: () => void;
}) {
  const { t } = useLanguageContext();
  if (!hasMore) return null;
  return (
    <div className="list-load-more">
      <button type="button" onClick={onLoadMore}>
        {t("আরও দেখুন")}
        <CaretDownIcon size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
