import { describe, it, expect } from "vitest";
import { ItemSchema } from "../../domain/model";
import { materialSuggestion } from "./materialSuggestion";
describe("material suggestions", () => {
  it("does not guess a brand when the same material name has different brands", () => {
    const items = ["Crown", "Shah"].map((brand) =>
      ItemSchema.parse({
        id: brand,
        name: "সিমেন্ট",
        materialGroupId: "cement",
        brand,
      }),
    );
    expect(materialSuggestion(items, "সিমেন্ট", {})).toEqual({
      label: "সিমেন্ট",
    });
  });
  it("fills a uniquely named variant and removes its automatic metadata after changing the material", () => {
    const item = ItemSchema.parse({
      id: "crown",
      name: "Crown সিমেন্ট",
      materialGroupId: "cement",
      brand: "Crown",
    });
    expect(materialSuggestion([item], item.name, {})).toMatchObject({
      brand: "Crown",
      autoItemName: item.name,
    });
    expect(
      materialSuggestion([item], "দরজা", { autoItemName: item.name }),
    ).toMatchObject({ brand: "", groupId: "", autoItemName: "" });
  });
  it("preserves explicitly entered metadata while editing an unrelated description", () => {
    expect(materialSuggestion([], "আঠা + ক্লিপ", { autoItemName: "" })).toEqual(
      { label: "আঠা + ক্লিপ" },
    );
  });
});
