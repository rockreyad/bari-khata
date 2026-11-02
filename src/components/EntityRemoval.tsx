import { useEffect, useRef, useState } from "react";
import {
  TrashSimpleIcon,
  ArrowCounterClockwiseIcon,
} from "@phosphor-icons/react";
import { useNotebook } from "../app/NotebookProvider";
import { useLanguageContext } from "../context/LanguageProvider";
import {
  removableEntity,
  setEntityRemoved,
  type RemovableKind,
} from "../domain/entityDeletion";
import { ConfirmationDialog } from "./ui/ConfirmationDialog";
import "./entity-removal.css";

export function useEntityRemoval(
  kind: RemovableKind,
  id: string | undefined,
  label?: string,
) {
  const { ledger, save, notify, go } = useNotebook();
  const { t, formatDigits } = useLanguageContext();
  const [confirm, setConfirm] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const entity = id ? removableEntity(ledger, kind, id) : undefined;
  const name = entity ? ("name" in entity ? entity.name : entity.title) : "";
  const displayedName = formatDigits(label || name || t("কাজ"));
  const archived = Boolean(entity?.archivedAt);
  async function change(remove: boolean) {
    if (!id || busy || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await save((current) =>
        setEntityRemoved(current, kind, id, remove, name),
      );
      if (!mounted.current) return;
      setConfirm(false);
      notify(t(remove ? "তালিকা থেকে সরানো হয়েছে" : "আবার তালিকায় রাখা হয়েছে"));
      if (remove)
        go(
          kind === "work" ? "/works" : kind === "person" ? "/people" : "/jobs",
        );
    } catch {
      if (mounted.current) setError(t("কাজটি হয়নি। আবার চেষ্টা করুন।"));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return {
    archived,
    triggerRef,
    menuItem: {
      label: t("মুছুন"),
      danger: true,
      icon: <TrashSimpleIcon size={18} />,
      separatorBefore: true,
      disabled: archived,
      onSelect: () => {
        setError("");
        setConfirm(true);
      },
    },
    notice: archived ? (
      <section className="entity-removed-notice">
        <div>
          <strong>{t("তালিকা থেকে সরানো আছে")}</strong>
          <p>{t("আগের হিসাব এখানে দেখতে পারবেন।")}</p>
          {error ? <p role="alert">{error}</p> : null}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void change(false)}
        >
          <ArrowCounterClockwiseIcon size={18} />
          {t("ফিরিয়ে আনুন")}
        </button>
      </section>
    ) : null,
    dialog:
      confirm && entity ? (
        <ConfirmationDialog
          key={`${kind}:${id}:${name}`}
          title={t("তালিকা থেকে সরাবেন?")}
          description={t("তালিকা থেকে সরবে। আগের হিসাব থাকবে।")}
          typedConfirmation="DELETE"
          returnFocusRef={triggerRef}
          confirmLabel={t("মুছুন")}
          onClose={() => setConfirm(false)}
          onConfirm={() => change(true)}
          busy={busy}
          error={error}
        >
          <p className="confirmation-subject">{displayedName}</p>
        </ConfirmationDialog>
      ) : null,
  };
}
