// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { LanguageProvider } from "../../context/LanguageProvider";
import { LedgerDatabase } from "../../data/database";
import { LedgerRepository } from "../../data/repository";
import { createEmptyLedger } from "../../domain/demo";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { savePreferences } from "../../lib/preferences";
import { LedgerPage } from "./LedgerPage";
import { buildLedgerSearchIndex, selectLedgerSearch } from "./searchAnalytics";

const notebook = vi.hoisted(() => ({
  ledger: null as unknown,
  detail: vi.fn(),
  add: vi.fn(),
  go: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({ ...notebook, ledger: notebook.ledger as Ledger }),
}));
vi.mock("./searchAnalytics", async (importOriginal) => {
  const original = await importOriginal<typeof import("./searchAnalytics")>();
  return {
    ...original,
    buildLedgerSearchIndex: vi.fn(original.buildLedgerSearchIndex),
    selectLedgerSearch: vi.fn(original.selectLedgerSearch),
  };
});

const databases: LedgerDatabase[] = [];
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  for (const database of databases.splice(0)) await database.delete();
});

function searchFixture(count = 65) {
  return LedgerSchema.parse({
    ...createEmptyLedger(),
    works: [
      { id: "masonry", name: "নমুনা রাজমিস্ত্রির কাজ" },
      { id: "roof", name: "নমুনা ছাদ" },
    ],
    people: [{ id: "shop", name: "নমুনা দোকান", kind: "shop" }],
    materialGroups: [{ id: "sand", name: "বালু", aliases: ["বালি"] }],
    items: [
      {
        id: "sand-item",
        name: "বালু",
        materialGroupId: "sand",
        aliases: ["বালি"],
      },
    ],
    entries: Array.from({ length: count }, (_, index) => ({
      id: `sand-${String(index).padStart(3, "0")}`,
      kind: "expense",
      account: "materials",
      personId: "shop",
      date: index < 35 ? "2026-10-05" : "2026-11-05",
      lines: [
        {
          id: `sand-line-${index}`,
          workId: "masonry",
          label: `বালু ${index + 1}`,
          itemId: "sand-item",
          materialGroupId: "sand",
          costType: "material",
          amount: 10000,
        },
        ...(index === 0
          ? [
              {
                id: "cement-line",
                workId: "masonry",
                label: "সিমেন্ট",
                amount: 90000,
              },
            ]
          : []),
      ],
    })),
  });
}

function variedFixture() {
  const original = searchFixture(2);
  return LedgerSchema.parse({
    ...original,
    entries: [
      {
        ...original.entries[0],
        date: "2026-11-05",
      },
      {
        ...original.entries[1],
        date: "2026-10-05",
        lines: [{ ...original.entries[1].lines[0], amount: 30000 }],
      },
      {
        ...original.entries[1],
        id: "undated-sand",
        date: null,
        lines: [
          { ...original.entries[1].lines[0], id: "undated-line", amount: 5000 },
        ],
      },
      {
        id: "sand-return",
        kind: "expense_credit",
        account: "materials",
        personId: "shop",
        date: "2026-11-06",
        lines: [
          {
            id: "return-line",
            workId: "masonry",
            label: "বালু ফেরত",
            itemId: "sand-item",
            materialGroupId: "sand",
            amount: 2000,
          },
        ],
      },
      {
        id: "sand-payment",
        kind: "payment",
        account: "materials",
        personId: "shop",
        note: "বালু কেনার টাকা",
        date: "2026-11-06",
        allocations: [{ workId: "masonry", amount: 90000 }],
        paymentParts: [{ amount: 90000 }],
      },
      {
        id: "sand-refund",
        kind: "refund",
        account: "materials",
        personId: "shop",
        note: "বালুর টাকা ফেরত",
        date: "2026-11-06",
        allocations: [{ workId: "masonry", amount: 10000 }],
        paymentParts: [{ amount: 10000 }],
      },
    ],
  });
}

