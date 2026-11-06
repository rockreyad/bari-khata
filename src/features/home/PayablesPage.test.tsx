// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import {
  LanguageProvider,
  useLanguageContext,
} from "../../context/LanguageProvider";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { savePreferences } from "../../lib/preferences";
import { PayablesPage } from "./PayablesPage";
import { payableBreakdown } from "./payableBreakdown";

const notebook = vi.hoisted(() => ({
  ledger: null as unknown,
  go: vi.fn(),
  detail: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({ ...notebook, ledger: notebook.ledger as Ledger }),
}));
vi.mock("./payableBreakdown", async (importOriginal) => {
  const original = await importOriginal<typeof import("./payableBreakdown")>();
  return { ...original, payableBreakdown: vi.fn(original.payableBreakdown) };
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

function fixture(count: number) {
  return LedgerSchema.parse({
    works: [{ id: "work", name: "নমুনা কাজ" }],
    people: Array.from({ length: count }, (_, index) => ({
      id: `person-${index}`,
      name: `নমুনা দোকান ${index}`,
      kind: "shop",
    })),
    entries: Array.from({ length: count }, (_, index) => ({
      id: `bill-${index}`,
      kind: "expense",
      personId: `person-${index}`,
      lines: [
        {
          id: `line-${index}`,
          workId: "work",
          label: "নমুনা মাল",
          amount: 10000,
        },
      ],
    })),
  });
}
function LanguageSwitch() {
  const { setLanguage } = useLanguageContext();
  return (
    <button onClick={() => setLanguage("bn")}>Test switch to Bangla</button>
  );
}
function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="dues-route">
      {location.pathname + location.search}
    </output>
  );
}
function mount(ledger: Ledger, route = "/dues") {
  notebook.ledger = ledger;
  savePreferences({ language: "en" });
  const view = () => (
    <MemoryRouter initialEntries={[route]}>
      <LanguageProvider>
        <PayablesPage />
        <LanguageSwitch />
        <LocationProbe />
      </LanguageProvider>
    </MemoryRouter>
  );
  const rendered = render(view());
  return {
    ...rendered,
    updateLedger: (next: Ledger) => {
      notebook.ledger = next;
      rendered.rerender(view());
    },
    rows: () => [
      ...rendered.container.querySelectorAll<HTMLButtonElement>(
        ".home-dues-list > li > button.home-dues-row",
      ),
    ],
    total: () =>
      rendered.container.querySelector(".home-dues-total dd")?.textContent,
  };
}

it("loads 75 dues in batches of 30 while keeping the full total and existing buttons", async () => {
  const user = userEvent.setup();
  const view = mount(fixture(75));
  const first = view.rows()[0];
  expect(view.rows()).toHaveLength(30);
  expect(view.total()).toBe("৳\u202f7,500");
  expect(payableBreakdown).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: "Load more" }));
  expect(view.rows()).toHaveLength(60);
  expect(view.rows()[0]).toBe(first);
  expect(view.total()).toBe("৳\u202f7,500");
  expect(screen.getByTestId("dues-route").textContent).toBe("/dues?page=2");

  await user.click(screen.getByRole("button", { name: "Load more" }));
  expect(view.rows()).toHaveLength(75);
  expect(view.rows()[0]).toBe(first);
  expect(view.total()).toBe("৳\u202f7,500");
  expect(screen.getByTestId("dues-route").textContent).toBe("/dues?page=3");
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  expect(payableBreakdown).toHaveBeenCalledTimes(1);

  await user.click(view.rows()[74]);
  expect(notebook.go).toHaveBeenCalledExactlyOnceWith(
    "/ledger?person=person-74&order=oldest",
  );
  expect(notebook.detail).not.toHaveBeenCalled();
});

