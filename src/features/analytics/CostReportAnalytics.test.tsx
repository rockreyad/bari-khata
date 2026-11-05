// @vitest-environment jsdom
import { Suspense, type ReactNode, type SelectHTMLAttributes } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  BrowserRouter,
  MemoryRouter,
  useLocation,
  useNavigate,
} from "react-router";
import { LanguageProvider } from "../../context/LanguageProvider";
import { LedgerSchema } from "../../domain/model";
import { formatMoney } from "../../lib/formatMoney";
import { savePreferences } from "../../lib/preferences";
import { saveFile } from "../../lib/display";
import {
  buildLedgerSearchIndex,
  selectLedgerSearch,
} from "../ledger/searchAnalytics";
import { buildCostReportIndex } from "./analytics";
import { AnalyticsPage } from "./AnalyticsPage";

vi.mock("./analytics", async (importOriginal) => {
  const original = await importOriginal<typeof import("./analytics")>();
  return {
    ...original,
    buildCostReportIndex: vi.fn(original.buildCostReportIndex),
  };
});
vi.mock("../../lib/display", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/display")>()),
  saveFile: vi.fn(),
}));
vi.mock("../../components/ui/AppSelect", () => ({
  AppSelect: (props: SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props} />
  ),
}));
vi.mock("../../components/Sheet", () => ({
  Sheet: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => (
    <section>
      {children}
      {footer}
    </section>
  ),
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

function fixture() {
  const line = (id: string, label: string, amount: number, extra = {}) => ({
    id,
    workId: "roof",
    label,
    amount,
    ...extra,
  });
  const bill = (
    id: string,
    lines: unknown[],
    date: string | null = "2026-06-10",
    extra = {},
  ) => ({ id, kind: "expense", personId: "shop", lines, date, ...extra });
  return LedgerSchema.parse({
    works: [
      { id: "roof", name: "ছাদ" },
      { id: "door", name: "দরজা" },
    ],
    people: [{ id: "shop", name: "নমুনা দোকান", kind: "shop" }],
    materialGroups: [
      { id: "cement", name: "সিমেন্ট", aliases: ["Cement"] },
      { id: "sand", name: "বালু", aliases: ["Sand"] },
    ],
    entries: [
      bill("mixed", [
        line("cement", "Cement", 10000),
        line("sand", "বালু", 90000),
      ]),
      bill(
        "unload",
        [line("unload-line", "সিমেন্ট আনলোড", 2000, { costType: "unload" })],
        "2026-07-10",
        { account: "other" },
      ),
      bill("return", [line("returned", "Cement ফেরত", 1000)], "2026-08-10", {
        kind: "expense_credit",
      }),
      bill("undated", [line("undated-line", "সিমেন্ট", 5000)], null),
      bill("historical", [line("old-line", "সিমেন্ট", 1000)], "2026-09-10", {
        balanceImpact: "historical",
        reviewStatus: "needs_review",
      }),
      bill("note-only", [line("other", "অন্য মাল", 70000)], "2026-06-10", {
        note: "সিমেন্ট",
      }),
      bill("uncertain", [line("mixed-name", "সিমেন্ট ও বালু", 99999)]),
      bill(
        "rental",
        [line("machine", "Cement mixer rental", 3000, { costType: "rental" })],
        "2026-06-10",
        { account: "other" },
      ),
      bill(
        "other-work",
        [line("door-cement", "সিমেন্ট", 9000, { workId: "door" })],
        "2026-11-10",
      ),
      bill(
        "cancelled",
        [line("cancelled-line", "সিমেন্ট", 12345)],
        "2026-06-10",
        { voided: true },
      ),
      {
        id: "payment",
        kind: "payment",
        personId: "shop",
        date: "2026-06-10",
        allocations: [{ workId: "roof", amount: 100000 }],
        paymentParts: [{ amount: 100000 }],
      },
    ],
  });
}
function Probe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="route" data-key={location.key}>
        {location.pathname + location.search}
      </output>
      <button onClick={() => navigate(-1)}>Back</button>
      <button onClick={() => navigate(1)}>Forward</button>
    </>
  );
}
const route = () =>
  new URL(screen.getByTestId("route").textContent!, "https://bari.invalid");
const total = (container: HTMLElement) =>
  container.querySelector(".report-total > strong")?.textContent;
function mount(
  path = "/reports?mode=cost&q=সিমেন্ট&work=roof",
  language: "bn" | "en" = "en",
) {
  savePreferences({ language });
  const ledger = fixture();
  const onEntry = vi.fn();
  return {
    ledger,
    onEntry,
    ...render(
      <MemoryRouter initialEntries={[path]}>
        <LanguageProvider>
          <AnalyticsPage ledger={ledger} onEntry={onEntry} />
          <Probe />
        </LanguageProvider>
      </MemoryRouter>,
    ),
  };
}

it("uses the ledger's line eligibility for default all-price search, excluding payments and ambiguous portions", () => {
  const { container, ledger, onEntry } = mount();
  const before = JSON.stringify(ledger);
  const expected = selectLedgerSearch(buildLedgerSearchIndex(ledger), {
    query: "সিমেন্ট",
    workId: "roof",
  });
  expect(expected.totalCost).toBe(17000);
  expect(total(container)).toBe(formatMoney(expected.totalCost, "en"));
  expect(
    screen.getByRole("tab", { name: "All prices", selected: true }),
  ).toBeTruthy();
  expect(container.querySelector(".history-payment")).toBeNull();
  const partial = [
    ...container.querySelectorAll<HTMLButtonElement>(".history-row"),
  ].find((row) => row.textContent?.includes("Matching portion"))!;
  expect(partial.querySelector(".history-row-amount")?.textContent).toBe(
    formatMoney(10000, "en"),
  );
  expect(partial.textContent).toContain("Matching portion");
  const uncertain = screen.getByRole("button", { name: /সিমেন্ট ও বালু/ });
  expect(uncertain.textContent).toContain("excluded from total");
  fireEvent.click(uncertain);
  expect(onEntry).toHaveBeenCalledWith("uncertain");
  expect(container.textContent).toContain("uncertain portion is excluded");
  expect(JSON.stringify(ledger)).toBe(before);
});

it("shares the selected month across total, rows, breakdown and CSV while keeping undated costs separate", async () => {
  const { container } = mount();
  await userEvent.click(screen.getByRole("button", { name: "By month" }));
  await userEvent.click(screen.getByRole("button", { name: "June 2026" }));
  expect(route().searchParams.get("month")).toBe("2026-06");
  expect(total(container)).toBe(formatMoney(10000, "en"));
  expect(
    container.querySelector(".report-breakdown-list button > strong")
      ?.textContent,
  ).toBe(formatMoney(10000, "en"));
  fireEvent.click(screen.getByRole("button", { name: "Download this report" }));
  const csv = vi.mocked(saveFile).mock.calls[0][0] as string;
  expect(csv.split("\r\n")).toHaveLength(2);
  expect(csv).toContain('"100.00"');
  expect(csv).not.toContain("সিমেন্ট ও বালু");
  fireEvent.click(screen.getByRole("button", { name: /Date unknown.*50/ }));
  expect(route().searchParams.get("month")).toBe("undated");
  expect(total(container)).toBe(formatMoney(5000, "en"));
  expect(container.querySelectorAll(".history-row")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Show all months" }));
  expect(total(container)).toBe(formatMoney(17000, "en"));
  expect(vi.mocked(buildCostReportIndex)).toHaveBeenCalledTimes(1);
});

it("keeps section, account, person and date constraints in monthly analytics and clears an invalid month safely", () => {
  const { container } = mount(
    "/reports?mode=cost&q=সিমেন্ট&work=roof&person=shop&section=transport&account=other&from=2026-07-01&to=2026-08-31&month=bad",
  );
  expect(total(container)).toBe(formatMoney(0, "en"));
  expect(container.textContent).toContain("Please choose again");
  fireEvent.click(screen.getByRole("button", { name: "Show all months" }));
  expect(total(container)).toBe(formatMoney(2000, "en"));
  expect(Object.fromEntries(route().searchParams)).toEqual({
    mode: "cost",
    q: "সিমেন্ট",
    work: "roof",
    person: "shop",
    section: "transport",
    account: "other",
    from: "2026-07-01",
    to: "2026-08-31",
  });
});

it("keeps Bengali preedit local, clears month on commit and ignores a trailing duplicate event", () => {
  const { container } = mount(
    "/reports?mode=cost&q=সিমেন্ট&work=roof&month=2026-07",
  );
  const input = screen.getByRole("textbox", {
    name: "Search this report",
  }) as HTMLInputElement;
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "balu" } });
  expect(input.value).toBe("balu");
  expect(route().searchParams.get("q")).toBe("সিমেন্ট");
  expect(total(container)).toBe(formatMoney(2000, "en"));
  fireEvent.compositionEnd(input, {
    data: "শেষ অক্ষর",
    target: { value: "বালু" },
  });
  expect(route().searchParams.get("q")).toBe("বালু");
  expect(route().searchParams.has("month")).toBe(false);
  expect(route().searchParams.get("work")).toBe("roof");
  expect(total(container)).toBe(formatMoney(90000, "en"));
  const key = screen.getByTestId("route").getAttribute("data-key");
  fireEvent.input(input, {
    inputType: "insertCompositionText",
    isComposing: false,
    target: { value: "বালু" },
  });
  expect(screen.getByTestId("route").getAttribute("data-key")).toBe(key);
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  fireEvent.compositionEnd(input, { target: { value: "বালু" } });
  expect(input.value).toBe("");
  expect(route().searchParams.has("q")).toBe(false);
  expect(document.activeElement).toBe(input);
});

