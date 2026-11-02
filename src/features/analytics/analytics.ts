import { latinDigits } from "../../lib/numerals";
import { poishaDecimal } from "../../domain/money";
import type {
  CostType,
  Entry,
  EntryLine,
  Item,
  Ledger,
} from "../../domain/model";

export type AnalyticsFilters = {
  groupId: string;
  itemId: string;
  brand: string;
  usage: string;
  workId: string;
  costType: string;
  personId: string;
  from: string;
  to: string;
  query: string;
  review: "all" | "needs_review" | "confirmed";
  dates: "all" | "known" | "unknown";
};

export const emptyFilters: AnalyticsFilters = {
  groupId: "",
  itemId: "",
  brand: "",
  usage: "",
  workId: "",
  costType: "",
  personId: "",
  from: "",
  to: "",
  query: "",
  review: "all",
  dates: "all",
};

export type CostRow = {
  key: string;
  entry: Entry;
  line: EntryLine;
  amount: number;
  item: Item | null;
  groupId: string;
  groupName: string;
  itemName: string;
  brand: string;
  usage: string;
  workName: string;
  personName: string;
  searchable: string;
};

export type Breakdown = {
  id: string;
  label: string;
  amount: number;
  lines: number;
  entries: number;
};
export type AnalyticsDimension =
  "group" | "item" | "work" | "brand" | "usage" | "costType" | "person";
export const normalizeSearch = (value: string) =>
  latinDigits(value)
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");

export function costRows(ledger: Ledger): CostRow[] {
  const items = new Map(ledger.items.map((item) => [item.id, item]));
  const groups = new Map(
    ledger.materialGroups.map((group) => [group.id, group]),
  );
  const works = new Map(ledger.works.map((work) => [work.id, work]));
  const people = new Map(ledger.people.map((person) => [person.id, person]));
  return ledger.entries.flatMap((entry) => {
    if (
      entry.voided ||
      (entry.kind !== "expense" && entry.kind !== "expense_credit")
    )
      return [];
    const sign = entry.kind === "expense_credit" ? -1 : 1;
    return entry.lines.map((line) => {
      const item = line.itemId ? (items.get(line.itemId) ?? null) : null;
      const groupId = line.materialGroupId || item?.materialGroupId || "";
      const group = groups.get(groupId);
      const workName = works.get(line.workId)?.name ?? "";
      const personName = entry.personId
        ? (people.get(entry.personId)?.name ?? "")
        : "";
      const itemName = item?.name || line.label;
      const usage = line.usage || item?.usage || "";
      const brand = item?.brand || "";
      return {
        key: `${entry.id}:${line.id}`,
        entry,
        line,
        amount: sign * line.amount,
        item,
        groupId,
        groupName: group?.name ?? "",
        itemName,
        brand,
        usage,
        workName,
        personName,
        searchable: normalizeSearch(
          [
            group?.name,
            ...(group?.aliases ?? []),
            itemName,
            ...(item?.aliases ?? []),
            line.label,
            brand,
            usage,
            workName,
            personName,
            entry.note,
            entry.source?.note,
          ]
            .filter(Boolean)
            .join(" "),
        ),
      };
    });
  });
}

export function filterCostRows(
  rows: CostRow[],
  filters: Partial<AnalyticsFilters> = {},
): CostRow[] {
  const f = { ...emptyFilters, ...filters };
  const query = normalizeSearch(f.query);
  return rows.filter(
    (row) =>
      (!f.groupId ||
        (f.groupId === "__unknown__"
          ? !row.groupId
          : row.groupId === f.groupId)) &&
      (!f.itemId ||
        (f.itemId.startsWith("label:")
          ? !row.line.itemId &&
            normalizeSearch(row.itemName) === normalizeSearch(f.itemId.slice(6))
          : row.line.itemId === f.itemId)) &&
      (!f.brand ||
        (f.brand === "__unknown__" ? !row.brand : row.brand === f.brand)) &&
      (!f.usage ||
        (f.usage === "__unknown__" ? !row.usage : row.usage === f.usage)) &&
      (!f.workId || row.line.workId === f.workId) &&
      (!f.costType || row.line.costType === f.costType) &&
      (!f.personId ||
        (f.personId === "__unknown__"
          ? !row.entry.personId
          : row.entry.personId === f.personId)) &&
      (!f.from || Boolean(row.entry.date && row.entry.date >= f.from)) &&
      (!f.to || Boolean(row.entry.date && row.entry.date <= f.to)) &&
      (f.review === "all" || row.entry.reviewStatus === f.review) &&
      (f.dates === "all" ||
        (f.dates === "unknown" ? !row.entry.date : Boolean(row.entry.date))) &&
      (!query ||
        query.split(" ").every((part) => row.searchable.includes(part))),
  );
}

