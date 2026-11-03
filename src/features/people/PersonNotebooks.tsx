import { useMemo } from "react";
import type { Ledger, Person } from "../../domain/model";
import { personWorks } from "../../domain/personWorkLinks";
import { useLanguageContext } from "../../context/LanguageProvider";
import { AppSelect } from "../../components/ui/AppSelect";
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
  const works = useMemo(() => {
    const linked = personWorks(ledger, person);
    const selected = ledger.works.find((work) => work.id === selectedWorkId);
    return selected && !linked.some((work) => work.id === selected.id)
      ? [...linked, selected]
      : linked;
  }, [ledger, person, selectedWorkId]);
  if (!works.length) return null;
  return (
    <div className="person-notebooks">
      <AppSelect
        aria-label={t("খাতা বেছে দেখুন")}
        value={selectedWorkId}
        onChange={(event) => onSelect(event.target.value)}
      >
        <option value="">{t("সব খাতা")}</option>
        {works.map((work) => (
          <option key={work.id} value={work.id}>
            {formatDigits(work.name)}
          </option>
        ))}
      </AppSelect>
    </div>
  );
}
