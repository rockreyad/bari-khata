import { describe, expect, it } from "vitest";
import { PersonSchema } from "../../domain/model";
import {
  MAX_PEOPLE_ROLE_TABS,
  peopleRoles,
  roleKey,
  visibleRoleTabs,
} from "./peopleRoles";

const people = [
  {
    id: "shop",
    name: "মালের দোকান",
    kind: "shop",
    contactType: "supplier",
    role: "সিমেন্ট",
  },
  {
    id: "mason",
    name: "মিস্ত্রি",
    kind: "worker",
    contactType: "craftsperson",
    role: "রাজমিস্ত্রি",
  },
  {
    id: "labour",
    name: "শ্রমিক",
    kind: "worker",
    contactType: "labour",
    role: "মাটি কাটা",
  },
  {
    id: "contractor",
    name: "ঠিকাদার",
    kind: "worker",
    contactType: "contractor",
    role: "উপ ঠিকাদার",
  },
  {
    id: "engineer",
    name: "পরামর্শক",
    kind: "worker",
    contactType: "professional",
    role: "মাপজোক",
  },
  {
    id: "driver",
    name: "গাড়ি",
    kind: "driver",
    contactType: "transport",
    role: "মাল আনা",
  },
  {
    id: "service",
    name: "সেবা",
    kind: "worker",
    contactType: "service",
    role: "পরিষ্কার",
  },
  {
    id: "unclassified",
    name: "নাম",
    kind: "other",
    contactType: "custom",
    role: "নিজের লেখা পরিচয়",
  },
].map((person) => PersonSchema.parse(person));
const expectedKeys = [
  "supplier",
  "craftsperson",
  "labour",
  "contractor",
  "professional",
  "transport",
  "service",
  "custom",
];
const keys = (tabs: ReturnType<typeof peopleRoles>) =>
  tabs.map((tab) => tab.key);

describe("contact type tabs", () => {
  it("retains canonical role matching only for legacy links", () => {
    expect(roleKey("  Ｄｅａｌｅｒ\t  ১  ")).toBe("dealer 1");
    expect(roleKey("DEALER 1")).toBe("dealer 1");
    expect(roleKey("\n\t ")).toBe("");
  });

  it("groups different descriptions by their saved type in a stable type order", () => {
    const source = [...people].reverse();
    source.push(
      PersonSchema.parse({
        ...people[4],
        id: "other-engineer",
        role: "অন্য কাজে সাহায্য",
      }),
    );
    const before = structuredClone(source);
    const tabs = peopleRoles(source);
    expect(keys(tabs)).toEqual(expectedKeys);
    expect(tabs.find((tab) => tab.key === "professional")).toEqual({
      key: "professional",
      label: "ইঞ্জিনিয়ার / পরামর্শক",
      count: 2,
    });
    expect(tabs.find((tab) => tab.key === "custom")?.label).toBe(
      "ধরন বাছা হয়নি",
    );
    expect(tabs.map((tab) => tab.label)).not.toContain("মাপজোক");
    expect(source).toEqual(before);
  });

  it("keeps saved type when the role is blank or looks like another type and excludes archived names", () => {
    const source = [
      PersonSchema.parse({ ...people[4], role: "রাজমিস্ত্রি" }),
      PersonSchema.parse({ ...people[4], id: "blank", role: "" }),
      PersonSchema.parse({
        ...people[1],
        archivedAt: "2026-11-05T00:00:00Z",
        removalHistory: [
          { id: "removed", at: "2026-11-05T00:00:00Z", archived: true },
        ],
      }),
    ];
    expect(peopleRoles(source)).toEqual([
      { key: "professional", label: "ইঞ্জিনিয়ার / পরামর্শক", count: 2 },
    ]);
  });

  it("classifies old descriptions conservatively without rewriting people", () => {
    const source = [
      PersonSchema.parse({
        id: "shop",
        name: "দোকান",
        kind: "shop",
        role: "রড বিক্রি",
      }),
      PersonSchema.parse({
        id: "engineer",
        name: "পরামর্শক",
        kind: "worker",
        role: "ইঞ্জিনিয়ার",
      }),
      PersonSchema.parse({
        id: "other",
        name: "নাম",
        kind: "worker",
        role: "নিজের মতো অপরিচিত কাজ",
      }),
      PersonSchema.parse({
        id: "legacy-shop",
        name: "মিতালী ট্রেডার্স",
        kind: null,
        role: "সিমেন্ট ও ইট",
      }),
    ];
    const before = structuredClone(source);
    expect(keys(peopleRoles(source))).toEqual([
      "supplier",
      "professional",
      "custom",
    ]);
    expect(
      peopleRoles(source).find((type) => type.key === "supplier")?.count,
    ).toBe(2);
    expect(source).toEqual(before);
  });
});

it("counts the same stable identity in every explicit role and keeps a role-free identity unclassified", () => {
  const source = [
    PersonSchema.parse({ ...people[0], roles: ["supplier", "professional"] }),
    PersonSchema.parse({ ...people[1], roles: [] }),
  ];
  expect(peopleRoles(source)).toEqual([
    { key: "supplier", label: "দোকানদার", count: 1 },
    { key: "professional", label: "ইঞ্জিনিয়ার / পরামর্শক", count: 1 },
    { key: "custom", label: "ধরন বাছা হয়নি", count: 1 },
  ]);
});

describe("visible type tabs", () => {
  const tabs = peopleRoles(people);

  it("shows all eight existing types by default without changing available choices", () => {
    const before = structuredClone(tabs);
    expect(MAX_PEOPLE_ROLE_TABS).toBe(8);
    expect(visibleRoleTabs(tabs, null)).toEqual(tabs);
    expect(tabs).toEqual(before);
    expect(visibleRoleTabs([], null)).toEqual([]);
  });

  it("preserves explicit stable-id order and skips stale or repeated keys", () => {
    const chosen = [
      "old description",
      "service",
      "supplier",
      "service",
      "professional",
    ];
    const before = [...chosen];
    expect(keys(visibleRoleTabs(tabs, chosen))).toEqual([
      "service",
      "supplier",
      "professional",
    ]);
    expect(chosen).toEqual(before);
  });

  it("keeps intentional no-tabs and removed-only preferences empty", () => {
    expect(visibleRoleTabs(tabs, [])).toEqual([]);
    expect(visibleRoleTabs(tabs, ["রাজমিস্ত্রি"])).toEqual([]);
    expect(
      visibleRoleTabs(
        tabs.filter((tab) => tab.key !== "supplier"),
        ["supplier"],
      ),
    ).toEqual([]);
  });
});