it("reuses financial calculations for pagination and language changes and refreshes them for a changed ledger", async () => {
  const user = userEvent.setup();
  const view = mount(fixture(75));
  await user.click(screen.getByRole("button", { name: "Load more" }));
  await user.click(
    screen.getByRole("button", { name: "Test switch to Bangla" }),
  );
  expect(view.rows()).toHaveLength(60);
  expect(view.total()).toBe("৳\u202f৭,৫০০");
  expect(view.rows()[0].textContent).toContain("নমুনা দোকান ০");
  expect(screen.getByRole("button", { name: "আরও দেখুন" })).toBeTruthy();
  expect(payableBreakdown).toHaveBeenCalledTimes(1);

  const next = fixture(76);
  view.updateLedger(next);
  expect(view.total()).toBe("৳\u202f৭,৬০০");
  expect(payableBreakdown).toHaveBeenCalledTimes(2);
  expect(payableBreakdown).toHaveBeenLastCalledWith(next);
});

it("opens an anonymous bill using its canonical bill identity", async () => {
  const user = userEvent.setup();
  const ledger = LedgerSchema.parse({
    works: [{ id: "work", name: "নমুনা কাজ" }],
    entries: [
      {
        id: "unnamed-bill",
        kind: "expense",
        lines: [
          {
            id: "line",
            workId: "work",
            label: "নমুনা সিমেন্ট",
            amount: 10000,
          },
        ],
      },
      {
        id: "settlement",
        kind: "payment",
        relatedEntryId: "unnamed-bill",
        allocations: [{ workId: "work", amount: 4000 }],
        paymentParts: [{ amount: 4000 }],
      },
    ],
  });
  const view = mount(ledger);
  await user.click(view.rows()[0]);
  expect(notebook.detail).toHaveBeenCalledExactlyOnceWith("unnamed-bill");
  expect(notebook.go).not.toHaveBeenCalled();
});

it.each([0, 1, 30])("renders %i dues without a load-more button", (count) => {
  const view = mount(fixture(count));
  expect(view.rows()).toHaveLength(count);
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
});

it("keeps sample routes and existing query parameters when loading more", async () => {
  const user = userEvent.setup();
  const view = mount(fixture(75), "/sample/dues?keep=1&page=2");
  expect(view.rows()).toHaveLength(60);
  await user.click(screen.getByRole("button", { name: "Load more" }));
  expect(view.rows()).toHaveLength(75);
  expect(screen.getByTestId("dues-route").textContent).toBe(
    "/sample/dues?keep=1&page=3",
  );
});

it.each(["0", "-2", "NaN", "Infinity", "1.5", "9007199254740992"])(
  "clamps unsafe page %s to the first batch",
  (page) => {
    const view = mount(fixture(75), `/dues?page=${page}`);
    expect(view.rows()).toHaveLength(30);
    expect(view.total()).toBe("৳\u202f7,500");
  },
);

it("clamps a page beyond the final batch without hiding any dues", () => {
  const view = mount(fixture(75), "/dues?page=999");
  expect(view.rows()).toHaveLength(75);
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
});

it("returns to the notebook overview from a directly opened dues page", async () => {
  const user = userEvent.setup();
  mount(fixture(1), "/sample/dues");
  await user.click(screen.getByRole("button", { name: "Overview" }));
  expect(notebook.go).toHaveBeenCalledExactlyOnceWith("/");
});

