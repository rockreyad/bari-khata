import { effectiveAccounts } from "../../domain/effectiveAccounts";
import { buildMaterialGroupResolver } from "../../domain/materialGroupResolution";
import { entryWorkIds } from "../../domain/ledger";
import { parseMoneyText, poishaDecimal } from "../../domain/money";
import type { Account, Entry, EntryLine, Ledger } from "../../domain/model";
import { normalizeLabel } from "../../lib/normalizeLabel";
import type { SpendingMonth } from "../../components/ui/monthlySpending";
import { adjustmentBasisLabels } from "../history/adjustmentDisplay";
import {
  entryKindLabels,
  validHistoryDate,
  type HistoryFilters,
} from "../history/history";

export type MaterialChoice = {
  token: string;
  label: string;
  description?: string;
};
type MaterialDocument = MaterialChoice & {
  names: string[];
  rank: number;
};
type CostDocument = {
  line: EntryLine;
  title: string;
  amount: bigint;
  identity: string;
  identitySearchable: string;
  searchable: string;
  tokens: Set<string>;
  resolvedGroupId: string | null;
  ambiguousGroupIds: Set<string>;
  ambiguousOrigins?: CostDocument[];
};
type EntryDocument = {
  entry: Entry;
  account: Account | null;
  workIds: Set<string>;
  searchable: string;
  costs: CostDocument[];
  totalAmount: bigint;
};
export type LedgerSearchIndex = {
  documents: EntryDocument[];
  materials: Map<string, MaterialDocument>;
  materialNames: string[];
  namedGroups: (name: string) => string[];
  namedIdentityWords: (name: string) => string[];
};
export type LedgerSearchFilters = HistoryFilters & {
  material?: string;
  month?: string;
};
export type LedgerSearchResult = {
  entries: Entry[];
  amounts: Record<string, number>;
  titles: Record<string, string>;
  matchedPartEntryIds: string[];
  ambiguousEntryIds: string[];
  partiallyAmbiguousEntryIds: string[];
  groupAmbiguousEntryIds: string[];
  totalCost: number;
  purchases: number;
  returns: number;
  costEntryCount: number;
  matchedLineCount: number;
  undatedCost: number;
  undatedEntryCount: number;
  baseUndatedCost: number;
  baseUndatedEntryCount: number;
  historicalCost: number;
  historicalEntryCount: number;
  reviewCost: number;
  reviewEntryCount: number;
  ambiguousEntryCount: number;
  unassignedAdjustmentCount: number;
  monthlyRows: SpendingMonth[];
  material: MaterialChoice | null;
  materialInvalid: boolean;
  monthInvalid: boolean;
};

const maximum = BigInt(Number.MAX_SAFE_INTEGER);
const exact = (amount: bigint) => {
  if (amount < -maximum || amount > maximum)
    throw new Error("search_amount_out_of_range");
  return Number(amount);
};
function moneyInteger(amount: number) {
  if (!Number.isSafeInteger(amount) || amount < 0)
    throw new Error("search_amount_out_of_range");
  return BigInt(amount);
}
const text = (values: (string | null | undefined)[]) =>
  normalizeLabel(values.filter(Boolean).join(" "));
const wordsOf = (value: string) =>
  normalizeLabel(value).split(" ").filter(Boolean);
const matches = (document: string, words: string[]) =>
  words.every((word) => document.includes(word));

