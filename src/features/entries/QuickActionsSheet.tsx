import {
  ArrowRightIcon,
  CoinsIcon,
  FolderPlusIcon,
  ReceiptIcon,
  UserPlusIcon,
} from "@phosphor-icons/react";
import { WorkMark } from "../../components/ui/Icons";
import "./entry-shortcuts.css";
import { Sheet } from "../../components/Sheet";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
export function QuickActionsSheet() {
  const { add, entity, close, ledger } = useNotebook();
  const { t } = useLanguageContext();
  const shortcuts = ledger.works.filter((work) => work.quickActions?.length);
  const actionNames = {
    expense: "খরচ লিখি",
    payment: "টাকা দিলাম",
    labour: "মজুরির বিল",
    transport: "আনার খরচ",
  };
  return (
    <Sheet title={t("কী লিখবেন?")} onClose={close}>
      {shortcuts.length ? (
        <section className="entry-work-shortcuts">
          <h3>{t("পছন্দের খাতার বোতাম")}</h3>
          <div className="entry-shortcut-scroll">
            {shortcuts.map((work) => (
              <article key={work.id}>
                <div className="entry-shortcut-title">
                  <WorkMark icon={work.icon} color={work.color} size={20} />
                  <strong>{work.name}</strong>
                </div>
                <div className="entry-shortcut-actions">
                  {work.quickActions!.map((action) => (
                    <button
                      key={action}
                      onClick={() => {
                        const labour =
                          action === "labour" ||
                          (action === "payment" &&
                            work.quickActions!.includes("labour") &&
                            !work.quickActions!.includes("expense") &&
                            !work.quickActions!.includes("transport"));
                        add({
                          kind: action === "payment" ? "payment" : "expense",
                          workId: work.id,
                          account: labour
                            ? "labour"
                            : action === "transport"
                              ? "other"
                              : "materials",
                          costType: labour
                            ? "labour"
                            : action === "transport"
                              ? "transport"
                              : "material",
                        });
                      }}
                    >
                      {t(actionNames[action])}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <div className="quick-launch">
        <button onClick={() => add()}>
          <span className="launch-mark blue">
            <ReceiptIcon size={27} weight="duotone" />
          </span>
          <span>
            <strong>{t("খরচ লিখি")}</strong>
            <small>{t("মাল কেনা, মজুরি বা আনার খরচ")}</small>
          </span>
          <ArrowRightIcon size={20} />
        </button>
        <button onClick={() => add({ kind: "payment" })}>
          <span className="launch-mark pink">
            <CoinsIcon size={28} weight="duotone" />
          </span>
          <span>
            <strong>{t("টাকা দিলাম")}</strong>
            <small>{t("কারও বাকি শোধ বা আগাম টাকা")}</small>
          </span>
          <ArrowRightIcon size={20} />
        </button>
        <div className="launch-secondary">
          <button onClick={() => entity("work")}>
            <FolderPlusIcon size={22} />
            {t("কাজের খাতা খুলব")}
          </button>
          <button onClick={() => entity("person")}>
            <UserPlusIcon size={22} />
            {t("নাম যোগ করব")}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
