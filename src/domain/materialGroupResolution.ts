import type { EntryLine, Ledger } from "./model";
import { normalizeLabel } from "../lib/normalizeLabel";

type Phrase = { words: string[]; groups: Set<string> };
type PhraseIndex = Map<string, Phrase[]>;
type Evidence = { start: number; end: number; groups: Set<string> };
export type MaterialGroupResolution = {
  groupId: string | null;
  source: "line" | "item" | "name" | null;
  ambiguousGroupIds: string[];
};
export type MaterialGroupResolver = {
  (line: EntryLine): MaterialGroupResolution;
  namedGroups(name: string): string[];
  namedIdentityWords(name: string): string[];
  searchNames(groupId: string): string[];
};

const genericNames = new Set([
  "মাল",
  "মালামাল",
  "খরচ",
  "অন্যান্য",
  "কাজ",
  "বিল",
  "আনলোড",
  "নামানো",
  "নামানোর",
  "খালাস",
  "পরিবহন",
  "ভাড়া",
  "ভাড়া",
  "গাড়িভাড়া",
  "গাড়িভাড়া",
  "ভ্যানভাড়া",
  "ভ্যানভাড়া",
  "মজুরি",
  "মজুরির",
  "শ্রমিক",
  "কুলি",
  "কুলির",
  "বস্তা",
  "বস্তার",
  "আনা",
  "আনার",
  "ডেলিভারি",
  "material",
  "materials",
  "other",
  "others",
  "work",
  "charge",
  "bill",
  "unload",
  "unloading",
  "transport",
  "delivery",
  "rent",
  "rental",
  "fee",
  "fees",
  "charges",
  "hire",
  "freight",
  "loading",
  "offloading",
  "labor",
  "labour",
  "wage",
  "wages",
  "bag",
  "bags",
  "sack",
  "sacks",
]);
const nameWords = (name: string) =>
  normalizeLabel(name)
    .replace(/[\u200c\u200d]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

function phraseIndex(names: Map<string, Set<string>>): PhraseIndex {
  const index: PhraseIndex = new Map();
  for (const [name, groups] of names) {
    const words = nameWords(name);
    if (!words.length) continue;
    const rows = index.get(words[0]) ?? [];
    rows.push({ words, groups });
    index.set(words[0], rows);
  }
  return index;
}

function evidence(index: PhraseIndex, words: string[]): Evidence[] {
  const found: Evidence[] = [];
  for (let start = 0; start < words.length; start++) {
    for (const phrase of index.get(words[start]) ?? []) {
      if (phrase.words.every((word, offset) => words[start + offset] === word))
        found.push({
          start,
          end: start + phrase.words.length,
          groups: phrase.groups,
        });
    }
  }
  return found.filter(
    (match) =>
      !found.some(
        (other) =>
          other.start <= match.start &&
          other.end >= match.end &&
          (other.start < match.start || other.end > match.end),
      ),
  );
}
const candidates = (found: Evidence[]) =>
  new Set(found.flatMap((row) => [...row.groups]));
const uniqueCandidates = (found: Evidence[]) =>
  candidates(found.filter((row) => row.groups.size === 1));

export function buildMaterialGroupResolver(
  ledger: Pick<Ledger, "items" | "materialGroups"> &
    Partial<Pick<Ledger, "entries">>,
): MaterialGroupResolver {
  const groups = new Set(ledger.materialGroups.map((group) => group.id));
  const items = new Map(ledger.items.map((item) => [item.id, item]));
  const groupNames = new Map<string, Set<string>>(),
    itemNames = new Map<string, Set<string>>(),
    brands = new Map<string, Set<string>>();
  const add = (
    index: Map<string, Set<string>>,
    name: string,
    groupId: string,
  ) => {
    const normalized = nameWords(name).join(" ");
    if (
      !normalized ||
      normalized
        .split(" ")
        .every((word) => genericNames.has(word) || /^\d+$/.test(word))
    )
      return;
    const matches = index.get(normalized) ?? new Set<string>();
    matches.add(groupId);
    index.set(normalized, matches);
  };
  for (const group of ledger.materialGroups)
    for (const name of [group.name, ...group.aliases])
      add(groupNames, name, group.id);
  const searchNames = new Map<string, string[]>();
  for (const [name, ids] of groupNames)
    for (const id of ids)
      searchNames.set(id, [...(searchNames.get(id) ?? []), name]);
  const materialItems = new Set<string>(),
    supportItems = new Set<string>();
  for (const entry of ledger.entries ?? []) {
    if (entry.voided || !["expense", "expense_credit"].includes(entry.kind))
      continue;
    for (const line of entry.lines)
      if (line.itemId)
        (line.costType === "material" ? materialItems : supportItems).add(
          line.itemId,
        );
  }
  for (const item of ledger.items) {
    if (!item.materialGroupId || !groups.has(item.materialGroupId)) continue;
    if (supportItems.has(item.id) && !materialItems.has(item.id)) continue;
    for (const name of [item.name, ...item.aliases])
      add(itemNames, name, item.materialGroupId);
    add(brands, item.brand, item.materialGroupId);
  }
  const lineGroupNames = new Map(
    [...groupNames].map(([name, ids]) => [name, new Set(ids)]),
  );
  for (const [name, ids] of groupNames) {
    if (!/[\u0980-\u09ff]$/u.test(name) || /ের$/u.test(name)) continue;
    const suffix = /[ািীুূেৈোৌঅআইঈউঊএঐওঔ]$/u.test(name) ? "র" : "ের";
    for (const id of ids) add(lineGroupNames, `${name}${suffix}`, id);
  }
  const groupIndex = phraseIndex(groupNames),
    lineGroupIndex = phraseIndex(lineGroupNames),
    itemIndex = phraseIndex(itemNames),
    brandIndex = phraseIndex(brands);
  const namedEvidence = (name: string, inflected = false) => {
    const words = nameWords(name);
    const directEvidence = evidence(
      inflected ? lineGroupIndex : groupIndex,
      words,
    );
    const direct = candidates(directEvidence);
    const outsideMoreSpecificGroup = (match: Evidence) =>
      !directEvidence.some(
        (group) =>
          group.start <= match.start &&
          group.end >= match.end &&
          (group.start < match.start || group.end > match.end),
      );
    const itemEvidence = evidence(itemIndex, words).filter(
        outsideMoreSpecificGroup,
      ),
      brandEvidence = evidence(brandIndex, words).filter(
        outsideMoreSpecificGroup,
      );
    const catalog = candidates([...itemEvidence, ...brandEvidence]);
    const clearCatalog = uniqueCandidates([...itemEvidence, ...brandEvidence]);
    const identityWords = [
      ...new Set(
        [...directEvidence, ...itemEvidence, ...brandEvidence].flatMap(
          (match) => words.slice(match.start, match.end),
        ),
      ),
    ];
    return { direct, catalog, clearCatalog, identityWords };
  };
  const namedGroups = (name: string) => {
    const { direct, catalog, clearCatalog } = namedEvidence(name);
    return [
      ...new Set([
        ...direct,
        ...(direct.size || clearCatalog.size ? clearCatalog : catalog),
      ]),
    ].sort();
  };
  const resolve = (line: EntryLine): MaterialGroupResolution => {
    const lineGroup = groups.has(line.materialGroupId ?? "")
      ? line.materialGroupId
      : null;
    const itemGroupId = items.get(line.itemId ?? "")?.materialGroupId ?? null;
    const itemGroup = groups.has(itemGroupId ?? "") ? itemGroupId : null;
    const metadata = new Set(
      [lineGroup, itemGroup].filter((id): id is string => Boolean(id)),
    );
    if (
      !metadata.size &&
      !["material", "unload", "transport"].includes(line.costType)
    )
      return { groupId: null, source: null, ambiguousGroupIds: [] };
    const { direct, catalog, clearCatalog } = namedEvidence(line.label, true);
    const known = new Set([...metadata, ...direct]);
    if (direct.size || metadata.size || clearCatalog.size)
      for (const id of clearCatalog) known.add(id);
    else for (const id of catalog) known.add(id);
    if (known.size > 1)
      return {
        groupId: null,
        source: null,
        ambiguousGroupIds: [...known].sort(),
      };
    const groupId = [...known][0] ?? null;
    return {
      groupId,
      source: groupId
        ? lineGroup
          ? "line"
          : itemGroup
            ? "item"
            : "name"
        : null,
      ambiguousGroupIds: [],
    };
  };
  return Object.assign(resolve, {
    namedGroups,
    namedIdentityWords: (name: string) => namedEvidence(name).identityWords,
    searchNames: (id: string) => searchNames.get(id) ?? [],
  });
}
