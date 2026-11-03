import type { SharedStatement } from "./shareModel";
import type { StatementFormat } from "../people/statement";
import { adjustmentBasisLabels } from "../history/adjustmentDisplay";

export type ShareReader = (
  token: string,
  offset?: number,
  revision?: number,
) => Promise<SharedStatement | null>;
export async function completeSharedStatement(
  token: string,
  read: ShareReader,
  cancelled: () => boolean = () => false,
): Promise<SharedStatement> {
  const first = await read(token);
  if (cancelled()) throw new Error("share_cancelled");
  if (!first) throw new Error("share_unavailable");
  const rows = [...first.rows];
  const keys = new Set(rows.map((row) => row.key));
  let offset = first.nextOffset;
  let previous = 0;
  while (offset !== null) {
    if (offset <= previous || offset > first.total || rows.length > first.total)
      throw new Error("share_invalid_page");
    const page = await read(token, offset, first.revision);
    if (cancelled()) throw new Error("share_cancelled");
    if (!page) throw new Error("share_unavailable");
    if (
      page.revision !== first.revision ||
      page.total !== first.total ||
      page.account !== first.account ||
      page.person.name !== first.person.name ||
      page.projectName !== first.projectName ||
      page.workName !== first.workName ||
      JSON.stringify(page.totals) !== JSON.stringify(first.totals)
    )
      throw new Error("share_changed");
    for (const row of page.rows) {
      if (keys.has(row.key)) throw new Error("share_invalid_page");
      keys.add(row.key);
      rows.push(row);
    }
    previous = offset;
    offset = page.nextOffset;
  }
  if (rows.length !== first.total || keys.size !== rows.length)
    throw new Error("share_invalid_page");
  return { ...first, rows, nextOffset: null };
}
const kinds = {
  expense: "বিল",
  payment: "পরিশোধ",
  expense_credit: "মাল ফেরত",
  refund: "টাকা ফেরত",
  adjustment: "সমন্বয়",
};
export function sharedStatementCsv(
  statement: SharedStatement,
  { t, money, date }: StatementFormat,
  formatDigits: (text: string) => string = (value) => value,
) {
  const safeCell = (value: string) =>
    `"${(/^[\s]*[=+\-@]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
  const row = (...values: string[]) => values.map(safeCell).join(",");
  const adjustments = statement.rows.some((row) => row.kind === "adjustment");
  const lines = [
    row(t("নাম"), formatDigits(statement.person.name)),
    row(t("খাতা"), formatDigits(statement.projectName)),
    ...(statement.workName
      ? [row(t("কাজের খাতা"), formatDigits(statement.workName))]
      : []),
    row(
      t(statement.account === "materials" ? "মোট কেনাকাটা" : "কাজের বিল"),
      money(statement.totals.reconciledCost ?? statement.totals.cost),
    ),
    row(
      t("পরিশোধ হয়েছে"),
      money(statement.totals.reconciledNetPaid ?? statement.totals.paid),
    ),
    row(
      t("আর পাবেন"),
      money(statement.totals.reconciledPayable ?? statement.totals.payable),
    ),
    row(
      t("আমার জমা"),
      money(statement.totals.reconciledAdvance ?? statement.totals.advance),
    ),
    ...(["paid", "cost", "balance"] as const).flatMap((basis) => {
      const correction = statement.totals[`${basis}Correction`] ?? 0;
      return correction
        ? [
            row(
              `${t("সমন্বয়")} · ${t(adjustmentBasisLabels[basis])}`,
              money(correction),
            ),
          ]
        : [];
    }),
    ...statement.contracts.flatMap((contract) => [
      row(t("চুক্তি"), formatDigits(contract.title || contract.workName)),
      row(t("চুক্তির মোট"), money(contract.total)),
      row(t("এই চুক্তিতে দিয়েছি"), money(contract.netPaid)),
      row(t("চুক্তির বাকি"), money(contract.remaining)),
    ]),
    "",
    row(
      t("তারিখ"),
      t("লেনদেন"),
      t("কাজের খাতা"),
      t("বিবরণ"),
      t("বিল / ফেরত"),
      t("টাকা দেওয়া"),
      ...(adjustments ? [t("সমন্বয়")] : []),
      t("পুরোনো তথ্য"),
    ),
    ...statement.rows.map((entry) =>
      row(
        date(entry.date),
        entry.kind === "adjustment" && entry.adjustmentBasis
          ? `${t(kinds.adjustment)} · ${t(adjustmentBasisLabels[entry.adjustmentBasis])}`
          : t(kinds[entry.kind]),
        formatDigits(entry.works),
        formatDigits(entry.description),
        money(entry.charge),
        money(entry.paid),
        ...(adjustments ? [money(entry.adjustment ?? 0)] : []),
        entry.historical ? t("পরিশোধ জানা নেই") : "",
      ),
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}
export function sharedExportFilename(name: string) {
  return `${
    name
      .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "")
      .trim()
      .slice(0, 80) || "statement"
  }.csv`;
}
export function downloadSharedCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
