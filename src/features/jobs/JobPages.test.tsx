// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import type { ReactNode, SelectHTMLAttributes } from "react";
import { LanguageProvider } from "../../context/LanguageProvider";
import {
  ContractSchema,
  EntrySchema,
  LedgerSchema,
  type Ledger,
} from "../../domain/model";
import { saveContractChange } from "../../domain/contracts";
import { savePreferences } from "../../lib/preferences";
import { formatMoney } from "../../lib/formatMoney";
import { JobPreview } from "./JobPreview";
import { JobPage, JobsPage } from "./JobPages";

const state = vi.hoisted(() => ({
  ledger: null as unknown,
  add: vi.fn(),
  entity: vi.fn(),
  go: vi.fn(),
  detail: vi.fn(),
  save: vi.fn(),
  base: "",
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    ledger: state.ledger as Ledger,
    add: state.add,
    entity: state.entity,
    go: state.go,
    detail: state.detail,
    save: state.save,
    base: state.base,
  }),
}));
vi.mock("../../components/ui/AppSelect", () => ({
  AppSelect: (props: SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props} />
  ),
}));
beforeEach(() => {
  state.base = "";
  state.save.mockImplementation(
    async (change: Ledger | ((current: Ledger) => Ledger)) => {
      state.ledger = LedgerSchema.parse(
        typeof change === "function" ? change(state.ledger as Ledger) : change,
      );
    },
  );
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});
function fixture(count = 5) {
  return LedgerSchema.parse({
    works: [
      { id: "door", name: "দরজা" },
      { id: "roof", name: "ছাদ" },
    ],
    people: [
      { id: "worker", name: "শাহ আলম", kind: "worker" },
      { id: "other-worker", name: "অন্য মিস্ত্রি", kind: "worker" },
    ],
    contracts: Array.from({ length: count }, (_, index) => ({
      id: `job-${index}`,
      scope: index === 0 ? "house" : "work",
      workId: index === 0 ? null : index % 2 ? "roof" : "door",
      personId: index % 2 ? "other-worker" : "worker",
      title: index === 0 ? "মোট মজুরির চুক্তি" : `টাইলস ${index}`,
      total: index === 0 ? 60000000 : 100000,
    })),
  });
}
function RouteState() {
  const location = useLocation();
  return (
    <output data-testid="job-location">
      {location.pathname + location.search}
    </output>
  );
}
function mount(
  ledger: Ledger,
  path: string,
  language: "bn" | "en" = "bn",
  component?: ReactNode,
) {
  state.ledger = ledger;
  savePreferences({ language });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LanguageProvider>
        {component ?? (
          <Routes>
            <Route
              path="/works"
              element={
                <>
                  <JobsPage />
                  <RouteState />
                </>
              }
            />
            <Route
              path="/works/:jobId"
              element={
                <>
                  <JobPage />
                  <RouteState />
                </>
              }
            />
            <Route
              path="/sample/works"
              element={
                <>
                  <JobsPage />
                  <RouteState />
                </>
              }
            />
            <Route
              path="/sample/works/:jobId"
              element={
                <>
                  <JobPage />
                  <RouteState />
                </>
              }
            />
          </Routes>
        )}
      </LanguageProvider>
    </MemoryRouter>,
  );
}
function withPayments() {
  const ledger = fixture();
  return LedgerSchema.parse({
    ...ledger,
    entries: [
      {
        id: "paid",
        kind: "payment",
        contractId: "job-0",
        personId: "worker",
        account: "labour",
        date: "2026-11-01",
        allocations: [{ workId: "door", amount: 3000000 }],
        paymentParts: [{ amount: 3000000 }],
      },
      {
        id: "returned",
        kind: "refund",
        contractId: "job-0",
        personId: "worker",
        account: "labour",
        date: "2026-11-02",
        allocations: [{ workId: "door", amount: 500000 }],
        paymentParts: [{ amount: 500000 }],
      },
      {
        id: "cancelled",
        kind: "payment",
        contractId: "job-0",
        personId: "worker",
        account: "labour",
        voided: true,
        date: "2026-11-03",
        allocations: [{ workId: "door", amount: 50000000 }],
        paymentParts: [{ amount: 50000000 }],
      },
      {
        id: "historical",
        kind: "payment",
        contractId: "job-0",
        personId: "worker",
        account: "labour",
        balanceImpact: "historical",
        date: "2026-10-01",
        allocations: [{ workId: "roof", amount: 900000 }],
        paymentParts: [{ amount: 900000 }],
      },
      {
        id: "other-job",
        kind: "payment",
        contractId: "job-1",
        personId: "other-worker",
        account: "labour",
        date: "2026-11-03",
        allocations: [{ workId: "roof", amount: 99900 }],
        paymentParts: [{ amount: 99900 }],
      },
      {
        id: "unassigned",
        kind: "payment",
        personId: "worker",
        account: "labour",
        date: "2026-11-03",
        allocations: [{ workId: "door", amount: 88800 }],
        paymentParts: [{ amount: 88800 }],
      },
    ],
  });
}

