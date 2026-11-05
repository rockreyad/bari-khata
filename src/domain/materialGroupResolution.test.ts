import { describe, expect, it } from "vitest";
import { EntryLineSchema, LedgerSchema } from "./model";
import { buildMaterialGroupResolver } from "./materialGroupResolution";

const catalog = () =>
  LedgerSchema.parse({
    materialGroups: [
      { id: "cement", name: "সিমেন্ট", aliases: ["Cement"] },
      { id: "sand", name: "বালু", aliases: ["Sand", "Balu"] },
      { id: "brick", name: "ইট", aliases: ["Brick"] },
      { id: "board", name: "Cementboard", aliases: ["Cement board"] },
    ],
    items: [
      {
        id: "cement-item",
        name: "নমুনা সিমেন্ট",
        brand: "Nomo",
        aliases: ["Demo Cement"],
        materialGroupId: "cement",
      },
      { id: "sand-item", name: "মোটা বালু", materialGroupId: "sand" },
    ],
  });
const line = (label: string, extra = {}) =>
  EntryLineSchema.parse({
    id: "line",
    workId: "work",
    label,
    amount: 100,
    ...extra,
  });

describe("read-only material group resolution", () => {
  it.each([
    "সিমেন্ট",
    "শাহ সিমেন্ট আনলোড",
    "CEMENT Unload",
    "২০ বস্তা Cement",
    "Nomo unload",
    "Demo Cement",
  ])("resolves an own recorded name: %s", (name) => {
    expect(buildMaterialGroupResolver(catalog())(line(name))).toEqual({
      groupId: "cement",
      source: "name",
      ambiguousGroupIds: [],
    });
  });

  it("uses valid line then item metadata when the recorded name is generic", () => {
    const resolve = buildMaterialGroupResolver(catalog());
    expect(resolve(line("মাল", { materialGroupId: "cement" })).source).toBe(
      "line",
    );
    expect(resolve(line("মাল", { itemId: "sand-item" }))).toEqual({
      groupId: "sand",
      source: "item",
      ambiguousGroupIds: [],
    });
    expect(
      resolve(line("মাল", { materialGroupId: "sand", itemId: "sand-item" }))
        .source,
    ).toBe("line");
  });

  it("flags metadata conflicts, clear own-name disagreements and multiple material names", () => {
    const resolve = buildMaterialGroupResolver(catalog());
    for (const recorded of [
      line("মাল", { materialGroupId: "cement", itemId: "sand-item" }),
      line("বালু", { materialGroupId: "cement" }),
      line("সিমেন্ট ও বালু আনলোড"),
    ])
      expect(resolve(recorded)).toEqual({
        groupId: null,
        source: null,
        ambiguousGroupIds: ["cement", "sand"],
      });
  });

  it("uses word boundaries and the most specific overlapping material phrase", () => {
    const ledger = catalog();
    ledger.items.push({
      ...ledger.items[0],
      id: "plain-cement",
      name: "Cement",
      brand: "",
      aliases: [],
    });
    const resolve = buildMaterialGroupResolver(ledger);
    expect(resolve(line("cementboard"))).toMatchObject({ groupId: "board" });
    expect(resolve(line("Cement board unload"))).toMatchObject({
      groupId: "board",
    });
    expect(resolve(line("Cement board and Sand"))).toMatchObject({
      groupId: null,
      ambiguousGroupIds: ["board", "sand"],
    });
    expect(resolve(line("brickwork"))).toMatchObject({
      groupId: null,
      ambiguousGroupIds: [],
    });
  });

  it("keeps ambiguous brands unresolved and never applies fuzzy or unrelated context inference", () => {
    const ledger = catalog();
    ledger.items.push({
      ...ledger.items[0],
      id: "other-brand",
      name: "নমুনা ইট",
      materialGroupId: "brick",
    });
    const resolve = buildMaterialGroupResolver(ledger);
    expect(resolve(line("Nomo"))).toMatchObject({
      groupId: null,
      ambiguousGroupIds: ["brick", "cement"],
    });
    expect(resolve(line("Nomo Cement"))).toMatchObject({ groupId: "cement" });
    for (const label of ["মাল আনলোড", "মজুরি", "Cemnet", "বালূ"])
      expect(resolve(line(label))).toMatchObject({
        groupId: null,
        ambiguousGroupIds: [],
      });
  });

  it("does not turn generic catalog labels into a material identity or change source data", () => {
    const ledger = catalog();
    ledger.items.push({
      ...ledger.items[0],
      id: "generic",
      name: "মাল",
      brand: "",
      aliases: [],
    });
    const before = structuredClone(ledger);
    const resolve = buildMaterialGroupResolver(ledger);
    const recorded = line("মাল আনলোড");
    expect(resolve(recorded).groupId).toBeNull();
    expect(recorded.materialGroupId).toBeNull();
    expect(ledger).toEqual(before);
  });

  it("infers only material, unload and transport names while keeping deliberate metadata links", () => {
    const resolve = buildMaterialGroupResolver(catalog());
    for (const costType of ["material", "unload", "transport"])
      expect(resolve(line("Cement unloading", { costType })).groupId).toBe(
        "cement",
      );
    for (const costType of ["labour", "rental", "other"]) {
      expect(
        resolve(line("সিমেন্ট মিক্সার ভাড়া", { costType })).groupId,
      ).toBeNull();
      expect(
        resolve(
          line("সিমেন্ট মিক্সার ভাড়া", { costType, materialGroupId: "cement" }),
        ).groupId,
      ).toBe("cement");
    }
  });

  it("accepts bounded Bengali possessives only on eligible lines, keeping work-query scope unchanged", () => {
    const resolve = buildMaterialGroupResolver(catalog());
    expect(
      resolve(line("বালুর গাড়িভাড়া", { costType: "transport" })).groupId,
    ).toBe("sand");
    expect(
      resolve(line("সিমেন্টের আনলোড", { costType: "unload" })).groupId,
    ).toBe("cement");
    expect(
      resolve(line("বালুর কাজের মজুরি", { costType: "labour" })).groupId,
    ).toBeNull();
    expect(
      resolve(line("সিমেন্টমেশিন", { costType: "transport" })).groupId,
    ).toBeNull();
    expect(resolve.namedGroups("বালুর কাজ")).toEqual([]);
  });

  it("does not discard a contradictory uniquely identified catalog brand", () => {
    const ledger = catalog();
    ledger.items[0].name = "Alpha";
    ledger.items[1].brand = "Beta";
    expect(
      buildMaterialGroupResolver(ledger)(line("Alpha Beta unloading")),
    ).toMatchObject({ groupId: null, ambiguousGroupIds: ["cement", "sand"] });
  });

  it("rejects generic service names and aliases even when a catalog grouped them previously", () => {
    const ledger = catalog();
    ledger.materialGroups[0].aliases.push("ভাড়া", "খালাস");
    ledger.items[0].name = "ভাড়া";
    ledger.items[0].aliases = ["20 Bag Unload", "মাল নামানোর ভাড়া"];
    const resolve = buildMaterialGroupResolver(ledger);
    for (const label of ["ভাড়া", "20 Bag Unload", "মাল নামানোর ভাড়া", "খালাস"])
      expect(
        resolve(line(label, { costType: "transport" })).groupId,
      ).toBeNull();
  });

  it("does not promote support-only catalog item names or brands into global material names", () => {
    const ledger = LedgerSchema.parse({
      ...catalog(),
      works: [{ id: "work", name: "কাজ" }],
      entries: [
        {
          id: "charge",
          kind: "expense",
          account: "other",
          lines: [
            line("Nomo load", { itemId: "cement-item", costType: "unload" }),
          ],
        },
      ],
    });
    const resolve = buildMaterialGroupResolver(ledger);
    expect(resolve(line("Nomo", { costType: "unload" })).groupId).toBeNull();
    expect(
      resolve(line("Nomo", { itemId: "cement-item", costType: "unload" }))
        .groupId,
    ).toBe("cement");
    expect(resolve.namedGroups("Nomo")).toEqual([]);
  });
});
