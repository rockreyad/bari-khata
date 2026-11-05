// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { LanguageProvider } from "../../context/LanguageProvider";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { savePreferences } from "../../lib/preferences";
import { formatMoney } from "../../lib/formatMoney";
import { HomePage } from "./HomePage";
const api = vi.hoisted(() => ({
  ledger: null as unknown,
  go: vi.fn(),
  detail: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({ ...api, ledger: api.ledger as Ledger }),
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});
function fixture(mode: "payment" | "paid-purchase" | "due" = "payment") {
  const bill = {
    id: "first",
    kind: "expense",
    date: "2026-11-01",
    createdAt: "2026-11-05T00:00:00Z",
    lines: [{ id: "one", workId: "roof", label: "নমুনা সিমেন্ট", amount: 100 }],
  };
  const paid = {
    id: "first-paid",
    kind: "payment",
    date: "2026-11-01",
    createdAt: "2026-11-05T00:00:00Z",
    relatedEntryId: "first",
    allocations: [{ workId: "roof", amount: 100 }],
    paymentParts: [{ amount: 100 }],
  };
  const second =
    mode === "payment"
      ? {
          id: "second",
          kind: "payment",
          personId: "party",
          date: "2026-11-02",
          createdAt: "2026-11-05T00:00:00Z",
          allocations: [{ workId: "roof", amount: 16200 }],
          paymentParts: [{ amount: 16200 }],
        }
      : {
          id: "second",
          kind: "expense",
          personId: "party",
          date: "2026-11-02",
          createdAt: "2026-11-05T00:00:00Z",
          lines: [
            { id: "two", workId: "roof", label: "নমুনা রড", amount: 16200 },
          ],
        };
  return LedgerSchema.parse({
    project: { name: "নমুনা বাড়ি" },
    works: [{ id: "roof", name: "নমুনা ছাদ" }],
    people: [{ id: "party", name: "নমুনা নাম", kind: "other" }],
    entries: [
      bill,
      paid,
      second,
      ...(mode === "paid-purchase"
        ? [
            {
              id: "second-paid",
              kind: "payment",
              personId: "party",
              date: "2026-11-02",
              createdAt: "2026-11-05T00:00:00Z",
              relatedEntryId: "second",
              allocations: [{ workId: "roof", amount: 16200 }],
              paymentParts: [{ amount: 16200 }],
            },
          ]
        : []),
    ],
  });
}
function mount(ledger: Ledger, language: "bn" | "en" = "bn") {
  api.ledger = ledger;
  savePreferences({ language });
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <HomePage />
      </LanguageProvider>
    </MemoryRouter>,
  );
}
describe.each(["bn", "en"] as const)("house overview in %s", (language) => {
  it.each([
    ["payment", 100, 16300, 0],
    ["paid-purchase", 16300, 16300, 0],
    ["due", 16300, 100, 16200],
  ] as const)(
    "separates received cost, actual payment and earned due for %s",
    (mode, cost, paid, due) => {
      const ledger = fixture(mode);
      const before = structuredClone(ledger);
      const { container } = mount(ledger, language);
      expect(container.querySelector(".house-cost > strong")?.textContent).toBe(
        formatMoney(cost, language),
      );
      expect(container.querySelector(".house-paid > strong")?.textContent).toBe(
        formatMoney(paid, language),
      );
      expect(
        container.querySelector(".home-overview-due > strong")?.textContent,
      ).toBe(formatMoney(due, language));
      expect(container.querySelectorAll(".history-row")).toHaveLength(2);
      expect(ledger).toEqual(before);
    },
  );
  it("keeps refunds out of net paid without changing purchase cost", () => {
    const source = fixture();
    const ledger = LedgerSchema.parse({
      ...source,
      entries: [
        ...source.entries,
        {
          id: "refund",
          kind: "refund",
          personId: "party",
          allocations: [{ workId: "roof", amount: 1300 }],
          paymentParts: [{ amount: 1300 }],
        },
      ],
    });
    const { container } = mount(ledger, language);
    expect(container.querySelector(".house-cost > strong")?.textContent).toBe(
      formatMoney(100, language),
    );
    expect(container.querySelector(".house-paid > strong")?.textContent).toBe(
      formatMoney(15000, language),
    );
  });
});
it("starts each house task directly and keeps history and report routes separate", () => {
  const { container } = mount(fixture());
  const actions = within(
    container.querySelector(".house-write-actions") as HTMLElement,
  );
  for (const [label, path] of [
    ["মাল কিনেছি", "/write/purchase"],
    ["কাজের বিল", "/write/charge"],
    ["টাকা দিয়েছি", "/write/payment"],
  ]) {
    fireEvent.click(actions.getByRole("button", { name: new RegExp(label) }));
    expect(api.go).toHaveBeenLastCalledWith(path);
  }
  fireEvent.click(screen.getByRole("button", { name: "আগের হিসাব খুঁজুন" }));
  expect(api.go).toHaveBeenLastCalledWith("/history?focus=search");
  fireEvent.click(screen.getByRole("button", { name: /খরচ দেখি/ }));
  expect(api.go).toHaveBeenLastCalledWith("/reports?mode=cost&section=all");
});
it("does not count a planned agreement as work received or a current due", () => {
  const ledger = LedgerSchema.parse({
    people: [{ id: "p", name: "নমুনা মিস্ত্রি" }],
    works: [{ id: "w", name: "নমুনা কাজ" }],
    contracts: [{ id: "c", personId: "p", workId: "w", total: 60000000 }],
  });
  const { container } = mount(ledger);
  expect(container.querySelector(".house-cost > strong")?.textContent).toBe(
    formatMoney(0, "bn"),
  );
  expect(
    container.querySelector(".home-overview-due > strong")?.textContent,
  ).toBe(formatMoney(0, "bn"));
});
it("retains earlier recorded costs while keeping their unknown payments out of a guessed current due", () => {
  const source = fixture("due");
  const ledger = LedgerSchema.parse({
    ...source,
    entries: source.entries
      .filter((entry) => entry.kind === "expense")
      .map((entry) => ({
        ...entry,
        balanceImpact: "historical",
        reviewStatus: "needs_review",
      })),
  });
  const before = structuredClone(ledger);
  const { container } = mount(ledger);
  expect(container.querySelector(".house-cost > strong")?.textContent).toBe(
    formatMoney(16300, "bn"),
  );
  expect(container.querySelector(".house-paid > strong")?.textContent).toBe(
    formatMoney(0, "bn"),
  );
  expect(
    container.querySelector(".home-overview-due > strong")?.textContent,
  ).toBe(formatMoney(0, "bn"));
  expect(container.querySelector(".house-history-note")).toBeTruthy();
  expect(ledger).toEqual(before);
});
it("shows only five grouped recent purchases without hiding partial cash from their amount", () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "w", name: "নমুনা কাজ" }],
    entries: [
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `b${index}`,
        kind: "expense",
        date: `2026-11-0${6 - index}`,
        createdAt: "2026-11-05T00:00:00Z",
        lines: [
          {
            id: `l${index}`,
            workId: "w",
            label: `নমুনা বিল ${index}`,
            amount: 2000,
          },
        ],
      })),
      {
        id: "partial",
        kind: "payment",
        date: "2026-11-02",
        createdAt: "2026-11-05T00:00:00Z",
        relatedEntryId: "b4",
        allocations: [{ workId: "w", amount: 800 }],
        paymentParts: [{ amount: 800 }],
      },
    ],
  });
  const { container } = mount(ledger);
  expect(container.querySelectorAll(".history-row")).toHaveLength(5);
  expect(screen.queryByRole("button", { name: /নমুনা বিল ৫/ })).toBeNull();
  expect(
    screen.getByRole("button", { name: /নমুনা বিল ৪/ }).textContent,
  ).toContain(formatMoney(800, "bn"));
});
