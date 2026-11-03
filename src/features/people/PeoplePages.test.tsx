// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { PeoplePage, PersonPage } from "./PeoplePages";
import { contactAccountSummary } from "../../domain/contacts";
import * as repository from "../../data/repository";
const state = vi.hoisted(() => ({
  ledger: null as unknown,
  go: vi.fn(),
  add: vi.fn(),
  entity: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    ledger: state.ledger as Ledger,
    mode: "demo",
    go: state.go,
    add: state.add,
    entity: state.entity,
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
  state.entity.mockClear();
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
it("shows the person's corrected paid total with a correction note in the directory", () => {
  const base = fixture();
  const person = base.people.find((row) => row.id === "worker")!;
  const before = contactAccountSummary(base, person).netPaid;
  state.ledger = LedgerSchema.parse({
    ...base,
    entries: [
      ...base.entries,
      {
        id: "adjust",
        kind: "adjustment",
        personId: "worker",
        account: "labour",
        note: "অঙ্ক মিলিয়েছি",
        adjustment: {
          target: "person",
          basis: "paid",
          account: "labour",
          before,
          after: before + 10000,
          delta: 10000,
          workId: null,
        },
      },
    ],
  });
  renderPage("/people");
  const row = screen.getByRole("button", { name: /রহিম/ });
  expect(row.textContent).toContain(`৳${(before + 10000) / 100}`);
  expect(row.textContent).toContain("সমন্বয়");
});
it("calls credit created by a paid-total adjustment my credit without claiming an actual advance", () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "work", name: "পরীক্ষার কাজ" }],
    people: [{ id: "worker", name: "পরীক্ষার মিস্ত্রি", kind: "worker" }],
    entries: [
      {
        id: "bill",
        kind: "expense",
        personId: "worker",
        account: "labour",
        lines: [
          {
            id: "line",
            workId: "work",
            label: "মজুরির বিল",
            costType: "labour",
            amount: 100000,
          },
        ],
      },
      {
        id: "adjust",
        kind: "adjustment",
        personId: "worker",
        account: "labour",
        note: "মোট ঠিক করেছি",
        adjustment: {
          target: "person",
          basis: "paid",
          account: "labour",
          before: 0,
          after: 150000,
          delta: 150000,
          workId: null,
        },
      },
    ],
  });
  state.ledger = ledger;
  const { container } = renderPage();
  expect(
    container.querySelector(".contact-summary-hero > strong")?.textContent,
  ).toBe("৳1500");
  expect(
    container.querySelector(".contact-reconciliation")?.textContent,
  ).toContain("আমার জমা৳500");
  expect(
    container.querySelector(".contact-reconciliation")?.textContent,
  ).not.toContain("অগ্রিম দিয়েছি");
  expect(ledger.entries.some((entry) => entry.kind === "payment")).toBe(false);
});
it("opens the contextual adjustment sheet without navigating to reconciliation", async () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  const realStorage = repository.createWorkspaceStorage("demo");
  const draftKey = "total-adjustment:person:worker:labour";
  await realStorage.removeDraft(draftKey);
  try {
    state.ledger = fixture();
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "মোট হিসাব মেলাই" }));
    const sheet = await screen.findByRole("dialog", {
      name: "মোট হিসাব মেলাই",
    });
    expect(within(sheet).getByLabelText("সঠিক অঙ্ক")).toBeTruthy();
    expect(sheet.textContent).toContain("রহিম");
    expect(state.go).not.toHaveBeenCalled();
    await user.click(within(sheet).getByRole("button", { name: "বন্ধ করুন" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "মোট হিসাব মেলাই" }),
      ).toBeNull(),
    );
    expect(state.go).not.toHaveBeenCalled();
    expect(await realStorage.readDraft(draftKey)).not.toBeNull();
  } finally {
    cleanup();
    await realStorage.removeDraft(draftKey);
    vi.unstubAllGlobals();
  }
});
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
  it("opens all contractor work from the people page even before a job exists", () => {
    state.ledger = fixture();
    renderPage("/people");
    fireEvent.click(screen.getByRole("button", { name: "মিস্ত্রির সব কাজ" }));
    expect(state.go).toHaveBeenLastCalledWith("/jobs");
  });

  it("offers one contextual worker payment action and keeps duplicate wage bills out of the menu", async () => {
    state.ledger = fixture();
    const user = userEvent.setup();
    for (const workId of [undefined, "work"]) {
      const view = renderPage(
        `/people/worker${workId ? `?work=${workId}` : ""}`,
      );
      expect(screen.getAllByRole("button", { name: "টাকা দিই" })).toHaveLength(
        1,
      );
      await user.click(screen.getByRole("button", { name: "টাকা দিই" }));
      expect(state.add).toHaveBeenLastCalledWith({
        kind: "payment",
        personId: "worker",
        workId,
        account: "labour",
      });
      screen.getByRole("button", { name: "আরও" }).focus();
      await user.keyboard("{Enter}");
      expect(await screen.findByRole("menu")).toBeTruthy();
      expect(
        screen.queryByRole("menuitem", { name: "মজুরির চুক্তি রাখি" }),
      ).toBeNull();
      expect(
        screen.queryByRole("menuitem", { name: "মজুরির বিল লিখি" }),
      ).toBeNull();
      await user.keyboard("{Escape}");
      await user.click(screen.getByRole("button", { name: "কাজ যোগ করি" }));
      expect(state.entity).toHaveBeenLastCalledWith(
        "contract",
        undefined,
        workId,
        "worker",
      );
      view.unmount();
    }
    expect(state.add).toHaveBeenCalledTimes(2);
    expect(state.entity).toHaveBeenCalledTimes(2);
  });
  it("shows simple contact rows without payment, return, edit or date controls on every contact", () => {
    state.ledger = fixture();
    const { container } = renderPage("/people");
    expect(container.querySelectorAll(".contact-row")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "টাকা দিই" })).toBeNull();
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
    expect(screen.getByRole("button", { name: "টাকা দিই" }).className).toBe(
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
    expect(screen.getAllByRole("button", { name: "টাকা দিই" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "বাকি মেটাই" })).toBeNull();
    expect(screen.queryByRole("button", { name: "অগ্রিম" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "টাকা দিই" }));
    expect(state.add).toHaveBeenLastCalledWith({
      kind: "payment",
      personId: "shop",
      workId: undefined,
      account: "materials",
    });
  });
  it("respects a contact that has intentionally hidden all quick actions", () => {
    const ledger = fixture();
    ledger.people[0].quickActions = [];
    state.ledger = ledger;
    renderPage();
    expect(screen.queryByRole("button", { name: "টাকা দিই" })).toBeNull();
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
    expect(screen.queryByRole("button", { name: "টাকা দিই" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "মূল হিসাবে ফিরি" }),
    ).toBeTruthy();
  });
});