function scopedFixture() {
  const original = variedFixture();
  return LedgerSchema.parse({
    ...original,
    entries: [
      ...original.entries,
      {
        id: "roof-sand",
        kind: "expense",
        account: "materials",
        date: "2026-11-06",
        lines: [
          {
            id: "roof-sand-line",
            workId: "roof",
            label: "বালু",
            amount: 70000,
          },
        ],
      },
      {
        id: "sand-transport",
        kind: "expense",
        account: "other",
        date: "2026-11-06",
        lines: [
          {
            id: "sand-transport-line",
            workId: "masonry",
            label: "বালু আনার ভাড়া",
            costType: "transport",
            amount: 5000,
          },
        ],
      },
    ],
  });
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="search-location">
      {location.pathname + location.search}
    </output>
  );
}

function NavigationProbe() {
  const navigate = useNavigate();
  return (
    <>
      <button
        onClick={() => navigate("/ledger?q=সিমেন্ট&work=masonry&month=2026-11")}
      >
        Test cement search
      </button>
      <button onClick={() => navigate(-1)}>Test back</button>
      <button onClick={() => navigate(1)}>Test forward</button>
    </>
  );
}

function mount(
  ledger: Ledger,
  path = "/ledger?q=বালু&order=oldest",
  language: "bn" | "en" = "bn",
) {
  notebook.ledger = ledger;
  savePreferences({ language });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LanguageProvider>
        <LedgerPage />
        <LocationProbe />
        <NavigationProbe />
      </LanguageProvider>
    </MemoryRouter>,
  );
}

const route = () =>
  new URL(
    screen.getByTestId("search-location").textContent!,
    "https://bari.invalid",
  );
const analytics = () => screen.getByRole("region", { name: "খোঁজার হিসাব" });
const visibleRows = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLButtonElement>(".history-row"),
];

it("totals all 65 exact matches before pagination and shows only the matching part of a mixed bill", async () => {
  const user = userEvent.setup();
  const ledger = searchFixture();
  const original = JSON.stringify(ledger);
  const { container } = mount(ledger);
  expect(analytics().textContent).toContain("৬,৫০০");
  expect(buildLedgerSearchIndex).toHaveBeenCalledTimes(1);
  expect(selectLedgerSearch).toHaveBeenCalledTimes(1);
  expect(visibleRows(container)).toHaveLength(30);
  const first = visibleRows(container)[0];
  expect(first.textContent).toContain("মেলা অংশ");
  expect(within(first).getByText(/৳/).textContent).toContain("১০০");
  expect(within(first).getByText(/৳/).textContent).not.toContain("১,০০০");
  await user.click(screen.getByRole("button", { name: "আরও দেখুন" }));
  expect(visibleRows(container)).toHaveLength(60);
  expect(visibleRows(container)[0]).toBe(first);
  expect(route().searchParams.get("page")).toBe("2");
  expect(analytics().textContent).toContain("৬,৫০০");
  expect(buildLedgerSearchIndex).toHaveBeenCalledTimes(1);
  expect(selectLedgerSearch).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "আরও দেখুন" }));
  expect(visibleRows(container)).toHaveLength(65);
  expect(screen.queryByRole("button", { name: "আরও দেখুন" })).toBeNull();
  expect(analytics().textContent).toContain("৬,৫০০");
  expect(buildLedgerSearchIndex).toHaveBeenCalledTimes(1);
  expect(selectLedgerSearch).toHaveBeenCalledTimes(1);
  await user.click(first);
  expect(notebook.detail).toHaveBeenCalledWith("sand-000");
  expect(JSON.stringify(ledger)).toBe(original);
});