export function buildLedgerSearchIndex(ledger: Ledger): LedgerSearchIndex {
  const accounts = effectiveAccounts(ledger);
  const resolveGroup = buildMaterialGroupResolver(ledger);
  const people = new Map(
    ledger.people.map((person) => [person.id, person.name]),
  );
  const works = new Map(ledger.works.map((work) => [work.id, work.name]));
  const items = new Map(ledger.items.map((item) => [item.id, item]));
  const groups = new Map(
    ledger.materialGroups.map((group) => [group.id, group]),
  );
  const purposes = new Map(
    ledger.paymentPurposes.map((purpose) => [purpose.id, purpose.name]),
  );
  const materials = new Map<string, MaterialDocument>();
  const addMaterial = (
    token: string,
    label: string,
    names: string[],
    rank: number,
    description?: string,
    includeLabel = true,
  ) => {
    if (!label.trim() || materials.has(token)) return;
    materials.set(token, {
      token,
      label,
      names: [
        ...new Set(
          [...(includeLabel ? [label] : []), ...names]
            .map(normalizeLabel)
            .filter(Boolean),
        ),
      ],
      rank,
      ...(description ? { description } : {}),
    });
  };
  const documents = ledger.entries.map((entry): EntryDocument => {
    const workIds = new Set(entryWorkIds(entry));
    const person = people.get(entry.personId ?? "");
    const isCost = entry.kind === "expense" || entry.kind === "expense_credit";
    const lineSearch: string[] = [];
    const costs = entry.lines.map((line): CostDocument => {
      const item = items.get(line.itemId ?? "");
      const resolution = resolveGroup(line);
      const group = groups.get(resolution.groupId ?? "");
      const identity = [
        line.label,
        line.usage,
        item?.name,
        item?.brand,
        item?.usage,
        ...(item?.aliases ?? []),
        ...(group ? resolveGroup.searchNames(group.id) : []),
        ...resolution.ambiguousGroupIds.flatMap((id) => {
          return resolveGroup.searchNames(id);
        }),
      ];
      const searchable = text([
        ...identity,
        person,
        works.get(line.workId),
        entryKindLabels[entry.kind],
      ]);
      lineSearch.push(text(identity));
      const tokens = new Set<string>();
      if (line.itemId) tokens.add(`item:${line.itemId}`);
      if (group) tokens.add(`group:${group.id}`);
      if (!line.itemId && line.costType === "material" && line.label.trim())
        tokens.add(`label:${normalizeLabel(line.label)}`);
      if (isCost && !entry.voided)
        for (const id of [
          resolution.groupId,
          ...resolution.ambiguousGroupIds,
        ]) {
          const candidate = groups.get(id ?? "");
          if (candidate)
            addMaterial(
              `group:${candidate.id}`,
              candidate.name,
              resolveGroup.searchNames(candidate.id),
              0,
              undefined,
              false,
            );
        }
      if (
        isCost &&
        !entry.voided &&
        line.costType === "material" &&
        (entry.kind === "expense" || item || group)
      ) {
        if (item)
          addMaterial(
            `item:${item.id}`,
            item.name,
            item.aliases,
            1,
            [item.brand, item.usage, group?.name].filter(Boolean).join(" · "),
          );
        else if (line.label.trim())
          addMaterial(
            `label:${normalizeLabel(line.label)}`,
            line.label.trim(),
            [],
            2,
            group?.name,
          );
      }
      return {
        line,
        title: line.label.trim() || item?.name || group?.name || "",
        amount:
          moneyInteger(line.amount) *
          (entry.kind === "expense_credit" ? -1n : 1n),
        identity: line.itemId
          ? `item:${line.itemId}`
          : line.label.trim()
            ? `label:${normalizeLabel(line.label)}`
            : group
              ? `group:${group.id}`
              : "",
        identitySearchable: text(identity),
        searchable,
        tokens,
        resolvedGroupId: resolution.groupId,
        ambiguousGroupIds: new Set(resolution.ambiguousGroupIds),
      };
    });
    const total = isCost
      ? entry.lines.reduce((sum, line) => sum + moneyInteger(line.amount), 0n)
      : entry.kind === "adjustment"
        ? moneyInteger(Math.abs(entry.adjustment?.delta ?? 0))
        : entry.paymentParts.reduce(
            (sum, part) => sum + moneyInteger(part.amount),
            0n,
          );
    return {
      entry,
      account: entry.adjustment
        ? entry.adjustment.account
        : (accounts.get(entry.id) ?? entry.account),
      workIds,
      searchable: text([
        entry.note,
        entry.source?.note,
        entryKindLabels[entry.kind],
        entry.adjustment ? adjustmentBasisLabels[entry.adjustment.basis] : "",
        purposes.get(entry.paymentPurposeId ?? ""),
        person,
        poishaDecimal(exact(total)),
        ...[...workIds].map((id) => works.get(id)),
        ...lineSearch,
      ]),
      costs: isCost ? costs : [],
      totalAmount: total,
    };
  });
  const byId = new Map(
    documents.map((document) => [document.entry.id, document]),
  );
  for (const document of documents) {
    if (
      document.entry.kind !== "expense_credit" ||
      !document.entry.relatedEntryId
    )
      continue;
    const original = byId.get(document.entry.relatedEntryId);
    if (original?.entry.kind !== "expense") continue;
    for (const cost of document.costs) {
      if (
        cost.line.itemId ||
        cost.line.materialGroupId ||
        cost.resolvedGroupId ||
        cost.ambiguousGroupIds.size
      )
        continue;
      const origins = original.costs.filter(
        ({ line }) =>
          line.workId === cost.line.workId &&
          line.costType === cost.line.costType,
      );
      const identities = new Set(origins.map((origin) => origin.identity));
      if (!origins.length) continue;
      document.searchable = text([
        document.searchable,
        ...origins.map((origin) => origin.identitySearchable),
      ]);
      const originGroups = new Set(
        origins.map((origin) => origin.resolvedGroupId),
      );
      const consistentOrigins =
        !origins.some((origin) => origin.ambiguousGroupIds.size) &&
        originGroups.size === 1;
      if (identities.size === 1 && !identities.has("") && consistentOrigins) {
        cost.identitySearchable = text([
          cost.identitySearchable,
          ...origins.map((origin) => origin.identitySearchable),
        ]);
        cost.searchable = text([
          cost.searchable,
          ...origins.map((origin) => origin.identitySearchable),
        ]);
        cost.tokens = new Set([
          ...cost.tokens,
          ...origins.flatMap((origin) => [...origin.tokens]),
        ]);
        cost.ambiguousGroupIds = new Set(
          origins.flatMap((origin) => [...origin.ambiguousGroupIds]),
        );
        cost.resolvedGroupId = origins[0].resolvedGroupId;
      } else if (consistentOrigins && origins[0].resolvedGroupId) {
        const group = groups.get(origins[0].resolvedGroupId)!;
        const names = resolveGroup.searchNames(group.id);
        cost.identitySearchable = text([cost.identitySearchable, ...names]);
        cost.searchable = text([cost.searchable, ...names]);
        cost.tokens.add(`group:${group.id}`);
        cost.resolvedGroupId = group.id;
        cost.ambiguousOrigins = origins;
      } else {
        cost.ambiguousOrigins = origins;
        cost.ambiguousGroupIds = new Set(
          origins.flatMap((origin) => [
            ...origin.ambiguousGroupIds,
            ...(origin.resolvedGroupId ? [origin.resolvedGroupId] : []),
          ]),
        );
      }
    }
  }
  return {
    documents,
    materials,
    materialNames: [
      ...new Set([...materials.values()].flatMap((choice) => choice.names)),
    ],
    namedGroups: resolveGroup.namedGroups,
    namedIdentityWords: resolveGroup.namedIdentityWords,
  };
}