describe("compact job previews", () => {
  it.each(["bn", "en"] as const)(
    "shows review wording for an unclear old correction in the %s preview and detail",
    (language) => {
      const base = fixture(1);
      const ledger = LedgerSchema.parse({
        ...base,
        entries: [
          {
            id: "unclear-old-correction",
            kind: "adjustment",
            personId: "worker",
            account: "labour",
            contractId: "job-0",
            note: "নমুনা পুরোনো চুক্তির ছাড়",
            adjustment: {
              target: "person",
              basis: "balance",
              account: "labour",
              workId: null,
              before: 100000,
              after: 80000,
              delta: -20000,
            },
          },
        ],
      });
      const label =
        language === "bn" ? "বাকি মেলানো বাকি" : "Balance needs review";
      const preview = mount(
        ledger,
        "/works",
        language,
        <JobPreview ledger={ledger} contracts={ledger.contracts} />,
      );
      expect(
        preview.container.querySelector(".job-tile-balance strong")
          ?.textContent,
      ).toBe(label);
      expect(preview.container.querySelector(".job-tile-settled")).toBeNull();
      expect(
        preview.container.querySelector(".job-payment-settled"),
      ).toBeNull();
      expect(preview.container.textContent).not.toContain(
        language === "bn"
          ? "টাকার অঙ্ক বেশি হয়েছে।"
          : "The amount is too large.",
      );
      preview.unmount();
      const detail = mount(ledger, "/works/job-0", language);
      expect(
        detail.container.querySelector(".job-detail-review dd")?.textContent,
      ).toBe(label);
      expect(detail.container.querySelector(".job-extra-paid")).toBeNull();
      expect(detail.container.querySelector(".job-detail-settled")).toBeNull();
      expect(detail.container.querySelector(".form-error")).toBeNull();
    },
  );
  it("keeps ongoing jobs ahead of recent completed jobs within four cards and follows their latest transaction", () => {
    const ledger = LedgerSchema.parse({
      ...fixture(0),
      contracts: [
        ["done-newest", "শেষ রং", "done", "2026-11-04"],
        ["done-next", "শেষ জানালা", "done", "2026-11-03"],
        ["done-third", "শেষ ছাদ", "done", "2026-11-02"],
        ["done-fourth", "শেষ বাথরুম", "done", "2026-11-01"],
        ["new-agreement", "নতুন চলমান", "ongoing", "2026-11-05"],
        ["old-agreement", "পুরোনো চলমান", "ongoing", "2020-01-01"],
      ].map(([id, title, status, agreedOn]) => ({
        id,
        title,
        status,
        agreedOn,
        personId: "worker",
        workId: "door",
        total: 1000000,
      })),
      entries: [
        ["new-agreement", "2026-11-01"],
        ["old-agreement", "2026-11-04"],
      ].map(([contractId, date]) => ({
        id: `${contractId}-payment`,
        kind: "payment",
        account: "labour",
        personId: "worker",
        contractId,
        date,
        createdAt: `${date}T12:00:00Z`,
        allocations: [{ workId: "door", amount: 10000 }],
        paymentParts: [{ amount: 10000 }],
      })),
    });
    const before = JSON.stringify(ledger);
    const { container } = mount(
      ledger,
      "/parties/worker",
      "bn",
      <JobPreview
        ledger={ledger}
        contracts={ledger.contracts}
        personId="worker"
      />,
    );
    expect(
      [...container.querySelectorAll(".job-tile-name")].map(
        (title) => title.textContent,
      ),
    ).toEqual(["পুরোনো চলমান", "নতুন চলমান", "শেষ রং", "শেষ জানালা"]);
    expect(container.querySelectorAll(".job-snap-card")).toHaveLength(4);
    expect(JSON.stringify(ledger)).toBe(before);
  });
  it("shows only four cards and opens the scoped full list and specific job without inline editing or history", () => {
    const ledger = fixture();
    const before = JSON.stringify(ledger);
    const { container } = mount(
      ledger,
      "/parties/worker",
      "bn",
      <JobPreview
        ledger={ledger}
        contracts={ledger.contracts}
        personId="worker"
        workId="door"
      />,
    );
    const cards =
      container.querySelectorAll<HTMLButtonElement>(".job-snap-card");
    expect(cards).toHaveLength(4);
    expect(cards[0].textContent).toContain("কাজের হিসাব");
    expect(cards[0].textContent).not.toContain("মোট মজুরির চুক্তি");
    expect(container.querySelector(".contract-history")).toBeNull();
    expect(container.querySelector(".balance-progress")).toBeNull();
    expect(screen.queryByRole("button", { name: "কাজ বদলাই" })).toBeNull();
    expect(container.querySelector("time")).toBeNull();
    fireEvent.click(cards[0]);
    expect(state.go).toHaveBeenLastCalledWith(
      "/works/job-0?back=%2Fparties%2Fworker",
    );
    fireEvent.click(screen.getByRole("button", { name: "সব কাজ" }));
    expect(state.go).toHaveBeenLastCalledWith("/works?person=worker&work=door");
    fireEvent.click(screen.getByRole("button", { name: "কাজ যোগ করি" }));
    expect(state.entity).toHaveBeenCalledWith(
      "contract",
      undefined,
      "door",
      "worker",
    );
    expect(JSON.stringify(ledger)).toBe(before);
  });
  it("keeps the all-list link for four jobs and omits creation on work previews including the empty state", () => {
    const ledger = fixture(4);
    const view = mount(
      ledger,
      "/sectors/door",
      "bn",
      <JobPreview
        ledger={ledger}
        contracts={ledger.contracts}
        workId="door"
        allowCreate={false}
      />,
    );
    expect(screen.getByRole("button", { name: "সব কাজ" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "কাজ যোগ করি" })).toBeNull();
    expect(view.container.querySelector(".job-tile-worker")?.textContent).toBe(
      "শাহ আলম",
    );
    view.unmount();
    const empty = mount(
      ledger,
      "/sectors/door",
      "bn",
      <JobPreview
        ledger={ledger}
        contracts={[]}
        workId="door"
        allowCreate={false}
      />,
    );
    expect(empty.container.querySelector(".job-preview")).toBeNull();
  });
});

