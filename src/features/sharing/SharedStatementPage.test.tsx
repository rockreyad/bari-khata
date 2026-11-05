// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SharedStatementPage } from "./SharedStatementPage";
import { SharedStatementSchema } from "./shareModel";
const mocked = vi.hoisted(() => ({
  read: vi.fn(),
  download: vi.fn(),
  detail: vi.fn(),
}));
vi.mock("./shareExport", async (original) => ({
  ...(await original<typeof import("./shareExport")>()),
  downloadSharedCsv: mocked.download,
}));
vi.mock("./shareClient", () => ({ readShare: mocked.read }));
vi.mock("./SharedEntryDetail", () => ({
  SharedEntryDetail: ({
    token,
    entryId,
    revision,
    onClose,
  }: {
    token: string;
    entryId: string;
    revision: number;
    onClose: () => void;
  }) => {
    mocked.detail({ token, entryId, revision });
    return (
      <section role="dialog" aria-label="নমুনা বিস্তারিত">
        <button onClick={onClose}>বিস্তারিত বন্ধ করুন</button>
      </section>
    );
  },
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string, values?: Record<string, string | number>) =>
      Object.entries(values ?? {}).reduce(
        (result, [key, value]) =>
          result.replaceAll(`{{${key}}}`, String(value)),
        text,
      ),
    money: (value: number) => `৳${value / 100}`,
    date: (value: string | null, options?: Intl.DateTimeFormatOptions) =>
      value
        ? new Intl.DateTimeFormat("bn-BD", {
            year: "numeric",
            month: "short",
            day: "numeric",
            ...options,
            numberingSystem: "latn",
            timeZone: "UTC",
          }).format(
            new Date(value.includes("T") ? value : `${value}T12:00:00Z`),
          )
        : "তারিখ জানা নেই",
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
    counts: { expense: 1, payment: 1 },
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
  mocked.detail.mockReset();
  window.location.hash = "a".repeat(64);
});
afterEach(cleanup);
describe("public live statements", () => {
  it.each(["labour", "materials"] as const)(
    "does not present unresolved %s contract corrections as a final due or credit",
    async (account) => {
      const source = page();
      mocked.read.mockResolvedValue(
        SharedStatementSchema.parse({
          ...source,
          account,
          totals: {
            ...source.totals,
            balanceAmbiguous: true,
            earnedPayable: null,
            advance: 15000,
          },
        }),
      );
      render(<SharedStatementPage />);
      await screen.findByText(
        "পুরোনো চুক্তির ছাড় আর কাজের বিল আলাদা করে মেলানো বাকি। এখন বাকি বা জমার চূড়ান্ত অঙ্ক দেখানো হচ্ছে না।",
      );
      expect(screen.queryByText("৳200")).toBeNull();
      expect(screen.queryByText("৳150")).toBeNull();
      expect(screen.queryByText("বাকি নেই")).toBeNull();
    },
  );
  it("identifies the adjusted metric even when a public row has no description", async () => {
    const source = page();
    mocked.read.mockResolvedValue(
      SharedStatementSchema.parse({
        ...source,
        total: 1,
        nextOffset: null,
        counts: { adjustment: 1 },
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
    await screen.findByText("হিসাবের সমন্বয়");
    const row = container.querySelector<HTMLElement>(
      ".shared-entry-adjustment",
    )!;
    expect(within(row).getByText("হিসাবের সমন্বয়")).toBeTruthy();
    expect(within(row).getByText("পরিশোধ")).toBeTruthy();
    expect(row.querySelector(".shared-ledger-paid")).toBeNull();
    expect(row.querySelector(".shared-ledger-bill")).toBeNull();
    expect(within(row).getByText("৳50")).toBeTruthy();
  });
  it("shows a corrected paid headline with an explicit correction while preserving raw received-cash totals", async () => {
    const source = page();
    mocked.read.mockResolvedValue(
      SharedStatementSchema.parse({
        ...source,
        total: 0,
        nextOffset: null,
        counts: {},
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
    const row = container.querySelector<HTMLElement>(
      ".shared-entry-adjustment",
    )!;
    expect(within(row).getByText("−৳50")).toBeTruthy();
    expect(within(row).getByText("বাকি")).toBeTruthy();
    expect(
      screen.queryByRole("group", { name: "লেনদেন বেছে দেখুন" }),
    ).toBeNull();
  });
  it("replaces a bounded page, restores it with Previous and refreshes without stale rows", async () => {
    const source = page();
    const first = {
      ...source,
      total: 21,
      nextOffset: 20,
      counts: { ...source.counts, expense: 20, payment: 1 },
      totals: { ...source.totals, cost: 600000, payable: 590000 },
      rows: Array.from({ length: 20 }, (_, index) => ({
        ...source.rows[0],
        key: `bill-${index}`,
        description: `নমুনা বিল ${index + 1}`,
      })),
    };
    mocked.read
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({
        ...first,
        nextOffset: null,
        rows: [
          {
            ...source.rows[0],
            key: "two",
            description: "টাকা দিয়েছি",
            kind: "payment",
            charge: 0,
            paid: 10000,
          },
        ],
      })
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({
        ...first,
        revision: 2,
        total: 1,
        nextOffset: null,
        rows: [{ ...first.rows[0], key: "new", description: "সংশোধিত বিল" }],
      });
    const user = userEvent.setup();
    const { container } = render(<SharedStatementPage />);
    await screen.findByText("নমুনা বিল 1");
    expect(container.querySelectorAll(".shared-entry")).toHaveLength(20);
    expect(screen.queryByText(/দেখছেন · মোট/)).toBeNull();
    expect(
      (screen.getByRole("button", { name: "আগের পাতা" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(mocked.read).toHaveBeenCalledWith(
      "a".repeat(64),
      0,
      undefined,
      undefined,
      { signal: expect.any(AbortSignal), grouped: true },
    );
    await user.click(screen.getByRole("button", { name: "পরের পাতা" }));
    await waitFor(() =>
      expect(screen.getAllByText("টাকা দিয়েছি").length).toBeGreaterThan(0),
    );
    expect(mocked.read).toHaveBeenLastCalledWith(
      "a".repeat(64),
      20,
      1,
      undefined,
      { signal: expect.any(AbortSignal), grouped: true },
    );
    expect(screen.queryByText("নমুনা বিল 1")).toBeNull();
    expect(container.querySelectorAll(".shared-entry")).toHaveLength(1);
    expect(screen.queryByText(/দেখছেন · মোট/)).toBeNull();
    expect(
      (screen.getByRole("button", { name: "পরের পাতা" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "লেনদেন" }),
    );
    expect(
      screen.getByRole("navigation", { name: "লেনদেনের পাতা" }),
    ).toBeTruthy();
    expect(
      container.querySelector(".shared-total-main > strong")?.textContent,
    ).toBe("৳100");
    await user.click(screen.getByRole("button", { name: "আগের পাতা" }));
    await screen.findByText("নমুনা বিল 1");
    expect(mocked.read).toHaveBeenLastCalledWith(
      "a".repeat(64),
      0,
      1,
      undefined,
      { signal: expect.any(AbortSignal), grouped: true },
    );
    expect(screen.queryByText("টাকা দিয়েছি")).toBeNull();
    expect(container.querySelectorAll(".shared-entry")).toHaveLength(20);
    await user.click(screen.getByRole("button", { name: "হালনাগাদ দেখি" }));
    await screen.findByText("সংশোধিত বিল");
    expect(screen.queryByText("নমুনা বিল 1")).toBeNull();
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
    await user.click(screen.getByRole("button", { name: "পরের পাতা" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toBe(
      "নতুন হিসাব এসেছে। হালনাগাদ করে আবার দেখুন।",
    );
    expect(screen.queryByText("মজুরির বিল")).toBeNull();
  });
  it.each(["revoked", "stale"] as const)(
    "cancels a pending copy when pagination finds the statement %s and ignores its late response",
    async (outcome) => {
      const original = page();
      let finish!: (value: ReturnType<typeof page>) => void;
      let signal!: AbortSignal;
      const pending = new Promise<ReturnType<typeof page>>((resolve) => {
        finish = resolve;
      });
      mocked.read
        .mockResolvedValueOnce(original)
        .mockImplementationOnce(
          (_token, _offset, _revision, _kind, options) => {
            signal = options.signal;
            return pending;
          },
        )
        .mockImplementationOnce(() =>
          outcome === "revoked"
            ? Promise.resolve(null)
            : Promise.reject(new Error("share_changed")),
        );
      const user = userEvent.setup();
      render(<SharedStatementPage />);
      await screen.findByText("মজুরির বিল");
      await user.click(screen.getByRole("button", { name: "কপি নামান" }));
      await screen.findByRole("button", { name: "বন্ধ করুন" });
      expect(signal.aborted).toBe(false);
      await user.click(screen.getByRole("button", { name: "পরের পাতা" }));
      const title =
        outcome === "revoked" ? "লিংকটি এখন কাজ করছে না" : "নতুন হিসাব এসেছে";
      await screen.findByRole("heading", { name: title });
      expect(screen.queryByText("রহিম")).toBeNull();
      expect(screen.queryByText("মজুরির বিল")).toBeNull();
      await act(async () => {
        finish(
          SharedStatementSchema.parse({
            ...original,
            total: 1,
            nextOffset: null,
            rows: [
              { ...original.rows[0], description: "নমুনা দেরিতে আসা কপি" },
            ],
          }),
        );
        await pending;
      });
      expect(signal.aborted).toBe(true);
      expect(mocked.download).not.toHaveBeenCalled();
      expect(screen.getByRole("heading", { name: title })).toBeTruthy();
      expect(screen.queryByText("নমুনা দেরিতে আসা কপি")).toBeNull();
      expect(screen.queryByRole("button", { name: "বন্ধ করুন" })).toBeNull();
    },
  );
  it("keeps a pending complete copy alive through an ordinary same-link search change", async () => {
    const original = page();
    let finish!: (value: ReturnType<typeof page>) => void;
    let signal!: AbortSignal;
    const pending = new Promise<ReturnType<typeof page>>((resolve) => {
      finish = resolve;
    });
    mocked.read
      .mockResolvedValueOnce(original)
      .mockImplementationOnce((_token, _offset, _revision, _kind, options) => {
        signal = options.signal;
        return pending;
      })
      .mockResolvedValueOnce({ ...original, total: 1, nextOffset: null });
    const user = userEvent.setup();
    render(<SharedStatementPage />);
    await screen.findByText("মজুরির বিল");
    await user.click(screen.getByRole("button", { name: "কপি নামান" }));
    await screen.findByRole("button", { name: "বন্ধ করুন" });
    await user.type(
      screen.getByRole("searchbox", { name: "লেনদেন খুঁজুন" }),
      "বিল",
    );
    await screen.findByText("মজুরির বিল");
    expect(signal.aborted).toBe(false);
    expect(screen.getByRole("button", { name: "বন্ধ করুন" })).toBeTruthy();
    await act(async () => {
      finish(
        SharedStatementSchema.parse({
          ...original,
          nextOffset: null,
          rows: [
            original.rows[0],
            {
              ...original.rows[0],
              key: "sample-payment",
              kind: "payment",
              charge: 0,
              paid: 10000,
              description: "নমুনা সম্পূর্ণ কপির পরিশোধ",
            },
          ],
        }),
      );
      await pending;
    });
    await waitFor(() => expect(mocked.download).toHaveBeenCalledOnce());
    expect(signal.aborted).toBe(false);
    expect(mocked.download.mock.calls[0][1]).toContain("মজুরির বিল");
    expect(mocked.download.mock.calls[0][1]).toContain(
      "নমুনা সম্পূর্ণ কপির পরিশোধ",
    );
    expect(screen.queryByText("নমুনা সম্পূর্ণ কপির পরিশোধ")).toBeNull();
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
    expect(mocked.read).toHaveBeenLastCalledWith(
      "b".repeat(64),
      0,
      undefined,
      undefined,
      { signal: expect.any(AbortSignal), grouped: true },
    );
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

it("keeps the shop's full bill, payment and due summary while searching all scoped history and exporting the full copy", async () => {
  const original = page();
  const shop = SharedStatementSchema.parse({
    ...original,
    person: { name: "নমুনা দোকান", role: "", kind: "shop" },
    account: "materials",
    total: 3,
    nextOffset: null,
    counts: { expense: 1, payment: 1, expense_credit: 1 },
    rows: [
      { ...original.rows[0], charge: 40000 },
      {
        ...original.rows[0],
        key: "paid",
        kind: "payment",
        charge: 0,
        paid: 10000,
        description: "নমুনা পরিশোধ",
      },
      {
        ...original.rows[0],
        key: "returned",
        kind: "expense_credit",
        charge: -10000,
        description: "দরজা ফেরত",
      },
    ],
  });
  mocked.read
    .mockResolvedValueOnce(shop)
    .mockResolvedValueOnce({ ...shop, total: 1, rows: [shop.rows[2]] })
    .mockResolvedValueOnce(shop);
  const user = userEvent.setup();
  const { container } = render(<SharedStatementPage />);
  await screen.findByText("মোট বিল");
  const summary = screen.getByRole("region", { name: "হিসাবের সারাংশ" });
  expect(
    container.querySelector(".shared-shop-bill > strong")?.textContent,
  ).toBe("৳300");
  expect(summary.textContent).toContain("পরিশোধ৳100");
  expect(summary.textContent).toContain("বাকি৳200");
  const beforeSummary = summary.textContent;
  await user.type(
    screen.getByRole("searchbox", { name: "লেনদেন খুঁজুন" }),
    "ফেরত",
  );
  await screen.findByText("দরজা ফেরত");
  expect(container.querySelectorAll(".shared-entry")).toHaveLength(1);
  expect(summary.textContent).toBe(beforeSummary);
  expect(mocked.read).toHaveBeenLastCalledWith(
    "a".repeat(64),
    0,
    undefined,
    undefined,
    { signal: expect.any(AbortSignal), grouped: true, query: "ফেরত" },
  );
  await user.click(screen.getByRole("button", { name: "কপি নামান" }));
  await waitFor(() => expect(mocked.download).toHaveBeenCalledOnce());
  expect(mocked.read).toHaveBeenLastCalledWith(
    "a".repeat(64),
    0,
    undefined,
    undefined,
    { signal: expect.any(AbortSignal) },
  );
  expect(mocked.download.mock.calls[0][1]).toContain("নমুনা পরিশোধ");
});
it.each([
  {
    name: "zero",
    cost: 0,
    paid: 0,
    due: 0,
    credit: 0,
    bill: "৳0",
    received: "৳0",
    balance: "৳0",
  },
  {
    name: "settled",
    cost: 30000,
    paid: 30000,
    due: 0,
    credit: 0,
    bill: "৳300",
    received: "৳300",
    balance: "৳0",
  },
  {
    name: "corrected credit",
    cost: 30000,
    paid: 10000,
    due: 20000,
    credit: 0,
    bill: "৳200",
    received: "৳250",
    balance: "৳50",
    corrections: {
      costCorrection: -10000,
      paidCorrection: 15000,
      reconciledCost: 20000,
      reconciledNetPaid: 25000,
      reconciledPayable: 0,
      reconciledAdvance: 5000,
    },
  },
])(
  "shows a truthful shop summary for $name without mutating the server amounts",
  async ({ cost, paid, due, credit, bill, received, balance, corrections }) => {
    const original = page();
    const statement = SharedStatementSchema.parse({
      ...original,
      account: "materials",
      person: { name: "নমুনা দোকান", role: "", kind: "shop" },
      ...(cost === 0
        ? { total: 0, nextOffset: null, rows: [], counts: {} }
        : {}),
      totals: {
        cost,
        paid,
        payable: due,
        advance: credit,
        historicalCost: 0,
        ...corrections,
      },
    });
    const before = JSON.stringify(statement);
    mocked.read.mockResolvedValue(statement);
    const { container } = render(<SharedStatementPage />);
    await screen.findByText("মোট বিল");
    expect(
      container.querySelector(".shared-shop-bill > strong")?.textContent,
    ).toBe(bill);
    if (corrections) {
      const payment = screen.getByText("পরিশোধ", {
        selector: "dt",
      }).parentElement!;
      expect(payment.querySelector("dd")?.textContent).toBe(received);
      const remaining = screen.getByText("ক্রেতা পাবেন", {
        selector: "dt",
      }).parentElement!;
      expect(remaining.querySelector("dd")?.textContent).toBe(balance);
      expect(
        container.querySelector(".shared-shop-bill small")?.textContent,
      ).toBe("সমন্বয়সহ · ৳-100");
      expect(payment.querySelector("small")?.textContent).toBe(
        "সমন্বয়সহ · +৳150",
      );
      expect(screen.queryByText("পুরো বিল মেটানো")).toBeNull();
    } else {
      expect(screen.queryByText("পরিশোধ", { selector: "dt" })).toBeNull();
      expect(screen.queryByText("বাকি", { selector: "dt" })).toBeNull();
      expect(
        screen.getByText(cost === 0 ? "বাকি নেই" : "পুরো বিল মেটানো"),
      ).toBeTruthy();
      const summary = screen.getByRole("region", { name: "হিসাবের সারাংশ" });
      expect(within(summary).getAllByText(bill)).toHaveLength(1);
    }
    expect(JSON.stringify(statement)).toBe(before);
  },
);

it("shows a noncash balance waiver as no amount owed without claiming the bill was paid", async () => {
  const original = page();
  const statement = SharedStatementSchema.parse({
    ...original,
    person: { name: "নমুনা দোকান", role: "", kind: "shop" },
    account: "materials",
    total: 2,
    nextOffset: null,
    counts: { expense: 1, adjustment: 1 },
    totals: {
      cost: 30000,
      paid: 0,
      payable: 30000,
      advance: 0,
      historicalCost: 0,
      actualNetPaid: 0,
      balanceCorrection: -30000,
      reconciledCost: 30000,
      reconciledNetPaid: 0,
      reconciledPayable: 0,
      reconciledAdvance: 0,
    },
    rows: [
      { ...original.rows[0], description: "নমুনা মালের বিল" },
      {
        ...original.rows[0],
        key: "waiver",
        kind: "adjustment",
        charge: 0,
        paid: 0,
        adjustment: -30000,
        adjustmentBasis: "balance",
        description: "নমুনা বকেয়া মওকুফ",
      },
    ],
  });
  const before = JSON.stringify(statement);
  mocked.read.mockResolvedValue(statement);
  const { container } = render(<SharedStatementPage />);
  await screen.findByText("বাকি নেই");
  expect(screen.queryByText("পুরো বিল মেটানো")).toBeNull();
  expect(
    container.querySelector(".shared-shop-bill > strong")?.textContent,
  ).toBe("৳300");
  expect(
    screen
      .getByText("পরিশোধ", { selector: "dt" })
      .parentElement?.querySelector("dd")?.textContent,
  ).toBe("৳0");
  expect(container.querySelector(".shared-shop-due dd")?.textContent).toBe(
    "৳0",
  );
  expect(
    container.querySelector(".shared-entry-expense .shared-bill-status"),
  ).toBeNull();
  expect(
    container.querySelector(".shared-entry-expense .shared-ledger-value")
      ?.textContent,
  ).toBe("৳300");
  expect(
    container.querySelector(".shared-entry-adjustment .shared-ledger-paid"),
  ).toBeNull();
  expect(statement.rows.some((row) => row.kind === "payment")).toBe(false);
  expect(JSON.stringify(statement)).toBe(before);
});

it("shows contracts only when scoped worker contracts exist", async () => {
  mocked.read
    .mockResolvedValueOnce({
      ...page(),
      total: 1,
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
    .mockResolvedValueOnce({ ...page(), total: 1, nextOffset: null });
  const user = userEvent.setup();
  render(<SharedStatementPage />);
  await screen.findByText("মোট পেয়েছেন");
  expect(screen.getByText("কাজ ও চুক্তি")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "হালনাগাদ দেখি" }));
  await waitFor(() => expect(screen.queryByText("কাজ ও চুক্তি")).toBeNull());
});

it("replaces a bounded set of contracts and keeps its financial summary unchanged", async () => {
  mocked.read.mockResolvedValue(
    SharedStatementSchema.parse({
      ...page(),
      total: 1,
      nextOffset: null,
      contracts: Array.from({ length: 6 }, (_, index) => ({
        title: `নমুনা চুক্তি ${index + 1}`,
        workName: "নমুনা ছাদ",
        total: 10000,
        netPaid: 4000,
        remaining: 6000,
      })),
    }),
  );
  const { container } = render(<SharedStatementPage />);
  await screen.findByText("কাজ ও চুক্তি");
  const contracts =
    container.querySelector<HTMLDetailsElement>(".shared-contracts")!;
  const user = userEvent.setup();
  await user.click(contracts.querySelector("summary")!);
  expect(contracts.querySelectorAll("article")).toHaveLength(5);
  expect(
    (
      within(contracts).getByRole("button", {
        name: "আগের চুক্তি",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await user.click(
    within(contracts).getByRole("button", { name: "পরের চুক্তি" }),
  );
  expect(
    within(contracts).getByRole("heading", { name: "নমুনা চুক্তি 6" }),
  ).toBeTruthy();
  expect(
    within(contracts).queryByRole("heading", { name: "নমুনা চুক্তি 1" }),
  ).toBeNull();
  expect(contracts.querySelectorAll("article")).toHaveLength(1);
  expect(
    (
      within(contracts).getByRole("button", {
        name: "পরের চুক্তি",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    container.querySelector(".shared-total-main > strong")?.textContent,
  ).toBe("৳100");
  await user.click(
    within(contracts).getByRole("button", { name: "আগের চুক্তি" }),
  );
  expect(contracts.querySelectorAll("article")).toHaveLength(5);
  expect(
    within(contracts).getByRole("heading", { name: "নমুনা চুক্তি 1" }),
  ).toBeTruthy();
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
    await screen.findByText("Golam");
    if (account === "materials") {
      expect(
        container.querySelector(".shared-shop-bill > strong")?.textContent,
      ).toBe("৳0");
      const balances = container.querySelector<HTMLElement>(
        ".shared-shop-balances",
      )!;
      expect(
        within(balances).getByText("পরিশোধ").parentElement?.textContent,
      ).toBe("পরিশোধ৳162");
      expect(
        within(balances).getByText("ক্রেতা পাবেন").parentElement?.textContent,
      ).toBe("ক্রেতা পাবেন৳162");
    } else {
      expect(
        container.querySelector(".shared-total-main > strong")?.textContent,
      ).toBe("৳162");
      expect(container.querySelector(".shared-balance-grid")).toBeNull();
      expect(container.querySelector(".shared-has-due")).toBeNull();
      const more = container.querySelector("details.shared-reconciliation")!;
      expect(more.hasAttribute("open")).toBe(false);
      await userEvent.click(screen.getByText("আপনার কাছে জমা"));
      expect(more.hasAttribute("open")).toBe(true);
      expect(more.querySelector("dd")?.textContent).toBe("৳162");
    }
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
  await screen.findByText("মোট বিল");
  expect(
    screen
      .getByText("পরিশোধ", { selector: "dt" })
      .parentElement?.querySelector("dd")?.textContent,
  ).toBe("৳150");
  expect(
    container.querySelector(".shared-shop-bill > strong")?.textContent,
  ).toBe("৳100");
  expect(
    container.querySelector(".shared-customer-credit dd")?.textContent,
  ).toBe("৳50");
  expect(
    (screen.getByRole("button", { name: "পরের পাতা" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});

it("identifies received cash, cash returned, bills and noncash corrections from the recipient's side", async () => {
  const baseRow = page().rows[0];
  const statement = SharedStatementSchema.parse({
    ...page(),
    person: { name: "নমুনা দোকান", role: "", kind: "shop" },
    account: "materials",
    total: 6,
    nextOffset: null,
    counts: {
      expense: 2,
      payment: 1,
      expense_credit: 1,
      refund: 1,
      adjustment: 1,
    },
    totals: {
      cost: 36000,
      paid: 9000,
      payable: 14000,
      advance: 0,
      historicalCost: 8000,
      adjustment: -5000,
      actualPaid: 10000,
      actualRefunds: 1000,
      actualNetPaid: 9000,
    },
    rows: [
      { ...baseRow, key: "bill", description: "নমুনা মালের বিবরণ" },
      {
        ...baseRow,
        key: "paid",
        kind: "payment",
        charge: 0,
        paid: 10000,
        description: "নমুনা ব্যাংক জমা",
      },
      {
        ...baseRow,
        key: "return",
        kind: "expense_credit",
        charge: -2000,
        description: "নমুনা মাল ফেরতের বিবরণ",
      },
      {
        ...baseRow,
        key: "refund",
        kind: "refund",
        charge: 0,
        paid: -1000,
        description: "নমুনা টাকা ফেরতের বিবরণ",
      },
      {
        ...baseRow,
        key: "adjustment",
        kind: "adjustment",
        charge: 0,
        paid: 0,
        adjustment: -5000,
        adjustmentBasis: "balance",
        description: "",
      },
      {
        ...baseRow,
        key: "historical",
        historical: true,
        date: null,
        charge: 8000,
        description: "নমুনা পুরোনো বিল",
      },
    ],
  });
  mocked.read.mockResolvedValue(statement);
  const before = JSON.stringify(statement);
  const { container } = render(<SharedStatementPage />);
  await screen.findByText("নমুনা ব্যাংক জমা");
  const row = (kind: string) =>
    within(container.querySelector<HTMLElement>(`.shared-entry-${kind}`)!);
  expect(row("payment").getByText("টাকা পেয়েছেন")).toBeTruthy();
  expect(row("payment").getByText("৳100")).toBeTruthy();
  expect(row("refund").getByText("টাকা ফেরত")).toBeTruthy();
  expect(row("refund").getByText("−৳10")).toBeTruthy();
  expect(row("expense").getByText("নমুনা মালের বিবরণ")).toBeTruthy();
  expect(
    container.querySelector(".shared-entry-expense .shared-bill-status"),
  ).toBeNull();
  expect(
    container.querySelector(".shared-entry-expense .shared-ledger-value")
      ?.textContent,
  ).toBe("৳300");
  expect(
    container.querySelector(".shared-entry-payment .shared-ledger-value")
      ?.textContent,
  ).toBe("৳100");
  expect(row("expense_credit").getByText("মাল ফেরত")).toBeTruthy();
  expect(row("expense_credit").getByText("−৳20")).toBeTruthy();
  expect(row("adjustment").getByText("হিসাবের সমন্বয়")).toBeTruthy();
  expect(row("adjustment").getByText("বাকি")).toBeTruthy();
  expect(row("adjustment").getByText("−৳50")).toBeTruthy();
  expect(
    container.querySelector(".shared-entry-adjustment .shared-ledger-paid"),
  ).toBeNull();
  expect(
    container.querySelector(".shared-entry-adjustment .shared-ledger-bill"),
  ).toBeNull();
  const historical = screen.getByText("নমুনা পুরোনো বিল").closest("article")!;
  expect(
    within(historical).getByText("পুরোনো তথ্য; বর্তমান হিসাবে ধরা হয়নি"),
  ).toBeTruthy();
  expect(within(historical).queryByText("টাকা পেয়েছেন")).toBeNull();
  expect(screen.getByRole("heading", { name: "তারিখ জানা নেই" })).toBeTruthy();
  expect(
    screen
      .getByText("পরিশোধ", { selector: "dt" })
      .parentElement?.querySelector("dd")?.textContent,
  ).toBe("৳90");
  expect(screen.getByText("টাকা ফেরত বাদে")).toBeTruthy();
  expect(container.querySelector(".shared-shop-due")?.textContent).toBe(
    "বাকি৳140",
  );
  expect(JSON.stringify(statement)).toBe(before);
});

it.each([
  ["materials", "worker", "বিল"],
  ["labour", "shop", "কাজের বিল"],
  ["other", "driver", "খরচের বিল"],
] as const)(
  "identifies the %s account independently of the person's kind and missing role",
  async (account, kind, invoice) => {
    mocked.read.mockResolvedValue(
      SharedStatementSchema.parse({
        ...page(),
        person: { name: "নমুনা প্রাপক", role: "", kind },
        account,
        workName: "নমুনা ছাদ",
        total: 1,
        nextOffset: null,
      }),
    );
    render(<SharedStatementPage />);
    expect(
      await screen.findByRole("heading", { name: "নমুনা প্রাপক" }),
    ).toBeTruthy();
    expect(screen.getByText("নমুনা ছাদ")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: new RegExp("^" + invoice + ".*বিস্তারিত"),
      }),
    ).toBeTruthy();
    expect(screen.queryByText("সব খাতা মিলিয়ে")).toBeNull();
    expect(
      screen.queryByText(/^(?:মালের হিসাব|মজুরির হিসাব|অন্য হিসাব)$/),
    ).toBeNull();
    expect(
      document.querySelector(".shared-heading")?.textContent,
    ).not.toContain("·");
  },
);

it("keeps only a short row preview and opens the exact entry capability for full details", async () => {
  const description = "নমুনা বিবরণ ".repeat(30) + "শেষ কথা";
  const original = SharedStatementSchema.parse({
    ...page(),
    total: 1,
    nextOffset: null,
    rows: [{ ...page().rows[0], description }],
  });
  mocked.read.mockResolvedValue(original);
  const user = userEvent.setup();
  const { container } = render(<SharedStatementPage />);
  await screen.findByText(description.slice(0, 100).trim());
  expect(screen.queryByText(description)).toBeNull();
  expect(
    container.querySelectorAll("details.shared-entry-description"),
  ).toHaveLength(0);
  expect(mocked.detail).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: /কাজের বিল.*বিস্তারিত/ }),
  );
  expect(
    await screen.findByRole("dialog", { name: "নমুনা বিস্তারিত" }),
  ).toBeTruthy();
  expect(mocked.detail).toHaveBeenLastCalledWith({
    token: "a".repeat(64),
    entryId: "one",
    revision: 1,
  });
  expect(mocked.read).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: "বিস্তারিত বন্ধ করুন" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it.each([5000, -5000])(
  "explains a signed %i correction beside corrected bill and due metrics",
  async (correction) => {
    const original = page();
    mocked.read.mockResolvedValue(
      SharedStatementSchema.parse({
        ...original,
        total: 1,
        nextOffset: null,
        totals: {
          ...original.totals,
          costCorrection: correction,
          balanceCorrection: correction,
          reconciledCost: 30000 + correction,
          reconciledPayable: 20000 + correction * 2,
        },
      }),
    );
    const { container } = render(<SharedStatementPage />);
    await screen.findByText("মোট পেয়েছেন");
    const bill = screen.getByText("কাজের বিল", {
      selector: "dt",
    }).parentElement!;
    const due = screen.getByText("আর পাবেন", { selector: "dt" }).parentElement!;
    expect(
      within(bill).getByText(`৳${(30000 + correction) / 100}`),
    ).toBeTruthy();
    expect(
      within(due).getByText(`৳${(20000 + correction * 2) / 100}`),
    ).toBeTruthy();
    const context = `সমন্বয়সহ · সমন্বয়: ${correction > 0 ? "+" : ""}৳${correction / 100}`;
    expect(within(bill).getByText(context)).toBeTruthy();
    expect(within(due).getByText(context)).toBeTruthy();
    expect(
      container.querySelector(".shared-total-main > strong")?.textContent,
    ).toBe("৳100");
  },
);

it("keeps correction context visible when the corrected bill and due are both zero", async () => {
  const original = page();
  mocked.read.mockResolvedValue(
    SharedStatementSchema.parse({
      ...original,
      total: 1,
      nextOffset: null,
      totals: {
        ...original.totals,
        costCorrection: -30000,
        balanceCorrection: 10000,
        reconciledCost: 0,
        reconciledPayable: 0,
        reconciledAdvance: 0,
      },
    }),
  );
  render(<SharedStatementPage />);
  await screen.findByText("মোট পেয়েছেন");
  const bill = screen.getByText("কাজের বিল", { selector: "dt" }).parentElement!;
  const due = screen.getByText("আর পাবেন", { selector: "dt" }).parentElement!;
  expect(within(bill).getByText("৳0")).toBeTruthy();
  expect(within(bill).getByText("সমন্বয়সহ · সমন্বয়: ৳-300")).toBeTruthy();
  expect(within(due).getByText("৳0")).toBeTruthy();
  expect(within(due).getByText("সমন্বয়সহ · সমন্বয়: +৳100")).toBeTruthy();
});

it("cannot download an old copy after a same-tick URL hash swap before its navigation event", async () => {
  const original = page();
  let finish!: (value: ReturnType<typeof page>) => void;
  const pending = new Promise<ReturnType<typeof page>>((resolve) => {
    finish = resolve;
  });
  mocked.read
    .mockResolvedValueOnce(original)
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce(null);
  const user = userEvent.setup();
  render(<SharedStatementPage />);
  await screen.findByText("মজুরির বিল");
  await user.click(screen.getByRole("button", { name: "কপি নামান" }));
  await screen.findByRole("button", { name: "বন্ধ করুন" });
  await act(async () => {
    window.history.replaceState(null, "", `#${"b".repeat(64)}`);
    finish(
      SharedStatementSchema.parse({ ...original, total: 1, nextOffset: null }),
    );
    await pending;
  });
  expect(mocked.download).not.toHaveBeenCalled();
  await act(async () => {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  await screen.findByText("লিংকটি এখন কাজ করছে না");
  expect(screen.queryByText("রহিম")).toBeNull();
  expect(screen.queryByText("মজুরির বিল")).toBeNull();
  expect(mocked.download).not.toHaveBeenCalled();
});

it("groups entries by month and year while keeping every row's own date and an unknown-date group", async () => {
  const original = page();
  const dates = ["2026-11-01", "2026-11-29", "2026-12-02", "2025-11-09", null];
  mocked.read.mockResolvedValue(
    SharedStatementSchema.parse({
      ...original,
      total: dates.length,
      nextOffset: null,
      counts: { payment: dates.length },
      rows: dates.map((date, index) => ({
        ...original.rows[0],
        key: `sample-month-${index}`,
        date,
        kind: "payment",
        charge: 0,
        paid: 10000,
        description: `নমুনা তারিখ ${index}`,
      })),
    }),
  );
  const { container } = render(<SharedStatementPage />);
  await screen.findByText("নমুনা তারিখ 0");
  expect(container.querySelectorAll(".shared-month")).toHaveLength(4);
  const november = screen
    .getByRole("heading", { name: /নভেম্বর.*2026/ })
    .closest("section")!;
  expect(within(november).getByText("নমুনা তারিখ 0")).toBeTruthy();
  expect(within(november).getByText("নমুনা তারিখ 1")).toBeTruthy();
  expect(within(november).queryByText("নমুনা তারিখ 3")).toBeNull();
  expect(screen.getByRole("heading", { name: /নভেম্বর.*2025/ })).toBeTruthy();
  expect(screen.getByRole("heading", { name: /ডিসেম্বর.*2026/ })).toBeTruthy();
  const unknown = screen
    .getByRole("heading", { name: "তারিখ জানা নেই" })
    .closest("section")!;
  expect(within(unknown).getByText("নমুনা তারিখ 4")).toBeTruthy();
  for (const [index, date] of dates.entries()) {
    const row = screen.getByText(`নমুনা তারিখ ${index}`).closest("article")!;
    const time = row.querySelector("time")!;
    expect(time.getAttribute("datetime")).toBe(date);
    expect(time.textContent?.trim()).not.toBe("");
    if (date)
      expect(time.textContent).toMatch(
        new RegExp(`^${Number(date.slice(8))}\\s`),
      );
    else expect(time.textContent).toBe("তারিখ জানা নেই");
  }
});

it.each(["none", "payment"] as const)(
  "hides the filter bar for %s-only availability without losing the scoped statement",
  async (available) => {
    const original = page();
    mocked.read.mockResolvedValue(
      SharedStatementSchema.parse({
        ...original,
        total: available === "payment" ? 1 : 0,
        nextOffset: null,
        counts: available === "payment" ? { payment: 1 } : {},
        rows:
          available === "payment"
            ? [{ ...original.rows[0], kind: "payment", charge: 0, paid: 10000 }]
            : [],
      }),
    );
    const { container } = render(<SharedStatementPage />);
    await screen.findByText("মোট পেয়েছেন");
    expect(
      screen.queryByRole("group", { name: "লেনদেন বেছে দেখুন" }),
    ).toBeNull();
    expect(container.querySelector(".shared-scope")).toBeNull();
    expect(screen.queryByText(/দেখছেন · মোট/)).toBeNull();
    expect(
      container.querySelector(".shared-total-main > strong")?.textContent,
    ).toBe("৳100");
  },
);

it("keeps a server search visible while loading, shows no matches and clears it without narrowing the financial summary", async () => {
  const original = page();
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  mocked.read
    .mockResolvedValueOnce(original)
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce(original);
  const user = userEvent.setup();
  const { container } = render(<SharedStatementPage />);
  await screen.findByText("মজুরির বিল");
  const summary = screen.getByRole("region", {
    name: "হিসাবের সারাংশ",
  }).textContent;
  const search = screen.getByRole("searchbox", { name: "লেনদেন খুঁজুন" });
  await user.type(search, "মেলেনি");
  await waitFor(() => expect(mocked.read).toHaveBeenCalledTimes(2));
  expect((search as HTMLInputElement).value).toBe("মেলেনি");
  expect(screen.queryByText("মজুরির বিল")).toBeNull();
  expect(screen.getByText("লেনদেন আসছে…")).toBeTruthy();
  await act(async () => {
    finish!({ ...original, total: 0, nextOffset: null, rows: [] });
    await pending;
  });
  await screen.findByText("কিছু মেলেনি। অন্যভাবে খুঁজে দেখুন।");
  expect(
    screen.getByRole("region", { name: "হিসাবের সারাংশ" }).textContent,
  ).toBe(summary);
  expect(container.querySelectorAll(".shared-entry")).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "খোঁজা মুছুন" }));
  await screen.findByText("মজুরির বিল");
  expect((search as HTMLInputElement).value).toBe("");
  expect(mocked.read.mock.lastCall?.[4].query).toBeUndefined();
});

it.each(["payment", "refund"] as const)(
  "identifies a historical %s as old information excluded from current totals",
  async (kind) => {
    const original = page();
    mocked.read.mockResolvedValue(
      SharedStatementSchema.parse({
        ...original,
        total: 1,
        nextOffset: null,
        totals: { cost: 0, paid: 0, payable: 0, advance: 0, historicalCost: 0 },
        rows: [
          {
            ...original.rows[0],
            kind,
            historical: true,
            charge: 0,
            paid: kind === "payment" ? 10000 : -5000,
            description: "নমুনা পুরোনো নগদ তথ্য",
          },
        ],
      }),
    );
    const { container } = render(<SharedStatementPage />);
    await screen.findByText("নমুনা পুরোনো নগদ তথ্য");
    const row = container.querySelector<HTMLElement>(`.shared-entry-${kind}`)!;
    expect(
      within(row).getByText(kind === "payment" ? "টাকা পেয়েছেন" : "টাকা ফেরত"),
    ).toBeTruthy();
    expect(
      within(row).getByText("পুরোনো তথ্য; বর্তমান হিসাবে ধরা হয়নি"),
    ).toBeTruthy();
    expect(within(row).queryByText("পুরোনো খরচ; পরিশোধ জানা নেই")).toBeNull();
    expect(
      container.querySelector(".shared-total-main > strong")?.textContent,
    ).toBe("৳0");
  },
);

it("shows one bill with a single amount and its payment status, while keeping partial and independent payments clear", async () => {
  const source = page();
  mocked.read.mockResolvedValue(
    SharedStatementSchema.parse({
      ...source,
      account: "materials",
      total: 4,
      nextOffset: null,
      rows: [
        {
          ...source.rows[0],
          key: "settled",
          description: "সিমেন্ট",
          settlement: {
            paid: 30000,
            returned: 0,
            refunded: 0,
            balance: 0,
            paymentCount: 1,
          },
        },
        {
          ...source.rows[0],
          key: "partial",
          description: "রড",
          settlement: {
            paid: 10000,
            returned: 0,
            refunded: 0,
            balance: 20000,
            paymentCount: 2,
          },
        },
        {
          ...source.rows[0],
          key: "unpaid",
          description: "ইট",
          settlement: {
            paid: 0,
            returned: 0,
            refunded: 0,
            balance: 30000,
            paymentCount: 0,
          },
        },
        {
          ...source.rows[0],
          key: "advance",
          kind: "payment",
          charge: 0,
          paid: 5000,
          description: "আলাদা অগ্রিম",
        },
      ],
    }),
  );
  const user = userEvent.setup();
  const { container } = render(<SharedStatementPage />);
  await screen.findByText("সিমেন্ট");
  expect(container.querySelectorAll(".shared-entry")).toHaveLength(4);
  const settled = screen.getByRole("button", { name: /বিল · সিমেন্ট/ });
  expect(within(settled).getAllByText("৳300")).toHaveLength(1);
  expect(within(settled).getByText("মেটানো")).toBeTruthy();
  expect(
    within(screen.getByRole("button", { name: /বিল · রড/ })).getByText(
      "বাকি ৳200",
    ),
  ).toBeTruthy();
  expect(
    within(screen.getByRole("button", { name: /বিল · রড/ })).getByText(
      "পেয়েছেন ৳100",
    ),
  ).toBeTruthy();
  expect(
    within(screen.getByRole("button", { name: /বিল · ইট/ })).getByText(
      "পুরোটাই বাকি",
    ),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: /টাকা পেয়েছেন · আলাদা অগ্রিম/ }),
  ).toBeTruthy();
  expect(container.querySelector(".shared-ledger-columns")).toBeNull();
  await user.click(settled);
  expect(mocked.detail).toHaveBeenLastCalledWith({
    token: "a".repeat(64),
    entryId: "settled",
    revision: 1,
  });
});

it("does not repeat matching worker bill and received totals", async () => {
  const source = page();
  mocked.read.mockResolvedValue({
    ...source,
    total: 0,
    nextOffset: null,
    rows: [],
    totals: { ...source.totals, paid: 30000, payable: 0 },
  });
  render(<SharedStatementPage />);
  await screen.findByText("মোট পেয়েছেন");
  const summary = screen.getByRole("region", { name: "হিসাবের সারাংশ" });
  expect(within(summary).getAllByText("৳300")).toHaveLength(1);
  expect(within(summary).getByText("পুরো বিল মেটানো")).toBeTruthy();
});

it("does not call the worker's bill fully paid when old bills have unknown payment", async () => {
  const source = page();
  mocked.read.mockResolvedValue({
    ...source,
    total: 0,
    nextOffset: null,
    rows: [],
    totals: {
      ...source.totals,
      paid: 30000,
      payable: 0,
      historicalCost: 50000,
    },
  });
  render(<SharedStatementPage />);
  await screen.findByText("মোট পেয়েছেন");
  const summary = screen.getByRole("region", { name: "হিসাবের সারাংশ" });
  expect(within(summary).queryByText("পুরো বিল মেটানো")).toBeNull();
  expect(within(summary).getByText("বাকি নেই")).toBeTruthy();
});
