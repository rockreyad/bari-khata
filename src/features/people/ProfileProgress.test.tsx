// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { LanguageProvider } from "../../context/LanguageProvider";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { saveContractChange } from "../../domain/contracts";
import { savePreferences } from "../../lib/preferences";
import { PersonPage } from "./PersonPage";
import { WorkPage } from "../works/WorksPages";
import { JobPage } from "../jobs/JobPages";

const state = vi.hoisted(() => ({
  ledger: null as unknown,
  add: vi.fn(),
  entity: vi.fn(),
  go: vi.fn(),
  detail: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    ledger: state.ledger as Ledger,
    add: state.add,
    entity: state.entity,
    go: state.go,
    detail: state.detail,
    base: "",
  }),
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});
function mount(ledger: Ledger, path: string, language: "bn" | "en" = "bn") {
  state.ledger = ledger;
  savePreferences({ language });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LanguageProvider>
        <Routes>
          <Route path="/parties/:personId" element={<PersonPage />} />
          <Route path="/sectors/:workId" element={<WorkPage />} />
          <Route path="/works/:jobId" element={<JobPage />} />
        </Routes>
      </LanguageProvider>
    </MemoryRouter>,
  );
}
function fixture() {
  let ledger = LedgerSchema.parse({
    works: [
      { id: "door", name: "দরজা" },
      { id: "roof", name: "ছাদ" },
    ],
    people: [
      { id: "worker", name: "শাহ আলম", kind: "worker" },
      { id: "shop", name: "দরজার দোকান", kind: "shop" },
    ],
    contracts: [
      {
        id: "house",
        scope: "house",
        workId: null,
        personId: "worker",
        title: "রাজমিস্ত্রির চুক্তি",
        total: 50000000,
        rate: 50000000,
        agreedOn: "2026-08-01",
        history: [
          { at: "2026-07-01T03:00:00Z", total: 45000000, note: "আগের দর" },
        ],
      },
      {
        id: "roof-only",
        workId: "roof",
        personId: "worker",
        title: "ছাদের বাড়তি কাজ",
        total: 1000000,
      },
    ],
    entries: [
      {
        id: "door-cash",
        kind: "payment",
        personId: "worker",
        account: "labour",
        contractId: "house",
        date: "2026-09-01",
        allocations: [{ workId: "door", amount: 3000000 }],
        paymentParts: [{ amount: 3000000 }],
      },
      {
        id: "roof-cash",
        kind: "payment",
        personId: "worker",
        account: "labour",
        contractId: "house",
        date: "2026-09-02",
        allocations: [{ workId: "roof", amount: 2000000 }],
        paymentParts: [{ amount: 2000000 }],
      },
      {
        id: "shop-bill",
        kind: "expense",
        personId: "shop",
        date: "2026-09-01",
        lines: [
          { id: "doors", workId: "door", amount: 9300000, label: "দরজা" },
        ],
      },
      {
        id: "shop-cash",
        kind: "payment",
        personId: "shop",
        date: "2026-09-01",
        relatedEntryId: "shop-bill",
        allocations: [{ workId: "door", amount: 3000000 }],
        paymentParts: [{ amount: 3000000 }],
      },
    ],
  });
  ledger = saveContractChange(
    ledger,
    { ...ledger.contracts[0], total: 60000000, rate: 60000000 },
    "বারান্দার কাজ যোগ হয়েছে",
    "2026-09-12T03:30:00Z",
  );
  return ledger;
}
const copy = {
  bn: {
    goal: "৳\u202f৬,০০,০০০",
    paid: "৳\u202f৫০,০০০",
    remaining: "৳\u202f৫০,০০০",
    year: "২০২৬",
    old: "৳\u202f৫,০০,০০০",
    due: "৳\u202f৬৩,০০০",
  },
  en: {
    goal: "৳\u202f600,000",
    paid: "৳\u202f50,000",
    remaining: "৳\u202f50,000",
    year: "2026",
    old: "৳\u202f500,000",
    due: "৳\u202f63,000",
  },
};

