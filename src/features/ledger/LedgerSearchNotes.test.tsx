// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LanguageProvider } from "../../context/LanguageProvider";
import { createEmptyLedger } from "../../domain/demo";
import { EntrySchema } from "../../domain/model";
import { LedgerSearchNotes } from "./LedgerSearchNotes";
import { buildLedgerSearchIndex, selectLedgerSearch } from "./searchAnalytics";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function warningResult() {
  return {
    ...selectLedgerSearch(buildLedgerSearchIndex(createEmptyLedger()), {}),
    entries: [
      EntrySchema.parse({
        id: "sample-payment",
        kind: "payment",
        account: "materials",
        allocations: [{ workId: "sample-work", amount: 100 }],
        paymentParts: [{ amount: 100 }],
      }),
    ],
    ambiguousEntryIds: ["sample-note-match", "sample-group-match"],
    groupAmbiguousEntryIds: ["sample-group-match"],
    partiallyAmbiguousEntryIds: ["sample-partial-return"],
    unassignedAdjustmentCount: 1,
    reviewEntryCount: 2,
    historicalEntryCount: 3,
  };
}

it("keeps bill uncertainty visible with a cash headline without cost-only explanations", () => {
  render(
    <LanguageProvider>
      <LedgerSearchNotes result={warningResult()} showCostContext={false} />
    </LanguageProvider>,
  );
  expect(screen.getByText(/১টি বিল শুধু অন্য তথ্যে মিলেছে/)).toBeTruthy();
  expect(screen.getByText(/কিছু লেখায় একাধিক মালের নাম/)).toBeTruthy();
  expect(screen.getByText(/কিছু ফেরতের মালের পরিচয় মেলেনি/)).toBeTruthy();
  expect(
    screen.getByText(/২টি হিসাব যাচাই বাকি · ৩টি পুরোনো খরচের হিসাব আছে/),
  ).toBeTruthy();
  expect(screen.queryByText(/আলাদা সমন্বয় এখানে যোগ করা হয়নি/)).toBeNull();
  expect(screen.queryByText(/এই বাছাইয়ে খরচের বিল নেই/)).toBeNull();
});

it("retains the existing cost explanations by default", () => {
  render(
    <LanguageProvider>
      <LedgerSearchNotes result={warningResult()} />
    </LanguageProvider>,
  );
  expect(screen.getByText(/আলাদা সমন্বয় এখানে যোগ করা হয়নি/)).toBeTruthy();
  expect(screen.getByText(/এই বাছাইয়ে খরচের বিল নেই/)).toBeTruthy();
});
