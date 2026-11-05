import "./navigation.css";
import type { Icon } from "@phosphor-icons/react";
import { Link, useLocation } from "react-router";
import { useLanguageContext } from "../context/LanguageProvider";

export function notebookSectionActive(
  pathname: string,
  base: string,
  section: string,
) {
  const path =
    (base && (pathname === base || pathname.startsWith(`${base}/`))
      ? pathname.slice(base.length)
      : pathname
    ).replace(/\/+$/, "") || "/";
  if (section === "/") return path === "/" || path === "/dues";
  const aliases =
    section === "/reports"
      ? [section, "/materials", "/more"]
      : section === "/ledger"
        ? [section, "/review", "/history", "/timeline"]
        : section === "/parties"
          ? [section, "/people"]
          : section === "/works"
            ? [section, "/jobs", "/contracts"]
            : [section];
  return aliases.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export function NotebookNavLink({
  to,
  base,
  label,
  icon: Icon,
  size = 24,
}: {
  to: string;
  base: string;
  label: string;
  icon: Icon;
  size?: number;
}) {
  const { pathname } = useLocation();
  const { t } = useLanguageContext();
  const active = notebookSectionActive(pathname, base, to);
  return (
    <Link
      to={`${base}${to}`}
      className={active ? "active" : undefined}
      aria-current={active ? "page" : undefined}
    >
      <Icon
        size={size}
        weight={active ? "duotone" : "regular"}
        aria-hidden="true"
        focusable="false"
      />
      <span>{t(label)}</span>
    </Link>
  );
}
