import { useMemo } from "react";
import { CaretRightIcon } from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { useLanguageContext } from "../../context/LanguageProvider";
import { entryWorkIds } from "../../domain/ledger";
import { contractEarnings } from "../../domain/contractObligations";
import { payableBreakdown, type PayableRow } from "../home/payableBreakdown";

export function WorkPayables({ workId }: { workId: string }) {
  const { ledger, go, detail } = useNotebook();
  const { t, money, formatDigits } = useLanguageContext();
  const data = useMemo(() => {
    try {
      const earnings = contractEarnings(ledger);
      return {
        ...payableBreakdown(ledger, { workId }),
        people: new Map(ledger.people.map((person) => [person.id, person])),
        entries: new Map(ledger.entries.map((entry) => [entry.id, entry])),
        completedPeople: new Set(
          ledger.contracts
            .filter(
              (job) =>
                job.scope === "work" &&
                job.workId === workId &&
                earnings.get(job.id)?.fromCompletion,
            )
            .map((job) => job.personId),
        ),
        recordedPeople: new Set(
          ledger.entries
            .filter(
              (entry) =>
                !entry.voided &&
                entry.balanceImpact !== "historical" &&
                entryWorkIds(entry).includes(workId),
            )
            .map((entry) => entry.personId),
        ),
      };
    } catch {
      return null;
    }
  }, [ledger, workId]);
  if (!data) return null;
  const correction = data.workBalanceCorrection ?? 0;
  if (!data.rows.length && !correction) return null;
  const open = (row: PayableRow) => {
    if (row.personId) {
      const params = new URLSearchParams({
        person: row.personId,
        work: workId,
        order: "oldest",
      });
      go(
        data.recordedPeople.has(row.personId) &&
          !data.completedPeople.has(row.personId)
          ? `/ledger?${params}`
          : `/parties/${encodeURIComponent(row.personId)}?${new URLSearchParams({ work: workId, account: "labour" })}`,
      );
    } else if (row.entryId) detail(row.entryId);
  };
  return (
    <section className="work-payables" aria-label={t("কার কাছে কত বাকি")}>
      <h2>{t("কার কাছে কত বাকি")}</h2>
      <ul>
        {data.rows.map((row) => {
          const person = row.personId
            ? data.people.get(row.personId)
            : undefined;
          const entry = row.entryId ? data.entries.get(row.entryId) : undefined;
          const description = !person
            ? entry?.lines
                .filter((line) => line.workId === workId)
                .map((line) => line.label)
                .filter(Boolean)
                .join(" · ") || entry?.note
            : undefined;
          return (
            <li key={row.id}>
              <button type="button" onClick={() => open(row)}>
                <span className="work-payable-name">
                  <strong>
                    {person ? formatDigits(person.name) : t("নাম দেওয়া নেই")}
                  </strong>
                  {description ? (
                    <small>{formatDigits(description)}</small>
                  ) : null}
                  {person?.archivedAt ? <small>{t("মুছে রাখা")}</small> : null}
                </span>
                <strong className="work-payable-amount">
                  {money(row.amount)}
                </strong>
                <CaretRightIcon size={16} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      {correction !== 0 ? (
        <div className="work-payable-correction">
          <span>{t("কারও নামে না থাকা সমন্বয়")}</span>
          <strong>{money(correction)}</strong>
          <p>
            {t(
              "এই সমন্বয় কারও নামে লেখা নেই। মোট বাকিতে ধরা হয়েছে, তবে কারও বাকিতে ভাগ করে দেওয়া হয়নি।",
            )}
          </p>
        </div>
      ) : null}
    </section>
  );
}
