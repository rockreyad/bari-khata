// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageProvider } from "../../context/LanguageProvider";
import { createEmptyLedger } from "../../domain/demo";
import { LedgerSchema } from "../../domain/model";
import { savePreferences } from "../../lib/preferences";
import { PartyLedgerSummary } from "./PartyLedgerSummary";
import {
  buildLedgerSearchIndex,
  selectLedgerSearch,
  type LedgerSearchFilters,
} from "./searchAnalytics";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function fixture(kind: "worker" | "shop" = "worker") {
  return LedgerSchema.parse({
    ...createEmptyLedger(),
    works: [
      { id: "work", name: "নমুনা কাজ" },
      { id: "other", name: "নমুনা অন্য কাজ" },
    ],
    people: [{ id: "party", name: "নমুনা কর্মী", kind }],
    entries: [
      {
        id: "bill",
        kind: "expense",
        personId: "party",
        date: "2026-10-01",
        lines: [
          { id: "line", workId: "work", label: "নমুনা মাল", amount: 100000 },
        ],
      },
      {
        id: "return",
        kind: "expense_credit",
        personId: "party",
        date: "2026-11-02",
        relatedEntryId: "bill",
        lines: [
          { id: "returned", workId: "work", label: "নমুনা মাল", amount: 20000 },
        ],
      },
      {
        id: "paid",
        kind: "payment",
        personId: "party",
        date: "2026-11-03",
        note: "নমুনা কিস্তি",
        allocations: [
          { workId: "work", amount: 40000 },
          { workId: "other", amount: 20000 },
        ],
        paymentParts: [{ amount: 60000 }],
      },
      {
        id: "refund",
        kind: "refund",
        personId: "party",
        date: "2026-11-04",
        allocations: [{ workId: "work", amount: 10000 }],
        paymentParts: [{ amount: 10000 }],
      },
      {
        id: "correction",
        kind: "adjustment",
        personId: "party",
        date: "2026-11-05",
        note: "নমুনা দেওয়া টাকার সংশোধন",
        adjustment: {
          target: "person",
          basis: "paid",
          account: "materials",
          workId: null,
          before: 60000,
          after: 55000,
          delta: -5000,
        },
      },
    ],
  });
}

function mount(ledger = fixture(), filters: LedgerSearchFilters = {}) {
  const result = selectLedgerSearch(buildLedgerSearchIndex(ledger), {
    personId: "party",
    ...filters,
  });
  const onMonthChange = vi.fn();
  render(
    <LanguageProvider>
      <PartyLedgerSummary
        ledger={ledger}
        person={ledger.people[0]}
        result={result}
        workId={filters.workId ?? ""}
        kind={filters.kind ?? ""}
        costType={filters.costType ?? ""}
        material={filters.material ?? ""}
        month={filters.month ?? ""}
        onMonthChange={onMonthChange}
      />
    </LanguageProvider>,
  );
  return {
    summary: screen.getByRole("region", { name: "খোঁজার হিসাব" }),
    onMonthChange,
  };
}

function total(summary: HTMLElement) {
  return summary.querySelector("output")?.textContent;
}

it("shows a worker's corrected net payments and bills separately", () => {
  const { summary } = mount();
  expect(within(summary).getByText("মোট দিয়েছি")).toBeTruthy();
  expect(total(summary)).toMatch(/৪৫০/);
  expect(
    within(summary).getByText("লেনদেনে দিয়েছি").parentElement?.textContent,
  ).toMatch(/৬০০/);
  expect(
    within(summary).getByText("ফেরত পেয়েছি").parentElement?.textContent,
  ).toMatch(/১০০/);
  expect(
    within(summary).getByText("দেওয়া টাকার সংশোধন").parentElement?.textContent,
  ).toMatch(/-.*৫০/);
  expect(
    within(summary).getByText("বিলের মোট").parentElement?.textContent,
  ).toMatch(/৮০০/);
  expect(within(summary).getByText("২টি টাকা লেনদেন")).toBeTruthy();
  expect(within(summary).queryByText("মোট খরচ")).toBeNull();
  expect(within(summary).queryByText("মাসে মাসে")).toBeNull();
});

it("shows supplier costs first with payments beside them, without adding both", () => {
  const { summary } = mount(fixture("shop"));
  expect(within(summary).getByText("মোট খরচ")).toBeTruthy();
  expect(total(summary)).toMatch(/৮০০/);
  expect(
    within(summary).getByText("মোট দিয়েছি").parentElement?.textContent,
  ).toMatch(/৪৫০/);
});

it.each([
  ["payment", "মোট দিয়েছি", "৬০০"],
  ["refund", "মোট ফেরত পেয়েছি", "১০০"],
  ["expense", "মোট খরচ", "১,০০০"],
  ["expense_credit", "ফেরত দেওয়া মালের মোট", "২০০"],
])("lets %s selection override contact role", (kind, label, amount) => {
  const { summary } = mount(fixture("shop"), { kind });
  expect(within(summary).getByText(label)).toBeTruthy();
  expect(total(summary)).toContain(amount);
});

