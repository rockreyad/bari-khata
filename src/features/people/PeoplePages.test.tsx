// @vitest-environment jsdom
import "fake-indexeddb/auto";
import type { SelectHTMLAttributes } from "react";
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
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
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
vi.mock("../../components/ui/AppSelect", () => ({
  AppSelect: (props: SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props} />
  ),
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
it("shows the person's corrected paid total without a correction note in the directory", () => {
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
  expect(row.textContent).not.toContain("সমন্বয়");
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
    container.querySelector(".contact-summary-hero")?.textContent,
  ).not.toContain("সমন্বয়সহ");
  expect(
    container.querySelector(".contact-reconciliation")?.textContent,
  ).toContain("আমার জমা৳500");
  expect(
    container.querySelector(".contact-reconciliation")?.textContent,
  ).not.toContain("অগ্রিম দিয়েছি");
  expect(ledger.entries.some((entry) => entry.kind === "payment")).toBe(false);
});
it.each([
  { path: "/people/worker", suffix: "", scopeLabel: "সব খাতা মিলিয়ে" },
  {
    path: "/people/worker?work=work",
    suffix: ":work:work",
    scopeLabel: "টাইলস",
  },
])(
  "opens the contextual adjustment sheet for $path without changing its scope",
  async ({ path, suffix, scopeLabel }) => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const realStorage = repository.createWorkspaceStorage("demo");
    const draftKey = `total-adjustment:person:worker:labour${suffix}`;
    await realStorage.removeDraft(draftKey);
    try {
      state.ledger = fixture();
      const user = userEvent.setup();
      renderPage(path);
      screen.getByRole("button", { name: "আরও" }).focus();
      await user.keyboard("{Enter}");
      await user.click(
        screen.getByRole("menuitem", { name: "মোট হিসাব মেলাই" }),
      );
      const sheet = await screen.findByRole("dialog", {
        name: "মোট হিসাব মেলাই",
      });
      expect(within(sheet).queryByLabelText("সঠিক অঙ্ক")).toBeNull();
      await user.selectOptions(
        within(sheet).getByLabelText("কোন হিসাব মেলাব"),
        "labour",
      );
      expect(within(sheet).getByLabelText("সঠিক অঙ্ক")).toBeTruthy();
      await waitFor(() =>
        expect(
          (
            within(sheet).getByRole("button", {
              name: "সমন্বয় রাখুন",
            }) as HTMLButtonElement
          ).disabled,
        ).toBe(false),
      );
      expect(sheet.textContent).toContain("রহিম");
      expect(sheet.textContent).toContain(scopeLabel);
      expect(state.go).not.toHaveBeenCalled();
      await user.click(
        within(sheet).getByRole("button", { name: "বন্ধ করুন" }),
      );
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
  },
);
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

it("puts payment before the chart and shows a matching job balance only once", () => {
  state.ledger = LedgerSchema.parse({
    works: [{ id: "work", name: "নমুনা কাজ" }],
    people: [{ id: "worker", name: "নমুনা মিস্ত্রি", kind: "worker" }],
    contracts: [
      { id: "job", personId: "worker", workId: "work", total: 100000 },
    ],
    entries: [
      {
        id: "paid",
        kind: "payment",
        account: "labour",
        personId: "worker",
        contractId: "job",
        date: "2026-11-03",
        allocations: [{ workId: "work", amount: 40000 }],
        paymentParts: [{ amount: 40000 }],
      },
    ],
  });
  const before = JSON.stringify(state.ledger);
  renderPage();
  const summary = screen.getByRole("region", { name: "এই নামের মোট হিসাব" });
  expect(within(summary).getAllByText("৳600")).toHaveLength(1);
  expect(summary.querySelector(".contact-job-totals")).toBeNull();
  const payment = within(summary).getByRole("button", { name: "টাকা দিই" });
  const chart = screen.getByRole("region", { name: "মাসের হিসাব" });
  expect(summary.contains(chart)).toBe(false);
  expect(
    payment.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "পুরো হিসাব" })).toHaveLength(1);
  const jobs = screen.getByRole("region", { name: "কাজ" });
  const history = payment
    .closest(".contact-detail-page")!
    .querySelector(".contact-history")!;
  expect(
    jobs.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(JSON.stringify(state.ledger)).toBe(before);
});

