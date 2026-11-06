import { latinDigits } from "../../lib/numerals";
import { normalizeLabel } from "../../lib/normalizeLabel";
import { poishaDecimal } from "../../domain/money";
import {
  buildBrandResolver,
  type BrandIdentity,
  type BrandResolver,
} from "../../domain/brandResolution";
import type {
  Account,
  CostType,
  Entry,
  EntryLine,
  Item,
  Ledger,
} from "../../domain/model";
import {
  buildLedgerSearchIndex,
  selectLedgerSearch,
  type LedgerSearchIndex,
} from "../ledger/searchAnalytics";

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
  brandIdentity: BrandIdentity | null;
  brandResolver: BrandResolver;
  usage: string;
  workName: string;
  personName: string;
  searchable: string;
  ambiguousGroupIds: string[];
  materialTokens: string[];
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

const maximum = BigInt(Number.MAX_SAFE_INTEGER);
function exactAmount(amount: bigint) {
  if (amount < -maximum || amount > maximum)
    throw new Error("report_amount_out_of_range");
  return Number(amount);
}
function moneyAmount(amount: number) {
  if (!Number.isSafeInteger(amount))
    throw new Error("report_amount_out_of_range");
  return BigInt(amount);
}

export function costRows(
  ledger: Ledger,
  index = buildLedgerSearchIndex(ledger),
  brands = buildBrandResolver(ledger.items.map((item) => item.brand)),
): CostRow[] {
  const items = new Map(ledger.items.map((item) => [item.id, item]));
  const groups = new Map(
    ledger.materialGroups.map((group) => [group.id, group]),
  );
  const works = new Map(ledger.works.map((work) => [work.id, work]));
  const people = new Map(ledger.people.map((person) => [person.id, person]));
  return index.documents.flatMap(({ entry, costs }) => {
    if (
      entry.voided ||
      (entry.kind !== "expense" && entry.kind !== "expense_credit")
    )
      return [];
    const sign = entry.kind === "expense_credit" ? -1 : 1;
    return costs.map(({ line, resolvedGroupId, ambiguousGroupIds, tokens }) => {
      const inheritedItem = [...tokens].find((token) =>
        token.startsWith("item:"),
      );
      const itemId = line.itemId || inheritedItem?.slice(5);
      const item = itemId ? (items.get(itemId) ?? null) : null;
      const groupId = resolvedGroupId ?? "";
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
        brandIdentity: brands.resolve(brand),
        brandResolver: brands,
        usage,
        workName,
        personName,
        ambiguousGroupIds: [...ambiguousGroupIds],
        materialTokens: [...tokens],
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

export type CostReportIndex = {
  search: LedgerSearchIndex;
  brands: BrandResolver;
  rows: CostRow[];
  ambiguousOrigins: Map<string, CostRow[]>;
};

export function buildCostReportIndex(ledger: Ledger): CostReportIndex {
  const search = buildLedgerSearchIndex(ledger);
  const brands = buildBrandResolver(ledger.items.map((item) => item.brand));
  const rows = costRows(ledger, search, brands);
  const byLine = new Map(rows.map((row) => [row.line, row]));
  const ambiguousOrigins = new Map<string, CostRow[]>();
  for (const document of search.documents)
    for (const cost of document.costs)
      if (cost.ambiguousOrigins)
        ambiguousOrigins.set(
          `${document.entry.id}:${cost.line.id}`,
          cost.ambiguousOrigins.flatMap((origin) => {
            const row = byLine.get(origin.line);
            return row ? [row] : [];
          }),
        );
  return { search, brands, rows, ambiguousOrigins };
}

export function selectCostReport(
  index: CostReportIndex,
  filters: Partial<AnalyticsFilters> = {},
  options: {
    section?: ReportSection;
    account?: Account | null;
    month?: string;
  } = {},
) {
  const f = { ...emptyFilters, ...filters };
  const selectedBrand = index.brands.resolve(f.brand);
  const scope = filterCostRows(
    sectionRows(index.rows, options.section ?? "all"),
    { ...f, groupId: "", itemId: "", brand: "", usage: "", query: "" },
  );
  const matchesIdentity = (row: CostRow) =>
    (!f.groupId ||
      (f.groupId === "__unknown__"
        ? !row.groupId
        : row.groupId === f.groupId ||
          row.ambiguousGroupIds.includes(f.groupId))) &&
    (!f.itemId ||
      row.materialTokens.includes(
        f.itemId.startsWith("label:")
          ? `label:${normalizeLabel(f.itemId.slice(6))}`
          : `item:${f.itemId}`,
      )) &&
    (!f.brand ||
      (f.brand === "__unknown__"
        ? !row.brandIdentity
        : Boolean(
            selectedBrand && row.brandIdentity?.id === selectedBrand.id,
          ))) &&
    (!f.usage ||
      (f.usage === "__unknown__" ? !row.usage : row.usage === f.usage));
  const candidates = scope.filter(
    (row) =>
      matchesIdentity(row) &&
      (!(f.itemId || (f.brand && f.brand !== "__unknown__")) ||
        !row.ambiguousGroupIds.length),
  );
  const candidateKeys = new Set(candidates.map((row) => row.key));
  const discoveries = scope.filter(
    (row) =>
      !candidateKeys.has(row.key) &&
      ((matchesIdentity(row) && row.ambiguousGroupIds.length > 0) ||
        index.ambiguousOrigins.get(row.key)?.some(matchesIdentity)),
  );
  const materialToken = f.itemId
    ? f.itemId.startsWith("label:")
      ? `label:${normalizeLabel(f.itemId.slice(6))}`
      : `item:${f.itemId}`
    : f.groupId && f.groupId !== "__unknown__"
      ? `group:${f.groupId}`
      : undefined;
  const material =
    materialToken &&
    (index.search.materials.has(materialToken) ||
      !scope.some((row) => row.materialTokens.includes(materialToken)))
      ? materialToken
      : undefined;
  const search = selectLedgerSearch(index.search, {
    query: f.query,
    workId: f.workId,
    personId: f.personId === "__unknown__" ? undefined : f.personId,
    account: options.account ?? undefined,
    from: f.from,
    to: f.to,
    material,
    month: options.month,
    costLineKeys: candidateKeys,
    costDiscoveryLineKeys: new Set(discoveries.map((row) => row.key)),
  });
  const keys = new Set(search.matchedLineKeys);
  return { rows: candidates.filter((row) => keys.has(row.key)), search };
}

export function filterCostRows(
  rows: CostRow[],
  filters: Partial<AnalyticsFilters> = {},
): CostRow[] {
  const f = { ...emptyFilters, ...filters };
  const query = normalizeSearch(f.query);
  const selectedBrand = rows[0]?.brandResolver.resolve(f.brand);
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
          : (row.item?.id ?? row.line.itemId) === f.itemId)) &&
      (!f.brand ||
        (f.brand === "__unknown__"
          ? !row.brandIdentity
          : Boolean(
              selectedBrand && row.brandIdentity?.id === selectedBrand.id,
            ))) &&
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
  const typeAmounts: Record<CostType, bigint> = {
    material: 0n,
    labour: 0n,
    transport: 0n,
    unload: 0n,
    rental: 0n,
    other: 0n,
  };
  let purchases = 0n,
    returns = 0n,
    historical = 0n,
    reviewAmount = 0n,
    undated = 0n;
  const entries = new Set<string>(),
    reviewEntries = new Set<string>(),
    historicalEntries = new Set<string>(),
    undatedEntries = new Set<string>();
  for (const row of rows) {
    const amount = moneyAmount(row.amount);
    typeAmounts[row.line.costType] += amount;
    entries.add(row.entry.id);
    if (amount >= 0n) purchases += amount;
    else returns -= amount;
    if (row.entry.balanceImpact === "historical") {
      historical += amount;
      historicalEntries.add(row.entry.id);
    }
    if (row.entry.reviewStatus === "needs_review") {
      reviewAmount += amount;
      reviewEntries.add(row.entry.id);
    }
    if (!row.entry.date) {
      undated += amount;
      undatedEntries.add(row.entry.id);
    }
  }
  const byType = Object.fromEntries(
    Object.entries(typeAmounts).map(([type, amount]) => [
      type,
      exactAmount(amount),
    ]),
  ) as Record<CostType, number>;
  return {
    total: exactAmount(purchases - returns),
    purchases: exactAmount(purchases),
    returns: exactAmount(returns),
    byType,
    material: byType.material,
    labour: byType.labour,
    supporting: exactAmount(
      typeAmounts.transport +
        typeAmounts.unload +
        typeAmounts.rental +
        typeAmounts.other,
    ),
    entryCount: entries.size,
    lineCount: rows.length,
    historical: exactAmount(historical),
    historicalCount: historicalEntries.size,
    reviewAmount: exactAmount(reviewAmount),
    reviewCount: reviewEntries.size,
    undated: exactAmount(undated),
    undatedCount: undatedEntries.size,
  };
}

export function breakdownRows(
  rows: CostRow[],
  dimension: AnalyticsDimension,
): Breakdown[] {
  const map = new Map<
    string,
    { label: string; amount: bigint; lines: number; entries: Set<string> }
  >();
  for (const row of rows) {
    const values: Record<AnalyticsDimension, [string, string]> = {
      group: [
        row.groupId || "__unknown__",
        row.groupName || "মালের ধরন দেওয়া নেই",
      ],
      item: [
        row.item?.id ||
          row.line.itemId ||
          `label:${normalizeSearch(row.itemName)}`,
        row.itemName || "মালের নাম দেওয়া নেই",
      ],
      work: [row.line.workId, row.workName],
      brand: [
        row.brandIdentity?.id ?? "__unknown__",
        row.brandIdentity?.label ?? "ব্র্যান্ড দেওয়া নেই",
      ],
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
      amount: 0n,
      lines: 0,
      entries: new Set<string>(),
    };
    previous.amount += moneyAmount(row.amount);
    previous.lines++;
    previous.entries.add(row.entry.id);
    map.set(id, previous);
  }
  return [...map]
    .map(([id, value]) => ({
      id,
      label: value.label,
      amount: exactAmount(value.amount),
      lines: value.lines,
      entries: value.entries.size,
    }))
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
}

export function matchingEntries(rows: CostRow[]) {
  const map = new Map<
    string,
    { entry: Entry; amount: bigint; lines: CostRow[] }
  >();
  for (const row of rows) {
    const previous = map.get(row.entry.id) ?? {
      entry: row.entry,
      amount: 0n,
      lines: [],
    };
    previous.amount += moneyAmount(row.amount);
    previous.lines.push(row);
    map.set(row.entry.id, previous);
  }
  return [...map.values()]
    .map((row) => ({ ...row, amount: exactAmount(row.amount) }))
    .sort(
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
  return "all";
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