it("keeps separate job balances on their cards without a repeated aggregate summary", () => {
  const ledger = LedgerSchema.parse({
    works: [
      { id: "bath", name: "বাথরুম" },
      { id: "electric", name: "বিদ্যুৎ" },
    ],
    people: [{ id: "worker", name: "মোরশেদ", kind: "worker" }],
    contracts: [
      { id: "a", personId: "worker", workId: "bath", total: 100000 },
      { id: "b", personId: "worker", workId: "electric", total: 200000 },
    ],
    entries: [
      {
        id: "pay-a",
        kind: "payment",
        account: "labour",
        personId: "worker",
        contractId: "a",
        allocations: [{ workId: "bath", amount: 120000 }],
        paymentParts: [{ amount: 120000 }],
      },
      {
        id: "pay-b",
        kind: "payment",
        account: "labour",
        personId: "worker",
        contractId: "b",
        allocations: [{ workId: "electric", amount: 50000 }],
        paymentParts: [{ amount: 50000 }],
      },
    ],
  });
  const before = JSON.stringify(ledger);
  const view = mount(ledger, "/parties/worker");
  expect(view.container.querySelector(".contact-job-totals")).toBeNull();
  expect(view.container.querySelectorAll(".job-snap-card")).toHaveLength(2);
  expect(JSON.stringify(ledger)).toBe(before);
});

describe.each(["bn", "en"] as const)("profile progress in %s", (language) => {
  it("keeps a compact house-job preview on the profile and opens full totals and history in the dedicated job page", () => {
    const ledger = fixture();
    const before = JSON.stringify(ledger);
    const profile = mount(ledger, "/parties/worker?work=door", language);
    const cards =
      profile.container.querySelectorAll<HTMLElement>(".job-snap-card");
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain(copy[language].goal);
    expect(cards[0].textContent).toContain(copy[language].remaining);
    expect(cards[0].textContent).toContain(copy[language].paid);
    expect(cards[0].textContent).not.toContain(
      language === "bn" ? "পুরো বাড়ি" : "Whole house",
    );
    expect(within(cards[0]).queryByRole("progressbar")).toBeNull();
    expect(profile.container.querySelector(".contract-history")).toBeNull();
    expect(profile.container.querySelector(".contract-card")).toBeNull();
    expect(
      profile.container.querySelector(".contact-summary-hero")?.textContent,
    ).toContain(language === "bn" ? "৳\u202f৩০,০০০" : "৳\u202f30,000");
    expect(profile.container.textContent).not.toContain("ছাদের বাড়তি কাজ");
    fireEvent.click(cards[0]);
    expect(state.go).toHaveBeenLastCalledWith(
      "/works/house?back=%2Fparties%2Fworker%3Fwork%3Ddoor",
    );
    profile.unmount();
    const detail = mount(ledger, "/works/house?tab=history", language);
    const card = detail.container.querySelector<HTMLElement>(".contract-card")!;
    expect(card.textContent).toContain(copy[language].goal);
    expect(card.textContent).toContain(copy[language].paid);
    expect(card.textContent).toContain(copy[language].remaining);
    expect(card.textContent).toContain(copy[language].year);
    expect(within(card).queryByRole("progressbar")).toBeNull();
    expect(
      detail.container.querySelector(".contract-history")?.textContent,
    ).toContain("বারান্দার কাজ যোগ হয়েছে");
    fireEvent.click(
      detail.container.querySelector<HTMLButtonElement>(
        ".job-page-heading .icon-button",
      )!,
    );
    expect(state.entity).toHaveBeenLastCalledWith("contract", "house");
    fireEvent.click(
      detail.container.querySelector<HTMLButtonElement>(
        "#job-transactions-tab",
      )!,
    );
    expect(detail.container.querySelectorAll(".history-payment")).toHaveLength(
      2,
    );
    expect(
      detail.container.querySelector(".job-detail-panel")?.textContent,
    ).not.toContain("দরজার দোকান");
    expect(JSON.stringify(ledger)).toBe(before);
  });

  it("shows a shop's paid cash and due without an unexplained progress bar", () => {
    const { container } = mount(fixture(), "/parties/shop?work=door", language);
    expect(
      container.querySelector(".contact-summary-metrics")?.textContent,
    ).toContain(copy[language].due);
    expect(within(container).queryByRole("progressbar")).toBeNull();
    expect(
      container.querySelector(".contact-detail-metrics")?.textContent,
    ).toContain(language === "bn" ? "৳\u202f৯৩,০০০" : "৳\u202f93,000");
    expect(container.querySelector(".contract-card")).toBeNull();
  });
});

