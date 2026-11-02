import { useEffect, useRef, type ReactNode } from "react";
import { ArrowLeftIcon, LockSimpleIcon } from "@phosphor-icons/react";
import { useLanguageContext } from "../context/LanguageProvider";
import "./entry-frame.css";

export type EntryFrameProps = {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  busy?: boolean;
};
export function EntryFrame({
  title,
  subtitle,
  onClose,
  children,
  footer,
  className = "",
  busy = false,
}: EntryFrameProps) {
  const { t } = useLanguageContext();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section className={`entry-page ${className}`} aria-busy={busy}>
      <header className="entry-page-header">
        <div className="entry-page-header-inner">
          <button
            type="button"
            className="entry-back"
            onClick={onClose}
            disabled={busy}
            aria-label={t("ফিরুন")}
          >
            <ArrowLeftIcon size={22} />
          </button>
          <div>
            <h1 ref={heading} tabIndex={-1}>
              {title}
            </h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <span className="entry-private" title={t("ব্যক্তিগত হিসাব")}>
            <LockSimpleIcon size={19} weight="duotone" />
          </span>
        </div>
      </header>
      <div className="entry-page-body">{children}</div>
      {footer ? (
        <footer className="entry-page-footer">
          <div>{footer}</div>
        </footer>
      ) : null}
    </section>
  );
}
