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