it("opens a work's compact house-job preview and retains its legacy and dated changes on the job history route", () => {
  const ledger = fixture();
  const work = mount(ledger, "/sectors/door?tab=labour");
  const tile = work.container.querySelector<HTMLElement>(".job-snap-card")!;
  expect(tile.textContent).toContain("শাহ আলম");
  expect(tile.textContent).not.toContain("পুরো বাড়ি");
  expect(tile.textContent).toContain("৳\u202f৫০,০০০");
  expect(work.container.querySelectorAll(".job-snap-card")).toHaveLength(1);
  expect(work.container.querySelector(".contract-history")).toBeNull();
  expect(within(tile).queryByRole("progressbar")).toBeNull();
  fireEvent.click(tile);
  expect(state.go).toHaveBeenLastCalledWith(
    "/works/house?back=%2Fsectors%2Fdoor%3Ftab%3Dlabour",
  );
  work.unmount();
  const detail = mount(ledger, "/works/house?tab=history");
  const history =
    detail.container.querySelector<HTMLElement>(".contract-history")!;
  expect(within(history).getByText("বারান্দার কাজ যোগ হয়েছে")).toBeTruthy();
  expect(within(history).getByText("আগের দর")).toBeTruthy();
  expect(
    history.querySelector(".contract-history-amount")?.textContent,
  ).toContain("৳\u202f৫,০০,০০০");
  expect(
    history.querySelector(".contract-history-amount")?.textContent,
  ).toContain("৳\u202f৬,০০,০০০");
  expect(
    history.querySelector("time[datetime='2026-09-12T03:30:00Z']")?.textContent,
  ).toContain("২০২৬");
  expect(
    ledger.contracts.find((contract) => contract.id === "house")!.history,
  ).toHaveLength(1);
  expect(
    ledger.contracts.find((contract) => contract.id === "house")!.activity,
  ).toHaveLength(1);
});

it("keeps purchasing and one shop payment action with the current work prefilled", () => {
  mount(fixture(), "/parties/shop?work=door");
  fireEvent.click(screen.getByRole("button", { name: "মাল কিনলাম" }));
  expect(state.add).toHaveBeenLastCalledWith({
    kind: "expense",
    personId: "shop",
    workId: "door",
    account: "materials",
    costType: "material",
  });
  expect(screen.getAllByRole("button", { name: "টাকা দিই" })).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "বাকি মেটাই" })).toBeNull();
  expect(screen.queryByRole("button", { name: "অগ্রিম" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "টাকা দিই" }));
  const target = new URL(
    state.go.mock.calls.at(-1)![0],
    "https://bari.invalid",
  );
  expect(target.pathname).toBe("/write");
  expect(Object.fromEntries(target.searchParams)).toEqual({
    person: "shop",
    account: "materials",
    work: "door",
    purpose: "party-payment",
    dueWork: "door",
    dueAccount: "all",
    back: "/parties/shop?work=door",
  });
  expect(state.add).toHaveBeenCalledTimes(1);
});

it("hides a paid shop bar while retaining the exact surplus as advance", () => {
  const ledger = fixture();
  const payment = ledger.entries.find((entry) => entry.id === "shop-cash")!;
  payment.allocations[0].amount = 10000000;
  payment.paymentParts[0].amount = 10000000;
  const { container } = mount(
    LedgerSchema.parse(ledger),
    "/parties/shop?work=door",
  );
  expect(container.querySelector(".contact-bill-progress")).toBeNull();
  expect(
    container.querySelector(".contact-summary-metrics")?.textContent,
  ).toContain("অগ্রিম৳\u202f৭,০০০");
  expect(
    container.querySelector(".contact-reconciliation")?.textContent,
  ).not.toContain("অগ্রিম");
});

it("does not turn historical bills with unknown payment into a shop payable or a progress bar", () => {
  const ledger = fixture();
  ledger.entries.push(
    ...LedgerSchema.parse({
      works: ledger.works,
      people: ledger.people,
      entries: [
        {
          id: "old-shop-bill",
          kind: "expense",
          personId: "shop",
          balanceImpact: "historical",
          date: "2026-01-01",
          lines: [
            {
              id: "old-shop-line",
              workId: "door",
              amount: 9990000,
              label: "পুরোনো মাল",
            },
          ],
        },
      ],
    }).entries,
  );
  const { container } = mount(ledger, "/parties/shop?work=door");
  expect(within(container).queryByRole("progressbar")).toBeNull();
  expect(
    container.querySelector(".contact-summary-metrics")?.textContent,
  ).toContain("৳\u202f৬৩,০০০");
  expect(
    container.querySelector(".contact-summary-metrics")?.textContent,
  ).not.toContain("৳\u202f১,৯২,৯০০");
  expect(container.querySelector(".contact-old-note")).not.toBeNull();
});