it("uses only matching work allocations and excludes unassigned corrections", () => {
  const { summary } = mount(fixture(), { workId: "work" });
  expect(total(summary)).toMatch(/৩০০/);
  expect(within(summary).queryByText("দেওয়া টাকার সংশোধন")).toBeNull();
});

it("uses search matches rather than the person's lifetime payment total", () => {
  const { summary } = mount(fixture(), { query: "কিস্তি" });
  expect(total(summary)).toMatch(/৬০০/);
  expect(within(summary).getByText("১টি টাকা লেনদেন")).toBeTruthy();
});

it("retains a selected month and offers all months for cash history", async () => {
  const { summary, onMonthChange } = mount(fixture(), { month: "2026-11" });
  expect(total(summary)).toMatch(/৪৫০/);
  await userEvent.click(
    within(summary).getByRole("button", { name: "সব মাস দেখুন" }),
  );
  expect(onMonthChange).toHaveBeenCalledWith("");
});

it("does not describe corrections as payments or add different bases", () => {
  const ledger = fixture();
  ledger.entries.push(
    LedgerSchema.parse({
      ...ledger,
      entries: [
        {
          ...ledger.entries[4],
          id: "cost-fix",
          adjustment: {
            ...ledger.entries[4].adjustment,
            basis: "cost",
            before: 80000,
            after: 90000,
            delta: 10000,
          },
        },
      ],
    }).entries[0],
  );
  const { summary } = mount(ledger, { kind: "adjustment" });
  expect(total(summary)).toBe("২");
  expect(
    within(summary).getByText("দেওয়া টাকার সংশোধন").parentElement?.textContent,
  ).toMatch(/৫০/);
  expect(
    within(summary).getByText("বিলের সংশোধন").parentElement?.textContent,
  ).toMatch(/১০০/);
  expect(within(summary).queryByText("মোট দিয়েছি")).toBeNull();
});

it("shows payment history for a shop without recorded bills", () => {
  const ledger = fixture("shop");
  ledger.entries = ledger.entries.filter(
    (e) => e.kind !== "expense" && e.kind !== "expense_credit",
  );
  const { summary } = mount(ledger);
  expect(within(summary).getByText("মোট দিয়েছি")).toBeTruthy();
  expect(total(summary)).toMatch(/৪৫০/);
});

it("translates the cash summary into English", () => {
  savePreferences({ language: "en" });
  const ledger = fixture();
  render(
    <LanguageProvider>
      <PartyLedgerSummary
        ledger={ledger}
        person={ledger.people[0]}
        result={selectLedgerSearch(buildLedgerSearchIndex(ledger), {
          personId: "party",
        })}
        workId=""
        kind=""
        costType=""
        material=""
        month=""
        onMonthChange={() => {}}
      />
    </LanguageProvider>,
  );
  const summary = screen.getByRole("region", { name: "Search totals" });
  expect(within(summary).getByText("Recorded payments")).toBeTruthy();
  expect(within(summary).getByText("Payment correction")).toBeTruthy();
  expect(summary.textContent).not.toMatch(/[\u0980-\u09ef]/);
});

it("keeps historical cash out of the total and discloses the exclusion", () => {
  const ledger = fixture();
  ledger.entries[2].balanceImpact = "historical";
  ledger.entries = ledger.entries.filter((e) => e.kind !== "adjustment");
  const { summary } = mount(ledger, { kind: "payment" });
  expect(total(summary)).toMatch(/০/);
  expect(
    within(summary).getByText("১টি পুরোনো লেনদেন এই মোটে ধরা হয়নি।"),
  ).toBeTruthy();
});

it("retains bill review warnings next to a worker's cash total", () => {
  const ledger = fixture();
  ledger.entries[0].reviewStatus = "needs_review";
  ledger.entries[0].balanceImpact = "historical";
  const { summary } = mount(ledger);
  expect(total(summary)).toMatch(/৪৫০/);
  expect(summary.textContent).toContain("১টি হিসাব যাচাই বাকি");
  expect(summary.textContent).toContain("১টি পুরোনো খরচের হিসাব আছে");
});

it("warns when a selected contract correction is unresolved", () => {
  const ledger = LedgerSchema.parse({
    ...fixture(),
    contracts: [{ id: "job", personId: "party", workId: "work", total: 10000 }],
    entries: [
      {
        id: "old-correction",
        kind: "adjustment",
        personId: "party",
        account: "labour",
        contractId: "job",
        note: "নমুনা আগের সংশোধন",
        adjustment: {
          target: "person",
          basis: "balance",
          account: "labour",
          workId: "work",
          before: 8000,
          after: 7000,
          delta: -1000,
        },
      },
    ],
  });
  const { summary } = mount(ledger, { kind: "adjustment" });
  expect(within(summary).getByText("যাচাই বাকি")).toBeTruthy();
  expect(
    within(summary)
      .getByText("১টি সংশোধন যাচাই বাকি। সেগুলো মোটে ধরা হয়নি।")
      .getAttribute("role"),
  ).toBe("status");
});
