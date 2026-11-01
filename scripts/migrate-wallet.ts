import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { importWallet } from "../src/domain/importWallet";
import { summarize } from "../src/domain/ledger";

const folder = new URL("../private/migration/", import.meta.url);
const input = JSON.parse(
  await readFile(new URL("source-grid.json", folder), "utf8"),
);
const result = importWallet(input);
const again = importWallet(input, result.ledger);
const summary = summarize(result.ledger);
const baseline = z
  .object({
    sourceChecksums: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
    rowCount: z.number().int().positive(),
    recordedCost: z.number().int(),
    summaryHeadline: z.number().int(),
    summaryComponents: z.number().int(),
    perLedger: z.record(
      z.string(),
      z.object({ count: z.number().int().min(0), amount: z.number().int() }),
    ),
  })
  .parse(
    JSON.parse(
      await readFile(new URL("verification-baseline.json", folder), "utf8"),
    ),
  );
if (
  result.rows.length !== baseline.rowCount ||
  result.report.historicalRecordedCost !== baseline.recordedCost ||
  result.report.summary.headline !== baseline.summaryHeadline ||
  result.report.summary.componentTotal !== baseline.summaryComponents ||
  Object.entries(baseline.sourceChecksums).some(
    ([file, checksum]) => result.report.sourceChecksums[file] !== checksum,
  ) ||
  result.report.perLedger.some(
    (group) =>
      baseline.perLedger[group.block]?.count !== group.count ||
      baseline.perLedger[group.block]?.amount !== group.amount,
  )
)
  throw new Error(
    "Original detail count or total changed; reconcile the sources again",
  );
if (
  result.report.detailSubtotal.amount !==
  result.report.detailSubtotal.calculated
)
  throw new Error("Source detail subtotal does not reconcile");
if (result.report.unmappedMoneyCells.length)
  throw new Error("Unmapped money cells remain in the source detail");
if (
  again.report.importedCount !== 0 ||
  again.ledger.entries.length !== result.ledger.entries.length ||
  JSON.stringify(again.ledger) !== JSON.stringify(result.ledger)
)
  throw new Error("Import is not idempotent");
if (
  summary.cost !== baseline.recordedCost ||
  summary.payable ||
  summary.advance ||
  summary.paid ||
  summary.refunds
)
  throw new Error("Historical costs leaked into current balances");
