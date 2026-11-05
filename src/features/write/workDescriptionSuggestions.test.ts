import { expect, it } from "vitest";
import { LedgerSchema } from "../../domain/model";
import { workDescriptionSuggestions } from "./workDescriptionSuggestions";
const entry = (
  id: string,
  label: string,
  personId = "worker",
  workId = "roof",
  extra = {},
) => ({
  id,
  kind: "expense",
  personId,
  account: "labour",
  date: "2026-11-01",
  lines: [
    { id: `${id}-line`, workId, costType: "labour", label, amount: 10000 },
  ],
  ...extra,
});
const ledger = (entries: unknown[]) =>
  LedgerSchema.parse({
    works: [
      { id: "roof", name: "ছাদ" },
      { id: "wall", name: "দেয়াল" },
    ],
    people: [
      { id: "worker", name: "নমুনা কর্মী" },
      { id: "other", name: "অন্য কর্মী" },
    ],
    entries,
  });
it("puts the selected worker and notebook's descriptions before unrelated recent work", () => {
  const source = ledger([
    entry("unrelated", "দরজা লাগানো", "other", "wall", { date: "2026-11-05" }),
    entry("same-worker", "টাইলস লাগানো", "worker", "wall"),
    entry("same-work", "রং করা", "other", "roof"),
    entry("exact", "দেয়ালে প্লাস্টার", "worker", "roof", {
      date: "2026-10-01",
    }),
  ]);
  const before = structuredClone(source);
  expect(
    workDescriptionSuggestions(source, {
      costType: "labour",
      personId: "worker",
      workId: "roof",
    }).map((row) => row.value),
  ).toEqual(["দেয়ালে প্লাস্টার", "টাইলস লাগানো", "রং করা", "দরজা লাগানো"]);
  expect(source).toEqual(before);
});
it("deduplicates normalized descriptions and keeps the most relevant original wording", () => {
  const rows = workDescriptionSuggestions(
    ledger([
      entry("recent", "  Paint  12 walls ", "other", "wall", {
        date: "2026-11-05",
      }),
      entry("relevant", "Paint ১২ walls"),
    ]),
    { costType: "labour", personId: "worker", workId: "roof" },
  );
  expect(rows).toEqual([
    { value: "Paint ১২ walls", description: "নমুনা কর্মী · ছাদ" },
  ]);
});
it("uses only confirmed work of the selected cost type, never materials or cancelled bills", () => {
  const source = ledger([
    entry("valid", "মাল আনার ভাড়া", "worker", "roof", {
      account: "other",
      lines: [
        {
          id: "transport",
          workId: "roof",
          costType: "transport",
          label: "মাল আনার ভাড়া",
          amount: 10000,
        },
      ],
    }),
    entry("labour", "ইট গাঁথা"),
    entry("cancelled", "পুরোনো বাতিল কাজ", "worker", "roof", { voided: true }),
    entry("review", "যাচাই বাকি কাজ", "worker", "roof", {
      reviewStatus: "needs_review",
    }),
    entry("material", "সিমেন্ট", "worker", "roof", {
      account: "materials",
      lines: [
        {
          id: "material-line",
          workId: "roof",
          costType: "material",
          label: "সিমেন্ট",
          amount: 10000,
        },
      ],
    }),
  ]);
  expect(
    workDescriptionSuggestions(source, { costType: "transport" }).map(
      (row) => row.value,
    ),
  ).toEqual(["মাল আনার ভাড়া"]);
  expect(
    workDescriptionSuggestions(source, { costType: "labour" }).map(
      (row) => row.value,
    ),
  ).toEqual(["ইট গাঁথা"]);
});
