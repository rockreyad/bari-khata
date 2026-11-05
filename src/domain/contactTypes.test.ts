import { describe, expect, it } from "vitest";
import { PersonSchema } from "./model";
import {
  personKind,
  defaultContactAccount,
  allowedContactActions,
} from "./contacts";
import {
  ContactTypeSchema,
  contactPresetFor,
  contactPresets,
} from "./contactTypes";

describe("durable contact types", () => {
  it.each(["shop", "driver"] as const)(
    "keeps a legacy %s account while an explicit custom type honors configured actions",
    (kind) => {
      const person = PersonSchema.parse({
        id: "person",
        name: "নমুনা",
        kind,
        contactType: "custom",
        quickActions: ["payment", "purchase", "return", "transport"],
      });
      expect(allowedContactActions(person)).toEqual([
        "payment",
        "purchase",
        "return",
        "transport",
      ]);
      expect(defaultContactAccount(person)).toBe(
        kind === "shop" ? "materials" : "other",
      );
    },
  );
  it("keeps an explicit relationship while the free description changes", () => {
    const person = PersonSchema.parse({
      id: "worker",
      name: "নমুনা ব্যক্তি",
      kind: "worker",
      contactType: "professional",
      role: "নকশার দায়িত্ব",
    });
    const changed = PersonSchema.parse({ ...person, role: "সিমেন্ট ও রড" });
    expect(contactPresetFor(changed).id).toBe("professional");
    expect(personKind(changed)).toBe("worker");
    expect(contactPresetFor({ ...person, contactType: "custom" }).id).toBe(
      "custom",
    );
  });

  it.each([
    ["ইঞ্জিনিয়ার", "other", "professional"],
    ["উপ ঠিকাদার", "worker", "contractor"],
    ["কারেন্টের মিস্ত্রি", "worker", "craftsperson"],
    ["নতুন অচেনা পরিচয়", "worker", "custom"],
    ["সুইপার", "shop", "supplier"],
    ["ইঞ্জিনিয়ার", "driver", "transport"],
  ] as const)(
    "infers a legacy %s description conservatively",
    (role, kind, id) => {
      const person = PersonSchema.parse({
        id: "person",
        name: "নমুনা",
        role,
        kind,
      });
      expect(contactPresetFor(person).id).toBe(id);
      expect(Object.hasOwn(person, "contactType")).toBe(false);
    },
  );

  it.each([
    ["supplier", "shop", "materials"],
    ["transport", "driver", "other"],
    ["professional", "worker", "labour"],
    ["custom", "other", "other"],
  ] as const)(
    "uses explicit %s with a legacy null kind",
    (contactType, kind, account) => {
      const person = PersonSchema.parse({
        id: "person",
        name: "নমুনা",
        kind: null,
        contactType,
        role: "অন্য বর্ণনা",
      });
      expect(personKind(person)).toBe(kind);
      expect(defaultContactAccount(person)).toBe(account);
    },
  );

  it("validates every persisted type and its coarse kind without reclassifying old human accounts", () => {
    for (const preset of contactPresets)
      expect(
        PersonSchema.parse({
          id: preset.id,
          name: "নমুনা",
          kind: preset.kind,
          contactType: preset.id,
        }).contactType,
      ).toBe(preset.id);
    expect(ContactTypeSchema.safeParse("unknown").success).toBe(false);
    expect(
      PersonSchema.safeParse({
        id: "person",
        name: "নমুনা",
        kind: "shop",
        contactType: "professional",
      }).success,
    ).toBe(false);
    const oldOther = PersonSchema.parse({
      id: "person",
      name: "নমুনা",
      kind: "other",
      contactType: "professional",
    });
    expect(defaultContactAccount(oldOther)).toBe("other");
    expect(
      PersonSchema.parse({ ...oldOther, kind: "worker", contactType: "custom" })
        .kind,
    ).toBe("worker");
  });
});