describe("full job list", () => {
  it("orders ongoing, planned or unknown, and done groups by real transaction recency with stable ties", () => {
    const ledger = LedgerSchema.parse({
      ...fixture(0),
      contracts: [
        ["done-new", "নতুন শেষ কাজ", "done", "2026-11-04"],
        ["planned", "শুরু হবে", "planned", "2026-11-04"],
        [
          "running-tie-first",
          "সমান দিনের প্রথম চলমান",
          "ongoing",
          "2026-11-04",
        ],
        ["unknown", "অবস্থা না লেখা কাজ", null, "2020-01-01"],
        [
          "running-recent",
          "সম্প্রতি টাকা দেওয়া চলমান",
          "ongoing",
          "2020-01-01",
        ],
        [
          "running-tie-second",
          "সমান দিনের দ্বিতীয় চলমান",
          "ongoing",
          "2026-11-04",
        ],
        ["running-no-payment", "লেনদেন ছাড়া চলমান", "ongoing", "2026-11-05"],
        ["done-old", "পুরোনো শেষ কাজ", "done", "2020-01-01"],
      ].map(([id, title, status, agreedOn]) => ({
        id,
        title,
        status,
        agreedOn,
        personId: "worker",
        workId: "door",
        total: 1000000,
      })),
      entries: [
        ["done-new", "2026-11-06"],
        ["planned", "2026-11-02"],
        ["running-tie-first", "2026-11-02"],
        ["running-recent", "2026-11-03"],
        ["running-tie-second", "2026-11-02"],
        ["done-old", "2026-11-01"],
      ].map(([contractId, date]) => ({
        id: `${contractId}-payment`,
        kind: "payment",
        account: "labour",
        personId: "worker",
        contractId,
        date,
        createdAt: `${date}T12:00:00Z`,
        allocations: [{ workId: "door", amount: 10000 }],
        paymentParts: [{ amount: 10000 }],
      })),
    });
    ledger.entries.push(
      EntrySchema.parse({
        id: "undated",
        kind: "payment",
        account: "labour",
        personId: "worker",
        contractId: "unknown",
        date: null,
        createdAt: "2026-11-04T12:00:00Z",
        allocations: [{ workId: "door", amount: 10000 }],
        paymentParts: [{ amount: 10000 }],
      }),
      EntrySchema.parse({
        id: "void",
        kind: "payment",
        account: "labour",
        personId: "worker",
        contractId: "running-no-payment",
        date: "2026-11-08",
        voided: true,
        allocations: [{ workId: "door", amount: 10000 }],
        paymentParts: [{ amount: 10000 }],
      }),
      EntrySchema.parse({
        id: "unlinked",
        kind: "payment",
        account: "labour",
        personId: "worker",
        date: "2026-11-08",
        allocations: [{ workId: "door", amount: 10000 }],
        paymentParts: [{ amount: 10000 }],
      }),
      EntrySchema.parse({
        id: "wrong-person",
        kind: "payment",
        account: "labour",
        personId: "other-worker",
        contractId: "running-no-payment",
        date: "2026-11-08",
        allocations: [{ workId: "door", amount: 10000 }],
        paymentParts: [{ amount: 10000 }],
      }),
    );
    const before = JSON.stringify(ledger);
    const { container } = mount(ledger, "/works");
    expect(
      [...container.querySelectorAll(".job-tile-name")].map(
        (title) => title.textContent,
      ),
    ).toEqual([
      "সম্প্রতি টাকা দেওয়া চলমান",
      "সমান দিনের প্রথম চলমান",
      "সমান দিনের দ্বিতীয় চলমান",
      "লেনদেন ছাড়া চলমান",
      "অবস্থা না লেখা কাজ",
      "শুরু হবে",
      "নতুন শেষ কাজ",
      "পুরোনো শেষ কাজ",
    ]);
    expect(JSON.stringify(ledger)).toBe(before);
  });
  it("appends twelve jobs at a time and hides load more after the final card", () => {
    const ledger = fixture(16);
    const { container } = mount(ledger, "/works");
    expect(container.querySelectorAll(".job-snap-card")).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: "আরও দেখুন" }));
    expect(container.querySelectorAll(".job-snap-card")).toHaveLength(16);
    expect(screen.queryByRole("button", { name: "আরও দেখুন" })).toBeNull();
  });
  it("validates person/work filters and keeps applicable house work visible in a selected notebook", () => {
    const ledger = fixture(16);
    const view = mount(ledger, "/works?person=worker&work=roof");
    expect(view.container.querySelectorAll(".job-snap-card")).toHaveLength(1);
    expect(view.container.querySelector(".job-tile-name")?.textContent).toBe(
      "কাজের হিসাব",
    );
    fireEvent.click(screen.getByRole("button", { name: "কাজ যোগ করি" }));
    expect(state.entity).toHaveBeenCalledWith(
      "contract",
      undefined,
      "roof",
      "worker",
    );
    view.unmount();
    const invalid = mount(ledger, "/works?person=missing&work=missing");
    expect(invalid.container.querySelectorAll(".job-snap-card")).toHaveLength(
      12,
    );
    fireEvent.click(screen.getByRole("button", { name: "কাজ যোগ করি" }));
    expect(state.entity).toHaveBeenLastCalledWith(
      "contract",
      undefined,
      undefined,
      undefined,
    );
  });
  it("finds stored Bengali numerals using either script without changing the job's title", () => {
    const ledger = fixture(3);
    ledger.contracts[2].title = "রড ১৬";
    for (const query of ["16", "১৬"]) {
      const view = mount(ledger, `/works?q=${query}`);
      expect(view.container.querySelectorAll(".job-snap-card")).toHaveLength(1);
      expect(view.container.querySelector(".job-tile-name")?.textContent).toBe(
        "রড ১৬",
      );
      view.unmount();
    }
    expect(ledger.contracts[2].title).toBe("রড ১৬");
  });
});

const copy = {
  bn: {
    title: "কাজের হিসাব",
    goal: "৳\u202f৬,০০,০০০",
    paid: "৳\u202f২৫,০০০",
    remaining: "৳\u202f৫,৭৫,০০০",
    refund: "৳\u202f৫,০০০",
    edit: "কাজ বদলাই",
    pay: "টাকা দিই",
    transactions: "লেনদেন",
    history: "পরিবর্তন",
  },
  en: {
    title: "Work details",
    goal: "৳\u202f600,000",
    paid: "৳\u202f25,000",
    remaining: "৳\u202f575,000",
    refund: "৳\u202f5,000",
    edit: "Edit job",
    pay: "Pay",
    transactions: "Transactions",
    history: "Changes",
  },
};
describe.each(["bn", "en"] as const)("job details in %s", (language) => {
  it("uses net paid after refunds, excludes historical/cancelled cash from totals and opens exact job entry/edit context", async () => {
    const ledger = withPayments();
    const before = JSON.stringify(ledger);
    const { container } = mount(ledger, "/works/job-0", language);
    expect(
      screen.getByRole("heading", { name: copy[language].title, level: 1 }),
    ).toBeTruthy();
    expect(
      container.querySelector(".job-detail-total strong")?.textContent,
    ).toBe(copy[language].goal);
    const amounts = container.querySelectorAll(".job-detail-money dd");
    expect(amounts[0].textContent).toBe(copy[language].paid);
    expect(amounts).toHaveLength(2);
    expect(container.querySelector(".job-detail-due dt")?.textContent).toBe(
      language === "bn" ? "আর দিতে হবে" : "Still to pay",
    );
    expect(amounts[1].textContent).toBe(copy[language].remaining);
    expect(container.querySelector(".job-extra-paid")).toBeNull();
    expect(container.querySelector(".balance-progress")).toBeNull();
    expect(container.querySelector(".job-refund-note")?.textContent).toContain(
      copy[language].refund,
    );
    expect(container.querySelectorAll(".history-row")).toHaveLength(4);
    expect(
      container.querySelector(".history-row.is-void")?.textContent,
    ).toContain(language === "bn" ? "বাতিল" : "Cancel");
    expect(
      container.querySelector(".job-detail-panel")?.textContent,
    ).not.toContain("অন্য মিস্ত্রি");
    expect(container.textContent).not.toContain("পুরো বাড়ি");
    expect(
      screen.queryByRole("button", { name: copy[language].edit }),
    ).toBeNull();
    expect(
      container.querySelectorAll(".job-page-heading > .icon-button"),
    ).toHaveLength(1);
    await userEvent.click(
      screen.getByRole("button", {
        name: language === "bn" ? "কাজের আরও কাজ" : "More work actions",
      }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: copy[language].edit }),
    );
    expect(state.entity).toHaveBeenCalledWith("contract", "job-0");
    fireEvent.click(screen.getByRole("button", { name: copy[language].pay }));
    expect(state.add).toHaveBeenCalledWith({
      kind: "payment",
      account: "labour",
      personId: "worker",
      workId: undefined,
      contractId: "job-0",
    });
    fireEvent.click(
      container.querySelector<HTMLButtonElement>(".history-row")!,
    );
    expect(state.detail).toHaveBeenCalledOnce();
    expect(JSON.stringify(ledger)).toBe(before);
  });
});

