import { poishaDecimal } from "../domain/money";
import type { CostType, Entry, Ledger } from "../domain/model";
import { entryWorkAmount, entryWorkIds } from "../domain/ledger";
import { adjustmentBasisLabels } from "../features/history/adjustmentDisplay";

export const costNames: Record<CostType, string> = {
  material: "মালামাল",
  labour: "মজুরি",
  transport: "গাড়িভাড়া",
  unload: "মাল নামানো",
  rental: "ভাড়া",
  other: "অন্যান্য",
};
export const accountNames = {
  materials: "মাল কেনার টাকা",
  labour: "মজুরির টাকা",
  other: "অন্য টাকা",
};
export const methodNames = {
  cash: "ক্যাশ",
  bkash: "বিকাশ",
  bank: "ব্যাংক",
  other: "অন্যভাবে",
};
export const statusNames = {
  planned: "এখনও শুরু হয়নি",
  ongoing: "চলছে",
  done: "শেষ",
};

export function todayDhaka(at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join("-");
}
export function entryWorks(ledger: Ledger, entry: Entry) {
  const ids = entryWorkIds(entry);
  return ids
    .map((id) => ledger.works.find((work) => work.id === id))
    .filter(Boolean);
}
export function entryAmount(entry: Entry, workId?: string) {
  if (entry.kind === "adjustment") {
    const amount = entryWorkAmount(entry, workId);
    return amount ? amount * ((entry.adjustment?.delta ?? 0) < 0 ? -1 : 1) : 0;
  }
  return entry.lines.length
    ? entry.lines
        .filter((line) => !workId || line.workId === workId)
        .reduce((sum, line) => sum + line.amount, 0)
    : entry.allocations
        .filter((line) => !workId || line.workId === workId)
        .reduce((sum, line) => sum + line.amount, 0);
}
export function saveFile(
  contents: BlobPart,
  name: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function buildCsv(
  ledger: Ledger,
  entries: Entry[],
  t: (text: string) => string,
  workId?: string,
) {
  const safe = (text: string) =>
    `"${(/^[=+@\-\t\r]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`;
  const rows = [
    ["তারিখ", "ধরন", "কাজ", "ব্যক্তি", "টাকা", "নোট", "বাতিল"].map(t),
  ];
  for (const entry of entries)
    rows.push([
      entry.date ?? "",
      entry.kind === "adjustment"
        ? `${t("সমন্বয়")} · ${entry.adjustment ? t(adjustmentBasisLabels[entry.adjustment.basis]) : ""}`
        : t(
            entry.kind === "payment"
              ? "টাকা দিয়েছি"
              : entry.kind === "refund"
                ? "টাকা ফেরত পেয়েছি"
                : entry.kind === "expense_credit"
                  ? "মাল ফেরত দিয়েছি"
                  : entry.account === "labour"
                    ? "মজুরির হিসাব"
                    : "মাল কিনেছি",
          ),
      entryWorks(ledger, entry)
        .filter((work) => !workId || work!.id === workId)
        .map((work) => work!.name)
        .join(" / "),
      ledger.people.find((person) => person.id === entry.personId)?.name ?? "",
      poishaDecimal(entryAmount(entry, workId)),
      entry.note,
      t(entry.voided ? "হ্যাঁ" : "না"),
    ]);
  return `\uFEFF${rows.map((row) => row.map(safe).join(",")).join("\r\n")}`;
}

export function exportCsv(
  ledger: Ledger,
  entries: Entry[],
  t: (text: string) => string,
  workId?: string,
) {
  saveFile(
    buildCsv(ledger, entries, t, workId),
    `bari-khata-${todayDhaka()}.csv`,
    "text/csv;charset=utf-8",
  );
}