it("puts cash paid first for a shop and its monthly chart while preserving material charges and known due", () => {
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
  expect(hero.textContent).toContain("মোট টাকা দিয়েছি");
  expect(hero.textContent).toContain("৳30000");
  expect(
    container.querySelector(".contact-summary-metrics")?.textContent,
  ).toContain("মালের দাম৳93000");
  expect(
    container.querySelector(".contact-summary-metrics")?.textContent,
  ).toContain("৳63000");
  expect(screen.queryByText("মজুরির চুক্তি")).toBeNull();
  const summary = container.querySelector<HTMLElement>(
    ".contact-summary-card",
  )!;
  const chart = screen.getByRole("region", { name: "মাসের হিসাব" });
  expect(summary.contains(chart)).toBe(true);
  expect(chart.querySelector("h2")).toBeNull();
  expect(chart.textContent).not.toContain("৳30000");
  fireEvent.click(
    [...chart.querySelectorAll(".spending-chart-months button")].at(-1)!,
  );
  expect(chart.textContent).toContain("৳30000");
  expect(screen.queryByText("মিস্ত্রির খরচ")).toBeNull();
});

it("charts a driver's older transport payment using the same scoped cash as the profile total", () => {
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
      {
        id: "legacy-trip-paid",
        kind: "payment",
        personId: "driver",
        account: "materials",
        relatedEntryId: "legacy-trip",
        date: "2026-11-01",
        allocations: [{ workId: "work", amount: 50000 }],
        paymentParts: [{ amount: 50000 }],
      },
    ],
  });
  renderPage("/people/driver");
  const chart = screen.getByRole("region", { name: "মাসের হিসাব" });
  expect(chart.textContent).not.toContain("৳500");
  fireEvent.click(
    [...chart.querySelectorAll(".spending-chart-months button")].at(-1)!,
  );
  expect(chart.textContent).toContain("৳500");
});

it.each([
  ["shop", "materials"],
  ["worker", "labour"],
  ["driver", "other"],
  ["other", "materials"],
] as const)(
  "keeps a payment-only %s profile consistent with the people list without upfront zero prices or inferred advances",
  async (kind, account) => {
    const ledger = LedgerSchema.parse({
      works: [{ id: "work", name: "দরজা" }],
      people: [{ id: "person", name: "Golam", kind }],
      entries: [
        {
          id: "paid",
          kind: "payment",
          date: "2026-11-02",
          personId: "person",
          account,
          allocations: [{ workId: "work", amount: 16200 }],
          paymentParts: [{ amount: 16200 }],
        },
      ],
    });
    const before = JSON.stringify(ledger);
    state.ledger = ledger;
    const list = renderPage("/people");
    expect(
      list.container.querySelector(".contact-row-money > strong")?.textContent,
    ).toBe("৳162");
    expect(list.container.querySelector(".contact-credit")).toBeNull();
    expect(list.container.querySelector(".contact-due")).toBeNull();
    list.unmount();
    const { container } = renderPage("/people/person");
    expect(container.querySelector(".contact-summary-hero")?.textContent).toBe(
      "মোট টাকা দিয়েছি৳162",
    );
    expect(container.querySelector(".contact-summary-metrics")).toBeNull();
    const chart = screen.getByRole("region", { name: "মাসের হিসাব" });
    expect(chart.querySelector("h2")).toBeNull();
    expect(chart.textContent).not.toContain("৳162");
    fireEvent.click(
      [...chart.querySelectorAll(".spending-chart-months button")].at(-1)!,
    );
    expect(chart.textContent).toContain("৳162");
    const more = container.querySelector("details.contact-reconciliation")!;
    expect(more.hasAttribute("open")).toBe(false);
    await userEvent.click(screen.getByText("আরও হিসাব"));
    expect(more.hasAttribute("open")).toBe(true);
    expect(more.textContent).toContain("অগ্রিম দিয়েছি৳162");
    expect(JSON.stringify(ledger)).toBe(before);
  },
);