it("shows overpayment rather than zero remaining in the preview and keeps zero-paid work usable", () => {
  const ledger = fixture(1);
  ledger.entries.push(
    EntrySchema.parse({
      id: "earned",
      kind: "expense",
      contractId: "job-0",
      personId: "worker",
      account: "labour",
      lines: [
        {
          id: "earned-line",
          workId: "door",
          amount: 60000000,
          costType: "labour",
        },
      ],
    }),
    EntrySchema.parse({
      id: "overpaid",
      kind: "payment",
      contractId: "job-0",
      personId: "worker",
      account: "labour",
      allocations: [{ workId: "door", amount: 60100000 }],
      paymentParts: [{ amount: 60100000 }],
    }),
  );
  const preview = mount(
    ledger,
    "/works",
    "bn",
    <JobPreview ledger={ledger} contracts={ledger.contracts} />,
  );
  expect(
    preview.container.querySelector(".job-card-balance")?.textContent,
  ).toContain("বেশি দিয়েছি৳\u202f১,০০০");
  preview.unmount();
  const page = mount(ledger, "/works/job-0");
  expect(page.container.querySelector(".job-extra-paid dd")?.textContent).toBe(
    "৳\u202f১,০০০",
  );
  expect(page.container.querySelector(".job-detail-due")).toBeNull();
  expect(page.container.querySelectorAll(".job-detail-money dd")).toHaveLength(
    2,
  );
  expect(page.container.querySelector(".balance-progress")).toBeNull();
  page.unmount();
  const empty = mount(fixture(1), "/works/job-0");
  expect(
    empty.container.querySelectorAll(".job-detail-money dd")[0].textContent,
  ).toBe("৳\u202f০");
  expect(screen.getByRole("button", { name: "টাকা দিই" })).toBeTruthy();
});

it.each([
  {
    total: 3500000,
    status: "done",
    paid: 3600000,
    billed: null,
    due: 0,
    extra: 100000,
    settled: false,
    label: "বেশি দিয়েছি",
  },
  {
    total: 3500000,
    status: "done",
    paid: 1000000,
    billed: null,
    due: 2500000,
    extra: 0,
    settled: false,
    label: "",
  },
  {
    total: 3500000,
    status: "done",
    paid: 3500000,
    billed: null,
    due: 0,
    extra: 0,
    settled: true,
    label: "",
  },
  {
    total: 3500000,
    status: "ongoing",
    paid: 1000000,
    billed: null,
    due: 2500000,
    extra: 0,
    settled: false,
    label: "",
  },
  {
    total: 3500000,
    status: "done",
    paid: 2000000,
    billed: 1000000,
    due: 1500000,
    extra: 0,
    settled: false,
    label: "",
  },
  {
    total: 60000000,
    status: "ongoing",
    paid: 54150000,
    billed: null,
    due: 5850000,
    extra: 0,
    settled: false,
    label: "",
  },
  {
    total: 3500000,
    status: "ongoing",
    paid: 3500000,
    billed: null,
    due: 0,
    extra: 0,
    settled: true,
    label: "",
  },
  {
    total: 3500000,
    status: "done",
    paid: 3600000,
    billed: 4000000,
    due: 400000,
    extra: 0,
    settled: false,
    label: "",
  },
] as const)(
  "keeps commitment $total and paid $paid clear for $status with bill $billed",
  async ({ total, status, paid, billed, due, extra, settled, label }) => {
    const ledger = LedgerSchema.parse({
      works: [{ id: "door", name: "নমুনা খাতা" }],
      people: [{ id: "worker", name: "নমুনা কর্মী", kind: "worker" }],
      contracts: [
        {
          id: "job",
          personId: "worker",
          workId: "door",
          title: "নমুনা কাজ",
          total,
          status,
        },
      ],
      entries: [
        ...(billed === null
          ? []
          : [
              {
                id: "bill",
                kind: "expense",
                personId: "worker",
                contractId: "job",
                account: "labour",
                lines: [
                  {
                    id: "line",
                    workId: "door",
                    costType: "labour",
                    amount: billed,
                  },
                ],
              },
            ]),
        {
          id: "cash",
          kind: "payment",
          personId: "worker",
          contractId: "job",
          account: "labour",
          paymentContext: "settlement",
          allocations: [{ workId: "door", amount: paid }],
          paymentParts: [{ amount: paid }],
        },
      ],
    });
    const before = JSON.stringify(ledger);
    let page = mount(ledger, "/works/job");
    const card = page.container.querySelector(".contract-card")!;
    expect(card.querySelector(".job-detail-total strong")?.textContent).toBe(
      formatMoney(total, "bn"),
    );
    expect(card.querySelector(".job-detail-paid dd")?.textContent).toBe(
      formatMoney(paid, "bn"),
    );
    expect(card.querySelector(".balance-progress")).toBeNull();
    expect(card.textContent).not.toContain("আগে দেওয়া টাকা");
    if (due)
      expect(card.querySelector(".job-detail-due dd")?.textContent).toBe(
        formatMoney(due, "bn"),
      );
    else expect(card.querySelector(".job-detail-due")).toBeNull();
    if (extra) {
      expect(card.querySelector(".job-extra-paid dt")?.textContent).toBe(label);
      expect(card.querySelector(".job-extra-paid dd")?.textContent).toBe(
        formatMoney(extra, "bn"),
      );
    } else expect(card.querySelector(".job-extra-paid")).toBeNull();
    if (settled)
      expect(card.querySelector(".job-detail-settled dd")?.textContent).toBe(
        "বাকি নেই",
      );
    else expect(card.querySelector(".job-detail-settled")).toBeNull();
    if (billed !== null)
      expect(card.querySelector(".job-earned-note")?.textContent).toContain(
        formatMoney(billed, "bn"),
      );
    expect(
      screen.getByRole("button", { name: "কাজের অবস্থা বদলাই" }).textContent,
    ).toContain(status === "done" ? "শেষ" : "চলছে");
    expect(screen.queryByText("কাজের ধাপ")).toBeNull();
    page.unmount();
    page = mount(
      ledger,
      "/works",
      "bn",
      <JobPreview ledger={ledger} contracts={ledger.contracts} />,
    );
    const tile = page.container.querySelector(".job-snap-card")!;
    expect(tile.querySelector(".job-tile-amounts")!.children).toHaveLength(2);
    expect(
      tile.querySelector(".job-card-balance")!.closest(".job-tile-amounts"),
    ).toBeNull();
    expect(tile.querySelector(".job-tile-paid strong")?.textContent).toBe(
      formatMoney(paid, "bn"),
    );
    if (due || extra)
      expect(tile.querySelector(".job-tile-balance strong")?.textContent).toBe(
        formatMoney(due || extra, "bn"),
      );
    else expect(tile.querySelector(".job-tile-balance")).toBeNull();
    expect(Boolean(tile.querySelector(".job-tile-settled"))).toBe(settled);
    expect(tile.querySelector(`.job-status-${status}`)).not.toBeNull();
    expect(tile.textContent).not.toContain("আগে দেওয়া টাকা");
    if (total === 60000000) {
      page.unmount();
      const list = mount(ledger, "/works?balance=due");
      expect(list.container.querySelectorAll(".job-snap-card")).toHaveLength(1);
      expect(
        list.container.querySelector(".job-card-balance")?.textContent,
      ).toContain(formatMoney(5850000, "bn"));
      expect(
        list.container.querySelector(".job-status-ongoing"),
      ).not.toBeNull();
    }
    expect(JSON.stringify(ledger)).toBe(before);
  },
);

