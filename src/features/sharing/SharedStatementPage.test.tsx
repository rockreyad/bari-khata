// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SharedStatementPage } from "./SharedStatementPage";
import { SharedStatementSchema } from "./shareModel";
const mocked = vi.hoisted(() => ({ read: vi.fn(), download: vi.fn() }));
vi.mock("./shareExport", async (original) => ({
  ...(await original<typeof import("./shareExport")>()),
  downloadSharedCsv: mocked.download,
}));
vi.mock("./shareClient", () => ({ readShare: mocked.read }));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string) => text,
    money: (value: number) => `৳${value / 100}`,
    date: (value: string | null) => value ?? "তারিখ জানা নেই",
    formatDigits: (value: string | number) => String(value),
  }),
}));
const page = () =>
  SharedStatementSchema.parse({
    person: { name: "রহিম", role: "মিস্ত্রি" },
    projectName: "বাড়ি",
    account: "labour",
    workName: "",
    updatedAt: "2026-11-01T12:00:00Z",
    revision: 1,
    total: 2,
    nextOffset: 1,
    totals: {
      cost: 30000,
      paid: 10000,
      payable: 20000,
      advance: 0,
      historicalCost: 0,
    },
    rows: [
      {
        key: "one",
        date: "2026-11-01",
        kind: "expense",
        historical: false,
        charge: 30000,
        paid: 0,
        description: "মজুরির বিল",
        works: "টাইলস",
      },
    ],
  });
