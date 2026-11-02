import { useMemo, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowCounterClockwiseIcon,
  ArchiveBoxIcon,
} from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import {
  setEntityRemoved,
  type RemovableKind,
} from "../../domain/entityDeletion";
import "./removed-items.css";

export function RemovedItemsPage() {
  const { ledger, save, go } = useNotebook();
  const { t, formatDigits, date } = useLanguageContext();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const rows = useMemo(
    () =>
      [
        ...ledger.works.map((entity) => ({
          kind: "work" as const,
          entity,
          name: entity.name,
        })),
        ...ledger.people.map((entity) => ({
          kind: "person" as const,
          entity,
          name: entity.name,
        })),
        ...ledger.contracts.map((entity) => ({
          kind: "contract" as const,
          entity,
          name: entity.title || t("কাজ"),
        })),
      ]
        .filter((row) => row.entity.archivedAt)
        .sort((a, b) =>
          b.entity.archivedAt!.localeCompare(a.entity.archivedAt!),
        ),
    [ledger, t],
  );
  async function restore(kind: RemovableKind, id: string) {
    if (busy) return;
    setBusy(`${kind}:${id}`);
    setError("");
    try {
      await save((current) => setEntityRemoved(current, kind, id, false));
    } catch {
      setError(t("ফিরিয়ে আনা যায়নি। আবার চেষ্টা করুন।"));
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="removed-items-page page-flow">
      <button className="back-link" onClick={() => go("/settings")}>
        <ArrowLeftIcon size={18} />
        {t("সেটিংস")}
      </button>
      <header className="page-heading">
        <div>
          <h1>{t("সরানো খাতা ও নাম")}</h1>
          <p>{t("চাইলে আবার তালিকায় রাখতে পারেন।")}</p>
        </div>
      </header>
      {error ? (
        <p className="removed-items-error" role="alert">
          {error}
        </p>
      ) : null}
      {rows.length ? (
        <section className="removed-items-list" aria-label={t("সরানো তালিকা")}>
          {rows.map(({ kind, entity, name }) => (
            <article key={`${kind}:${entity.id}`} className="removed-item">
              <div>
                <strong>{formatDigits(name)}</strong>
                <small>
                  {t(
                    kind === "work"
                      ? "কাজের খাতা"
                      : kind === "person"
                        ? "মানুষ ও দোকান"
                        : "মিস্ত্রির কাজ",
                  )}{" "}
                  · {date(entity.archivedAt!.slice(0, 10), { year: "numeric" })}
                </small>
              </div>
              <button
                type="button"
                disabled={Boolean(busy)}
                aria-label={t("{{name}} ফিরিয়ে আনুন", {
                  name: formatDigits(name),
                })}
                onClick={() => void restore(kind, entity.id)}
              >
                <ArrowCounterClockwiseIcon size={19} />
                {t("ফিরিয়ে আনুন")}
              </button>
            </article>
          ))}
        </section>
      ) : (
        <section className="removed-items-empty">
          <ArchiveBoxIcon size={35} weight="duotone" />
          <h2>{t("সরানো কিছু নেই")}</h2>
        </section>
      )}
    </div>
  );
}