it("moves the cost action above the cash tools and removes duplicate payment history while preserving actual cash totals", () => {
  const { container } = mount("/reports");
  const action = screen.getByRole("button", {
    name: "View material and work prices",
  });
  expect(container.querySelector(".page-heading")?.nextElementSibling).toBe(
    action,
  );
  expect(container.querySelector(".report-history")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Payment history" })).toBeNull();
  expect(total(container)).toBe(formatMoney(100000, "en"));
  const input = screen.getByRole("textbox", {
    name: "Find a payment",
  }) as HTMLInputElement;
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "dokan" } });
  expect(route().searchParams.has("q")).toBe(false);
  fireEvent.compositionEnd(input, { target: { value: "দোকান" } });
  expect(route().searchParams.get("q")).toBe("দোকান");
  expect(total(container)).toBe(formatMoney(100000, "en"));
});

it("retains a blurred cost query when its section changes before BrowserRouter finishes rendering", async () => {
  const ledger = fixture();
  savePreferences({ language: "en" });
  const original = window.location.href;
  window.history.replaceState(null, "", "/reports?mode=cost&work=roof");
  let ready = false;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  function Gate() {
    if (
      new URLSearchParams(useLocation().search).get("q") === "সিমেন্ট" &&
      !ready
    )
      throw pending;
    return null;
  }
  try {
    const { container } = render(
      <BrowserRouter>
        <LanguageProvider>
          <Suspense fallback={<p>Loading</p>}>
            <AnalyticsPage ledger={ledger} />
            <Probe />
            <Gate />
          </Suspense>
        </LanguageProvider>
      </BrowserRouter>,
    );
    const input = screen.getByRole("textbox", {
      name: "Search this report",
    }) as HTMLInputElement;
    await userEvent.click(input);
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "সিমেন্ট" } });
    await userEvent.click(screen.getByRole("tab", { name: "Materials" }));
    const query = new URL(window.location.href).searchParams.get("q");
    await act(async () => {
      ready = true;
      release();
    });
    expect(query).toBe("সিমেন্ট");
    expect(route().searchParams.get("section")).toBe("material");
    expect(input.value).toBe("সিমেন্ট");
    expect(total(container)).toBe(formatMoney(15000, "en"));
  } finally {
    await act(async () => {
      ready = true;
      release();
    });
    window.history.replaceState(null, "", original);
  }
});

