// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { LanguageProvider } from "../../context/LanguageProvider";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { savePreferences } from "../../lib/preferences";
import { HomePage } from "./HomePage";
const state = vi.hoisted(() => ({ ledger: null as unknown, go: vi.fn() }));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    ledger: state.ledger as Ledger,
    add: vi.fn(),
    go: state.go,
    detail: vi.fn(),
  }),
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  state.go.mockClear();
});
function fixture(secondKind: "payment" | "expense" | "unpaid") {
  return LedgerSchema.parse({
    project: { name: "সংখ্যার পরীক্ষা" },
    works: [{ id: "general", name: "সাধারণ খরচ" }],
    people: [{ id: "golam", name: "Golam", kind: "other" }],
    entries: [
      {
        id: "che",
        kind: "expense",
        account: "materials",
        date: "2026-11-02",
        lines: [
          { id: "che-line", workId: "general", label: "che", amount: 100 },
        ],
      },
      {
        id: "che-paid",
        kind: "payment",
        account: "materials",
        relatedEntryId: "che",
        date: "2026-11-02",
        allocations: [{ workId: "general", amount: 100 }],
        paymentParts: [{ method: "cash", amount: 100 }],
      },
      secondKind === "payment"
        ? {
            id: "golam-entry",
            kind: "payment",
            account: "materials",
            personId: "golam",
            date: "2026-11-01",
            allocations: [{ workId: "general", amount: 16200 }],
            paymentParts: [{ method: "cash", amount: 16200 }],
          }
        : {
            id: "golam-entry",
            kind: "expense",
            account: "materials",
            personId: "golam",
            date: "2026-11-01",
            lines: [
              {
                id: "golam-line",
                workId: "general",
                label: "Golam",
                amount: 16200,
              },
            ],
          },
      ...(secondKind === "expense"
        ? [
            {
              id: "golam-paid",
              kind: "payment",
              account: "materials",
              personId: "golam",
              relatedEntryId: "golam-entry",
              date: "2026-11-01",
              allocations: [{ workId: "general", amount: 16200 }],
              paymentParts: [{ method: "cash", amount: 16200 }],
            },
          ]
        : []),
    ].map((entry) => ({ ...entry, createdAt: "2026-11-02T00:00:00Z" })),
  });
}
function mount(ledger: Ledger, language: "bn" | "en") {
  state.ledger = ledger;
  savePreferences({ language });
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <HomePage />
      </LanguageProvider>
    </MemoryRouter>,
  );
}
const labels = {
  bn: {
    total: "মোট দিয়েছি",
    one: "৳\u202f১",
    old: "৳\u202f১৬২",
    sum: "৳\u202f১৬৩",
    cost: "খরচ",
    payment: "টাকা দিয়েছি",
    due: "দিতে বাকি",
    materials: "মালের টাকা",
  },
  en: {
    total: "Total paid",
    one: "৳\u202f1",
    old: "৳\u202f162",
    sum: "৳\u202f163",
    cost: "Cost",
    payment: "Paid someone",
    due: "Amount owed",
    materials: "Material payment",
  },
};
it("shows only ongoing notebooks on home", () => {
  const ledger = LedgerSchema.parse({
    works: [
      { id: "current", name: "চলতি খাতা", status: "ongoing" },
      { id: "later", name: "পরের খাতা", status: "planned" },
      { id: "finished", name: "শেষ খাতা", status: "done" },
    ],
  });
  const view = mount(ledger, "bn");
  expect(view.container.querySelectorAll(".work-carousel h3")).toHaveLength(1);
  expect(view.container.querySelector(".work-carousel h3")?.textContent).toBe(
    "চলতি খাতা",
  );
});
it("shows a corrected paid headline and a separate correction without changing cash category rows", () => {
  const base = fixture("payment");
  const ledger = LedgerSchema.parse({
    ...base,
    entries: [
      ...base.entries,
      {
        id: "adjust",
        kind: "adjustment",
        personId: null,
        account: "other",
        note: "মোট মিলিয়েছি",
        adjustment: {
          target: "work",
          basis: "paid",
          account: null,
          before: 16300,
          after: 20000,
          delta: 3700,
          workId: "general",
        },
      },
    ],
  });
  const before = JSON.stringify(ledger);
  const { container } = mount(ledger, "en");
  expect(
    container.querySelector(".home-total-heading strong")?.textContent,
  ).toBe("৳\u202f200");
  expect(container.querySelector(".home-total-heading")?.textContent).toContain(
    "Adjustment",
  );
  expect(container.querySelector(".home-total-heading")?.textContent).toContain(
    "৳\u202f37",
  );
  expect(
    container.querySelector(".home-total-breakdown")?.textContent,
  ).toContain("৳\u202f163");
  expect(JSON.stringify(ledger)).toBe(before);
});
describe.each(["bn", "en"] as const)(
  "home numeric ledger in %s",
  (language) => {
    it("shows 163 taka paid from a paid one-taka purchase and a standalone 162-taka payment without double counting the bill", () => {
      const ledger = fixture("payment");
      const before = JSON.stringify(ledger);
      const copy = labels[language];
      const { container } = mount(ledger, language);
      const headline = screen
        .getByRole("region", { name: copy.total })
        .querySelector(".home-total-heading strong");
      expect(headline?.textContent).toBe(copy.sum);
      expect(container.querySelector(".home-known-due")).toBeNull();
      expect(
        screen.getByRole("button", { name: `${copy.materials}${copy.sum}` }),
      ).toBeTruthy();
      const expense = container.querySelector(".history-expense");
      const payment = container.querySelector(".history-payment");
      expect(expense?.textContent).toContain("che");
      expect(expense?.textContent).toContain(copy.cost);
      expect(payment?.textContent).toContain("Golam");
      expect(payment?.textContent).toContain(copy.payment);
      expect(payment?.querySelector(".history-row-amount")?.textContent).toBe(
        copy.old,
      );
      expect(container.querySelectorAll(".history-row")).toHaveLength(2);
      expect(JSON.stringify(ledger)).toBe(before);
    });
    it("sums cash attached to two old ASCII numeric expenses as 163 taka, counting neither bill twice", () => {
      const ledger = fixture("expense");
      const before = JSON.stringify(ledger);
      const copy = labels[language];
      const { container } = mount(ledger, language);
      expect(
        screen
          .getByRole("region", { name: copy.total })
          .querySelector(".home-total-heading strong")?.textContent,
      ).toBe(copy.sum);
      expect(container.querySelectorAll(".history-expense")).toHaveLength(2);
      expect(container.querySelector(".history-payment")).toBeNull();
      expect(
        [...container.querySelectorAll(".history-row-amount")].map(
          (amount) => amount.textContent,
        ),
      ).toEqual([copy.one, copy.old]);
      expect(
        ledger.entries
          .filter((entry) => entry.kind === "expense")
          .map((entry) => entry.lines[0].amount),
      ).toEqual([100, 16200]);
      expect(JSON.stringify(ledger)).toBe(before);
    });
    it("keeps an unpaid bill out of total paid and shows only its known due", () => {
      const ledger = fixture("unpaid");
      const copy = labels[language];
      const { container } = mount(ledger, language);
      expect(
        screen
          .getByRole("region", { name: copy.total })
          .querySelector(".home-total-heading strong")?.textContent,
      ).toBe(copy.one);
      const due = container.querySelector(".home-known-due");
      expect(due?.textContent).toContain(copy.due);
      expect(due?.querySelector("strong")?.textContent).toBe(copy.old);
      expect(container.querySelectorAll(".history-row")).toHaveLength(2);
    });
  },
);

it("opens all contractor work directly from the home page without any existing job", () => {
  mount(fixture("payment"), "bn");
  fireEvent.click(
    screen.getByRole("button", {
      name: "মিস্ত্রির কাজ",
    }),
  );
  expect(state.go).toHaveBeenLastCalledWith("/jobs");
});
