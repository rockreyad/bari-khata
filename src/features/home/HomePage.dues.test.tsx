// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { LanguageProvider } from "../../context/LanguageProvider";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { savePreferences } from "../../lib/preferences";
import { HomePage } from "./HomePage";
import { LedgerPage } from "../ledger/LedgerPage";
import { PayablesPage } from "./PayablesPage";

const state = vi.hoisted(() => ({
  ledger: null as unknown,
  base: "",
  go: vi.fn(),
  detail: vi.fn(),
  add: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", async () => {
  const router =
    await vi.importActual<typeof import("react-router")>("react-router");
  return {
    useNotebook: () => {
      const navigate = router.useNavigate();
      const [, setParams] = router.useSearchParams();
      return {
        ledger: state.ledger as Ledger,
        add: state.add,
        go: (path: string) => {
          state.go(path);
          navigate(`${state.base}${path}`);
        },
        detail: (id: string) => {
          state.detail(id);
          setParams((previous) => {
            const next = new URLSearchParams(previous);
            next.set("_entry", id);
            return next;
          });
        },
      };
    },
  };
});
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  state.go.mockClear();
  state.detail.mockClear();
  state.add.mockClear();
  vi.unstubAllGlobals();
});

function fixture() {
  return LedgerSchema.parse({
    works: [
      { id: "roof", name: "ছাদের কাজ" },
      { id: "tiles", name: "টাইলসের কাজ" },
    ],
    people: [
      { id: "shop", name: "নমুনা দোকান", kind: "shop" },
      { id: "worker", name: "নমুনা মিস্ত্রি", kind: "worker" },
    ],
    contracts: [
      { id: "job", personId: "worker", workId: "tiles", total: 20000 },
    ],
    entries: [
      {
        id: "named-bill",
        kind: "expense",
        personId: "shop",
        lines: [
          { id: "named-line", workId: "roof", label: "রড", amount: 15000 },
        ],
      },
      {
        id: "named-payment",
        kind: "payment",
        personId: "shop",
        allocations: [{ workId: "roof", amount: 5000 }],
        paymentParts: [{ amount: 5000 }],
      },
      {
        id: "unnamed-bill",
        kind: "expense",
        lines: [
          {
            id: "unnamed-line",
            workId: "roof",
            label: "সিমেন্ট",
            amount: 5000,
          },
        ],
      },
      {
        id: "unnamed-payment",
        kind: "payment",
        relatedEntryId: "unnamed-bill",
        allocations: [{ workId: "roof", amount: 1000 }],
        paymentParts: [{ amount: 1000 }],
      },
    ],
  });
}
let browserBack: () => void;
function RouteProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  browserBack = () => navigate(-1);
  return (
    <output data-testid="route">{location.pathname + location.search}</output>
  );
}
function mount(
  ledger = fixture(),
  language: "bn" | "en" = "bn",
  route = "/?keep=1",
) {
  state.ledger = ledger;
  state.base = route.startsWith("/sample") ? "/sample" : "";
  savePreferences({ language });
  return render(
    <MemoryRouter initialEntries={[route]}>
      <LanguageProvider>
        <Routes>
          <Route path={state.base || "/"} element={<HomePage />} />
          <Route path={`${state.base}/dues`} element={<PayablesPage />} />
          <Route path={`${state.base}/ledger`} element={<LedgerPage />} />
          <Route
            path={`${state.base}/write/payment`}
            element={<p>Payment opened</p>}
          />
          <Route
            path={`${state.base}/parties/:id`}
            element={<p>Account opened</p>}
          />
        </Routes>
        <RouteProbe />
      </LanguageProvider>
    </MemoryRouter>,
  );
}

it.each([
  ["bn", "দিতে বাকি", "কোথায় কত বাকি", "৳\u202f১৪০", "এক নজরে"],
  ["en", "Amount owed", "Where money is owed", "৳\u202f140", "Overview"],
] as const)(
  "opens the complete %s due page and returns home with its back button",
  async (language, dueLabel, title, total, backLabel) => {
    const ledger = fixture();
    const before = JSON.stringify(ledger);
    const user = userEvent.setup();
    const { container } = mount(ledger, language);
    const opener = screen.getByRole("button", { name: new RegExp(dueLabel) });
    expect(opener.textContent).toContain(total);
    expect(opener.getAttribute("aria-haspopup")).toBeNull();
    await user.click(opener);
    expect(screen.getByRole("heading", { name: title, level: 1 })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    const page = screen.getByRole("region", { name: title });
    expect(page.querySelector(".home-dues-total dd")?.textContent).toBe(total);
    const rows = [...page.querySelectorAll(".home-dues-row")];
    expect(rows).toHaveLength(2);
    expect(
      rows.map(
        (row) => row.querySelector(".home-dues-copy strong")?.textContent,
      ),
    ).toEqual(["নমুনা দোকান", "সিমেন্ট"]);
    expect(rows[0].textContent).toContain("ছাদের কাজ");
    expect(rows[1].textContent).toContain(
      language === "bn" ? "নাম দেওয়া নেই" : "Name unknown",
    );
    expect(screen.getByTestId("route").textContent).toBe("/dues");
    await user.click(screen.getByRole("button", { name: backLabel }));
    expect(screen.getByTestId("route").textContent).toBe("/");
    expect(container.querySelector(".home-overview-due")).toBeTruthy();
    expect(JSON.stringify(ledger)).toBe(before);
  },
);

it("returns from the due page to its original homepage with browser Back", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: /দিতে বাকি/ }));
  await act(async () => browserBack());
  await waitFor(() =>
    expect(screen.getByTestId("route").textContent).toBe("/?keep=1"),
  );
  expect(screen.getByTestId("route").textContent).toBe("/?keep=1");
});

