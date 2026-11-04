import { describe, expect, it } from "vitest";
import {
  MAX_PEOPLE_ROLE_TABS,
  peopleRoles,
  roleKey,
  visibleRoleTabs,
} from "./peopleRoles";

const person = (role: string, archivedAt: string | null = null) => ({
  role,
  archivedAt,
});
const keys = (roles: ReturnType<typeof peopleRoles>) =>
  roles.map((role) => role.key);

describe("existing contact roles", () => {
  it("canonicalizes case, whitespace, Unicode width and Bengali digits", () => {
    expect(roleKey("  Ｄｅａｌｅｒ\t  ১  ")).toBe("dealer 1");
    expect(roleKey("DEALER 1")).toBe("dealer 1");
    expect(roleKey("\n\t ")).toBe("");
  });

  it("counts exact canonical matches while preserving the first display spelling", () => {
    const people = [
      person("  Ｄｅａｌｅｒ\t১ "),
      person("dealer 1"),
      person("DEALER   ১"),
      person("Dealer"),
      person("Dealer 10"),
      person("Cement Dealer 1"),
    ];
    const before = structuredClone(people);
    const roles = peopleRoles(people);
    expect(roles[0]).toEqual({
      key: "dealer 1",
      label: "Ｄｅａｌｅｒ ১",
      count: 3,
    });
    expect(roles).toHaveLength(4);
    expect(roles.find((role) => role.key === "dealer")?.count).toBe(1);
    expect(roles.find((role) => role.key === "dealer 10")?.count).toBe(1);
    expect(roles.find((role) => role.key === "cement dealer 1")?.count).toBe(1);
    expect(people).toEqual(before);
  });

  it("excludes archived and blank roles without falling back to contact kind or name", () => {
    const people = [
      { ...person(""), kind: "shop", name: "দোকান" },
      { ...person(" \n\t"), kind: "worker", name: "মিস্ত্রি" },
      { ...person("ইঞ্জিনিয়ার"), kind: "worker", name: "নমুনা" },
      person("সিমেন্ট ডিলার", "2026-11-04T00:00:00Z"),
      person("ইঞ্জিনিয়ার", "2026-11-04T00:00:00Z"),
    ];
    expect(peopleRoles(people)).toEqual([
      { key: "ইঞ্জিনিয়ার", label: "ইঞ্জিনিয়ার", count: 1 },
    ]);
  });

  it("sorts by frequency, then label, without limiting the available chooser roles", () => {
    const people = [
      person("Z role"),
      person("B role"),
      person("A role"),
      person("Popular"),
      person(" popular "),
      ...Array.from({ length: 7 }, (_, index) => person(`Role ${index}`)),
    ];
    const roles = peopleRoles(people);
    expect(roles[0]).toEqual({ key: "popular", label: "Popular", count: 2 });
    expect(keys(roles).slice(1, 3)).toEqual(["a role", "b role"]);
    expect(roles).toHaveLength(11);
    expect(peopleRoles(people)).toEqual(roles);
  });
});

describe("visible role tabs", () => {
  const roles = peopleRoles(
    Array.from({ length: 8 }, (_, index) => person(`Role ${index + 1}`)),
  );

  it("defaults to the first six existing roles without changing the chooser list", () => {
    const before = structuredClone(roles);
    expect(MAX_PEOPLE_ROLE_TABS).toBe(6);
    expect(visibleRoleTabs(roles, null)).toEqual(roles.slice(0, 6));
    expect(roles).toEqual(before);
    expect(visibleRoleTabs([], null)).toEqual([]);
  });

  it("preserves explicit order, skips unavailable keys and keeps normalized matches unique", () => {
    const selected = [
      "stale role",
      "ROLE ৮",
      "role 2",
      "role 8",
      "role",
      "role 20",
      "role 1",
    ];
    const before = [...selected];
    expect(keys(visibleRoleTabs(roles, selected))).toEqual([
      "role 8",
      "role 2",
      "role 1",
    ]);
    expect(selected).toEqual(before);
  });

  it("caps available selections at six after skipping stale and duplicate keys", () => {
    const selected = [
      "stale",
      "role 8",
      "role 8",
      "role 7",
      "role 6",
      "role 5",
      "role 4",
      "role 3",
      "role 2",
      "role 1",
    ];
    expect(keys(visibleRoleTabs(roles, selected))).toEqual([
      "role 8",
      "role 7",
      "role 6",
      "role 5",
      "role 4",
      "role 3",
    ]);
  });

  it("keeps intentional no-tabs and stale-only preferences empty without silently restoring defaults", () => {
    expect(visibleRoleTabs(roles, [])).toEqual([]);
    expect(visibleRoleTabs(roles, ["removed role"])).toEqual([]);
  });
});
