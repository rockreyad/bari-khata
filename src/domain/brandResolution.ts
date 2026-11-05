import { normalizeLabel } from "../lib/normalizeLabel";

export type BrandIdentity = {
  id: string;
  label: string;
  aliases: string[];
};
export type BrandResolver = {
  identities: readonly BrandIdentity[];
  resolve(value: string): BrandIdentity | null;
};

const brandKey = (value: string) =>
  normalizeLabel(value)
    .replace(/[\u200b-\u200d\ufeff]/gu, "")
    .replace(/\+/gu, " plus ")
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .map((word) => (word === "প্লাস" ? "plus" : word))
    .filter(Boolean)
    .join(" ");
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const bengali = /\p{Script=Bengali}/u;
const consonants: Record<string, string> = {
  ক: "k",
  খ: "kh",
  গ: "g",
  ঘ: "gh",
  ঙ: "ng",
  চ: "ch",
  ছ: "chh",
  জ: "j",
  ঝ: "jh",
  ঞ: "n",
  ট: "t",
  ঠ: "th",
  ড: "d",
  ঢ: "dh",
  ণ: "n",
  ত: "t",
  থ: "th",
  দ: "d",
  ধ: "dh",
  ন: "n",
  প: "p",
  ফ: "f",
  ব: "b",
  ভ: "v",
  ম: "m",
  য: "y",
  র: "r",
  ল: "l",
  শ: "sh",
  ষ: "sh",
  স: "s",
  হ: "h",
  ড়: "r",
  ঢ়: "rh",
  য়: "y",
  ৎ: "t",
};
const vowels: Record<string, string> = {
  অ: "a",
  আ: "a",
  ই: "i",
  ঈ: "i",
  উ: "u",
  ঊ: "u",
  ঋ: "ri",
  এ: "e",
  ঐ: "oi",
  ও: "o",
  ঔ: "ou",
};
const vowelSigns: Record<string, string> = {
  "া": "a",
  "ি": "i",
  "ী": "i",
  "ু": "u",
  "ূ": "u",
  "ৃ": "ri",
  "ে": "e",
  "ৈ": "oi",
  "ো": "o",
  "ৌ": "ou",
};

function latinSound(word: string) {
  return word
    .replace(/ph/g, "f")
    .replace(/bh/g, "v")
    .replace(/ck/g, "k")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c/g, "k")
    .replace(/ee/g, "i")
    .replace(/e([^aeiou])e$/g, "i$1")
    .replace(/er(?=[b-df-hj-np-tv-z]{2})/g, "ar")
    .replace(/rown/g, "raun")
    .replace(/aa/g, "a")
    .replace(/ii/g, "i")
    .replace(/oo/g, "u")
    .replace(/([^aeiou])e$/g, word.length >= 5 ? "$1" : "$1e");
}

function bengaliSound(word: string): RegExp | null {
  const chars = [...word];
  let pattern = "";
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    let sound = consonants[char];
    if (sound) {
      if (chars[i + 1] === "়") {
        sound = char === "ড" ? "r" : char === "ঢ" ? "rh" : sound;
        i++;
      }
      pattern += sound;
      if (chars[i + 1] === "্") i++;
      else if (vowelSigns[chars[i + 1]]) pattern += vowelSigns[chars[++i]];
      // Banglish often omits the inherent vowel; written vowel signs stay exact.
      else if (i + 1 < chars.length) pattern += "[ao]?";
    } else if (vowels[char]) pattern += vowels[char];
    else if (char === "ং") pattern += "ng";
    else if (char === "ঃ") pattern += "h";
    else if (char === "ঁ") pattern += "n";
    else if (/^[a-z0-9]$/.test(char)) pattern += char;
    else return null;
  }
  return pattern ? new RegExp(`^${pattern}$`, "u") : null;
}