it.each(["", "/sample"])(
  "opens the complete named history across accounts in %s and Back returns to dues",
  async (base) => {
    const original = fixture();
    const ledger = LedgerSchema.parse({
      ...original,
      entries: [
        ...original.entries,
        {
          id: "other-account",
          kind: "expense",
          account: "other",
          personId: "shop",
          lines: [
            {
              id: "other-line",
              workId: "tiles",
              label: "গাড়িভাড়া",
              amount: 2000,
            },
          ],
        },
      ],
    });
    const before = JSON.stringify(ledger);
    const user = userEvent.setup();
    const { container } = mount(ledger, "bn", `${base}/dues`);
    await user.click(screen.getByRole("button", { name: /^নমুনা দোকান/ }));
    expect(screen.getByTestId("route").textContent).toBe(
      `${base}/ledger?person=shop`,
    );
    expect(state.go).toHaveBeenLastCalledWith("/ledger?person=shop");
    expect(
      screen.getByRole("heading", { name: "নমুনা দোকান-এর সব হিসাব" }),
    ).toBeTruthy();
    const history = [...container.querySelectorAll(".history-row")];
    expect(history).toHaveLength(3);
    expect(history.some((row) => row.textContent?.includes("রড"))).toBe(true);
    expect(history.some((row) => row.textContent?.includes("গাড়িভাড়া"))).toBe(
      true,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => browserBack());
    expect(
      screen.getByRole("heading", { name: "কোথায় কত বাকি", level: 1 }),
    ).toBeTruthy();
    expect(JSON.stringify(ledger)).toBe(before);
  },
);

it("does not list an unearned agreement as a current due", () => {
  const ledger = fixture();
  mount(ledger, "bn", "/dues");
  expect(screen.queryByRole("button", { name: /নমুনা মিস্ত্রি/ })).toBeNull();
});

it("keeps the due page and pagination beneath an unnamed bill detail", async () => {
  const user = userEvent.setup();
  mount(fixture(), "bn", "/sample/dues?page=2");
  await user.click(screen.getByRole("button", { name: /সিমেন্ট/ }));
  expect(state.detail).toHaveBeenLastCalledWith("unnamed-bill");
  expect(screen.getByTestId("route").textContent).toBe(
    "/sample/dues?page=2&_entry=unnamed-bill",
  );
  expect(
    screen.getByRole("heading", { name: "কোথায় কত বাকি", level: 1 }),
  ).toBeTruthy();
  await act(async () => browserBack());
  expect(screen.getByTestId("route").textContent).toBe("/sample/dues?page=2");
});

it("reopens from its URL and handles a settled ledger without showing a false due", async () => {
  const user = userEvent.setup();
  const { container } = mount(LedgerSchema.parse({}), "bn", "/dues");
  const page = screen.getByRole("region", { name: "কোথায় কত বাকি" });
  expect(page.querySelector(".home-dues-total dd")?.textContent).toBe(
    "৳\u202f০",
  );
  expect(within(page).getByText("এখন কোনো বাকি নেই")).toBeTruthy();
  expect(container.querySelector(".home-overview-due")).toBeNull();
  await user.click(screen.getByRole("button", { name: "এক নজরে" }));
  expect(screen.getByTestId("route").textContent).toBe("/");
});

it("opens payment directly from an active worker's due without changing records", async () => {
  const ledger = fixture(),
    before = JSON.stringify(ledger),
    user = userEvent.setup();
  mount(ledger, "bn", "/dues");
  await user.click(
    screen.getByRole("button", { name: "টাকা দিই: নমুনা দোকান" }),
  );
  const url = new URL(state.go.mock.calls[0][0], "https://example.invalid");
  expect(url.pathname).toBe("/write/payment");
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    person: "shop",
    amount: "10000",
    account: "materials",
    contract: "none",
    purpose: "settle",
    balanceOnly: "1",
    dueWork: "all",
    dueAccount: "all",
    back: "/dues",
  });
  expect(url.searchParams.has("bill")).toBe(false);
  expect(state.add).not.toHaveBeenCalled();
  expect(JSON.stringify(ledger)).toBe(before);
});