it("loads older job changes only on the dedicated history page and hides the button at the end", async () => {
  const ledger = fixture();
  const contract = ledger.contracts.find((row) => row.id === "house")!;
  contract.history = Array.from({ length: 14 }, (_, i) => ({
    at: `2026-07-${String(i + 1).padStart(2, "0")}T03:00:00Z`,
    total: 45000000 + i * 100000,
    note: `আগের পরিবর্তন ${i + 1}`,
  }));
  const { container } = mount(ledger, "/works/house?tab=history");
  const history = container.querySelector<HTMLElement>(".contract-history")!;
  await waitFor(() =>
    expect(
      history.querySelectorAll(".contract-history-list > li"),
    ).toHaveLength(12),
  );
  fireEvent.click(within(history).getByRole("button", { name: "আরও দেখুন" }));
  expect(history.querySelectorAll(".contract-history-list > li")).toHaveLength(
    15,
  );
  expect(
    within(history).queryByRole("button", { name: "আরও দেখুন" }),
  ).toBeNull();
  expect(contract.history).toHaveLength(14);
});

it("does not call ordinary contract instalments an advance, while retaining a separate explicit uncontracted advance", () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
    people: [{ id: "worker", name: "মিস্ত্রি", kind: "worker" }],
    contracts: [
      {
        id: "c",
        scope: "house",
        personId: "worker",
        total: 60000000,
        rate: 60000000,
      },
    ],
    entries: [
      {
        id: "paid",
        kind: "payment",
        account: "labour",
        personId: "worker",
        contractId: "c",
        allocations: [{ workId: "door", amount: 3000000 }],
        paymentParts: [{ amount: 3000000 }],
      },
    ],
  });
  const first = mount(ledger, "/parties/worker");
  expect(first.container.querySelector(".contact-job-totals")).toBeNull();
  expect(
    first.container.querySelector(".contact-reconciliation")?.textContent ?? "",
  ).not.toContain("অগ্রিম দিয়েছি");
  expect(
    first.container.querySelector(".job-snap-card")?.textContent,
  ).toContain("৳\u202f৩০,০০০");
  first.unmount();
  const next = LedgerSchema.parse({
    ...ledger,
    entries: [
      ...ledger.entries,
      {
        id: "advance",
        kind: "payment",
        account: "labour",
        personId: "worker",
        note: "অগ্রিম",
        allocations: [{ workId: "door", amount: 1500000 }],
        paymentParts: [{ amount: 1500000 }],
      },
    ],
  });
  const second = mount(next, "/parties/worker");
  expect(
    second.container.querySelector(".contact-reconciliation dd")?.textContent,
  ).toBe("৳\u202f১৫,০০০");
});

describe.each(["bn", "en"] as const)(
  "settled shop summary in %s",
  (language) => {
    it("keeps one paid amount and a separate monthly chart without a repeated purchase price or completed bar", () => {
      const ledger = fixture();
      const payment = ledger.entries.find((entry) => entry.id === "shop-cash")!;
      payment.allocations[0].amount = 9300000;
      payment.paymentParts[0].amount = 9300000;
      const before = JSON.stringify(ledger);
      const { container } = mount(
        LedgerSchema.parse(ledger),
        "/parties/shop",
        language,
      );
      const summary = container.querySelector<HTMLElement>(
        ".contact-summary-card",
      )!;
      const amount = language === "bn" ? "৳\u202f৯৩,০০০" : "৳\u202f93,000";
      expect(
        summary.querySelector(".contact-summary-hero")?.textContent,
      ).toContain(amount);
      expect(summary.querySelector(".contact-summary-metrics")).toBeNull();
      expect(within(summary).queryByRole("progressbar")).toBeNull();
      const chart = within(container).getByRole("region", {
        name: language === "bn" ? "মাসের হিসাব" : "Monthly activity",
      });
      expect(chart.querySelector("h2")).toBeNull();
      expect(chart.querySelector(".spending-chart-legend")).toBeNull();
      expect(chart.textContent).not.toContain(amount);
      expect(summary.textContent?.split(amount)).toHaveLength(2);
      expect(JSON.stringify(ledger)).toBe(before);
    });
  },
);