type Word = {
  text: string;
  sound: string | null;
  pattern: RegExp | null;
};
type Brand = {
  key: string;
  aliases: string[];
  words: Word[];
  numbers: string;
};
const wordProfile = (text: string): Word => ({
  text,
  sound: /^[a-z]+$/.test(text) ? latinSound(text) : null,
  pattern: bengali.test(text) ? bengaliSound(text) : null,
});

function differentScriptMatch(a: Brand, b: Brand) {
  if (a.words.length !== b.words.length || a.numbers !== b.numbers)
    return false;
  let crossed = false;
  for (let i = 0; i < a.words.length; i++) {
    const first = a.words[i],
      second = b.words[i];
    if (first.text === second.text) continue;
    if (
      (first.pattern &&
        second.sound &&
        second.text.length >= 4 &&
        second.sound.length >= 4 &&
        first.pattern.test(second.sound)) ||
      (second.pattern &&
        first.sound &&
        first.text.length >= 4 &&
        first.sound.length >= 4 &&
        second.pattern.test(first.sound))
    )
      crossed = true;
    else return false;
  }
  return crossed;
}

function oneEdit(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let left = 0;
  while (left < a.length && a[left] === b[left]) left++;
  if (a.length === b.length)
    return (
      a.slice(left + 1) === b.slice(left + 1) ||
      (a[left] === b[left + 1] &&
        a[left + 1] === b[left] &&
        a.slice(left + 2) === b.slice(left + 2))
    );
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  return shorter.slice(left) === longer.slice(left + 1);
}

function nearBrand(a: Brand, b: Brand) {
  if (a.words.length !== b.words.length || a.numbers !== b.numbers)
    return false;
  if (differentScriptMatch(a, b)) return true;
  const first = a.words[0].text,
    second = b.words[0].text;
  if (
    !/^[a-z]{6,64}$/.test(first) ||
    !/^[a-z]{6,64}$/.test(second) ||
    first[0] !== second[0] ||
    !a.words
      .slice(1)
      .every((word, index) => word.text === b.words[index + 1].text)
  )
    return false;
  return oneEdit(first, second);
}

function eligiblePair(a: Brand, b: Brand) {
  const first = a.words[0].text,
    second = b.words[0].text;
  if (!/^[a-z]{8,64}$/.test(first) || !/^[a-z]{8,64}$/.test(second))
    return false;
  // Keep model-like prefixes and suffixes out of automatic typo matching.
  if (
    first.slice(0, 2) !== second.slice(0, 2) ||
    first.slice(-2) !== second.slice(-2)
  )
    return false;
  let left = 0;
  while (left < first.length && first[left] === second[left]) left++;
  if (left >= Math.min(first.length, second.length) - 2) return false;
  if (first.length === second.length)
    return (
      first[left] === second[left + 1] &&
      first[left + 1] === second[left] &&
      first.slice(left + 2) === second.slice(left + 2)
    );
  const shorter = first.length < second.length ? first : second;
  const longer = first.length < second.length ? second : first;
  return (
    shorter.slice(left) === longer.slice(left + 1) &&
    (longer[left] === longer[left - 1] || longer[left] === longer[left + 1])
  );
}

function bucketKeys(brand: Brand) {
  const first = brand.words[0];
  const shape = [brand.words.length, brand.numbers];
  const keys = [JSON.stringify([...shape, "native", first.text[0]])];
  const sound = first.sound?.[0] ?? first.pattern?.source[1];
  if (sound) keys.push(JSON.stringify([...shape, "sound", sound]));
  return keys;
}

function displayRank(value: string) {
  const words = value.match(/[a-z]+/gi) ?? [];
  if (
    !bengali.test(value) &&
    words.length &&
    words.every((word) => /^[A-Z][a-z]+$/.test(word))
  )
    return 0;
  if (bengali.test(value)) return 1;
  if (
    words.length &&
    words.every((word) => word === word.toUpperCase() && word.length <= 4)
  )
    return 2;
  return value === value.toLowerCase() ? 3 : 4;
}

