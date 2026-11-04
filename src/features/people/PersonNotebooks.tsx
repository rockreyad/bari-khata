import { useEffect, useMemo, useRef, useState } from "react";
import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react";
import type { Ledger, Person } from "../../domain/model";
import { personWorks } from "../../domain/personWorkLinks";
import { useLanguageContext } from "../../context/LanguageProvider";
import { Sheet } from "../../components/Sheet";
import "./person-work-links.css";

export function PersonNotebooks({
  ledger,
  person,
  selectedWorkId,
  onSelect,
}: {
  ledger: Ledger;
  person: Person;
  selectedWorkId: string;
  onSelect: (workId: string) => void;
}) {
  const { t, formatDigits } = useLanguageContext();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (open || !restoreFocus.current) return;
    restoreFocus.current = false;
    // Sheet has no connected trigger; restore focus after its focus trap unmounts.
    const timer = window.setTimeout(() => trigger.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);
  const works = useMemo(() => {
    const linked = personWorks(ledger, person);
    const selected = ledger.works.find((work) => work.id === selectedWorkId);
    return selected && !linked.some((work) => work.id === selected.id)
      ? [...linked, selected]
      : linked;
  }, [ledger, person, selectedWorkId]);
  if (!works.length) return null;
  const selected = works.find((work) => work.id === selectedWorkId);
  const label = selected ? formatDigits(selected.name) : t("সব খাতা");
  const close = () => {
    restoreFocus.current = true;
    setOpen(false);
  };
  return (
    <span className="person-notebooks">
      <span aria-hidden="true">·</span>
      <button
        ref={trigger}
        type="button"
        className="person-notebook-trigger"
        aria-label={t("খাতা বেছে দেখুন")}
        aria-description={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen(true)}
      >
        <span className="person-notebook-label">{label}</span>
        <CaretDownIcon size={13} aria-hidden="true" />
      </button>
      {open ? (
        <Sheet
          title={t("খাতা বেছে দেখুন")}
          subtitle={formatDigits(person.name)}
          onClose={close}
        >
          <div className="person-notebook-options">
            {[{ id: "", name: t("সব খাতা") }, ...works].map((work) => (
              <button
                key={work.id}
                type="button"
                className="person-notebook-option"
                aria-pressed={selectedWorkId === work.id}
                autoFocus={selectedWorkId === work.id}
                onClick={() => {
                  if (work.id !== selectedWorkId) onSelect(work.id);
                  close();
                }}
              >
                <span>{formatDigits(work.name)}</span>
                {selectedWorkId === work.id ? (
                  <CheckIcon size={19} weight="bold" aria-hidden="true" />
                ) : null}
              </button>
            ))}
          </div>
        </Sheet>
      ) : null}
    </span>
  );
}