function partyFixture() {
  return LedgerSchema.parse({
    architectureVersion: 2,
    paymentAllocations: [],
    works: [
      { id: "roof", name: "নমুনা ছাদ" },
      { id: "wall", name: "নমুনা দেয়াল" },
    ],
    people: [
      { id: "person", name: "নমুনা কর্মী", roles: ["supplier"] },
      { id: "other", name: "অন্য কর্মী", roles: ["supplier"] },
    ],
    entries: [
      ...[
        ["first", 10000],
        ["second", 20000],
      ].map(([id, amount]) => ({
        id,
        kind: "expense",
        personId: "person",
        account: "materials",
        date: "2026-11-01",
        lines: [
          {
            id: `${id}-line`,
            workId: "roof",
            amount,
            label: `নমুনা ${id}`,
            costType: "material",
          },
        ],
      })),
      {
        id: "old-cash",
        kind: "payment",
        personId: "person",
        account: "materials",
        paymentContext: "settlement",
        allocations: [{ workId: "roof", amount: 10000 }],
        paymentParts: [{ amount: 10000 }],
      },
      {
        id: "other-bill",
        kind: "expense",
        personId: "other",
        lines: [
          {
            id: "other-line",
            workId: "wall",
            amount: 50000,
            label: "অন্য কর্মীর বিল",
          },
        ],
      },
    ],
  });
}
it("shows only the requested worker's neutral balance when old cash is not linked to specific bills", () => {
  const view = mount(partyFixture(), "/dues?person=person");
  expect(view.rows()).toHaveLength(1);
  expect(view.total()).toBe("৳\u202f200");
  expect(screen.queryByText("নমুনা first")).toBeNull();
  expect(screen.queryByText("নমুনা second")).toBeNull();
  expect(screen.queryByText("অন্য কর্মীর বিল")).toBeNull();
  expect(view.rows()[0].textContent).toContain("200");
});
it("prefills a particular bill payment with its capped amount, source scope and sample return context", async () => {
  const user = userEvent.setup();
  const ledger = partyFixture();
  ledger.paymentAllocations = [
    {
      id: "known",
      paymentId: "old-cash",
      billId: "first",
      workId: "roof",
      amount: 10000,
      createdAt: "2026-11-01T00:00:00Z",
    },
  ];
  mount(ledger, "/sample/dues?person=person&keep=1");
  await user.click(screen.getByRole("button", { name: "Pay: নমুনা second" }));
  const url = new URL(notebook.go.mock.calls[0][0], "https://example.invalid");
  expect(url.pathname).toBe("/write/payment");
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    person: "person",
    bill: "second",
    account: "materials",
    contract: "none",
    work: "roof",
    amount: "20000",
    purpose: "settle",
    back: "/sample/dues?person=person&keep=1",
  });
  expect(notebook.detail).not.toHaveBeenCalled();
});
it("keeps an invalid person query isolated instead of displaying everyone's dues", () => {
  const view = mount(partyFixture(), "/dues?person=missing");
  expect(view.rows()).toHaveLength(0);
  expect(screen.getByRole("heading").textContent).toContain("not found");
  expect(screen.queryByText("নমুনা first")).toBeNull();
  expect(screen.queryByText("অন্য কর্মীর বিল")).toBeNull();
});
it("applies the requested worker and notebook filters together without crossing their work scopes", () => {
  const ledger = partyFixture();
  ledger.entries.push(
    ...LedgerSchema.parse({
      ...ledger,
      entries: [
        {
          id: "wall-bill",
          kind: "expense",
          personId: "person",
          lines: [
            {
              id: "wall-line",
              workId: "wall",
              amount: 5000,
              label: "নমুনা দেয়ালের বিল",
            },
          ],
        },
      ],
    }).entries,
  );
  const view = mount(ledger, "/dues?person=person&work=wall");
  expect(view.rows()).toHaveLength(1);
  expect(view.total()).toBe("৳\u202f50");
  expect(screen.getByText("নমুনা দেয়ালের বিল")).toBeTruthy();
  expect(screen.queryByText("নমুনা first")).toBeNull();
});
it("opens related dues instead of guessing a multi-bill global settlement", async () => {
  const user = userEvent.setup();
  const ledger = partyFixture();
  ledger.entries = ledger.entries.filter((entry) => entry.id !== "old-cash");
  mount(ledger, "/sample/dues?keep=1");
  await user.click(screen.getByRole("button", { name: "Pay নমুনা কর্মী" }));
  expect(notebook.go).toHaveBeenCalledExactlyOnceWith("/dues?person=person");
});
it("directly prefills a global payment only when there is one canonical due item", async () => {
  const user = userEvent.setup();
  const ledger = partyFixture();
  ledger.entries = ledger.entries.filter((entry) => entry.id !== "second");
  ledger.entries.find(
    (entry) => entry.id === "old-cash",
  )!.allocations[0].amount = 4000;
  ledger.entries.find(
    (entry) => entry.id === "old-cash",
  )!.paymentParts[0].amount = 4000;
  mount(ledger, "/sample/dues?keep=1");
  await user.click(screen.getByRole("button", { name: "Pay নমুনা কর্মী" }));
  const url = new URL(notebook.go.mock.calls[0][0], "https://example.invalid");
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    person: "person",
    balanceOnly: "1",
    amount: "6000",
    account: "materials",
    contract: "none",
    dueWork: "all",
    dueAccount: "all",
    purpose: "settle",
    back: "/sample/dues?keep=1",
  });
});
