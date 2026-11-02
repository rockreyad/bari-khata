import type { Ledger } from "../../domain/model";
import type { CashRow } from "../../domain/cashSummary";
import { poishaDecimal } from "../../domain/money";

export function cashReportCsv(
  ledger: Ledger,
  rows: CashRow[],
  t: (text: string) => string,
) {
  const people = new Map(
    ledger.people.map((person) => [person.id, person.name]),
  );
  const works = new Map(ledger.works.map((work) => [work.id, work.name]));
  const safe = (text: string, numeric = false) =>
    `"${(!numeric && /^[\s]*[=+@\-\t\r]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`;
  const values = [
    ["তারিখ", "ব্যক্তি", "কাজ", "ধরন", "টাকা"].map((label) => t(label)),
    ...rows.map((row) => [
      row.entry.date ?? "",
      people.get(row.entry.personId ?? "") ?? t("নাম দেওয়া নেই"),
      works.get(row.workId) ?? "",
      t(row.entry.kind === "refund" ? "টাকা ফেরত পেয়েছি" : "টাকা দিয়েছি"),
      poishaDecimal(row.amount),
    ]),
  ];
  return `\uFEFF${values.map((row, index) => row.map((value, column) => safe(value, index > 0 && column === 4)).join(",")).join("\r\n")}`;
}
