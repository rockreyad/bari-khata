import {
  validateSharedPage,
  type SharedKind,
  type SharedStatement,
} from "./shareModel";
import type { StatementFormat } from "../people/statement";

export const SHARED_EXPORT_MAX_CHARACTERS = 8 * 1024 * 1024;
export const SHARED_EXPORT_MAX_ROWS = 2000;

export type ShareReader = (
  token: string,
  offset?: number,
  revision?: number,
  kind?: SharedKind,
  options?: { signal?: AbortSignal },
) => Promise<SharedStatement | null>;
export async function completeSharedStatement(
  token: string,
  read: ShareReader,
  cancelled: () => boolean = () => false,
  options?: { signal?: AbortSignal },
): Promise<SharedStatement> {
  const stopped = () => cancelled() || Boolean(options?.signal?.aborted);
  async function readPage(offset?: number, revision?: number) {
    if (stopped()) throw new Error("share_cancelled");
    try {
      const page = options?.signal
        ? await read(token, offset ?? 0, revision, undefined, options)
        : offset === undefined
          ? await read(token)
          : await read(token, offset, revision);
      if (stopped()) throw new Error("share_cancelled");
      return page;
    } catch (cause) {
      if (stopped()) throw new Error("share_cancelled");
      throw cause;
    }
  }
  const first = await readPage();
  if (!first) throw new Error("share_unavailable");
  validateSharedPage(first, 0);
  if (first.total > SHARED_EXPORT_MAX_ROWS)
    throw new Error("share_export_too_large");
  const rows: SharedStatement["rows"] = [];
  const keys = new Set<string>();
  let characters = 0;
  function appendRows(pageRows: SharedStatement["rows"]) {
    for (const row of pageRows) {
      if (keys.has(row.key)) throw new Error("share_invalid_page");
      const size = row.key.length + row.description.length + row.works.length;
      if (size > SHARED_EXPORT_MAX_CHARACTERS - characters)
        throw new Error("share_export_too_large");
      characters += size;
      keys.add(row.key);
      rows.push(row);
    }
  }
  appendRows(first.rows);
  let offset = first.nextOffset;
  let previous = 0;
  while (offset !== null) {
    if (offset <= previous || offset > first.total || rows.length > first.total)
      throw new Error("share_invalid_page");
    const page = await readPage(offset, first.revision);
    if (!page) throw new Error("share_unavailable");
    validateSharedPage(page, offset, first.revision);
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
    appendRows(page.rows);
    previous = offset;
    offset = page.nextOffset;
  }
  if (rows.length !== first.total || keys.size !== rows.length)
    throw new Error("share_invalid_page");
  return { ...first, rows, nextOffset: null };
}
const recipientBasis = {
  paid: "মোট পাওয়া",
  cost: "বিলের মোট",
  balance: "বাকি",
};
export function sharedStatementCsv(
  statement: SharedStatement,
  { t, money, date }: StatementFormat,
  formatDigits: (text: string) => string = (value) => value,
) {
  const isShop = statement.account === "materials";
  const correctionBasis = {
    ...recipientBasis,
    paid: isShop ? "পরিশোধ" : recipientBasis.paid,
  };
  const safeCell = (value: string) =>
    `"${(/^[\s]*[=+\-@]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
  const row = (...values: string[]) => values.map(safeCell).join(",");
  const kinds = {
    expense: isShop
      ? "বিল"
      : statement.account === "labour"
        ? "কাজের বিল"
        : "খরচের বিল",
    payment: isShop ? "পরিশোধ" : "টাকা পেয়েছেন",
    expense_credit: "মাল ফেরত",
    refund: isShop ? "টাকা ফেরত" : "ফেরত দিয়েছেন",
    adjustment: "হিসাবের সমন্বয়",
  };
  const adjustments = statement.rows.some((row) => row.kind === "adjustment");
  const lines = [
    row(t("নাম"), formatDigits(statement.person.name)),
    row(t("খাতা"), formatDigits(statement.projectName)),
    ...(statement.workName
      ? [row(t("কাজের খাতা"), formatDigits(statement.workName))]
      : []),
    row(
      t(isShop ? "মোট বিল" : kinds.expense),
      money(statement.totals.reconciledCost ?? statement.totals.cost),
    ),
    row(
      t(isShop ? "পরিশোধ" : "মোট পেয়েছেন"),
      money(statement.totals.reconciledNetPaid ?? statement.totals.paid),
    ),
    row(
      t(isShop ? "বাকি" : "আর পাবেন"),
      money(statement.totals.reconciledPayable ?? statement.totals.payable),
    ),
    row(
      t(isShop ? "ক্রেতা পাবেন" : "আপনার কাছে জমা"),
      money(statement.totals.reconciledAdvance ?? statement.totals.advance),
    ),
    ...(["paid", "cost", "balance"] as const).flatMap((basis) => {
      const correction = statement.totals[`${basis}Correction`] ?? 0;
      return correction
        ? [
            row(
              `${t("সমন্বয়")} · ${t(correctionBasis[basis])}`,
              money(correction),
            ),
          ]
        : [];
    }),
    ...statement.contracts.flatMap((contract) => [
      row(t("চুক্তি"), formatDigits(contract.title || contract.workName)),
      row(t("চুক্তির মোট"), money(contract.total)),
      row(t(isShop ? "পরিশোধ" : "পেয়েছেন"), money(contract.netPaid)),
      row(t("চুক্তির বাকি"), money(contract.remaining)),
    ]),
    "",
    row(
      t("তারিখ"),
      t("লেনদেন"),
      t("কাজের খাতা"),
      t("বিবরণ"),
      t(isShop ? "বিল" : "বিল / ফেরত"),
      t(isShop ? "পরিশোধ" : "টাকা পেয়েছেন"),
      ...(adjustments ? [t("সমন্বয়")] : []),
      t("পুরোনো তথ্য"),
    ),
    ...statement.rows.map((entry) =>
      row(
        date(entry.date),
        entry.kind === "adjustment" && entry.adjustmentBasis
          ? `${t(kinds.adjustment)} · ${t(correctionBasis[entry.adjustmentBasis])}`
          : t(kinds[entry.kind]),
        formatDigits(entry.works),
        formatDigits(entry.description),
        money(entry.charge),
        money(entry.paid),
        ...(adjustments ? [money(entry.adjustment ?? 0)] : []),
        entry.historical ? t("পুরোনো তথ্য; বর্তমান হিসাবে ধরা হয়নি") : "",
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
