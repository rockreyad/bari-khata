import {
  contactAccountLedger,
  defaultContactAccount,
  sortContactEntries,
} from "../../domain/contacts";
import { entryWorkAmount, personSummary } from "../../domain/ledger";
import type { Account, Ledger, Person } from "../../domain/model";

export type StatementOptions = {
  account?: Account;
  workId?: string;
  includeNotes?: boolean;
};
export function contactStatement(
  ledger: Ledger,
  person: Person,
  options: StatementOptions = {},
) {
  const account = options.account ?? defaultContactAccount(person);
  const scoped = contactAccountLedger(ledger, person, account);
  const own = personSummary(scoped, person.id, options.workId);
  const workNames = new Map(ledger.works.map((work) => [work.id, work.name]));
  let balance = 0;
  const rows = sortContactEntries(
    own.entries.filter((entry) => !entry.voided),
    true,
  ).map((entry) => {
    const amount = entryWorkAmount(entry, options.workId);
    const historical = entry.balanceImpact === "historical";
    const charge =
      entry.kind === "expense"
        ? amount
        : entry.kind === "expense_credit"
          ? -amount
          : 0;
    const paid =
      entry.kind === "payment" ? amount : entry.kind === "refund" ? -amount : 0;
    if (!historical) balance += charge - paid;
    const parts = (entry.lines.length ? entry.lines : entry.allocations).filter(
      (part) => !options.workId || part.workId === options.workId,
    );
    return {
      date: entry.date,
      kind: entry.kind,
      historical,
      charge,
      paid,
      balance: historical ? null : balance,
      description: entry.lines.length
        ? entry.lines
            .filter((line) => !options.workId || line.workId === options.workId)
            .map((line) => line.label)
            .join(" · ")
        : "",
      works: [...new Set(parts.map((part) => workNames.get(part.workId) ?? ""))]
        .filter(Boolean)
        .join(" · "),
      note: options.includeNotes ? entry.note : "",
    };
  });
  const totals = {
    cost: own.cost,
    paid: own.netPaid,
    payable: own.payable,
    advance: own.advance,
    historicalCost: own.historicalCost,
  };
  return {
    person: { name: person.name, role: person.role },
    projectName: ledger.project.name,
    account,
    workName: options.workId ? (workNames.get(options.workId) ?? "") : "",
    rows,
    totals,
  };
}
export type ContactStatement = ReturnType<typeof contactStatement>;
export type StatementFormat = {
  t: (key: string) => string;
  money: (value: number) => string;
  date: (value: string | null) => string;
};
export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
export function statementHtml(
  statement: ContactStatement,
  { t, money, date }: StatementFormat,
): string {
  const e = escapeHtml;
  const label = {
    materials: "মালের হিসাব",
    labour: "মজুরির হিসাব",
    other: "আনা ও অন্য খরচ",
  };
  const kinds = {
    expense: "বিল",
    payment: "টাকা দিয়েছি",
    expense_credit: "মাল ফেরত",
    refund: "টাকা পেয়েছি",
  };
  const moneyCell = (value: number) => (value ? e(money(value)) : "—");
  return `<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'"><title>${e(statement.person.name)} · ${e(t("হিসাবের কপি"))}</title><style>*{box-sizing:border-box}body{margin:0;background:#f2f5f9;color:#18253b;font-family:-apple-system,BlinkMacSystemFont,'Noto Sans Bengali',sans-serif;line-height:1.7}.page{max-width:980px;margin:32px auto;padding:36px;background:#fff;border:1px solid #e1e7f0;border-radius:20px}h1{font-size:28px;margin:0 0 6px}p{margin:4px 0;color:#617087}.label{font-size:12px;color:#617087}.totals{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:25px 0}.total{padding:14px;border:1px solid #e1e7f0;border-radius:12px}.total strong{display:block;font-size:22px;color:#18253b}.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;font-size:14px}th{text-align:left;color:#617087;font-size:12px;font-weight:500;background:#f7f9fc}td,th{padding:13px 10px;border-bottom:1px solid #e7ebf2;vertical-align:top}.money{text-align:right;white-space:nowrap}small{display:block;color:#78869b;font-size:11px}.note{padding:14px 16px;background:#f7f9fc;border-radius:12px;font-size:12px;margin-top:22px}.footer{font-size:11px;margin-top:25px;color:#78869b}@media(max-width:620px){.page{margin:0;padding:22px 16px;border:0;border-radius:0}.totals{gap:8px}.total{padding:11px}.total strong{font-size:17px}td,th{padding:11px 7px}}@media print{body{background:white}.page{margin:0;padding:12px;border:0;border-radius:0;max-width:none}.table-scroll{overflow:visible}tr{break-inside:avoid}.totals{grid-template-columns:repeat(3,1fr)}thead{display:table-header-group}}</style></head><body><main class="page"><div class="label">${e(statement.projectName)} · ${e(t(label[statement.account]))}</div><h1>${e(statement.person.name)}</h1><p>${e(statement.person.role)}${statement.workName ? ` · ${e(statement.workName)}` : ""}</p><div class="totals"><div class="total"><span class="label">${e(t("টাকা দিয়েছি"))}</span><strong>${e(money(statement.totals.paid))}</strong></div><div class="total"><span class="label">${e(t("দিতে বাকি"))}</span><strong>${e(money(statement.totals.payable))}</strong></div><div class="total"><span class="label">${e(t("আগাম দিয়েছি"))}</span><strong>${e(money(statement.totals.advance))}</strong></div></div><div class="table-scroll"><table><thead><tr><th>${e(t("তারিখ"))}</th><th>${e(t("লেনদেন"))}</th><th class="money">${e(t("বিল / ফেরত"))}</th><th class="money">${e(t("টাকা দেওয়া"))}</th></tr></thead><tbody>${statement.rows.map((row) => `<tr><td>${e(date(row.date))}</td><td>${e(row.description || t(kinds[row.kind]))}<small>${e(row.works)}${row.historical ? ` · ${e(t("পুরোনো তথ্য"))}` : ""}</small>${row.note ? `<small>${e(row.note)}</small>` : ""}</td><td class="money">${row.historical ? `${moneyCell(row.charge || row.paid)}<small>${e(t("পরিশোধ জানা নেই"))}</small>` : moneyCell(row.charge)}</td><td class="money">${row.historical ? "—" : moneyCell(row.paid)}</td></tr>`).join("")}</tbody></table></div>${statement.totals.historicalCost ? `<p class="note">${e(t("পুরোনো খাতার তথ্য আছে। সেখানে পরিশোধ পরিষ্কার নয় বলে বাকি বা অগ্রিম ধরে নেওয়া হয়নি।"))}</p>` : ""}<p class="footer">${e(t("এটি শুধু এই নামের হিসাবের কপি। এখানে কোনো তথ্য বদলানো যায় না।"))}</p></main></body></html>`;
}
export function statementFilename(name: string): string {
  return `${
    name
      .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "")
      .trim()
      .slice(0, 80) || "contact"
  }-statement.html`;
}
