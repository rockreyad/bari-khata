// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { PeoplePage, PersonPage } from "./PeoplePages";
const state = vi.hoisted(() => ({
  ledger: null as unknown,
  go: vi.fn(),
  add: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    ledger: state.ledger as Ledger,
    mode: "demo",
    go: state.go,
    add: state.add,
    entity: vi.fn(),
    detail: vi.fn(),
    notify: vi.fn(),
  }),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    language: "bn",
    formatDigits: String,
    t: (text: string) => text,
    money: (value: number) => `৳${value / 100}`,
    number: String,
    date: (value: string | null) => value ?? "—",
  }),
}));
afterEach(() => {
  cleanup();
  state.go.mockClear();
  state.add.mockClear();
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
  it("opens an earned wage bill from a worker with the selected work context and never offers it for a shop", async () => {
    state.ledger = fixture();
    const user = userEvent.setup();
    for (const workId of [undefined, "work"]) {
      const view = renderPage(
        `/people/worker${workId ? `?work=${workId}` : ""}`,
      );
      screen.getByRole("button", { name: "আরও" }).focus();
      await user.keyboard("{Enter}");
      await user.click(
        await screen.findByRole("menuitem", { name: "মজুরির বিল লিখি" }),
      );
      expect(state.add).toHaveBeenLastCalledWith({
        kind: "wage",
        personId: "worker",
        workId,
        account: "labour",
        costType: "labour",
      });
      view.unmount();
    }
    renderPage("/people/shop");
    screen.getByRole("button", { name: "আরও" }).focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("menu")).toBeTruthy();
    expect(
      screen.queryByRole("menuitem", { name: "মজুরির বিল লিখি" }),
    ).toBeNull();
    expect(state.add).toHaveBeenCalledTimes(2);
  });
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
    expect(screen.queryByRole("button", { name: "মাল কিনলাম" })).toBeNull();
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
  it("makes purchasing the shop primary action and keeps returns out of the main buttons", async () => {
    state.ledger = fixture();
    renderPage("/people/shop");
    const purchase = screen.getByRole("button", { name: "মাল কিনলাম" });
    expect(purchase.className).toBe("primary-button");
    expect(screen.getByRole("button", { name: "টাকা দিলাম" }).className).toBe(
      "secondary-button",
    );
    expect(screen.queryByRole("button", { name: "মাল ফেরত লিখি" })).toBeNull();
    await userEvent.click(purchase);
    expect(state.add).toHaveBeenCalledWith({
      kind: "expense",
      personId: "shop",
      workId: undefined,
      account: "materials",
      costType: "material",
    });
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

it("puts a shop's net purchases ahead of payments and shows only its own bills in the monthly chart", () => {
  const ledger = fixture();
  ledger.entries.push(
    ...LedgerSchema.parse({
      works: ledger.works,
      people: ledger.people,
      entries: [
        {
          id: "shop-bill",
          personId: "shop",
          kind: "expense",
          date: "2026-11-01",
          lines: [{ id: "s", workId: "work", label: "মাল", amount: 9300000 }],
        },
        {
          id: "shop-paid",
          personId: "shop",
          kind: "payment",
          date: "2026-11-01",
          allocations: [{ workId: "work", amount: 3000000 }],
          paymentParts: [{ amount: 3000000 }],
        },
      ],
    }).entries,
  );
  state.ledger = ledger;
  const { container } = renderPage("/people/shop");
  const hero = container.querySelector(".contact-summary-hero")!;
  expect(hero.textContent).toContain("মোট কেনাকাটা");
  expect(hero.textContent).toContain("৳93000");
  expect(
    container.querySelector(".contact-summary-metrics")?.textContent,
  ).toContain("৳63000");
  expect(screen.queryByText("মজুরির চুক্তি")).toBeNull();
  expect(screen.getByRole("region", { name: "মাসে মাসে খরচ" })).toBeTruthy();
  expect(screen.queryByText("মিস্ত্রির খরচ")).toBeNull();
});

it("charts a driver's older transport account using the same scoped bills as the profile totals", () => {
  state.ledger = LedgerSchema.parse({
    works: [{ id: "work", name: "দরজা" }],
    people: [{ id: "driver", name: "রনি", kind: "driver" }],
    entries: [
      {
        id: "legacy-trip",
        kind: "expense",
        personId: "driver",
        account: "materials",
        date: "2026-11-01",
        lines: [
          {
            id: "trip-line",
            workId: "work",
            label: "দরজার ভ্যান",
            costType: "transport",
            amount: 50000,
          },
        ],
      },
    ],
  });
  renderPage("/people/driver");
  const chart = screen.getByRole("region", { name: "মাসে মাসে খরচ" });
  expect(chart.querySelector("h2")?.textContent).toBe("৳500");
});
