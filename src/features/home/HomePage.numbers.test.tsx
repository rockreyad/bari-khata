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
import { HomePage } from "./HomePage";
const state = vi.hoisted(() => ({
  ledger: null as unknown,
  add: vi.fn(),
  go: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    ledger: state.ledger as Ledger,
    add: state.add,
    go: state.go,
    detail: vi.fn(),
  }),
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  state.go.mockClear();
  state.add.mockClear();
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
    breakdown: "কোথায় কত দিয়েছি",
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
    breakdown: "Where the money went",
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
  const details = container.querySelector("details.home-overview-details");
  expect(details?.hasAttribute("open")).toBe(false);
  expect(
    container.querySelector(".home-overview-paid-total > dd")?.textContent,
  ).toBe("৳\u202f200");
  const correction = container.querySelector(".home-overview-correction");
  expect(correction?.closest("details")).toBeNull();
  expect(correction?.textContent).toContain("Adjustment");
  expect(correction?.textContent).toContain("৳\u202f37");
  fireEvent.click(screen.getByText("Where the money went", { exact: true }));
  expect(details?.hasAttribute("open")).toBe(true);
  expect(
    container.querySelector(".home-overview-breakdown")?.textContent,
  ).toContain("৳\u202f163");
  expect(
    screen.getByText("These amounts include payments and money returned."),
  ).toBeTruthy();
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
        .querySelector(".home-overview-paid-total > dd");
      expect(headline?.textContent).toBe(copy.sum);
      expect(container.querySelector(".home-overview-due")).toBeNull();
      const details = container.querySelector("details.home-overview-details");
      expect(details?.hasAttribute("open")).toBe(false);
      fireEvent.click(screen.getByText(copy.breakdown, { exact: true }));
      expect(details?.hasAttribute("open")).toBe(true);
      expect(
        screen.getByRole("button", { name: new RegExp(copy.materials) })
          .textContent,
      ).toContain(copy.sum);
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
          .querySelector(".home-overview-paid-total > dd")?.textContent,
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
          .querySelector(".home-overview-paid-total > dd")?.textContent,
      ).toBe(copy.one);
      const due = container.querySelector(".home-overview-due");
      expect(due?.textContent).toContain(copy.due);
      expect(due?.querySelector("strong")?.textContent).toBe(copy.old);
      expect(container.querySelectorAll(".history-row")).toHaveLength(2);
    });
  },
);

it("shows a zero paid total without inventing dues or another payment category", () => {
  const { container } = mount(LedgerSchema.parse({}), "bn");
  expect(
    container.querySelector(".home-overview-paid-total > dd")?.textContent,
  ).toBe("৳\u202f০");
  expect(container.querySelector(".home-overview-due")).toBeNull();
  fireEvent.click(screen.getByText("কোথায় কত দিয়েছি", { exact: true }));
  const breakdown = within(
    container.querySelector(".home-overview-breakdown") as HTMLElement,
  );
  expect(breakdown.getAllByRole("button")).toHaveLength(2);
  expect(
    breakdown.getAllByRole("button").map((button) => button.textContent),
  ).toEqual(["মালের টাকা৳\u202f০", "মজুরি৳\u202f০"]);
});

it("keeps category cash net of refunds and opens the matching reports and search", () => {
  const base = fixture("payment");
  const ledger = LedgerSchema.parse({
    ...base,
    entries: [
      ...base.entries,
      ...[
        { id: "labour-paid", kind: "payment", account: "labour", amount: 5000 },
        { id: "other-paid", kind: "payment", account: "other", amount: 1000 },
        { id: "other-refund", kind: "refund", account: "other", amount: 300 },
      ].map(({ amount, ...entry }) => ({
        ...entry,
        personId: "golam",
        date: "2026-11-02",
        allocations: [{ workId: "general", amount }],
        paymentParts: [{ method: "cash", amount }],
      })),
    ],
  });
  const before = JSON.stringify(ledger);
  const { container } = mount(ledger, "bn");
  expect(
    container.querySelector(".home-overview-paid-total > dd")?.textContent,
  ).toBe("৳\u202f২২০");
  fireEvent.click(screen.getByText("কোথায় কত দিয়েছি", { exact: true }));
  const breakdown = within(
    container.querySelector(".home-overview-breakdown") as HTMLElement,
  );
  expect(breakdown.getAllByRole("button")).toHaveLength(3);
  for (const [label, amount, account] of [
    ["মালের টাকা", "৳\u202f১৬৩", "materials"],
    ["মজুরি", "৳\u202f৫০", "labour"],
    ["অন্যান্য", "৳\u202f৭", "other"],
  ]) {
    const button = breakdown.getByRole("button", { name: new RegExp(label) });
    expect(button.textContent).toContain(amount);
    fireEvent.click(button);
    expect(state.go).toHaveBeenLastCalledWith(`/reports?account=${account}`);
  }
  fireEvent.click(screen.getByRole("button", { name: "রিপোর্ট" }));
  expect(state.go).toHaveBeenLastCalledWith("/reports");
  fireEvent.click(screen.getByRole("button", { name: "আগের হিসাব খুঁজুন" }));
  expect(state.go).toHaveBeenLastCalledWith("/ledger?focus=search");
  expect(JSON.stringify(ledger)).toBe(before);
});

