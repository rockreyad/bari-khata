import {
  ArrowRightIcon,
  ChartDonutIcon,
  ClockCounterClockwiseIcon,
  GearSixIcon,
} from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import "./more.css";

export function MorePage() {
  const { go } = useNotebook();
  const { t } = useLanguageContext();
  const items = [
    {
      path: "/migration",
      title: "পুরোনো হিসাব যাচাই",
      detail: "আগের লেখা অক্ষত রেখে নতুন বাকি বুঝে নিই",
      Icon: ClockCounterClockwiseIcon,
    },
    {
      path: "/history",
      title: "আগের সব হিসাব",
      detail: "তারিখ, নাম বা কাজ দিয়ে খুঁজে দেখুন",
      Icon: ClockCounterClockwiseIcon,
    },
    {
      path: "/reports",
      title: "খরচের রিপোর্ট",
      detail: "মাল, কাজ আর মাস অনুযায়ী হিসাব",
      Icon: ChartDonutIcon,
    },
    {
      path: "/settings",
      title: "খাতার সেটিংস",
      detail: "ব্যাকআপ, ভাষা আর নিজের পছন্দ",
      Icon: GearSixIcon,
    },
  ];
  return (
    <div className="more-page page-flow">
      <header className="page-heading">
        <div>
          <h1>{t("আরও")}</h1>
          <p>{t("পুরোনো লেখা দেখি, খাতার যত্ন নিই।")}</p>
        </div>
      </header>
      <div className="more-links">
        {items.map(({ path, title, detail, Icon }) => (
          <button type="button" key={path} onClick={() => go(path)}>
            <span className="more-link-icon">
              <Icon size={25} weight="duotone" />
            </span>
            <span>
              <strong>{t(title)}</strong>
              <small>{t(detail)}</small>
            </span>
            <ArrowRightIcon size={19} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}