beforeEach(() => {
  mocked.read.mockReset();
  mocked.download.mockReset();
  window.location.hash = "a".repeat(64);
});
afterEach(cleanup);
describe("public live statements", () => {
  it("identifies the adjusted metric even when a public row has no description", async () => {
    const source = page();
    mocked.read.mockResolvedValue(
      SharedStatementSchema.parse({
        ...source,
        total: 1,
        nextOffset: null,
        rows: [
          {
            key: "adjust",
            date: "2026-11-03",
            kind: "adjustment",
            historical: false,
            charge: 0,
            paid: 0,
            adjustment: 5000,
            adjustmentBasis: "paid",
            description: "",
            works: "টাইলস",
          },
        ],
      }),
    );
    const { container } = render(<SharedStatementPage />);
    await screen.findByText("মোট দিয়েছি");
    expect(
      container.querySelector(".shared-kind-adjustment")?.textContent,
    ).toBe("৳50মোট দিয়েছি");
  });
  it("shows a corrected paid headline with an explicit correction while preserving raw received-cash totals", async () => {
    const source = page();
    mocked.read.mockResolvedValue(
      SharedStatementSchema.parse({
        ...source,
        nextOffset: null,
        totals: {
          ...source.totals,
          paidCorrection: 5000,
          reconciledNetPaid: 15000,
        },
        rows: [],
      }),
    );
    const { container } = render(<SharedStatementPage />);
    await screen.findByText("মোট পেয়েছেন");
    expect(
      container.querySelector(".shared-total-main > strong")?.textContent,
    ).toBe("৳150");
    expect(
      container.querySelector(".shared-total-main")?.textContent,
    ).toContain("সমন্বয়");
    expect(
      container.querySelector(".shared-total-main")?.textContent,
    ).toContain("৳50");
    expect(source.totals.paid).toBe(10000);
  });
  it("shows signed adjustments without adding them to the received-cash headline", async () => {
    const source = page();
    mocked.read.mockResolvedValue(
      SharedStatementSchema.parse({
        ...source,
        total: 1,
        nextOffset: null,
        counts: { adjustment: 1 },
        totals: { ...source.totals, adjustment: -5000, payable: 15000 },
        rows: [
          {
            key: "adjust",
            date: "2026-11-03",
            kind: "adjustment",
            historical: false,
            charge: 0,
            paid: 0,
            adjustment: -5000,
            adjustmentBasis: "balance",
            description: "আগের হিসাব মিলিয়েছি",
            works: "টাইলস",
          },
        ],
      }),
    );
    const { container } = render(<SharedStatementPage />);
    await screen.findByText("আগের হিসাব মিলিয়েছি");
    expect(
      container.querySelector(".shared-total-main > strong")?.textContent,
    ).toBe("৳100");
    expect(
      container.querySelector(".shared-kind-adjustment")?.textContent,
    ).toBe("৳-50সমন্বয় · বাকি");
    expect(screen.getByRole("button", { name: "সমন্বয়" })).toBeTruthy();
  });
  it("loads another bounded page on request and refreshes without stale rows", async () => {
    const first = page();
    mocked.read
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({
        ...first,
        nextOffset: null,
        rows: [
          {
            ...first.rows[0],
            key: "two",
            description: "টাকা দিয়েছি",
            kind: "payment",
            charge: 0,
            paid: 10000,
          },
        ],
      })
      .mockResolvedValueOnce({
        ...first,
        revision: 2,
        total: 1,
        nextOffset: null,
        rows: [{ ...first.rows[0], key: "new", description: "সংশোধিত বিল" }],
      });
    const user = userEvent.setup();
    render(<SharedStatementPage />);
    await screen.findByText("মজুরির বিল");
    expect(mocked.read).toHaveBeenCalledWith("a".repeat(64));
    await user.click(screen.getByRole("button", { name: "আরও হিসাব দেখি" }));
    await waitFor(() =>
      expect(screen.getAllByText("টাকা দিয়েছি").length).toBeGreaterThan(0),
    );
    expect(mocked.read).toHaveBeenLastCalledWith("a".repeat(64), 1, 1);
    expect(screen.queryByRole("button", { name: "আরও হিসাব দেখি" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "হালনাগাদ দেখি" }));
    await screen.findByText("সংশোধিত বিল");
    expect(screen.queryByText("মজুরির বিল")).toBeNull();
    expect(screen.queryByRole("button", { name: "সংশোধন করুন" })).toBeNull();
  });
  it("clears a previously visible statement after its link is revoked", async () => {
    mocked.read.mockResolvedValueOnce(page()).mockResolvedValueOnce(null);
    const user = userEvent.setup();
    render(<SharedStatementPage />);
    await screen.findByText("মজুরির বিল");
    await user.click(screen.getByRole("button", { name: "হালনাগাদ দেখি" }));
    await screen.findByText("লিংকটি এখন কাজ করছে না");
    expect(screen.queryByText("রহিম")).toBeNull();
    expect(screen.queryByText("মজুরির বিল")).toBeNull();
  });
  it("asks for refresh when entries change between pages", async () => {
    mocked.read
      .mockResolvedValueOnce(page())
      .mockRejectedValueOnce(new Error("share_changed"));
    const user = userEvent.setup();
    render(<SharedStatementPage />);
    await screen.findByText("মজুরির বিল");
    await user.click(screen.getByRole("button", { name: "আরও হিসাব দেখি" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toBe(
      "নতুন হিসাব এসেছে। হালনাগাদ করে আবার দেখুন।",
    );
  });
  it("switches links on hash navigation and removes the previous person's data", async () => {
    mocked.read.mockResolvedValueOnce(page()).mockResolvedValueOnce(null);
    render(<SharedStatementPage />);
    await screen.findByText("মজুরির বিল");
    await act(async () => {
      window.history.replaceState(null, "", `#${"b".repeat(64)}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await screen.findByText("লিংকটি এখন কাজ করছে না");
    expect(mocked.read).toHaveBeenLastCalledWith("b".repeat(64));
    expect(screen.queryByText("রহিম")).toBeNull();
  });
  it("validates bounded financial responses and strips unexpected private fields", () => {
    const clean = page();
    expect(
      SharedStatementSchema.parse({
        ...clean,
        source: "private",
        owner_id: "secret",
      }),
    ).not.toHaveProperty("source");
    expect(() =>
      SharedStatementSchema.parse({
        ...clean,
        rows: Array.from({ length: 61 }, () => clean.rows[0]),
      }),
    ).toThrow();
    expect(() =>
      SharedStatementSchema.parse({
        ...clean,
        totals: { ...clean.totals, cost: Number.MAX_SAFE_INTEGER + 1 },
      }),
    ).toThrow();
  });
});

it("shows shop cash received as the headline, preserves prices and totals while filtering, and offers a full scoped copy", async () => {
  const first = page();
  const shop = {
    ...first,
    person: { name: "দরজার দোকান", role: "", kind: "shop" },
    account: "materials",
    total: 1,
    nextOffset: null,
    counts: { expense: 1, payment: 1, expense_credit: 1, refund: 0 },
  };
  mocked.read
    .mockResolvedValueOnce(shop)
    .mockResolvedValueOnce({
      ...shop,
      rows: [
        {
          ...first.rows[0],
          key: "returned",
          kind: "expense_credit",
          description: "দরজা ফেরত",
          charge: -10000,
        },
      ],
    })
    .mockResolvedValueOnce(shop);
  const user = userEvent.setup();
  render(<SharedStatementPage />);
  await screen.findByText("মোট পেয়েছেন");
  expect(
    document.querySelector(".shared-total-main > strong")?.textContent,
  ).toBe("৳100");
  expect(document.querySelector(".shared-balance-grid")?.textContent).toContain(
    "মালের দাম৳300",
  );
  expect(screen.queryByText("এই লিংকে শুধু হিসাব দেখা যায়")).toBeNull();
  expect(screen.queryByText("এই লিংকে কোনো তথ্য বদলানো যায় না।")).toBeNull();
  await user.click(screen.getByRole("button", { name: "মাল ফেরত" }));
  await screen.findByText("দরজা ফেরত");
  expect(mocked.read).toHaveBeenLastCalledWith(
    "a".repeat(64),
    0,
    undefined,
    "expense_credit",
  );
  expect(
    screen.getByRole("region", { name: "হিসাবের সারাংশ" }).textContent,
  ).toContain("৳300");
  expect(
    document.querySelector(".shared-total-main > strong")?.textContent,
  ).toBe("৳100");
  await user.click(screen.getByRole("button", { name: "কপি নামান" }));
  await waitFor(() => expect(mocked.download).toHaveBeenCalledOnce());
  expect(mocked.read).toHaveBeenLastCalledWith("a".repeat(64));
  expect(mocked.download.mock.calls[0][1]).toContain("মজুরির বিল");
});
it("shows contracts only when scoped worker contracts exist", async () => {
  mocked.read
    .mockResolvedValueOnce({
      ...page(),
      nextOffset: null,
      contracts: [
        {
          title: "রাজমিস্ত্রির কাজ",
          workName: "দরজা",
          total: 60000000,
          netPaid: 3000000,
          remaining: 57000000,
        },
      ],
    })
    .mockResolvedValueOnce({ ...page(), nextOffset: null });
  const user = userEvent.setup();
  render(<SharedStatementPage />);
  await screen.findByText("মোট পেয়েছেন");
  expect(screen.getByText("চুক্তির হিসাব")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "হালনাগাদ দেখি" }));
  await waitFor(() => expect(screen.queryByText("চুক্তির হিসাব")).toBeNull());
});

it.each([
  ["shop", "materials"],
  ["worker", "labour"],
  ["driver", "other"],
  ["other", "materials"],
] as const)(
  "shows payment-only %s recipients the cash they received without zero bill totals",
  async (kind, account) => {
    const statement = SharedStatementSchema.parse({
      ...page(),
      person: { name: "Golam", role: "", kind },
      account,
      total: 1,
      nextOffset: null,
      totals: {
        cost: 0,
        paid: 16200,
        payable: 0,
        advance: 16200,
        historicalCost: 0,
      },
      counts: { payment: 1 },
      rows: [
        {
          key: "paid",
          date: "2026-11-02",
          kind: "payment",
          historical: false,
          charge: 0,
          paid: 16200,
          description: "দরজার জন্য দিয়েছি",
          works: "দরজা",
        },
      ],
    });
    const before = JSON.stringify(statement);
    mocked.read.mockResolvedValue(statement);
    const { container } = render(<SharedStatementPage />);
    await screen.findByText("মোট পেয়েছেন");
    expect(
      container.querySelector(".shared-total-main > strong")?.textContent,
    ).toBe("৳162");
    expect(container.querySelector(".shared-balance-grid")).toBeNull();
    expect(container.querySelector(".shared-has-due")).toBeNull();
    const more = container.querySelector("details.shared-reconciliation")!;
    expect(more.hasAttribute("open")).toBe(false);
    await userEvent.click(screen.getByText("আরও হিসাব"));
    expect(more.hasAttribute("open")).toBe(true);
    expect(more.querySelector("dd")?.textContent).toBe("৳162");
    expect(screen.getByRole("button", { name: "কপি নামান" })).toBeTruthy();
    expect(JSON.stringify(statement)).toBe(before);
  },
);

it("uses the server's net paid amount once even when only a refund row is loaded", async () => {
  mocked.read.mockResolvedValue(
    SharedStatementSchema.parse({
      ...page(),
      person: { name: "দরজার দোকান", role: "", kind: "shop" },
      account: "materials",
      total: 3,
      nextOffset: 1,
      totals: {
        cost: 10000,
        paid: 15000,
        payable: 0,
        advance: 5000,
        historicalCost: 0,
      },
      counts: { expense: 1, payment: 1, refund: 1 },
      rows: [
        {
          key: "refund",
          date: "2026-11-02",
          kind: "refund",
          historical: false,
          charge: 0,
          paid: -5000,
          description: "ফেরত পাওয়া",
          works: "দরজা",
        },
      ],
    }),
  );
  const { container } = render(<SharedStatementPage />);
  await screen.findByText("মোট পেয়েছেন");
  expect(
    container.querySelector(".shared-total-main > strong")?.textContent,
  ).toBe("৳150");
  expect(container.querySelector(".shared-balance-grid")?.textContent).toBe(
    "মালের দাম৳100",
  );
  expect(
    container.querySelector(".shared-reconciliation dd")?.textContent,
  ).toBe("৳50");
  expect(screen.getByRole("button", { name: "আরও হিসাব দেখি" })).toBeTruthy();
});
