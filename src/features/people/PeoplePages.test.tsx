// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { PeoplePage, PersonPage } from "./PeoplePages";
const state = vi.hoisted(() => ({ ledger: null as unknown, go: vi.fn() }));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    ledger: state.ledger as Ledger,
    mode: "demo",
    go: state.go,
    add: vi.fn(),
    entity: vi.fn(),
    detail: vi.fn(),
    notify: vi.fn(),
  }),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    language: "bn",
    t: (text: string) => text,
    money: (value: number) => `৳${value / 100}`,
    number: String,
    date: (value: string | null) => value ?? "—",
  }),
}));
afterEach(() => {
  cleanup();
  state.go.mockClear();
});
function renderPage(path = "/people/worker") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/people" element={<PeoplePage />} />
        <Route path="/people/:personId" element={<PersonPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
function fixture() {
  return LedgerSchema.parse({
    works: [{ id: "work", name: "টাইলস" }],
    people: [
      { id: "worker", name: "রহিম", kind: "worker", phone: "01712345678" },
      { id: "shop", name: "টাইলসের দোকান", kind: "shop" },
    ],
    entries: [
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `wage-${i + 1}`,
        kind: "expense",
        date: `2026-11-0${i + 1}`,
        account: "labour",
        personId: "worker",
        lines: [
          {
            id: `line-${i + 1}`,
            label: `বিল ${i + 1}`,
            amount: 10000,
            workId: "work",
            costType: "labour",
          },
        ],
      })),
      {
        id: "material",
        kind: "expense",
        personId: "worker",
        lines: [
          {
            id: "material-line",
            label: "মিস্ত্রির মাল আলাদা",
            amount: 1000,
            workId: "work",
          },
        ],
      },
    ],
  });
}
describe("minimal people pages", () => {
  it("shows simple contact rows without payment, return, edit or date controls on every contact", () => {
    state.ledger = fixture();
    const { container } = renderPage("/people");
    expect(container.querySelectorAll(".contact-row")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "টাকা দিলাম" })).toBeNull();
    expect(screen.queryByRole("button", { name: "মাল ফেরত লিখি" })).toBeNull();
    expect(container.textContent).not.toContain("2026-11");
  });
  it("shows the last five wage entries and navigates to a scoped chronological history page", async () => {
    state.ledger = fixture();
    const user = userEvent.setup();
    const { container } = renderPage();
    expect(container.querySelectorAll(".history-row")).toHaveLength(5);
    expect(container.textContent).not.toContain("মিস্ত্রির মাল আলাদা");
    expect(screen.queryByRole("button", { name: "মাল কিনেছি" })).toBeNull();
    expect(screen.queryByRole("button", { name: "মাল ফেরত লিখি" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "পুরো হিসাব" }));
    expect(state.go).toHaveBeenCalledWith(
      "/ledger?person=worker&account=labour&order=oldest",
    );
    const rows = [...container.querySelectorAll(".history-row")];
    expect(rows).toHaveLength(5);
    expect(rows[0].textContent).toContain("বিল 7");
    expect(rows[4].textContent).toContain("বিল 3");
  });
  it("keeps shop purchases available and rare returns inside the menu", () => {
    state.ledger = fixture();
    renderPage("/people/shop");
    expect(screen.getByRole("button", { name: "মাল কিনেছি" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "মাল ফেরত লিখি" })).toBeNull();
  });
  it("respects a contact that has intentionally hidden all quick actions", () => {
    const ledger = fixture();
    ledger.people[0].quickActions = [];
    state.ledger = ledger;
    renderPage();
    expect(screen.queryByRole("button", { name: "টাকা দিলাম" })).toBeNull();
  });
  it("does not inflate a worker balance with a cancelled record while routing full history", async () => {
    const ledger = fixture();
    ledger.entries.push({
      ...ledger.entries[0],
      id: "cancelled",
      date: "2026-10-01",
      voided: true,
    });
    state.ledger = ledger;
    const user = userEvent.setup();
    const { container } = renderPage();
    expect(container.querySelectorAll(".history-row")).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: "পুরো হিসাব" }));
    expect(state.go).toHaveBeenCalledWith(
      "/ledger?person=worker&account=labour&order=oldest",
    );
    expect(container.querySelectorAll(".history-row")).toHaveLength(5);
    expect(container.textContent).toContain("৳700");
    expect(container.textContent).not.toContain("৳800");
  });
  it("makes a worker's old material account read-only instead of offering a misleading wage payment there", () => {
    state.ledger = fixture();
    renderPage("/people/worker?account=materials");
    expect(screen.queryByRole("button", { name: "টাকা দিলাম" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "মূল হিসাবে ফিরি" }),
    ).toBeTruthy();
  });
});