it("paginates only the job's own transactions and excludes a mismatched party even if the record carries the same job id", () => {
  const ledger = fixture(2);
  ledger.entries = Array.from({ length: 14 }, (_, index) =>
    EntrySchema.parse({
      id: `cash-${index}`,
      kind: "payment",
      contractId: "job-0",
      personId: "worker",
      account: "labour",
      date: "2026-11-01",
      allocations: [{ workId: "door", amount: 100 }],
      paymentParts: [{ amount: 100 }],
    }),
  );
  ledger.entries.push(
    EntrySchema.parse({
      id: "wrong-person",
      kind: "payment",
      contractId: "job-0",
      personId: "other-worker",
      account: "labour",
      allocations: [{ workId: "door", amount: 99900 }],
      paymentParts: [{ amount: 99900 }],
    }),
  );
  const { container } = mount(ledger, "/works/job-0");
  expect(container.querySelectorAll(".history-row")).toHaveLength(12);
  fireEvent.click(screen.getByRole("button", { name: "আরও দেখুন" }));
  expect(container.querySelectorAll(".history-row")).toHaveLength(14);
  expect(screen.queryByRole("button", { name: "আরও দেখুন" })).toBeNull();
  expect(
    container.querySelector(".job-detail-panel")?.textContent,
  ).not.toContain("অন্য মিস্ত্রি");
});

it("loads all structured amendments and legacy history and supports keyboard tab navigation", async () => {
  let ledger = fixture(1);
  ledger.contracts[0] = ContractSchema.parse({
    ...ledger.contracts[0],
    title: "টাইলস",
    rate: 60000000,
    history: [{ at: "old timestamp", total: 50000000, note: "পুরোনো দর" }],
  });
  ledger = saveContractChange(
    ledger,
    ContractSchema.parse({
      ...ledger.contracts[0],
      title: "টাইলস ও বারান্দা",
      basis: "day",
      quantity: "3",
      rate: 80000,
      total: 240000,
      agreedOn: "2026-09-12",
      notes: "নতুন দিনের হিসাব",
    }),
    "দিন হিসাবে ঠিক হয়েছে",
    "2026-09-12T00:00:00Z",
  );
  for (let index = 0; index < 14; index++)
    ledger = saveContractChange(
      ledger,
      ContractSchema.parse({
        ...ledger.contracts[0],
        quantity: String(index + 4),
        total: (index + 4) * 80000,
      }),
      `পরিমাণ বদল ${index + 1}`,
      new Date(Date.UTC(2026, 8, 13 + index)).toISOString(),
    );
  const before = JSON.stringify(ledger);
  const { container } = mount(ledger, "/works/job-0");
  const transactions = screen.getByRole("tab", { name: "লেনদেন" });
  const history = screen.getByRole("tab", { name: "পরিবর্তন" });
  transactions.focus();
  const user = userEvent.setup();
  await user.keyboard("{ArrowRight}");
  expect(document.activeElement).toBe(history);
  expect(history.getAttribute("aria-selected")).toBe("true");
  expect(history.tabIndex).toBe(0);
  expect(transactions.tabIndex).toBe(-1);
  expect(
    container.querySelectorAll(".contract-history-list > li"),
  ).toHaveLength(12);
  fireEvent.click(screen.getByRole("button", { name: "আরও দেখুন" }));
  expect(
    container.querySelectorAll(".contract-history-list > li"),
  ).toHaveLength(16);
  expect(
    container.querySelector(".contract-history-list")?.textContent,
  ).toContain("পুরোনো দর");
  expect(
    container.querySelector(".contract-history-list")?.textContent,
  ).toContain("দিন হিসাবে ঠিক হয়েছে");
  expect(
    container.querySelector(".contract-history-list")?.textContent,
  ).toContain("নতুন দিনের হিসাব");
  expect(
    container.querySelector(".contract-history-list")?.textContent,
  ).toContain("সময় লেখা নেই");
  expect(
    container.querySelector(".contract-history-fields")?.textContent,
  ).toContain("পরিমাণ");
  expect(screen.queryByRole("button", { name: "আরও দেখুন" })).toBeNull();
  history.focus();
  await user.keyboard("{Home}");
  expect(document.activeElement).toBe(transactions);
  await user.keyboard("{End}");
  expect(document.activeElement).toBe(history);
  expect(JSON.stringify(ledger)).toBe(before);
});