const ledgerJSON = JSON.stringify(result.ledger, null, 2) + "\n";
const report = {
  ...result.report,
  ledgerChecksum: createHash("sha256").update(ledgerJSON).digest("hex"),
  checks: {
    schemaValid: true,
    detailSubtotalMatches: true,
    allDetailAmountsImported: true,
    idempotent: true,
    historicalBalancesExcluded: true,
  },
};
const money = (amount: number) =>
  `৳${(amount / 100).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
const adjustmentAmount = Math.abs(
  report.adjustments.find((row) => row.cell === "H148")?.amount ?? 0,
);
const markdown = `# পুরোনো খাতার হিসাব মিলিয়ে দেখা\n\nএটি পুরোনো খাতায় লেখা খরচের প্রতিলিপি। কোনটি বিল, কোনটি টাকা দেওয়া, অগ্রিম বা আগের বাকি—সব ঘরে তা আলাদা লেখা নেই। তাই এই আমদানির টাকা বর্তমান পাওনা বা অগ্রিমের হিসাব তৈরি করে না। যাচাইয়ের আগে এগুলো নিশ্চিত বিল বা নিশ্চিত পেমেন্ট নয়।\n\n- আমদানি: ${report.rowCount}টি আলাদা টাকার ঘর, মূল খাতা ও ঘরের নম্বরসহ।\n- লিখে রাখা মোট খরচ: **${money(report.historicalRecordedCost)}**।\n- মূল সারাংশে দেখানো মোট: **${money(report.summary.headline)}**।\n- দুইটির পার্থক্য: **${money(report.summary.detailVsHeadline)}**।\n- ${report.missingDateCount}টি ঘরে নির্ভরযোগ্য নিজস্ব তারিখ নেই; পাশের খাতা থেকে তারিখ নেওয়া হয়নি।\n- ${report.unsplitMixedRows.length}টি মিশ্র বিবরণ ভাগ করা হয়নি। সব ${report.unreviewedCount}টি এন্ট্রিতে যাচাইয়ের চিহ্ন আছে।\n\n| মূল খাতা | এন্ট্রি | লিখে রাখা খরচ |\n|---|---:|---:|\n${report.perLedger.map((group) => `| ${group.name} | ${group.count} | ${money(group.amount)} |`).join("\n")}\n\n## পার্থক্যের উৎস\n\n1. সারাংশের ১৩টি আলাদা খরচ যোগ করলে ${money(report.summary.componentTotal)} হয়। উপরের মোটের চেয়ে ${money(report.summary.componentVsHeadline)} বেশি। এটি E12-তে লেখা বিদ্যুতের কাজের টাকার সমান। HTML-এ আসল সূত্র নেই, তাই কোন সূত্র ভুল ছিল তা নিশ্চিত বলা যায় না।\n2. রডের বিস্তারিত খাতা সারাংশের J10-এর চেয়ে ${money(report.summary.discrepancies[1].amount)} বেশি। শেষের H111 ও H112 মিলে ঠিক এই টাকা। এগুলো বাদ দেওয়া হয়নি।\n3. Others-এর বিস্তারিত থেকে সারাংশের J20-এর কেমিক্যাল বাদ দিলে আরও ${money(report.summary.discrepancies[2].amount)} থাকে। এই খরচগুলোও একবার করে রাখা হয়েছে।\n4. স্পষ্ট কেমিক্যালের বিস্তারিত ${money(report.chemical.detailAmount)}; সারাংশে ${money(report.chemical.summaryAmount)}। শেষের X54-এর ${money(report.chemical.detailAmount - report.chemical.summaryAmount)} এই পার্থক্যের সমান।\n5. বিস্তারিত D111-এর সাবটোটাল ${money(report.detailSubtotal.amount)}; D8:D110-এর আমদানির সঙ্গে হুবহু মিলেছে। অন্য খাতার সারাংশ বা সাবটোটালকে নতুন খরচ হিসেবে যোগ করা হয়নি।\n\nH148-এর ঋণাত্মক ${money(adjustmentAmount)} এবং X53-এর ধনাত্মক ${money(adjustmentAmount)} Adjustment আলাদা মূল ঘর হিসেবে আছে; মোটে দুটির প্রভাব শূন্য। এটিকে অনুমান করে নগদ ফেরত বলা হয়নি।\n\n## যাচাই করতে হবে\n\nমিস্ত্রির ফাঁকা বিবরণ, মিশ্র মাল ও মজুরি, Advance/Due/Baki/Dhar/Pabo, অন্য খাতার উল্লেখ এবং Adjustment-এর আসল অর্থ যাচাই করতে হবে। আলাদা মাল বা ব্র্যান্ডের ঘর না থাকলে পাশের এন্ট্রি দেখে ধরে নেওয়া হয়নি। মিশ্র সিমেন্ট বা বালুর টাকাও অনুমান করে ভাগ করা হয়নি। একই নামের মিস্ত্রির পানির লাইন ও বিদ্যুতের দুই খাতা একজন ব্যক্তির সঙ্গে যুক্ত আছে; মূল খাতার নাম প্রতিটি এন্ট্রিতে রয়ে গেছে।\n\nসব এন্ট্রিতে original note, file, sheet, cell ও SHA-256 checksum আছে। raw-transactions.json-এ তারিখ, পরিমাণ ও বিবরণের আসল ঘরও আছে। পুনরায় চালালে নতুন এন্ট্রি যোগ হয় না এবং ব্যবহারকারীর যাচাই করা এন্ট্রি মুছে লেখা হয় না।\n\nLedger SHA-256: \`${report.ledgerChecksum}\`\n`;
await mkdir(folder, { recursive: true, mode: 0o700 });
await chmod(folder, 0o700);
for (const [name, value] of [
  ["ledger.json", ledgerJSON],
  ["raw-transactions.json", JSON.stringify(result.rows, null, 2) + "\n"],
  ["reconciliation.json", JSON.stringify(report, null, 2) + "\n"],
  ["REPORT.md", markdown],
]) {
  const file = new URL(name, folder);
  await writeFile(file, value, { mode: 0o600 });
  await chmod(file, 0o600);
}
await chmod(new URL("source-grid.json", folder), 0o600);
console.log(
  JSON.stringify({
    entries: report.rowCount,
    recordedBDT: report.historicalRecordedCost / 100,
    summaryHeadlineBDT: report.summary.headline / 100,
    differenceBDT: report.summary.detailVsHeadline / 100,
    checks: report.checks,
  }),
);
