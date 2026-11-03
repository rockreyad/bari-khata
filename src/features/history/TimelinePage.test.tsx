// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { LedgerSchema } from "../../domain/model";
import { TimelinePage } from "./TimelinePage";
const state = vi.hoisted(() => ({
  ledger: {} as unknown,
  go: vi.fn(),
  detail: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({ useNotebook: () => state }));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string) => text,
    money: (value: number) => `৳${value / 100}`,
    formatDigits: String,
    date: (value: string) => value.slice(0, 10),
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("filters by category and either numeral script, opens the actual record, and never changes ledger data", () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "work", name: "খাতা" }],
    entries: [
      {
        id: "bill",
        kind: "expense",
        createdAt: "2026-11-03T10:00:00Z",
        lines: [
          { id: "line", workId: "work", label: "সিমেন্ট ১৬", amount: 100000 },
        ],
      },
    ],
  });
  state.ledger = ledger;
  const before = JSON.stringify(ledger);
  render(
    <MemoryRouter>
      <TimelinePage />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "টাইমলাইনে খুঁজুন" }), {
    target: { value: "16" },
  });
  const record = screen.getByRole("button", { name: /খরচের হিসাব রেখেছি/ });
  fireEvent.click(record);
  expect(state.detail).toHaveBeenCalledExactlyOnceWith("bill");
  fireEvent.click(screen.getByRole("button", { name: "মিস্ত্রির কাজ" }));
  expect(screen.getByText("এখানে কোনো ঘটনা পাওয়া যায়নি।")).toBeTruthy();
  expect(JSON.stringify(ledger)).toBe(before);
});
it("shows more events without losing the timeline filter", () => {
  state.ledger = LedgerSchema.parse({
    works: [{ id: "work", name: "খাতা" }],
    entries: Array.from({ length: 45 }, (_, index) => ({
      id: `bill${index}`,
      kind: "expense",
      createdAt: "2026-11-03T10:00:00Z",
      lines: [
        {
          id: `line${index}`,
          workId: "work",
          label: `সিমেন্ট ${index}`,
          amount: 100,
        },
      ],
    })),
  });
  render(
    <MemoryRouter initialEntries={["/timeline?type=money"]}>
      <TimelinePage />
    </MemoryRouter>,
  );
  expect(
    screen.getAllByRole("button", { name: /খরচের হিসাব রেখেছি/ }),
  ).toHaveLength(40);
  fireEvent.click(screen.getByRole("button", { name: "আরও ঘটনা দেখুন" }));
  expect(
    screen.getAllByRole("button", { name: /খরচের হিসাব রেখেছি/ }),
  ).toHaveLength(45);
  expect(
    screen.getByRole("button", { name: "হিসাব", pressed: true }),
  ).toBeTruthy();
});