export function summarizeRows(rows: CostRow[]) {
  const byType: Record<CostType, number> = {
    material: 0,
    labour: 0,
    transport: 0,
    unload: 0,
    rental: 0,
    other: 0,
  };
  let purchases = 0,
    returns = 0,
    historical = 0,
    reviewAmount = 0,
    undated = 0;
  const entries = new Set<string>(),
    reviewEntries = new Set<string>(),
    historicalEntries = new Set<string>(),
    undatedEntries = new Set<string>();
  for (const row of rows) {
    byType[row.line.costType] += row.amount;
    entries.add(row.entry.id);
    if (row.amount >= 0) purchases += row.amount;
    else returns -= row.amount;
    if (row.entry.balanceImpact === "historical") {
      historical += row.amount;
      historicalEntries.add(row.entry.id);
    }
    if (row.entry.reviewStatus === "needs_review") {
      reviewAmount += row.amount;
      reviewEntries.add(row.entry.id);
    }
    if (!row.entry.date) {
      undated += row.amount;
      undatedEntries.add(row.entry.id);
    }
  }
  return {
    total: purchases - returns,
    purchases,
    returns,
    byType,
    material: byType.material,
    labour: byType.labour,
    supporting: byType.transport + byType.unload + byType.rental + byType.other,
    entryCount: entries.size,
    lineCount: rows.length,
    historical,
    historicalCount: historicalEntries.size,
    reviewAmount,
    reviewCount: reviewEntries.size,
    undated,
    undatedCount: undatedEntries.size,
  };
}

export function breakdownRows(
  rows: CostRow[],
  dimension: AnalyticsDimension,
): Breakdown[] {
  const map = new Map<
    string,
    { label: string; amount: number; lines: number; entries: Set<string> }
  >();
  for (const row of rows) {
    const values: Record<AnalyticsDimension, [string, string]> = {
      group: [
        row.groupId || "__unknown__",
        row.groupName || "মালের ধরন দেওয়া নেই",
      ],
      item: [
        row.line.itemId || `label:${normalizeSearch(row.itemName)}`,
        row.itemName || "মালের নাম দেওয়া নেই",
      ],
      work: [row.line.workId, row.workName],
      brand: [row.brand || "__unknown__", row.brand || "ব্র্যান্ড দেওয়া নেই"],
      usage: [row.usage || "__unknown__", row.usage || "ব্যবহার লেখা নেই"],
      costType: [row.line.costType, row.line.costType],
      person: [
        row.entry.personId || "__unknown__",
        row.personName || "নাম দেওয়া নেই",
      ],
    };
    const [id, label] = values[dimension];
    const previous = map.get(id) ?? {
      label,
      amount: 0,
      lines: 0,
      entries: new Set<string>(),
    };
    previous.amount += row.amount;
    previous.lines++;
    previous.entries.add(row.entry.id);
    map.set(id, previous);
  }
  return [...map]
    .map(([id, value]) => ({
      id,
      label: value.label,
      amount: value.amount,
      lines: value.lines,
      entries: value.entries.size,
    }))
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
}

export function matchingEntries(rows: CostRow[]) {
  const map = new Map<
    string,
    { entry: Entry; amount: number; lines: CostRow[] }
  >();
  for (const row of rows) {
    const previous = map.get(row.entry.id) ?? {
      entry: row.entry,
      amount: 0,
      lines: [],
    };
    previous.amount += row.amount;
    previous.lines.push(row);
    map.set(row.entry.id, previous);
  }
  return [...map.values()].sort(
    (a, b) =>
      (b.entry.date ?? "").localeCompare(a.entry.date ?? "") ||
      b.entry.createdAt.localeCompare(a.entry.createdAt),
  );
}

type Translate = (text: string) => string;
function poishaText(amount: number) {
  const text = poishaDecimal(amount);
  const [whole, tail = ""] = text.split(".");
  return `${whole}.${tail.padEnd(2, "0")}`;
}

function csvCell(text: string, generatedNumber = false) {
  const escaped =
    !generatedNumber && /^[=+@\-\t\r\n]/.test(text.trimStart())
      ? `'${text}`
      : text;
  return `"${escaped.replaceAll('"', '""')}"`;
}
const costLabels: Record<CostType, string> = {
  material: "মালামাল",
  labour: "মজুরি",
  transport: "গাড়িভাড়া",
  unload: "মাল নামানো",
  rental: "ভাড়া",
  other: "অন্যান্য",
};