type MonthBucket = {
  material: bigint;
  labour: bigint;
  other: bigint;
  total: bigint;
};
const emptyMonth = (): MonthBucket => ({
  material: 0n,
  labour: 0n,
  other: 0n,
  total: 0n,
});
const validMonth = (month: string) =>
  /^\d{4}-\d{2}$/.test(month) && Boolean(validHistoryDate(`${month}-01`));

export function selectLedgerSearch(
  index: LedgerSearchIndex,
  filters: LedgerSearchFilters = {},
): LedgerSearchResult {
  const words = wordsOf(filters.query ?? "");
  const normalizedQuery = normalizeLabel(filters.query ?? "");
  let numericAmount: number | null = null;
  if (/^\d+(?:\.\d{1,2})?$/.test(normalizedQuery)) {
    try {
      numericAmount = parseMoneyText(normalizedQuery);
    } catch {
      /* A search term may be larger than a stored amount. */
    }
  }
  const identityWords = [
    ...new Set([
      ...index.namedIdentityWords(filters.query ?? ""),
      ...index.materialNames.flatMap((name) => {
        if (!words.length) return [];
        if (` ${normalizedQuery} `.includes(` ${name} `)) return wordsOf(name);
        return matches(name, words) ? words : [];
      }),
    ]),
  ];
  const material = filters.material
    ? (index.materials.get(filters.material) ?? null)
    : null;
  const materialInvalid = Boolean(filters.material && !material);
  const requestedGroup = material?.token.startsWith("group:")
    ? material.token.slice("group:".length)
    : null;
  const queryGroups = new Set(
    numericAmount === null ? index.namedGroups(filters.query ?? "") : [],
  );
  if (words.length && numericAmount === null)
    for (const choice of index.materials.values())
      if (
        choice.token.startsWith("group:") &&
        choice.names.some((name) => matches(name, words))
      )
        queryGroups.add(choice.token.slice("group:".length));
  const groupScope = requestedGroup
    ? new Set([requestedGroup])
    : material
      ? new Set<string>()
      : queryGroups;
  const groupUncertain = (cost: CostDocument) =>
    material && !requestedGroup
      ? cost.tokens.has(material.token) && cost.ambiguousGroupIds.size > 0
      : [...cost.ambiguousGroupIds].some((id) => groupScope.has(id));
  const monthInvalid = Boolean(
    filters.month && filters.month !== "undated" && !validMonth(filters.month),
  );
  const entries: Entry[] = [];
  const amounts: Record<string, number> = Object.create(null);
  const titles: Record<string, string> = Object.create(null);
  const matchedPartEntryIds: string[] = [];
  const ambiguousEntryIds: string[] = [];
  const partiallyAmbiguousEntryIds: string[] = [];
  const groupAmbiguousEntryIds: string[] = [];
  const months = new Map<string, MonthBucket>();
  const costEntries = new Set<string>(),
    undatedEntries = new Set<string>(),
    baseUndatedEntries = new Set<string>(),
    historicalEntries = new Set<string>(),
    reviewEntries = new Set<string>();
  let purchases = 0n,
    returns = 0n,
    undatedCost = 0n,
    baseUndatedCost = 0n,
    historicalCost = 0n,
    reviewCost = 0n,
    matchedLineCount = 0,
    unassignedAdjustmentCount = 0;
  for (const document of index.documents) {
    if (materialInvalid) break;
    const { entry } = document;
    if (
      (!filters.includeVoided && entry.voided) ||
      (filters.personId && entry.personId !== filters.personId) ||
      (filters.workId && !document.workIds.has(filters.workId)) ||
      (filters.account && document.account !== filters.account) ||
      (filters.kind && entry.kind !== filters.kind) ||
      (filters.costType &&
        !entry.lines.some((line) => line.costType === filters.costType)) ||
      (filters.from && (!entry.date || entry.date < filters.from)) ||
      (filters.to && (!entry.date || entry.date > filters.to))
    )
      continue;
    const wholeBillMatch =
      numericAmount !== null && document.totalAmount === BigInt(numericAmount);
    const broadMatch = wholeBillMatch || matches(document.searchable, words);
    if (!material && !broadMatch) continue;
    const scopeCosts = document.costs.filter(
      ({ line }) =>
        (!filters.workId || line.workId === filters.workId) &&
        (!filters.costType || line.costType === filters.costType),
    );
    const selected = scopeCosts.filter(
      (cost) =>
        (!material || cost.tokens.has(material.token)) &&
        !groupUncertain(cost) &&
        (material ||
          !groupScope.size ||
          [...groupScope].some((id) => cost.tokens.has(`group:${id}`))) &&
        (wholeBillMatch ||
          (matches(cost.searchable, words) &&
            matches(cost.identitySearchable, identityWords))),
    );
    const ambiguousReturn = scopeCosts.some((cost) =>
      selected.includes(cost)
        ? false
        : cost.ambiguousOrigins?.some(
            (origin) =>
              (!material || origin.tokens.has(material.token)) &&
              matches(origin.searchable, words) &&
              matches(origin.identitySearchable, identityWords),
          ),
    );
    const ambiguousGroup = Boolean(
      (groupScope.size || material) &&
      scopeCosts.some(
        (cost) =>
          groupUncertain(cost) &&
          (wholeBillMatch ||
            (matches(cost.searchable, words) &&
              matches(cost.identitySearchable, identityWords))),
      ),
    );
    if (
      material
        ? !selected.length && !ambiguousReturn && !ambiguousGroup
        : !broadMatch
    )
      continue;
    if (document.costs.length && !scopeCosts.length) continue;
    const dated = Boolean(entry.date && validHistoryDate(entry.date));
    const inMonth =
      !monthInvalid &&
      (!filters.month ||
        (filters.month === "undated"
          ? !dated
          : Boolean(dated && entry.date!.startsWith(`${filters.month}-`))));
    if (!entry.voided) {
      for (const cost of selected) {
        if (dated) {
          const month = entry.date!.slice(0, 7);
          const bucket = months.get(month) ?? emptyMonth();
          const category =
            cost.line.costType === "material"
              ? "material"
              : cost.line.costType === "labour"
                ? "labour"
                : "other";
          bucket[category] += cost.amount;
          bucket.total += cost.amount;
          months.set(month, bucket);
        } else {
          baseUndatedCost += cost.amount;
          baseUndatedEntries.add(entry.id);
        }
      }
    }
    if (!inMonth) continue;
    entries.push(entry);
    if (ambiguousGroup && !entry.voided) groupAmbiguousEntryIds.push(entry.id);
    if (
      document.costs.length &&
      (words.length || ambiguousReturn || ambiguousGroup) &&
      !selected.length &&
      !entry.voided
    )
      ambiguousEntryIds.push(entry.id);
    else if (selected.length && ambiguousReturn && !entry.voided)
      partiallyAmbiguousEntryIds.push(entry.id);
    if (selected.length) {
      const amount = selected.reduce((sum, cost) => sum + cost.amount, 0n);
      amounts[entry.id] = exact(amount);
      const title = [
        ...new Set(selected.map((cost) => cost.title).filter(Boolean)),
      ].join(" · ");
      if (title) titles[entry.id] = title;
      const originalScopeCount = document.costs.filter(
        ({ line }) => !filters.workId || line.workId === filters.workId,
      ).length;
      if (selected.length < originalScopeCount)
        matchedPartEntryIds.push(entry.id);
      if (!entry.voided) {
        costEntries.add(entry.id);
        for (const cost of selected) {
          matchedLineCount++;
          if (cost.amount >= 0n) purchases += cost.amount;
          else returns -= cost.amount;
          if (!dated) {
            undatedCost += cost.amount;
            undatedEntries.add(entry.id);
          }
          if (entry.balanceImpact === "historical") {
            historicalCost += cost.amount;
            historicalEntries.add(entry.id);
          }
          if (entry.reviewStatus === "needs_review") {
            reviewCost += cost.amount;
            reviewEntries.add(entry.id);
          }
        }
      }
    }
    if (entry.kind === "adjustment" && !entry.voided)
      unassignedAdjustmentCount++;
  }
  const monthlyRows = [...months]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, bucket]) => ({
      month,
      material: exact(bucket.material),
      labour: exact(bucket.labour),
      other: exact(bucket.other),
      total: exact(bucket.total),
    }));
  exact(
    monthlyRows.reduce((sum, row) => sum + BigInt(row.total), baseUndatedCost),
  );
  return {
    entries,
    amounts,
    titles,
    matchedPartEntryIds,
    ambiguousEntryIds,
    partiallyAmbiguousEntryIds,
    groupAmbiguousEntryIds,
    totalCost: exact(purchases - returns),
    purchases: exact(purchases),
    returns: exact(returns),
    costEntryCount: costEntries.size,
    matchedLineCount,
    undatedCost: exact(undatedCost),
    undatedEntryCount: undatedEntries.size,
    baseUndatedCost: exact(baseUndatedCost),
    baseUndatedEntryCount: baseUndatedEntries.size,
    historicalCost: exact(historicalCost),
    historicalEntryCount: historicalEntries.size,
    reviewCost: exact(reviewCost),
    reviewEntryCount: reviewEntries.size,
    ambiguousEntryCount: new Set([
      ...ambiguousEntryIds,
      ...partiallyAmbiguousEntryIds,
      ...groupAmbiguousEntryIds,
    ]).size,
    unassignedAdjustmentCount,
    monthlyRows,
    material: material
      ? {
          token: material.token,
          label: material.label,
          ...(material.description
            ? { description: material.description }
            : {}),
        }
      : null,
    materialInvalid,
    monthInvalid,
  };
}