it("handles a missing job without showing another person's records", () => {
  mount(withPayments(), "/works/missing");
  expect(
    screen.getByRole("heading", { name: "কাজটি পাওয়া যায়নি" }),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "টাকা দিই" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "ফিরুন" }));
  expect(state.go).toHaveBeenLastCalledWith("/works", { replace: true });
});

it("keeps a custom job name and sends the specific notebook when paying a work-scoped job", () => {
  const ledger = fixture(3);
  ledger.contracts[2].title = "Door design 2";
  const { container } = mount(ledger, "/works/job-2");
  expect(
    screen.getByRole("heading", { name: "Door design ২", level: 1 }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "টাকা দিই" }));
  expect(state.add).toHaveBeenCalledWith({
    kind: "payment",
    account: "labour",
    personId: "worker",
    workId: "door",
    contractId: "job-2",
  });
  expect(container.textContent).not.toContain("পুরো বাড়ি");
  expect(ledger.contracts[2].title).toBe("Door design 2");
});

it("keeps a newly created job visible before older jobs when the preview already has four", () => {
  const old = fixture();
  const ledger = saveContractChange(
    old,
    ContractSchema.parse({
      id: "new-job",
      personId: "worker",
      scope: "house",
      title: "নতুন দরজার কাজ",
      total: 2000000,
    }),
    "",
    "2026-11-02T06:00:00Z",
  );
  const before = JSON.stringify(ledger);
  const { container } = mount(
    ledger,
    "/parties/worker",
    "bn",
    <JobPreview
      ledger={ledger}
      contracts={ledger.contracts}
      personId="worker"
    />,
  );
  const cards = container.querySelectorAll<HTMLButtonElement>(".job-snap-card");
  expect(cards).toHaveLength(4);
  expect(cards[0].textContent).toContain("নতুন দরজার কাজ");
  fireEvent.click(cards[0]);
  expect(state.go).toHaveBeenCalledWith(
    "/works/new-job?back=%2Fparties%2Fworker",
  );
  expect(JSON.stringify(ledger)).toBe(before);
});

function filterFixture() {
  const jobs = [
    { id: "active-due", title: "চলমান কাজ", status: "ongoing" },
    { id: "old-paid", title: "পুরোনো কাজ", status: null },
    { id: "done-over", title: "শেষের বাড়তি কাজ", status: "done" },
    { id: "planned", title: "সামনের কাজ", status: "planned" },
    { id: "done-due", title: "শেষ হলেও বাকি কাজ", status: "done" },
    { id: "unknown-due", title: "অবস্থা ছাড়া কাজ", status: null },
  ];
  const cash = (
    id: string,
    contractId: string,
    amount: number,
    kind: "payment" | "refund" = "payment",
  ) => ({
    id,
    contractId,
    amount,
    kind,
    personId: "worker",
    account: "labour",
    allocations: [{ workId: "door", amount }],
    paymentParts: [{ amount }],
  });
  return LedgerSchema.parse({
    works: [
      { id: "door", name: "দরজা" },
      { id: "roof", name: "ছাদ" },
    ],
    people: [{ id: "worker", name: "শাহ আলম", kind: "worker" }],
    contracts: jobs.map((job) => ({
      ...job,
      personId: "worker",
      workId: "door",
      total: 100000,
    })),
    entries: [
      ...jobs.map((job) => ({
        id: `earned-${job.id}`,
        kind: "expense",
        personId: "worker",
        account: "labour",
        contractId: job.id,
        lines: [
          {
            id: `earned-line-${job.id}`,
            workId: "door",
            costType: "labour",
            amount: 100000,
          },
        ],
      })),
      cash("active-cash", "active-due", 40000),
      cash("old-cash", "old-paid", 100000),
      cash("over-cash", "done-over", 120000),
      cash("over-return", "done-over", 10000, "refund"),
      cash("done-cash", "done-due", 100000),
      cash("done-return", "done-due", 10000, "refund"),
    ],
  });
}
function currentUrl() {
  return new URL(
    screen.getByTestId("job-location").textContent ?? "",
    "https://bari.invalid",
  );
}

it("keeps paid state separate from work status and filters unknown, due and completed work independently", () => {
  const ledger = filterFixture();
  const initial = JSON.stringify(ledger);
  const view = mount(ledger, "/works?balance=settled");
  expect(view.container.querySelectorAll(".job-snap-card")).toHaveLength(1);
  expect(view.container.querySelector(".job-tile-name")?.textContent).toBe(
    "পুরোনো কাজ",
  );
  expect(
    view.container.querySelector(".job-status-unknown")?.textContent,
  ).toContain("অবস্থা লেখা নেই");
  expect(view.container.querySelector(".job-status-done")).toBeNull();
  expect(
    view.container.querySelector(".job-tile-settled")?.textContent,
  ).toContain("বাকি নেই");
  fireEvent.change(screen.getByLabelText("কাজের অবস্থা"), {
    target: { value: "done" },
  });
  expect(view.container.querySelectorAll(".job-snap-card")).toHaveLength(0);
  const balances = screen.getByRole("group", { name: "টাকার অবস্থা" });
  fireEvent.click(within(balances).getByRole("button", { name: "বাকি আছে" }));
  expect(view.container.querySelectorAll(".job-snap-card")).toHaveLength(1);
  expect(view.container.querySelector(".job-tile-name")?.textContent).toBe(
    "শেষ হলেও বাকি কাজ",
  );
  expect(view.container.querySelector(".job-status-done")).not.toBeNull();
  expect(currentUrl().searchParams.get("status")).toBe("done");
  expect(currentUrl().searchParams.get("balance")).toBe("due");
  expect(JSON.stringify(ledger)).toBe(initial);
});