it("keeps credit from an aggregate correction visible when a contact has an agreed job", async () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "work", name: "নমুনা কাজ" }],
    people: [{ id: "worker", name: "নমুনা মিস্ত্রি", kind: "worker" }],
    contracts: [
      { id: "job", scope: "house", personId: "worker", total: 100000 },
    ],
    entries: [
      {
        id: "paid",
        kind: "payment",
        account: "labour",
        personId: "worker",
        contractId: "job",
        allocations: [{ workId: "work", amount: 40000 }],
        paymentParts: [{ amount: 40000 }],
      },
      {
        id: "adjust",
        kind: "adjustment",
        personId: "worker",
        account: "labour",
        note: "নমুনার মোট মিলিয়েছি",
        adjustment: {
          target: "person",
          basis: "paid",
          account: "labour",
          workId: null,
          before: 40000,
          after: 110000,
          delta: 70000,
        },
      },
    ],
  });
  state.ledger = ledger;
  const before = JSON.stringify(ledger);
  const { container } = renderPage();
  expect(
    container.querySelector(".contact-summary-hero > strong")?.textContent,
  ).toBe("৳1100");
  await userEvent.click(screen.getByText("আরও হিসাব"));
  expect(
    container.querySelector(".contact-reconciliation")?.textContent,
  ).toContain("আমার জমা৳100");
  expect(
    container.querySelector(".contact-reconciliation")?.textContent,
  ).not.toContain("অগ্রিম দিয়েছি");
  expect(
    ledger.entries.filter((entry) => entry.kind === "payment"),
  ).toHaveLength(1);
  expect(JSON.stringify(ledger)).toBe(before);
});

it("retains a recorded unassigned advance when a correction leaves aggregate credit at zero", () => {
  state.ledger = LedgerSchema.parse({
    works: [{ id: "work", name: "নমুনা কাজ" }],
    people: [{ id: "worker", name: "নমুনা মিস্ত্রি", kind: "worker" }],
    contracts: [
      { id: "job", scope: "house", personId: "worker", total: 100000 },
    ],
    entries: [
      {
        id: "paid",
        kind: "payment",
        account: "labour",
        personId: "worker",
        contractId: "job",
        allocations: [{ workId: "work", amount: 40000 }],
        paymentParts: [{ amount: 40000 }],
      },
      {
        id: "advance",
        kind: "payment",
        account: "labour",
        personId: "worker",
        allocations: [{ workId: "work", amount: 20000 }],
        paymentParts: [{ amount: 20000 }],
      },
      {
        id: "adjust",
        kind: "adjustment",
        personId: "worker",
        account: "labour",
        note: "নমুনার খরচ মিলিয়েছি",
        adjustment: {
          target: "person",
          basis: "cost",
          account: "labour",
          workId: null,
          before: 0,
          after: 10000,
          delta: 10000,
        },
      },
    ],
  });
  const { container } = renderPage();
  expect(
    container.querySelector(".contact-summary-metrics")?.textContent,
  ).toContain("দিতে বাকি৳500");
  expect(
    container.querySelector(".contact-reconciliation")?.textContent,
  ).toContain("আমার জমা৳200");
});