export function analyticsCsv(rows: CostRow[], t: Translate) {
  const headers = [
    "তারিখ",
    "কাজ",
    "মালের ধরন",
    "মালের নাম",
    "ব্র্যান্ড",
    "কোথায় ব্যবহার",
    "খরচের ধরন",
    "ব্যক্তি বা দোকান",
    "কেনা",
    "ফেরত ও সমন্বয়",
    "মোট খরচ",
    "যাচাই",
    "পুরোনো খাতার সূত্র",
    "মনে রাখার কথা",
  ];
  const output = [headers.map((header) => csvCell(t(header))).join(",")];
  for (const row of rows) {
    const source = row.entry.source
      ? `${row.entry.source.file} · ${row.entry.source.cell}`
      : "";
    const values = [
      row.entry.date ?? "",
      row.workName,
      row.groupName,
      row.itemName,
      row.brand,
      row.usage,
      t(costLabels[row.line.costType]),
      row.personName,
      poishaText(Math.max(row.amount, 0)),
      poishaText(Math.max(-row.amount, 0)),
      poishaText(row.amount),
      t(row.entry.reviewStatus === "needs_review" ? "যাচাই বাকি" : "যাচাই করা"),
      source,
      row.entry.note,
    ];
    output.push(
      values
        .map((value, index) => csvCell(value, index >= 8 && index <= 10))
        .join(","),
    );
  }
  return `\uFEFF${output.join("\r\n")}`;
}

export type AnalyticsPreset = {
  id: string;
  label: string;
  filters: Partial<AnalyticsFilters>;
};
export function analyticsPresets(ledger: Ledger): AnalyticsPreset[] {
  const find = (words: string[]) =>
    ledger.materialGroups.find((group) =>
      words.some((word) =>
        normalizeSearch(
          [group.id, group.name, ...group.aliases].join(" "),
        ).includes(normalizeSearch(word)),
      ),
    )?.id;
  const steel = find(["লোহা", "রড", "steel"]),
    cement = find(["সিমেন্ট", "cement"]),
    sand = find(["বালু", "sand"]),
    chemical = find(["রাসায়নিক", "কেমিক্যাল", "chemical"]),
    polythene = find(["পলিথিন", "polythene", "polithin"]);
  const presets: AnalyticsPreset[] = [];
  if (steel)
    presets.push({
      id: "steel",
      label: "লোহায় মোট কত",
      filters: { groupId: steel },
    });
  if (cement)
    presets.push({
      id: "cement-unload",
      label: "সিমেন্ট নামানো",
      filters: { groupId: cement, costType: "unload" },
    });
  if (sand)
    presets.push({
      id: "sand-labour",
      label: "বালুর শ্রমিক",
      filters: { groupId: sand, costType: "labour" },
    });
  if (chemical)
    presets.push({
      id: "chemical",
      label: "সব রাসায়নিক",
      filters: { groupId: chemical },
    });
  if (polythene)
    presets.push({
      id: "polythene",
      label: "সব পলিথিন",
      filters: { groupId: polythene },
    });
  if (sand) {
    const usages = new Set(
      costRows(ledger)
        .filter((row) => row.groupId === sand)
        .map((row) => row.usage)
        .filter(Boolean),
    );
    const plaster = [...usages].find((usage) =>
      /plaster|প্লাস্টার|পলেস্তারা/i.test(usage),
    );
    const filling = [...usages].find((usage) =>
      /fill|ভরাট|ভিটে|ভিতে/i.test(usage),
    );
    if (plaster)
      presets.push({
        id: "plaster-sand",
        label: "প্লাস্টারের বালু",
        filters: { groupId: sand, usage: plaster },
      });
    if (filling)
      presets.push({
        id: "filling-sand",
        label: "ভরাটের বালু",
        filters: { groupId: sand, usage: filling },
      });
  }
  return presets;
}

export type ReportSection =
  "material" | "labour" | "transport" | "other" | "all";
export function reportSection(
  value: string | null,
  costType = "",
): ReportSection {
  if (
    value === "all" ||
    value === "material" ||
    value === "labour" ||
    value === "transport" ||
    value === "other"
  )
    return value;
  if (costType === "labour") return "labour";
  if (costType === "transport" || costType === "unload") return "transport";
  if (costType === "rental" || costType === "other") return "other";
  return "material";
}
export function sectionRows(rows: CostRow[], section: ReportSection) {
  if (section === "all") return rows;
  return rows.filter((row) =>
    section === "material"
      ? row.line.costType === "material"
      : section === "labour"
        ? row.line.costType === "labour"
        : section === "transport"
          ? row.line.costType === "transport" || row.line.costType === "unload"
          : row.line.costType === "rental" || row.line.costType === "other",
  );
}