it("renders a partial mixed bill with a prototype-like entry ID safely", async () => {
  const user = userEvent.setup();
  const original = searchFixture(1);
  const ledger = LedgerSchema.parse({
    ...original,
    entries: [{ ...original.entries[0], id: "__proto__" }],
  });
  const before = JSON.stringify(ledger);
  const { container } = mount(ledger);
  const rows = visibleRows(container);
  expect(rows).toHaveLength(1);
  expect(rows[0].textContent).toContain("মেলা অংশ");
  expect(within(rows[0]).getByText(/৳/).textContent).toContain("১০০");
  expect(
    analytics().querySelector(".ledger-search-total-value")?.textContent,
  ).toContain("১০০");
  await user.click(rows[0]);
  expect(notebook.detail).toHaveBeenCalledExactlyOnceWith("__proto__");
  expect(JSON.stringify(ledger)).toBe(before);
});

it("keeps purchase returns and payments distinct in the searched expense total", () => {
  const ledger = variedFixture();
  const original = JSON.stringify(ledger);
  mount(ledger);
  expect(analytics().textContent).toContain("৪৩০");
  expect(analytics().textContent).toContain("৪৫০");
  expect(analytics().textContent).toContain("২০");
  expect(analytics().textContent).not.toContain("৯০০");
  expect(JSON.stringify(ledger)).toBe(original);
});

it("uses the chart month to narrow totals and rows and keeps undated costs separate", async () => {
  const user = userEvent.setup();
  const ledger = variedFixture();
  const original = JSON.stringify(ledger);
  const { container } = mount(ledger);
  await user.click(
    within(analytics()).getByRole("button", { name: "মাসে মাসে" }),
  );
  const months = screen.getByRole("group", { name: "চার্টের মাস বেছে নিন" });
  await user.click(
    within(months).getByRole("button", { name: /অক্টোবর.*২০২৬/ }),
  );
  expect(route().searchParams.get("month")).toBe("2026-10");
  expect(route().searchParams.has("page")).toBe(false);
  expect(visibleRows(container)).toHaveLength(1);
  expect(visibleRows(container)[0].textContent).toContain("৩০০");
  expect(analytics().textContent).toContain("৩০০");
  await user.click(screen.getByRole("button", { name: "সব মাস দেখুন" }));
  expect(route().searchParams.has("month")).toBe(false);
  expect(analytics().textContent).toContain("৪৩০");
  await user.click(screen.getByRole("button", { name: "তারিখ লেখা নেই" }));
  expect(route().searchParams.get("month")).toBe("undated");
  expect(visibleRows(container)).toHaveLength(1);
  expect(visibleRows(container)[0].textContent).toContain("৫০");
  expect(JSON.stringify(ledger)).toBe(original);
});

it("keeps fuzzy material suggestions out of totals until the user selects one", async () => {
  const user = userEvent.setup();
  const { container } = mount(variedFixture(), "/ledger?q=বালূ&order=oldest");
  expect(visibleRows(container)).toHaveLength(0);
  const suggestions = screen.getAllByRole("button", {
    name: /মালের হিসাব: বালু/,
  });
  expect(suggestions.length).toBeGreaterThan(0);
  await user.click(suggestions[0]);
  expect(route().searchParams.get("material")).toBeTruthy();
  expect(route().searchParams.has("q")).toBe(false);
  expect(analytics().textContent).toContain("৪৩০");
  expect(
    visibleRows(container).some((row) =>
      row.classList.contains("history-payment"),
    ),
  ).toBe(false);
  await user.click(screen.getByRole("button", { name: "মালের বাছাই মুছুন" }));
  expect(route().searchParams.has("material")).toBe(false);
});

it("shows the search summary only when there is a search or filter", () => {
  mount(searchFixture(1), "/ledger");
  expect(screen.queryByRole("region", { name: "খোঁজার হিসাব" })).toBeNull();
});

it("renders searched cost labels and totals in English through the language provider", async () => {
  const user = userEvent.setup();
  mount(variedFixture(), "/ledger?q=বালু&order=oldest", "en");
  const summary = screen.getByRole("region", { name: "Search totals" });
  expect(within(summary).getByText("Recorded cost")).toBeTruthy();
  expect(within(summary).getByText("Purchases")).toBeTruthy();
  expect(within(summary).getByText("Material return")).toBeTruthy();
  expect(summary.textContent).toContain("430");
  expect(summary.textContent).not.toContain("মোট খরচ");
  await user.click(within(summary).getByRole("button", { name: "By month" }));
  expect(screen.getByRole("button", { name: "Date unknown" })).toBeTruthy();
});