it("shows a safe amount status if the checked report index cannot be represented", () => {
  vi.mocked(buildCostReportIndex).mockImplementationOnce(() => {
    throw new Error("search_amount_out_of_range");
  });
  const { container } = mount();
  expect(screen.getByText("The amount is too large.")).toBeTruthy();
  expect(container.querySelector(".report-total")).toBeNull();
});

it.each([
  ["", "2026-07-01", "2026-07-31"],
  ["&from=2026-07-05&to=2026-07-20", "2026-07-05", "2026-07-20"],
])(
  "keeps the selected calendar month intersected with date filters when opening payments: %s",
  (extra, from, to) => {
    mount(`/reports?mode=cost&work=roof&q=সিমেন্ট&month=2026-07${extra}`);
    fireEvent.click(
      screen.getByRole("button", { name: "View payments across all accounts" }),
    );
    expect(Object.fromEntries(route().searchParams)).toEqual({
      mode: "cash",
      work: "roof",
      q: "সিমেন্ট",
      from,
      to,
    });
  },
);

it.each(["month=undated", "month=2026-06&from=2026-07-01"])(
  "does not broaden a period with no equivalent cash date scope: %s",
  (scope) => {
    mount(`/reports?mode=cost&work=roof&${scope}`);
    expect(
      screen.queryByRole("button", {
        name: "View payments across all accounts",
      }),
    ).toBeNull();
  },
);
