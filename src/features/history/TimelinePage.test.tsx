// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { LedgerSchema } from "../../domain/model";
import { TimelinePage } from "./TimelinePage";
const state = vi.hoisted(() => ({
  ledger: {} as unknown,
  go: vi.fn(),
  detail: vi.fn(),
}));
const translate = vi.hoisted(
  () =>
    (text: string, values: Record<string, string> = {}) =>
      text.replace(/{{(\w+)}}/g, (_, key: string) => values[key] ?? ""),
);
vi.mock("../../app/NotebookProvider", () => ({ useNotebook: () => state }));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: translate,
    money: (value: number) => `৳${value / 100}`,
    formatDigits: String,
    number: String,
    date: (value: string) => value.slice(0, 10),
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function Location() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="location">{location.search}</output>
      <button onClick={() => navigate(-1)}>browser back</button>
    </>
  );
}
function App({ start = "/timeline" }: { start?: string }) {
  return (
    <MemoryRouter initialEntries={[start]}>
      <TimelinePage />
      <Location />
    </MemoryRouter>
  );
}
function fixture(count: number) {
  return LedgerSchema.parse({
    works: [{ id: "work", name: "খাতা" }],
    entries: Array.from({ length: count }, (_, index) => ({
      id: `bill${index}`,
      kind: "expense",
      createdAt: new Date(
        Date.UTC(2026, 10, 3, 10) - index * 1000,
      ).toISOString(),
      note: `wall repair ${index}`,
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
}
const cards = () =>
  screen.getAllByRole("button", { name: /খরচের হিসাব রেখেছি/ });
const locationParams = () =>
  new URLSearchParams(screen.getByTestId("location").textContent ?? "");
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
it("keeps only one page of cards mounted through a large history and restores page/filter/search from the URL", () => {
  const ledger = fixture(1000);
  state.ledger = ledger;
  const before = JSON.stringify(ledger);
  const view = render(<App start="/timeline?type=money&q=সিমেন্ট" />);
  expect(cards()).toHaveLength(40);
  expect(
    (screen.getByRole("button", { name: "আগের পাতা" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  for (let page = 2; page <= 5; page++) {
    fireEvent.click(screen.getByRole("button", { name: "পরের পাতা" }));
    expect(cards()).toHaveLength(40);
    expect(locationParams().get("page")).toBe(String(page));
    expect(locationParams().get("type")).toBe("money");
    expect(locationParams().get("q")).toBe("সিমেন্ট");
  }
  expect(screen.queryByText("সিমেন্ট 0", { exact: true })).toBeNull();
  expect(screen.getByText("সিমেন্ট 160", { exact: true })).toBeTruthy();
  const address = `/timeline${screen.getByTestId("location").textContent}`;
  fireEvent.click(screen.getByRole("button", { name: "browser back" }));
  expect(locationParams().get("page")).toBe("4");
  expect(cards()).toHaveLength(40);
  view.unmount();
  render(<App start={address} />);
  expect(screen.getByText("সিমেন্ট 160", { exact: true })).toBeTruthy();
  expect(cards()).toHaveLength(40);
  expect(JSON.stringify(ledger)).toBe(before);
});

it("resets pagination when either search or category changes, including a search for the literal word all", async () => {
  state.ledger = fixture(150);
  render(<App start="/timeline?type=money&page=3" />);
  fireEvent.change(screen.getByRole("textbox", { name: "টাইমলাইনে খুঁজুন" }), {
    target: { value: "সিমেন্ট ১৪৯" },
  });
  await waitFor(() => expect(cards()).toHaveLength(1));
  expect(locationParams().has("page")).toBe(false);
  expect(screen.getByText("সিমেন্ট 149", { exact: true })).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "টাইমলাইনে খুঁজুন" }), {
    target: { value: "all" },
  });
  await waitFor(() => expect(cards()).toHaveLength(40));
  expect(locationParams().get("q")).toBe("all");
  expect(
    (
      screen.getByRole("textbox", {
        name: "টাইমলাইনে খুঁজুন",
      }) as HTMLInputElement
    ).value,
  ).toBe("all");
  fireEvent.click(screen.getByRole("button", { name: "পরের পাতা" }));
  expect(locationParams().get("page")).toBe("2");
  fireEvent.click(screen.getByRole("button", { name: "মিস্ত্রির কাজ" }));
  expect(locationParams().has("page")).toBe(false);
  expect(screen.getByText("এখানে কোনো ঘটনা পাওয়া যায়নি।")).toBeTruthy();
});

it.each([
  ["-1", null, 40],
  ["999", "2", 5],
  ["9007199254740993", null, 40],
] as const)(
  "canonicalizes page=%s without mounting an unbounded list",
  async (page, expected, count) => {
    state.ledger = fixture(45);
    render(<App start={`/timeline?page=${page}`} />);
    await waitFor(() => expect(locationParams().get("page")).toBe(expected));
    expect(cards()).toHaveLength(count);
  },
);

it("moves back to an available page if refreshed ledger data shrinks", async () => {
  state.ledger = fixture(100);
  const view = render(<App start="/timeline?page=3" />);
  expect(cards()).toHaveLength(20);
  state.ledger = fixture(10);
  view.rerender(<App start="/timeline?page=3" />);
  await waitFor(() => expect(locationParams().has("page")).toBe(false));
  expect(cards()).toHaveLength(10);
});