it.each([
  [
    "work=masonry&account=materials&type=material&from=2026-11-01&to=2026-11-30",
    "৮০",
  ],
  [
    "work=masonry&account=materials&type=material&from=2026-10-01&to=2026-10-31",
    "৩০০",
  ],
  ["work=roof&account=materials&type=material", "৭০০"],
  ["work=masonry&account=other&type=transport", "৫০"],
])("applies the same filters to rows and analytics: %s", (filters, total) => {
  const { container } = mount(scopedFixture(), `/ledger?q=বালু&${filters}`);
  expect(analytics().textContent).toContain(total);
  const rows = visibleRows(container);
  if (
    filters.includes("work=roof") ||
    filters.includes("2026-10-01") ||
    filters.includes("type=transport")
  )
    expect(rows).toHaveLength(1);
  else
    expect(rows.every((row) => !row.textContent?.includes("অক্টো"))).toBe(true);
});

it("resets a selected month and appended rows when the search changes", async () => {
  const user = userEvent.setup();
  mount(
    searchFixture(),
    "/ledger?q=বালু&month=2026-10&page=2&work=masonry&order=oldest",
  );
  const input = screen.getByRole("searchbox", { name: "হিসাব খুঁজুন" });
  await user.clear(input);
  await user.type(input, "সিমেন্ট");
  expect(route().searchParams.get("q")).toBe("সিমেন্ট");
  expect(route().searchParams.has("month")).toBe(false);
  expect(route().searchParams.has("page")).toBe(false);
  expect(route().searchParams.get("work")).toBe("masonry");
  expect(analytics().textContent).toContain("৯০০");
});

it("restores search totals and rows with browser back and forward navigation", async () => {
  const user = userEvent.setup();
  const { container } = mount(variedFixture());
  expect(analytics().textContent).toContain("৪৩০");
  await user.click(screen.getByRole("button", { name: "Test cement search" }));
  expect(route().searchParams.get("q")).toBe("সিমেন্ট");
  expect(analytics().textContent).toContain("৯০০");
  expect(visibleRows(container)).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Test back" }));
  expect(route().searchParams.get("q")).toBe("বালু");
  expect(analytics().textContent).toContain("৪৩০");
  await user.click(screen.getByRole("button", { name: "Test forward" }));
  expect(route().searchParams.get("q")).toBe("সিমেন্ট");
  expect(analytics().textContent).toContain("৯০০");
});

it("reopens the same searched totals and mixed-bill amount from IndexedDB and a restored backup", async () => {
  const makeRepository = () => {
    const database = new LedgerDatabase(
      `test-ledger-search-${crypto.randomUUID()}`,
    );
    databases.push(database);
    return new LedgerRepository(database);
  };
  const repo = makeRepository();
  await repo.ensure("real", createEmptyLedger());
  await repo.save(variedFixture(), "real");
  repo.database.close();
  await repo.database.open();
  const first = mount((await repo.read("real"))!.ledger);
  const expected = analytics().textContent;
  expect(expected).toContain("৪৩০");
  first.unmount();
  const target = makeRepository();
  await target.ensure("real", createEmptyLedger());
  await target.importBackup(await repo.exportBackup(), { replace: true });
  target.database.close();
  await target.database.open();
  const restored = mount((await target.read("real"))!.ledger);
  expect(analytics().textContent).toBe(expected);
  const mixed = visibleRows(restored.container).find((row) =>
    row.textContent?.includes("বালু ১"),
  );
  expect(mixed?.textContent).toContain("মেলা অংশ");
  expect(mixed?.textContent).toContain("১০০");
});