it("keeps recording an expense separate from recording money paid", () => {
  mount(fixture("payment"), "bn");
  fireEvent.click(screen.getByRole("button", { name: "খরচ লিখি" }));
  fireEvent.click(screen.getByRole("button", { name: "টাকা দিলাম" }));
  expect(state.add).toHaveBeenCalledTimes(2);
  expect(state.add).toHaveBeenNthCalledWith(1);
  expect(state.add).toHaveBeenNthCalledWith(2, { kind: "payment" });
  expect(state.go).not.toHaveBeenCalled();
});

it("shows five recent records after grouping purchases and retains every paired partial payment", () => {
  const createdAt = "2026-11-04T00:00:00Z";
  const ledger = LedgerSchema.parse({
    works: [{ id: "general", name: "সাধারণ খরচ" }],
    entries: [
      ...["প্রথম বিল", "দ্বিতীয় বিল", "তৃতীয় বিল", "চতুর্থ বিল"].map(
        (label, index) => ({
          id: `recent-${index}`,
          kind: "expense",
          account: "materials",
          date: `2026-11-0${4 - index}`,
          createdAt,
          lines: [
            { id: `line-${index}`, workId: "general", label, amount: 100 },
          ],
        }),
      ),
      {
        id: "partial-bill",
        kind: "expense",
        account: "materials",
        date: "2026-10-31",
        createdAt,
        lines: [
          {
            id: "partial-line",
            workId: "general",
            label: "পঞ্চম বিল",
            amount: 2000,
          },
        ],
      },
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `partial-payment-${index}`,
        kind: "payment",
        account: "materials",
        relatedEntryId: "partial-bill",
        date: "2026-10-31",
        createdAt,
        allocations: [{ workId: "general", amount: 100 }],
        paymentParts: [{ method: "cash", amount: 100 }],
      })),
      {
        id: "older-bill",
        kind: "expense",
        account: "materials",
        date: "2026-10-30",
        createdAt,
        lines: [
          {
            id: "older-line",
            workId: "general",
            label: "আগের বিল",
            amount: 500,
          },
        ],
      },
    ],
  });
  const before = JSON.stringify(ledger);
  const { container } = mount(ledger, "bn");
  expect(container.querySelectorAll(".history-row")).toHaveLength(5);
  expect(
    [...container.querySelectorAll(".history-row-copy > strong")].map(
      (title) => title.textContent,
    ),
  ).toEqual([
    "প্রথম বিল",
    "দ্বিতীয় বিল",
    "তৃতীয় বিল",
    "চতুর্থ বিল",
    "পঞ্চম বিল",
  ]);
  const partial = screen.getByRole("button", { name: /পঞ্চম বিল/ });
  expect(partial.querySelector(".history-row-amount")?.textContent).toBe(
    "৳\u202f২০",
  );
  expect(partial.querySelector(".history-row-meta-v4")?.textContent).toContain(
    "দিয়েছি ৳\u202f৮",
  );
  expect(container.querySelector(".history-payment")).toBeNull();
  expect(screen.queryByRole("button", { name: /আগের বিল/ })).toBeNull();
  expect(JSON.stringify(ledger)).toBe(before);
});

it.each([
  ["bn", "ফেরত পাওয়া টাকা বাদ দিয়ে", "৳\u202f১৫০"],
  ["en", "After subtracting money returned", "৳\u202f150"],
] as const)(
  "explains refunded money in %s without requiring a balance correction",
  (language, explanation, total) => {
    const base = fixture("payment");
    const ledger = LedgerSchema.parse({
      ...base,
      entries: [
        ...base.entries,
        {
          id: "materials-refund",
          kind: "refund",
          account: "materials",
          personId: "golam",
          date: "2026-11-03",
          allocations: [{ workId: "general", amount: 1300 }],
          paymentParts: [{ method: "cash", amount: 1300 }],
        },
      ],
    });
    const before = JSON.stringify(ledger);
    const { container } = mount(ledger, language);
    const note = screen.getByText(explanation, { exact: true });
    expect(note.closest("details")).toBeNull();
    expect(container.querySelector(".home-overview-correction")).toBeNull();
    expect(
      container.querySelector(".home-overview-paid-total > dd")?.textContent,
    ).toBe(total);
    expect(JSON.stringify(ledger)).toBe(before);
  },
);
