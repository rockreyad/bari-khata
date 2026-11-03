import { expect, it } from "vitest";
import { entryReturn } from "../../app/entryRoutes";
import { reconciliationEditUrl } from "./reconciliation";

it("keeps reconciliation and timeline returns in the current workspace without allowing new form loops", () => {
  for (const base of ["", "/sample"])
    for (const path of ["reconcile", "timeline"]) {
      expect(entryReturn(`${base}/${path}?id=one&_entry=old`, base)).toBe(
        `${base}/${path}?id=one`,
      );
    }
  expect(entryReturn("/sample/reconcile", "")).toBe("/");
  expect(entryReturn("/timeline/edit")).toBe("/");
  expect(entryReturn("/reconcile/../entries/new")).toBe("/");
  expect(
    reconciliationEditUrl(
      "/sample",
      "bill",
      "bill/one",
      "https://outside.invalid",
    ),
  ).toContain("/sample/entries/bill%2Fone/edit?");
  expect(
    new URL(
      reconciliationEditUrl(
        "/sample",
        "bill",
        "one",
        "https://outside.invalid",
      ),
      "https://bari.invalid",
    ).searchParams.get("back"),
  ).toBe("/sample/");
});
