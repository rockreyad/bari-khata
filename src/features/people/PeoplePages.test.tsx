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
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { LanguageProvider } from "../../context/LanguageProvider";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { savePreferences } from "../../lib/preferences";
import { formatMoney } from "../../lib/formatMoney";
import { PeoplePage, PersonPage } from "./PeoplePages";
const state = vi.hoisted(() => ({
  ledger: null as unknown,
  go: vi.fn(),
  entity: vi.fn(),
  detail: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    ...state,
    ledger: state.ledger as Ledger,
    mode: "demo",
    base: "",
  }),
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});
function fixture() {
  return LedgerSchema.parse({
    works: [
      { id: "roof", name: "নমুনা ছাদ" },
      { id: "wall", name: "নমুনা দেয়াল" },
    ],
    people: [
      {
        id: "person",
        name: "নমুনা করিম",
        kind: "other",
        contactType: "custom",
        roles: [],
      },
      {
        id: "shop",
        name: "নমুনা দোকান",
        kind: "shop",
        contactType: "supplier",
        roles: ["supplier", "professional"],
      },
    ],
    entries: [
      {
        id: "bill",
        kind: "expense",
        personId: "person",
        date: "2026-11-01",
        lines: [{ id: "l", workId: "roof", label: "নমুনা মাল", amount: 10000 }],
      },
      {
        id: "paid",
        kind: "payment",
        personId: "person",
        paymentContext: "settlement",
        date: "2026-11-02",
        allocations: [{ workId: "roof", amount: 3000 }],
        paymentParts: [{ amount: 3000 }],
      },
    ],
  });
}
function mount(
  ledger = fixture(),
  path = "/people/person",
  language: "bn" | "en" = "bn",
) {
  state.ledger = ledger;
  savePreferences({ language });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LanguageProvider>
        <Routes>
          <Route path="/people" element={<PeoplePage />} />
          <Route path="/people/:personId" element={<PersonPage />} />
          <Route path="/history" element={<p>Opened history</p>} />
        </Routes>
      </LanguageProvider>
    </MemoryRouter>,
  );
}
describe.each(["bn", "en"] as const)(
  "simple party account in %s",
  (language) => {
    it("shows the known due and amount paid without bill-allocation or total-adjustment controls", () => {
      const ledger = fixture(),
        before = structuredClone(ledger);
      const { container } = mount(ledger, undefined, language);
      expect(
        container.querySelector(".person-balance-head strong")?.textContent,
      ).toBe(formatMoney(7000, language));
      expect(
        container.querySelector(".person-money-details")?.textContent,
      ).toContain(formatMoney(3000, language));
      expect(container.querySelector(".party-allocation-panel")).toBeNull();
      expect(container.querySelector(".contact-reconciliation")).toBeNull();
      expect(container.querySelector(".contact-trend-card")).toBeNull();
      expect(ledger).toEqual(before);
    });
  },
);
it("opens payment and the writing chooser with the current identity and work without forcing its role", () => {
  mount(fixture(), "/people/person?work=roof&account=labour");
  fireEvent.click(screen.getByRole("button", { name: "টাকা দিই" }));
  expect(state.go).toHaveBeenLastCalledWith(
    "/write/payment?person=person&work=roof",
  );
  fireEvent.click(screen.getByRole("button", { name: "হিসাব লিখি" }));
  expect(state.go).toHaveBeenLastCalledWith("/write?person=person&work=roof");
});
it.each(["shop", "driver", "worker", "other"])(
  "keeps the same two task actions for a %s without a role",
  (kind) => {
    const ledger = LedgerSchema.parse({
      ...fixture(),
      people: [{ id: "person", name: "নমুনা নাম", kind, roles: [] }],
    });
    mount(ledger);
    expect(screen.getAllByRole("button", { name: "টাকা দিই" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "হিসাব লিখি" })).toHaveLength(
      1,
    );
    expect(screen.queryByRole("button", { name: "মাল ফেরত দিই" })).toBeNull();
  },
);
it("keeps a payable, credit in another account and recoverable money separate", () => {
  const base = fixture();
  const ledger = LedgerSchema.parse({
    ...base,
    entries: [
      ...base.entries,
      {
        id: "ahead",
        kind: "payment",
        personId: "person",
        account: "other",
        paymentContext: "advance",
        allocations: [{ workId: "wall", amount: 4000 }],
        paymentParts: [{ amount: 4000 }],
      },
      {
        id: "loan",
        kind: "payment",
        personId: "person",
        paymentContext: "receivable",
        allocations: [{ workId: "roof", amount: 2000 }],
        paymentParts: [{ amount: 2000 }],
      },
    ],
  });
  const { container } = mount(ledger);
  expect(
    container.querySelector(".person-balance-head strong")?.textContent,
  ).toBe(formatMoney(7000, "bn"));
  const metrics = container.querySelector(".person-money-details")!;
  expect(metrics.textContent).toContain(formatMoney(4000, "bn"));
  expect(metrics.textContent).toContain(formatMoney(2000, "bn"));
});
it("does not turn a work price into earned debt, and keeps its details reachable", () => {
  const ledger = LedgerSchema.parse({
    ...fixture(),
    entries: [],
    contracts: [
      {
        id: "job",
        personId: "person",
        workId: "roof",
        title: "নমুনা ঠিক করা কাজ",
        total: 60000000,
      },
    ],
  });
  const before = structuredClone(ledger);
  const { container } = mount(ledger);
  expect(container.querySelector(".person-balance-head strong")).toBeNull();
  expect(container.querySelector(".person-agreements")?.textContent).toContain(
    formatMoney(60000000, "bn"),
  );
  fireEvent.click(screen.getByRole("button", { name: /নমুনা ঠিক করা কাজ/ }));
  expect(state.go).toHaveBeenLastCalledWith(
    "/jobs/job?back=%2Fpeople%2Fperson",
  );
  expect(ledger).toEqual(before);
});
it("offers optional work prices for every active identity", () => {
  mount();
  fireEvent.click(
    screen.getByRole("button", { name: "কাজের দর ঠিক করা থাকলে রাখি" }),
  );
  expect(state.entity).toHaveBeenLastCalledWith(
    "contract",
    undefined,
    undefined,
    "person",
  );
});
it("keeps the latest five entries and opens complete history across old account filters", () => {
  const base = fixture();
  const ledger = LedgerSchema.parse({
    ...base,
    entries: Array.from({ length: 7 }, (_, index) => ({
      id: `bill${index}`,
      kind: "expense",
      personId: "person",
      date: `2026-11-0${index + 1}`,
      lines: [
        {
          id: `l${index}`,
          workId: "roof",
          label: `নমুনা লেখা ${index}`,
          amount: 1000,
        },
      ],
    })),
  });
  const { container } = mount(ledger, "/people/person?account=materials");
  expect(container.querySelectorAll(".history-row")).toHaveLength(5);
  fireEvent.click(screen.getByRole("button", { name: "পুরো হিসাব" }));
  expect(state.go).toHaveBeenLastCalledWith(
    "/history?person=person&order=oldest",
  );
});
it("does not guess a historical payment or current due", () => {
  const base = fixture();
  const ledger = LedgerSchema.parse({
    ...base,
    entries: [
      {
        ...base.entries[0],
        balanceImpact: "historical",
        reviewStatus: "needs_review",
      },
    ],
  });
  const { container } = mount(ledger);
  expect(container.querySelector(".person-balance-head strong")).toBeNull();
  expect(container.querySelector(".contact-old-note")).toBeTruthy();
});
it("keeps an archived identity readable and disables new financial writing", () => {
  const ledger = fixture();
  ledger.people[0] = {
    ...ledger.people[0],
    archivedAt: "2026-11-05T00:00:00Z",
    removalHistory: [
      { id: "removed", at: "2026-11-05T00:00:00Z", archived: true },
    ],
  };
  mount(LedgerSchema.parse(ledger));
  expect(screen.queryByRole("button", { name: "টাকা দিই" })).toBeNull();
  expect(screen.queryByRole("button", { name: "হিসাব লিখি" })).toBeNull();
  expect(screen.getByRole("button", { name: "পুরো হিসাব" })).toBeTruthy();
});
it("redirects the old full-history link without reviving its account restriction", async () => {
  mount(fixture(), "/people/person?view=history&account=labour&work=roof");
  await waitFor(() => expect(screen.getByText("Opened history")).toBeTruthy());
});
it("keeps editing and sharing in the menu while hiding the old reconciliation task", async () => {
  mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "আরও" }));
  expect(
    screen.queryByRole("menuitem", { name: "মোট হিসাব মেলাই" }),
  ).toBeNull();
  await user.click(screen.getByRole("menuitem", { name: /তথ্য ও .*বদলাই/ }));
  expect(state.entity).toHaveBeenLastCalledWith("person", "person");
});
it("finds a contact by name without changing money or identity", () => {
  const ledger = fixture(),
    before = structuredClone(ledger);
  const { container } = mount(ledger, "/people");
  expect(container.querySelectorAll(".contact-row")).toHaveLength(2);
  fireEvent.change(
    screen.getByRole("textbox", { name: "নাম বা নম্বর খুঁজুন" }),
    { target: { value: "করিম" } },
  );
  expect(container.querySelectorAll(".contact-row")).toHaveLength(1);
  expect(container.textContent).not.toContain("নমুনা দোকান");
  expect(ledger).toEqual(before);
});
it("includes one identity in each explicit role filter", () => {
  const { container } = mount(fixture(), "/people?contactType=professional");
  expect(container.querySelectorAll(".contact-row")).toHaveLength(1);
  expect(
    within(container).getByRole("button", { name: /নমুনা দোকান/ }),
  ).toBeTruthy();
});