it("retains search, person, work and payment/status filters after reload and through a detail's Back navigation", () => {
  const ledger = filterFixture();
  const path =
    "/works?person=worker&work=door&q=" +
    encodeURIComponent("কাজ") +
    "&status=done&balance=due";
  const first = mount(ledger, path);
  expect(first.container.querySelectorAll(".job-snap-card")).toHaveLength(1);
  first.unmount();
  const reloaded = mount(ledger, path);
  expect(
    (screen.getByLabelText("কাজের অবস্থা") as HTMLSelectElement).value,
  ).toBe("done");
  expect((screen.getByLabelText("কর্মী") as HTMLSelectElement).value).toBe(
    "worker",
  );
  expect((screen.getByLabelText("খাতা") as HTMLSelectElement).value).toBe(
    "door",
  );
  expect((screen.getByLabelText("কাজ খুঁজুন") as HTMLInputElement).value).toBe(
    "কাজ",
  );
  fireEvent.click(
    reloaded.container.querySelector<HTMLButtonElement>(".job-snap-card")!,
  );
  const target = state.go.mock.calls.at(-1)![0] as string;
  const detailUrl = new URL(target, "https://bari.invalid");
  expect(detailUrl.pathname).toBe("/works/done-due");
  expect(
    new URL(
      detailUrl.searchParams.get("back")!,
      "https://bari.invalid",
    ).searchParams.get("balance"),
  ).toBe("due");
  reloaded.unmount();
  mount(ledger, target);
  fireEvent.click(screen.getByRole("tab", { name: "পরিবর্তন" }));
  expect(currentUrl().searchParams.get("back")).toBe(
    detailUrl.searchParams.get("back"),
  );
  fireEvent.click(screen.getByRole("button", { name: "ফিরুন" }));
  const [back, options] = state.go.mock.calls.at(-1)!;
  const backUrl = new URL(back, "https://bari.invalid");
  expect(backUrl.pathname).toBe("/works");
  expect(Object.fromEntries(backUrl.searchParams)).toEqual({
    person: "worker",
    work: "door",
    q: "কাজ",
    status: "done",
    balance: "due",
  });
  expect(options).toEqual({ replace: true });
});

it("preserves sample work origins without a duplicate prefix and returns to that work's filtered tab", () => {
  state.base = "/sample";
  const ledger = fixture(1);
  const origin = "/sample/sectors/door?tab=labour&q=steel";
  const preview = mount(
    ledger,
    origin,
    "bn",
    <JobPreview
      ledger={ledger}
      contracts={ledger.contracts}
      workId="door"
      allowCreate={false}
    />,
  );
  fireEvent.click(
    preview.container.querySelector<HTMLButtonElement>(".job-snap-card")!,
  );
  const target = new URL(
    state.go.mock.calls.at(-1)![0],
    "https://bari.invalid",
  );
  expect(target.pathname).toBe("/works/job-0");
  expect(target.searchParams.get("back")).toBe(origin);
  preview.unmount();
  mount(ledger, "/sample" + target.pathname + target.search);
  fireEvent.click(screen.getByRole("button", { name: "ফিরুন" }));
  expect(state.go).toHaveBeenLastCalledWith(
    "/sectors/door?tab=labour&q=steel",
    {
      replace: true,
    },
  );
});

it.each([
  "https://outside.invalid/",
  "/parties/worker",
  "/sample/works/another-job",
])(
  "rejects an unsafe or looping sample origin %s and falls back to its worker",
  (origin) => {
    state.base = "/sample";
    mount(fixture(1), `/sample/works/job-0?back=${encodeURIComponent(origin)}`);
    fireEvent.click(screen.getByRole("button", { name: "ফিরুন" }));
    expect(state.go).toHaveBeenLastCalledWith("/parties/worker", {
      replace: true,
    });
  },
);

it("resets the twelve-card window after a status filter changes and keeps insight counts clickable", () => {
  const ledger = fixture(30);
  ledger.contracts.forEach((job, index) => {
    job.status = index % 2 ? "ongoing" : "done";
    ledger.entries.push(
      EntrySchema.parse({
        id: `earned-${job.id}`,
        kind: "expense",
        personId: job.personId,
        account: "labour",
        contractId: job.id,
        lines: [
          {
            id: `earned-line-${job.id}`,
            workId: job.workId ?? "door",
            amount: job.total,
            costType: "labour",
          },
        ],
      }),
    );
  });
  const { container } = mount(ledger, "/works?status=ongoing");
  expect(container.querySelectorAll(".job-snap-card")).toHaveLength(12);
  fireEvent.click(screen.getByRole("button", { name: "আরও দেখুন" }));
  expect(container.querySelectorAll(".job-snap-card")).toHaveLength(15);
  expect(screen.queryByRole("button", { name: "আরও দেখুন" })).toBeNull();
  fireEvent.change(screen.getByLabelText("কাজের অবস্থা"), {
    target: { value: "all" },
  });
  expect(container.querySelectorAll(".job-snap-card")).toHaveLength(12);
  const overview = screen.getByRole("region", { name: "কাজের খবর" });
  fireEvent.click(within(overview).getByRole("button", { name: /^চলছে/ }));
  expect(currentUrl().searchParams.get("status")).toBe("ongoing");
  expect(container.querySelectorAll(".job-snap-card")).toHaveLength(12);
  fireEvent.click(within(overview).getByRole("button", { name: /^বাকি আছে/ }));
  expect(currentUrl().searchParams.has("status")).toBe(false);
  expect(currentUrl().searchParams.get("balance")).toBe("due");
  expect(container.querySelectorAll(".job-snap-card")).toHaveLength(12);
});

