import { describe, expect, it } from "vitest";
import { buildBrandResolver } from "./brandResolution";

describe("read-only brand identity", () => {
  it("groups recorded case, spacing, punctuation and plus spellings with a readable label", () => {
    const values = [
      "  Northstone  Plus ",
      "northstone+",
      "ＮＯＲＴＨＳＴＯＮＥ +",
      "Northstone-Plus",
      "Northstone",
    ];
    const before = [...values];
    const resolver = buildBrandResolver(values);
    const plus = resolver.resolve("Northstone Plus")!;
    expect(plus.label).toBe("Northstone Plus");
    for (const value of values.slice(0, 4))
      expect(resolver.resolve(value)).toBe(plus);
    expect(resolver.resolve(plus.id)).toBe(plus);
    expect(resolver.resolve("northstone")).not.toBe(plus);
    expect(resolver.identities).toHaveLength(2);
    expect(values).toEqual(before);
  });

  it.each([
    ["Crown", "ক্রাউন"],
    ["Shah", "শাহ"],
    ["Supercrete Plus", "সুপারক্রিট প্লাস"],
    ["Nova", "নোভা"],
    ["Basundhara", "বসুন্ধরা"],
    ["Rahim", "রহিম"],
  ])(
    "combines a bounded recorded cross-script pair: %s / %s",
    (latin, bangla) => {
      const resolver = buildBrandResolver([latin, bangla]);
      expect(resolver.resolve(latin)).toBe(resolver.resolve(bangla));
      expect(resolver.resolve(latin)?.label).toBe(latin);
    },
  );

  it("does not collapse written vowels, short brands or product variants", () => {
    const values = [
      "Nova",
      "Nava",
      "নোভা",
      "নাভা",
      "Dura",
      "Dora",
      "দুরা",
      "ডোরা",
      "ABC",
      "ABD",
      "Northstone32",
      "Northstone42",
      "Northstone",
      "Northstone Plus",
      "Northstone Pro",
      "Northstone Max",
    ];
    const resolver = buildBrandResolver(values);
    for (const [a, b] of [
      ["Nova", "Nava"],
      ["Dura", "Dora"],
      ["ABC", "ABD"],
      ["Northstone32", "Northstone42"],
      ["Northstone", "Northstone Plus"],
      ["Northstone Pro", "Northstone Max"],
    ])
      expect(resolver.resolve(a)).not.toBe(resolver.resolve(b));
    expect(resolver.resolve("Nova")).toBe(resolver.resolve("নোভা"));
    expect(resolver.resolve("Nava")).toBe(resolver.resolve("নাভা"));
    expect(resolver.resolve("Dora")).toBe(resolver.resolve("ডোরা"));
  });

  it("does not use phonetic folds to collapse different Latin names", () => {
    const resolver = buildBrandResolver([
      "Phorix",
      "Forix",
      "Northstone Plus",
      "Northstone",
    ]);
    expect(resolver.resolve("Phorix")).not.toBe(resolver.resolve("Forix"));
  });

  it.each([
    ["Crown", "Krown", "ক্রাউন"],
    ["Crown", "Kraun", "ক্রাউন"],
    ["Shah", "Shaah", "শাহ"],
    ["Supercrete", "Suparcrit", "সুপারক্রিট"],
    ["Supercrete Plus", "Suparcrit+", "সুপারক্রিট প্লাস"],
  ])(
    "uses a unique Bengali anchor for a three-way recorded profile: %s",
    (...values) => {
      const resolver = buildBrandResolver(values);
      expect(resolver.identities).toHaveLength(1);
      expect(new Set(values.map((value) => resolver.resolve(value))).size).toBe(
        1,
      );
      expect(buildBrandResolver([...values].reverse()).identities).toEqual(
        resolver.identities,
      );
      expect(buildBrandResolver(values.slice(0, 2)).identities).toHaveLength(2);
    },
  );

  it("leaves short cross-script names and competing Bengali anchors separate", () => {
    const values = ["Na", "না", "E", "এ", "Ali", "আলি", "Dora", "Dara", "দরা"];
    const resolver = buildBrandResolver(values);
    expect(resolver.identities).toHaveLength(values.length);
    const ambiguous = buildBrandResolver(["Shah", "Shaah", "শাহ", "ষাহ"]);
    expect(ambiguous.identities).toHaveLength(4);
  });

  it("keeps terminal vowel differences out of an otherwise similar sound profile", () => {
    const resolver = buildBrandResolver(["Silver", "Silvar", "সিলভার"]);
    expect(resolver.identities).toHaveLength(2);
    expect(resolver.resolve("Silver")).not.toBe(resolver.resolve("Silvar"));
    expect(resolver.resolve("Silvar")).toBe(resolver.resolve("সিলভার"));
  });

  it.each([
    ["Northstone", "নর্থস্টোন", "Northstnoe", "Northstnooe"],
    ["Northstone", "নর্থস্টোন", "Norhtstone", "Norhhtstone"],
  ])(
    "keeps anchored names as ambiguity blockers instead of starting a later typo chain: %s",
    (...values) => {
      const resolver = buildBrandResolver(values);
      expect(resolver.identities).toHaveLength(3);
      expect(resolver.resolve("Northstone")).toBe(
        resolver.resolve("নর্থস্টোন"),
      );
      expect(resolver.resolve(values[2])).not.toBe(resolver.resolve(values[3]));
      expect(resolver.resolve(values[2])).not.toBe(
        resolver.resolve("Northstone"),
      );
      expect(buildBrandResolver([...values].reverse()).identities).toEqual(
        resolver.identities,
      );
    },
  );

  it("only merges long isolated transpositions or repeated-letter mistakes", () => {
    for (const values of [
      ["Northstone", "Norhtstone"],
      ["Northstone", "Northsstone"],
    ])
      expect(buildBrandResolver(values).identities).toHaveLength(1);
    for (const values of [
      ["Northstone", "Northstore"],
      ["Solartone", "Solarzone"],
      ["Northstone", "Northstne"],
      ["Novalux", "Navalux"],
      ["Northstone", "NorthstoneX"],
      ["Solarix", "Sloarix"],
      ["Supercrete", "Supercreet"],
      ["NorthstoneX", "NorthstoneXX"],
      ["NorthstoneAB", "NorthstoneBA"],
    ])
      expect(buildBrandResolver(values).identities).toHaveLength(2);
  });

  it("matches a unique long recorded typo but does not guess a new URL spelling", () => {
    const resolver = buildBrandResolver(["Northstone Plus", "Norhtstone Plus"]);
    expect(resolver.resolve("Northstone Plus")).toBe(
      resolver.resolve("Norhtstone Plus"),
    );
    expect(resolver.resolve("Northston Plus")).toBeNull();
    expect(resolver.resolve("NORTHSTONE +")).toBe(
      resolver.resolve("Northstone Plus"),
    );
  });

  it("never joins ambiguity or transitive fuzzy bridges", () => {
    const values = [
      "Solarixx",
      "Solerixx",
      "Solerix",
      "Marblestar",
      "Marblstar",
      "Marbstar",
    ];
    const resolver = buildBrandResolver(values);
    expect(new Set(values.map((value) => resolver.resolve(value))).size).toBe(
      values.length,
    );
    expect(resolver.identities).toHaveLength(6);
    for (const value of values)
      expect(resolver.resolve(value)?.aliases).toEqual([value]);
  });

  it("uses short or vowel-near candidates as ambiguity blockers without merging them", () => {
    for (const values of [
      ["Solarix", "Solerix", "Solerx"],
      ["Solartone", "Solartnoe", "Solartnooe"],
      ["Northstone", "Nortstone", "Norttone"],
    ]) {
      const resolver = buildBrandResolver(values);
      expect(resolver.identities).toHaveLength(values.length);
    }
    const resolver = buildBrandResolver([
      "Novastone",
      "Navastone",
      "Northstone",
      "NorthstoneX",
    ]);
    expect(resolver.identities).toHaveLength(4);
  });

  it("keeps model and qualifier changes out of typo matches", () => {
    const values = [
      "Northstone A32",
      "Northstnoe A42",
      "Northstnoe Max",
      "Northstone Pro",
    ];
    const resolver = buildBrandResolver(values);
    expect(resolver.identities).toHaveLength(values.length);
  });

  it("is stable under inventory order and never confuses opaque IDs with a raw prefix", () => {
    const values = [
      "northstone",
      "Northstone",
      "Northstnoe",
      "Crown",
      "ক্রাউন",
      "brand:Northstone",
      "__unknown__",
      "",
      "   ",
      "---",
    ];
    const a = buildBrandResolver(values);
    const b = buildBrandResolver([...values].reverse());
    expect(a.identities).toEqual(b.identities);
    for (const value of values)
      expect(a.resolve(value)).toEqual(b.resolve(value));
    expect(a.resolve("brand:Northstone")).not.toBe(a.resolve("Northstone"));
    expect(a.resolve("")).toBeNull();
    expect(a.resolve("  ")).toBeNull();
    expect(a.resolve("---")).toBeNull();
    expect(a.resolve("__unknown__")?.id).not.toBe("__unknown__");
  });
});
