import type { Ledger, Person } from "../../domain/model";
import { personWorks } from "../../domain/personWorkLinks";
import { useLanguageContext } from "../../context/LanguageProvider";
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
  const works = useMemo(() => personWorks(ledger, person), [ledger, person]);
  if (!works.length) return null;
  return (
    <section className="person-notebooks" aria-label={t("এই নামের খাতাগুলো")}>
      <h2>{t("এই নামের খাতাগুলো")}</h2>
      <div>
        <button
          type="button"
          aria-pressed={!selectedWorkId}
          onClick={() => onSelect("")}
        >
          {t("সব খাতা")}
        </button>
        {works.map((work) => (
          <button
            type="button"
            key={work.id}
            aria-pressed={selectedWorkId === work.id}
            onClick={() => onSelect(work.id)}
          >
            {formatDigits(work.name)}
          </button>
        ))}
      </div>
    </section>
  );
}
import { useMemo } from "react";