it("reclassifies refunded overpayment exactly and clears only known filters", () => {
  const ledger = filterFixture();
  const { container } = mount(ledger, "/works?balance=overpaid&keep=1");
  expect(container.querySelectorAll(".job-snap-card")).toHaveLength(1);
  expect(container.querySelector(".job-card-balance")?.textContent).toContain(
    "বেশি দিয়েছি৳\u202f১০০",
  );
  state.ledger = LedgerSchema.parse({
    ...ledger,
    entries: [
      ...ledger.entries,
      {
        id: "last-refund",
        kind: "refund",
        account: "labour",
        personId: "worker",
        contractId: "done-over",
        allocations: [{ workId: "door", amount: 10000 }],
        paymentParts: [{ amount: 10000 }],
      },
    ],
  });
  fireEvent.click(
    within(screen.getByRole("group", { name: "টাকার অবস্থা" })).getByRole(
      "button",
      { name: "বাকি নেই" },
    ),
  );
  expect(container.querySelectorAll(".job-snap-card")).toHaveLength(2);
  expect(container.querySelector(".job-payment-overpaid")).toBeNull();
  expect(container.querySelector(".job-status-unknown")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "বাছাই মুছি" }));
  expect(container.querySelectorAll(".job-snap-card")).toHaveLength(6);
  expect(Object.fromEntries(currentUrl().searchParams)).toEqual({ keep: "1" });
});

it("requires a reason to change status and saves it against the latest job without changing payment history", async () => {
  const ledger = filterFixture();
  const before = JSON.stringify(ledger);
  mount(ledger, "/works/old-paid");
  fireEvent.click(screen.getByRole("button", { name: "কাজের অবস্থা বদলাই" }));
  fireEvent.change(screen.getByLabelText("কাজের অবস্থা"), {
    target: { value: "done" },
  });
  fireEvent.click(screen.getByRole("button", { name: "রাখুন" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "কেন বদলালেন, ছোট করে লিখুন।",
  );
  const reason = screen.getByLabelText("কেন বদলালেন");
  const alert = screen.getByRole("alert");
  expect(alert.parentElement?.firstElementChild).toBe(alert);
  expect(document.activeElement).toBe(alert);
  expect(reason.getAttribute("aria-invalid")).toBe("true");
  reason.focus();
  fireEvent.click(screen.getByRole("button", { name: "রাখুন" }));
  expect(document.activeElement).toBe(alert);
  expect(state.save).not.toHaveBeenCalled();
  state.ledger = saveContractChange(
    ledger,
    {
      ...ledger.contracts.find((job) => job.id === "old-paid")!,
      total: 200000,
    },
    "অন্য জায়গায় দর বদলেছে",
  );
  fireEvent.change(screen.getByLabelText("কেন বদলালেন"), {
    target: { value: "আজ কাজ শেষ হয়েছে" },
  });
  fireEvent.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(screen.queryByLabelText("কেন বদলালেন")).toBeNull(),
  );
  const saved = state.ledger as Ledger;
  const job = saved.contracts.find((value) => value.id === "old-paid")!;
  expect(job.status).toBe("done");
  expect(job.total).toBe(200000);
  expect(job.activity.at(-1)).toMatchObject({
    reason: "আজ কাজ শেষ হয়েছে",
    before: { status: null, total: 200000 },
    after: { status: "done", total: 200000 },
  });
  expect(saved.entries).toEqual(ledger.entries);
  expect(JSON.stringify(ledger)).toBe(before);
});

it("keeps status changes retryable after a save error", async () => {
  mount(filterFixture(), "/works/old-paid");
  state.save.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByRole("button", { name: "কাজের অবস্থা বদলাই" }));
  fireEvent.change(screen.getByLabelText("কাজের অবস্থা"), {
    target: { value: "planned" },
  });
  fireEvent.change(screen.getByLabelText("কেন বদলালেন"), {
    target: { value: "আগামী সপ্তাহে শুরু হবে" },
  });
  fireEvent.click(screen.getByRole("button", { name: "রাখুন" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "অবস্থা রাখা যায়নি। আবার চেষ্টা করুন।",
  );
  expect((screen.getByLabelText("কেন বদলালেন") as HTMLInputElement).value).toBe(
    "আগামী সপ্তাহে শুরু হবে",
  );
  fireEvent.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(state.save).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.queryByLabelText("কেন বদলালেন")).toBeNull(),
  );
  expect(
    (state.ledger as Ledger).contracts.find((job) => job.id === "old-paid")
      ?.status,
  ).toBe("planned");
});

it("keeps people/work selectors compact by default and restores active context filters expanded on reload", () => {
  const ledger = filterFixture();
  const view = mount(ledger, "/works");
  const toggle = screen.getByRole("button", { name: "কর্মী ও খাতা" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByLabelText("কর্মী")).toBeNull();
  expect(screen.queryByLabelText("খাতা")).toBeNull();
  expect(screen.getByLabelText("কাজের অবস্থা")).toBeTruthy();
  fireEvent.click(toggle);
  fireEvent.change(screen.getByLabelText("কর্মী"), {
    target: { value: "worker" },
  });
  fireEvent.change(screen.getByLabelText("খাতা"), {
    target: { value: "door" },
  });
  const path = currentUrl().pathname + currentUrl().search;
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(currentUrl().searchParams.get("person")).toBe("worker");
  expect(currentUrl().searchParams.get("work")).toBe("door");
  view.unmount();
  mount(ledger, path);
  expect(
    screen
      .getByRole("button", { name: "কর্মী ও খাতা" })
      .getAttribute("aria-expanded"),
  ).toBe("true");
  expect((screen.getByLabelText("কর্মী") as HTMLSelectElement).value).toBe(
    "worker",
  );
  expect((screen.getByLabelText("খাতা") as HTMLSelectElement).value).toBe(
    "door",
  );
});

it("keeps cancelled, historical and unmatched cash out of list-card balances", () => {
  const ledger = withPayments();
  ledger.entries.push(
    EntrySchema.parse({
      id: "wrong-person-for-list",
      kind: "payment",
      account: "labour",
      personId: "other-worker",
      contractId: "job-0",
      allocations: [{ workId: "door", amount: 10000000 }],
      paymentParts: [{ amount: 10000000 }],
    }),
  );
  const { container } = mount(ledger, "/works?person=worker");
  const card = [
    ...container.querySelectorAll<HTMLElement>(".job-snap-card"),
  ].find(
    (element) =>
      element.querySelector(".job-tile-name")?.textContent === "কাজের হিসাব",
  )!;
  expect(card.querySelector(".job-tile-paid strong")?.textContent).toBe(
    "৳\u202f২৫,০০০",
  );
  expect(card.querySelector(".job-tile-balance strong")?.textContent).toBe(
    formatMoney(57500000, "bn"),
  );
  expect(card.classList.contains("job-payment-due")).toBe(true);
});