it("keeps a house commitment accessible when its remaining amount happens to equal a selected notebook bill", () => {
  state.ledger = LedgerSchema.parse({
    works: [
      { id: "work", name: "নমুনা খাতা" },
      { id: "other", name: "অন্য খাতা" },
    ],
    people: [{ id: "worker", name: "নমুনা মিস্ত্রি", kind: "worker" }],
    contracts: [
      { id: "job", scope: "house", personId: "worker", total: 100000 },
    ],
    entries: [
      {
        id: "paid",
        kind: "payment",
        account: "labour",
        personId: "worker",
        contractId: "job",
        allocations: [{ workId: "other", amount: 40000 }],
        paymentParts: [{ amount: 40000 }],
      },
      {
        id: "bill",
        kind: "expense",
        account: "labour",
        personId: "worker",
        lines: [
          {
            id: "line",
            workId: "work",
            label: "আলাদা মজুরি",
            costType: "labour",
            amount: 60000,
          },
        ],
      },
    ],
  });
  const { container } = renderPage("/people/worker?work=work");
  expect(
    container.querySelector(".contact-summary-metrics")?.textContent,
  ).toContain("৳600");
  const extra = container.querySelector(".contact-job-totals")!;
  expect(extra.textContent).toContain("সব কাজ মিলিয়ে");
  expect(extra.textContent).toContain("চুক্তির অবশিষ্ট৳600");
  expect(extra.closest("details")?.hasAttribute("open")).toBe(false);
});

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
    expect(state.go).toHaveBeenCalledWith("/ledger?person=worker&order=oldest");
    const rows = [...container.querySelectorAll(".history-row")];
    expect(rows).toHaveLength(5);
    expect(rows[0].textContent).toContain("বিল 7");
    expect(rows[4].textContent).toContain("বিল 3");
  });
  it.each(["দোকান", "ডিলার"])(
    "prioritises purchases for a %s and keeps payment and returns together",
    async (role) => {
      const ledger = fixture();
      ledger.people.find((person) => person.id === "shop")!.role = role;
      state.ledger = ledger;
      const before = JSON.stringify(ledger);
      renderPage("/people/shop");
      const purchase = screen.getByRole("button", { name: "মাল কিনলাম" });
      expect(purchase.className).toBe("primary-button");
      expect(screen.getByRole("button", { name: "টাকা দিই" }).className).toBe(
        "secondary-button",
      );
      expect(
        screen.getByRole("button", { name: "মাল ফেরত দিই" }).className,
      ).toBe("secondary-button");
      expect(
        screen.getByRole("button", { name: "টাকা দিই" }).parentElement,
      ).toBe(
        screen.getByRole("button", { name: "মাল ফেরত দিই" }).parentElement,
      );
      expect(screen.queryByRole("button", { name: "কাজ যোগ করি" })).toBeNull();
      expect(screen.queryByRole("region", { name: "কাজ" })).toBeNull();
      expect(
        screen.queryByRole("button", { name: "মাল ফেরত লিখি" }),
      ).toBeNull();
      await userEvent.click(purchase);
      expect(state.add).toHaveBeenCalledWith({
        kind: "expense",
        personId: "shop",
        workId: undefined,
        account: "materials",
        costType: "material",
      });
      expect(screen.getAllByRole("button", { name: "টাকা দিই" })).toHaveLength(
        1,
      );
      expect(screen.queryByRole("button", { name: "বাকি মেটাই" })).toBeNull();
      expect(screen.queryByRole("button", { name: "অগ্রিম" })).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "টাকা দিই" }));
      expect(state.add).toHaveBeenLastCalledWith({
        kind: "payment",
        personId: "shop",
        workId: undefined,
        account: "materials",
      });
      await userEvent.click(
        screen.getByRole("button", { name: "মাল ফেরত দিই" }),
      );
      expect(state.add).toHaveBeenLastCalledWith({
        kind: "return",
        personId: "shop",
        workId: undefined,
        account: "materials",
      });
      expect(JSON.stringify(ledger)).toBe(before);
    },
  );
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
    expect(state.go).toHaveBeenCalledWith("/ledger?person=worker&order=oldest");
    expect(container.querySelectorAll(".history-row")).toHaveLength(5);
    expect(container.textContent).toContain("৳710");
    expect(container.textContent).not.toContain("৳800");
  });
  it("ignores a legacy material filter when opening a payment from the all-account profile", async () => {
    state.ledger = fixture();
    renderPage("/people/worker?account=materials");
    await userEvent.click(screen.getByRole("button", { name: "টাকা দিই" }));
    expect(state.add).toHaveBeenCalledWith({
      kind: "payment",
      personId: "worker",
      workId: undefined,
      account: "labour",
    });
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
    container.querySelector(".contact-detail-metrics")?.textContent,
  ).toContain("মাল ও কাজের খরচ৳93000");
  expect(
    container.querySelector(".contact-summary-metrics")?.textContent,
  ).toContain("৳63000");
  expect(screen.queryByText("মজুরির চুক্তি")).toBeNull();
  const summary = container.querySelector<HTMLElement>(
    ".contact-summary-card",
  )!;
  const chart = screen.getByRole("region", { name: "মাসের হিসাব" });
  expect(summary.contains(chart)).toBe(false);
  expect(container.querySelector(".contact-trend-card")?.contains(chart)).toBe(
    true,
  );
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

function twoAccountLedger() {
  return LedgerSchema.parse({
    works: [{ id: "sample", name: "নমুনা খাতা" }],
    people: [{ id: "sample-person", name: "নমুনা ব্যক্তি", kind: "other" }],
    entries: [
      {
        id: "sample-material",
        kind: "expense",
        personId: "sample-person",
        account: "materials",
        lines: [
          { id: "m", workId: "sample", label: "নমুনা মাল", amount: 10000 },
        ],
      },
      {
        id: "sample-material-paid",
        kind: "payment",
        personId: "sample-person",
        account: "materials",
        allocations: [{ workId: "sample", amount: 3000 }],
        paymentParts: [{ amount: 3000 }],
      },
      {
        id: "sample-labour",
        kind: "expense",
        personId: "sample-person",
        account: "labour",
        lines: [
          {
            id: "l",
            workId: "sample",
            label: "নমুনা মজুরি",
            costType: "labour",
            amount: 20000,
          },
        ],
      },
      {
        id: "sample-labour-paid",
        kind: "payment",
        personId: "sample-person",
        account: "labour",
        allocations: [{ workId: "sample", amount: 25000 }],
        paymentParts: [{ amount: 25000 }],
      },
    ],
  });
}

it.each(["materials", "labour", "other"])(
  "always shows every account and keeps debt and credit separate despite the legacy %s URL",
  async (account) => {
    const ledger = twoAccountLedger();
    state.ledger = ledger;
    const user = userEvent.setup();
    const { container } = renderPage(
      `/people/sample-person?account=${account}&work=sample`,
    );
    expect(screen.queryByLabelText("কোন হিসাব দেখব")).toBeNull();
    expect(container.querySelector(".contact-summary-hero")?.textContent).toBe(
      "মোট টাকা দিয়েছি৳280",
    );
    expect(
      container.querySelector(".contact-summary-metrics")?.textContent,
    ).toBe("দিতে বাকি৳70");
    expect(
      container.querySelector(".contact-reconciliation")?.textContent,
    ).toContain("অগ্রিম দিয়েছি৳50");
    const history = container.querySelector(".contact-history")!;
    expect(history.textContent).toContain("নমুনা মাল");
    expect(history.textContent).toContain("নমুনা মজুরি");
    expect(history.textContent).toContain("সব হিসাব");
    await user.click(screen.getByRole("button", { name: "পুরো হিসাব" }));
    expect(state.go).toHaveBeenCalledWith(
      "/ledger?person=sample-person&order=oldest&work=sample",
    );
    expect(state.ledger).toEqual(ledger);
  },
);

function HistoryDestination() {
  return <p data-testid="history-destination">{useLocation().search}</p>;
}

it("removes a legacy account restriction when redirecting to the person's full history", async () => {
  state.ledger = twoAccountLedger();
  render(
    <MemoryRouter
      initialEntries={[
        "/people/sample-person?view=history&account=materials&work=sample&order=newest",
      ]}
    >
      <Routes>
        <Route path="/people/:personId" element={<PersonPage />} />
        <Route path="/ledger" element={<HistoryDestination />} />
      </Routes>
    </MemoryRouter>,
  );
  const destination = await screen.findByTestId("history-destination");
  const query = new URLSearchParams(destination.textContent!);
  expect(Object.fromEntries(query)).toEqual({
    person: "sample-person",
    work: "sample",
    order: "newest",
  });
});

it("chooses share and reconciliation scopes without narrowing the profile behind either dialog", async () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  const ledger = twoAccountLedger();
  state.ledger = ledger;
  const storage = repository.createWorkspaceStorage("demo");
  const draftKey =
    "total-adjustment:person:sample-person:materials:work:sample";
  await storage.removeDraft(draftKey);
  const user = userEvent.setup();
  const { container } = renderPage(
    "/people/sample-person?account=materials&work=sample",
  );
  const summary = () =>
    container.querySelector(".contact-summary-card")!.textContent;
  const history = () =>
    container.querySelector(".contact-history")!.textContent;
  const beforeSummary = summary();
  const beforeHistory = history();
  try {
    await user.click(screen.getByRole("button", { name: "আরও" }));
    await user.click(
      screen.getByRole("menuitem", { name: "হিসাবের কপি পাঠাই" }),
    );
    let sheet = await screen.findByRole("dialog", {
      name: "হিসাবের কপি পাঠাই",
    });
    expect(
      (within(sheet).getByLabelText("কোন হিসাবের কপি") as HTMLSelectElement)
        .value,
    ).toBe("");
    await user.selectOptions(
      within(sheet).getByLabelText("কোন হিসাবের কপি"),
      "labour",
    );
    expect(
      sheet.querySelector(".statement-recipient-copy > span")?.textContent,
    ).toBe("মজুরির হিসাব · নমুনা খাতা");
    await user.click(within(sheet).getByRole("button", { name: "বন্ধ করুন" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(summary()).toBe(beforeSummary);
    expect(history()).toBe(beforeHistory);
    await user.click(screen.getByRole("button", { name: "আরও" }));
    await user.click(screen.getByRole("menuitem", { name: "মোট হিসাব মেলাই" }));
    sheet = await screen.findByRole("dialog", { name: "মোট হিসাব মেলাই" });
    expect(
      (within(sheet).getByLabelText("কোন হিসাব মেলাব") as HTMLSelectElement)
        .value,
    ).toBe("");
    await user.selectOptions(
      within(sheet).getByLabelText("কোন হিসাব মেলাব"),
      "materials",
    );
    await within(sheet).findByText("৳30");
    await waitFor(() =>
      expect(
        (
          within(sheet).getByRole("button", {
            name: "সমন্বয় রাখুন",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    await user.click(within(sheet).getByRole("button", { name: "বন্ধ করুন" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(summary()).toBe(beforeSummary);
    expect(history()).toBe(beforeHistory);
    expect(state.ledger).toEqual(ledger);
    expect(state.go).not.toHaveBeenCalled();
  } finally {
    cleanup();
    await storage.removeDraft(draftKey);
    vi.unstubAllGlobals();
  }
});

it.each([
  {
    kind: "worker" as const,
    action: "return" as const,
    label: "মাল ফেরত দিই",
    expected: { kind: "return", account: "materials" },
  },
  {
    kind: "shop" as const,
    action: "transport" as const,
    label: "আনার খরচ লিখি",
    expected: { kind: "expense", account: "other", costType: "transport" },
  },
])(
  "honours an explicitly chosen $action shortcut for a $kind profile",
  async ({ kind, action, label, expected }) => {
    state.ledger = LedgerSchema.parse({
      works: [{ id: "sample", name: "নমুনা খাতা" }],
      people: [
        {
          id: "sample-person",
          name: "নমুনা ব্যক্তি",
          kind,
          quickActions: [action],
        },
      ],
    });
    renderPage("/people/sample-person");
    const group = screen.getByRole("group", { name: "হিসাব লেখার বোতাম" });
    expect(within(group).getAllByRole("button")).toHaveLength(1);
    await userEvent.click(within(group).getByRole("button", { name: label }));
    expect(state.add).toHaveBeenCalledWith({
      ...expected,
      personId: "sample-person",
      workId: undefined,
    });
  },
);