export function buildBrandResolver(values: readonly string[]): BrandResolver {
  const aliases = new Map<string, Set<string>>();
  for (const value of values) {
    const key = brandKey(value);
    if (!key) continue;
    const names = aliases.get(key) ?? new Set<string>();
    names.add(value.trim());
    aliases.set(key, names);
  }
  const brands: Brand[] = [...aliases]
    .sort(([a], [b]) => compare(a, b))
    .map(([key, names]) => ({
      key,
      aliases: [...names].sort(compare),
      words: key.split(" ").map(wordProfile),
      numbers: (key.match(/\d+/g) ?? []).join("|"),
    }));
  const byKey = new Map<string, BrandIdentity>();
  const identities: BrandIdentity[] = [];
  function register(cluster: Brand[]) {
    const names = cluster.flatMap((brand) => brand.aliases).sort(compare);
    const identity: BrandIdentity = {
      id: cluster.map((brand) => brand.key).sort(compare)[0],
      label: names
        .map((name) => name.replace(/\s+/gu, " "))
        .sort((a, b) => displayRank(a) - displayRank(b) || compare(a, b))[0],
      aliases: names,
    };
    identities.push(identity);
    for (const brand of cluster) byKey.set(brand.key, identity);
  }
  const profiles = new Map<string, Brand[]>();
  const profileBuckets = new Map<string, Set<string>>();
  for (const brand of brands) {
    if (brand.words.some((word) => bengali.test(word.text))) continue;
    const profile = JSON.stringify(
      brand.words.map((word) => word.sound ?? word.text),
    );
    profiles.set(profile, [...(profiles.get(profile) ?? []), brand]);
    for (const key of bucketKeys(brand)) {
      const bucket = profileBuckets.get(key) ?? new Set<string>();
      bucket.add(profile);
      profileBuckets.set(key, bucket);
    }
  }
  const matches = new Map<Brand, string[]>();
  const anchors = new Map<string, Brand[]>();
  for (const brand of brands) {
    if (!brand.words.some((word) => word.pattern)) continue;
    const possible = new Set(
      bucketKeys(brand).flatMap((key) => [...(profileBuckets.get(key) ?? [])]),
    );
    const found = [...possible].filter((profile) =>
      differentScriptMatch(brand, profiles.get(profile)![0]),
    );
    matches.set(brand, found);
    for (const profile of found)
      anchors.set(profile, [...(anchors.get(profile) ?? []), brand]);
  }
  // Several Latin spellings need one unique recorded Bengali anchor, not only a sound key.
  for (const [brand, found] of matches)
    if (found.length === 1 && anchors.get(found[0])?.length === 1)
      register([...profiles.get(found[0])!, brand]);

  // Anchored names still block ambiguous typo chains elsewhere in the inventory.
  const neighbors = brands.map(() => new Set<number>());
  const buckets = new Map<string, number[]>();
  brands.forEach((brand, index) => {
    for (const key of bucketKeys(brand))
      buckets.set(key, [...(buckets.get(key) ?? []), index]);
  });
  brands.forEach((brand, index) => {
    const possible = new Set(
      bucketKeys(brand).flatMap((key) => buckets.get(key) ?? []),
    );
    for (const next of possible)
      if (next > index && nearBrand(brand, brands[next])) {
        neighbors[index].add(next);
        neighbors[next].add(index);
      }
  });
  for (let i = 0; i < brands.length; i++) {
    if (byKey.has(brands[i].key)) continue;
    const cluster = [brands[i]];
    const neighbor = [...neighbors[i]][0];
    // A third near spelling makes the whole candidate set uncertain, not a bridge.
    if (
      neighbors[i].size === 1 &&
      neighbors[neighbor].size === 1 &&
      !byKey.has(brands[neighbor].key) &&
      eligiblePair(brands[i], brands[neighbor])
    )
      cluster.push(brands[neighbor]);
    register(cluster);
  }
  identities.sort((a, b) => compare(a.id, b.id));
  return {
    identities,
    resolve(value) {
      return byKey.get(brandKey(value)) ?? null;
    },
  };
}