function near(a: string, b: string, limit: number) {
  const left = Array.from(a),
    right = Array.from(b);
  if (Math.abs(left.length - right.length) > limit) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 0; i < left.length; i++) {
    const current = [i + 1];
    for (let j = 0; j < right.length; j++)
      current.push(
        Math.min(
          current[j] + 1,
          previous[j + 1] + 1,
          previous[j] + Number(left[i] !== right[j]),
        ),
      );
    if (Math.min(...current) > limit) return false;
    previous = current;
  }
  return previous[right.length] <= limit;
}

export function materialSuggestions(
  index: LedgerSearchIndex,
  query: string,
  limit = 6,
): MaterialChoice[] {
  const normalized = normalizeLabel(query);
  if (!normalized) return [];
  const alternatives = [
    normalized,
    ...(["balu", "baalu", "sand"].includes(normalized) ? ["বালু"] : []),
  ];
  return [...index.materials.values()]
    .map((choice) => {
      let score = Infinity;
      for (const candidate of alternatives)
        for (const name of choice.names) {
          if (name === candidate)
            score = Math.min(score, candidate === normalized ? 0 : 1);
          else if (name.startsWith(candidate)) score = Math.min(score, 2);
          else if (wordsOf(candidate).every((word) => name.includes(word)))
            score = Math.min(score, 3);
          else if (
            candidate.length >= 4 &&
            near(candidate, name, candidate.length >= 7 ? 2 : 1)
          )
            score = Math.min(score, 4);
        }
      return { choice, score };
    })
    .filter(({ score }) => Number.isFinite(score))
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.choice.rank - b.choice.rank ||
        a.choice.label.localeCompare(b.choice.label),
    )
    .slice(0, Math.min(12, Math.max(0, Math.trunc(limit) || 0)))
    .map(({ choice }) => ({
      token: choice.token,
      label: choice.label,
      ...(choice.description ? { description: choice.description } : {}),
    }));
}
