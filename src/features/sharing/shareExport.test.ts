import { describe, expect, it, vi } from "vitest";
import { formatMoney } from "../../lib/formatMoney";
import { SharedStatementSchema } from "./shareModel";
import {
  completeSharedStatement,
  SHARED_EXPORT_MAX_CHARACTERS,
  SHARED_EXPORT_MAX_ROWS,
  sharedExportFilename,
  sharedStatementCsv,
} from "./shareExport";
const first = () =>
  SharedStatementSchema.parse({
    person: { name: "দরজার দোকান", role: "দোকান", kind: "shop" },
    projectName: "পরীক্ষার বাড়ি",
    account: "materials",
    workName: "দরজা",
    updatedAt: "2026-11-01T10:00:00Z",
    revision: 7,
    total: 2,
    nextOffset: 1,
    totals: {
      cost: 9300000,
      paid: 3000000,
      payable: 6300000,
      advance: 0,
      historicalCost: 0,
    },
    rows: [
      {
        key: "bill",
        date: "2026-11-01",
        kind: "expense",
        historical: false,
        charge: 9300000,
        paid: 0,
        description: "৮টি দরজা",
        works: "দরজা",
      },
    ],
  });
describe("shared statement export", () => {
  it("marks unclear legacy balances as pending review in the exported copy", () => {
    const source = first();
    const statement = SharedStatementSchema.parse({
      ...source,
      totals: { ...source.totals, balanceAmbiguous: true, earnedPayable: null },
    });
    const csv = sharedStatementCsv(statement, {
      t: (key) => key,
      money: (value) => `money:${value}`,
      date: (value) => value ?? "",
    });
    expect(csv).toContain('"বাকি","বাকি মেলানো বাকি"');
    expect(csv).not.toContain('"বাকি","money:6300000"');
  });
  it("matches the shop ledger captions while preserving bills, payments and signed returns", () => {
    const source = first();
    const statement = SharedStatementSchema.parse({
      ...source,
      total: 4,
      nextOffset: null,
      totals: {
        cost: 9000,
        paid: 13000,
        payable: 0,
        advance: 4000,
        historicalCost: 0,
      },
      rows: [
        {
          ...source.rows[0],
          key: "sample-bill",
          kind: "expense",
          charge: 10000,
          paid: 0,
        },
        {
          ...source.rows[0],
          key: "sample-paid",
          kind: "payment",
          charge: 0,
          paid: 14000,
        },
        {
          ...source.rows[0],
          key: "sample-return",
          kind: "expense_credit",
          charge: -1000,
          paid: 0,
        },
        {
          ...source.rows[0],
          key: "sample-refund",
          kind: "refund",
          charge: 0,
          paid: -1000,
        },
      ],
    });
    const before = JSON.stringify(statement);
    const csv = sharedStatementCsv(statement, {
      t: (value) => value,
      money: (value) => `৳${value}`,
      date: (value) => value ?? "",
    });
    for (const value of [
      '"মোট বিল","৳9000"',
      '"পরিশোধ","৳13000"',
      '"বাকি","৳0"',
      '"ক্রেতা পাবেন","৳4000"',
      '"বিল","পরিশোধ","পুরোনো তথ্য"',
      '"2026-11-01","বিল"',
      '"2026-11-01","পরিশোধ"',
      '"2026-11-01","টাকা ফেরত"',
      '"৳-1000","৳0"',
      '"৳0","৳-1000"',
    ])
      expect(csv).toContain(value);
    expect(csv).not.toContain("মোট পেয়েছেন");
    expect(csv).not.toContain("ফেরত দিয়েছেন");
    expect(JSON.stringify(statement)).toBe(before);
  });
  it("keeps signed noncash adjustments in a separate export column with zero payment/charge", () => {
    const source = first();
    const page = SharedStatementSchema.parse({
      ...source,
      nextOffset: null,
      totals: { ...source.totals, adjustment: -400000 },
      rows: [
        {
          key: "adjust",
          date: "2026-11-03",
          kind: "adjustment",
          historical: false,
          charge: 0,
          paid: 0,
          adjustment: -400000,
          adjustmentBasis: "balance",
          description: "হিসাব মিলিয়েছি",
          works: "দরজা",
        },
      ],
    });
    const csv = sharedStatementCsv(page, {
      t: (value) => value,
      money: (value) => `৳${value / 100}`,
      date: (value) => value ?? "",
    });
    expect(csv).toContain('"পরিশোধ","সমন্বয়"');
    expect(csv).toContain('"৳0","৳0","৳-4000"');
    expect(csv).toContain('"হিসাবের সমন্বয় · বাকি"');
    for (const invalid of [
      { adjustment: 0 },
      { paid: 1 },
      { charge: 1 },
      { historical: true },
    ])
      expect(
        SharedStatementSchema.safeParse({
          ...page,
          rows: [{ ...page.rows[0], ...invalid }],
        }).success,
      ).toBe(false);
  });
  it.each(["bn", "en"] as const)(
    "keeps currency spacing in the downloadable %s account copy",
    (language) => {
      const csv = sharedStatementCsv(first(), {
        language,
        t: (value) => value,
        money: (amount) => formatMoney(amount, language),
        date: (value) => value ?? "—",
      });
      expect(csv).toContain(
        language === "bn" ? '"৳\u202f৯৩,০০০"' : '"৳\u202f93,000"',
      );
      expect(csv).not.toMatch(/৳[0-9০-৯-]/u);
    },
  );
  it("uses recipient wording for cash, returns, credit and each correction basis without changing signed values", () => {
    const source = first();
    const normal = (
      key: string,
      kind: "expense" | "payment" | "expense_credit" | "refund",
      charge: number,
      paid: number,
    ) => ({ ...source.rows[0], key, kind, charge, paid });
    const corrections = [
      { basis: "paid", amount: 500 },
      { basis: "cost", amount: -200 },
      { basis: "balance", amount: -100 },
    ] as const;
    const statement = SharedStatementSchema.parse({
      ...source,
      person: { name: "নমুনা কর্মী", role: "মিস্ত্রি", kind: "worker" },
      account: "labour",
      total: 7,
      nextOffset: null,
      totals: {
        cost: 9000,
        paid: 9000,
        payable: 0,
        advance: 0,
        historicalCost: 0,
        paidCorrection: 500,
        costCorrection: -200,
        balanceCorrection: -100,
        reconciledCost: 8800,
        reconciledNetPaid: 9500,
        reconciledPayable: 0,
        reconciledAdvance: 800,
      },
      contracts: [
        {
          title: "নমুনা চুক্তি",
          workName: "দরজা",
          total: 9000,
          netPaid: 9000,
          remaining: 0,
        },
      ],
      rows: [
        normal("bill", "expense", 10000, 0),
        normal("paid", "payment", 0, 10000),
        normal("return", "expense_credit", -1000, 0),
        normal("refund", "refund", 0, -1000),
        ...corrections.map(({ basis, amount }) => ({
          ...source.rows[0],
          key: `adjust-${basis}`,
          kind: "adjustment",
          charge: 0,
          paid: 0,
          adjustment: amount,
          adjustmentBasis: basis,
        })),
      ],
    });
    const before = JSON.stringify(statement);
    const csv = sharedStatementCsv(statement, {
      t: (value) => value,
      money: (value) => `৳${value}`,
      date: (value) => value ?? "",
    });
    for (const text of [
      '"কাজের বিল","৳8800"',
      '"মোট পেয়েছেন","৳9500"',
      '"আপনার কাছে জমা","৳800"',
      '"পেয়েছেন","৳9000"',
      '"সমন্বয় · মোট পাওয়া","৳500"',
      '"সমন্বয় · বিলের মোট","৳-200"',
      '"সমন্বয় · বাকি","৳-100"',
      '"টাকা পেয়েছেন"',
      '"ফেরত দিয়েছেন"',
      '"৳0","৳-1000"',
      '"৳-1000","৳0"',
      '"হিসাবের সমন্বয় · মোট পাওয়া"',
      '"হিসাবের সমন্বয় · বিলের মোট"',
      '"হিসাবের সমন্বয় · বাকি"',
    ])
      expect(csv).toContain(text);
    for (const ownerLabel of [
      "এই চুক্তিতে দিয়েছি",
      "মোট দিয়েছি",
      "টাকা দেওয়া",
      "আমার জমা",
      "পরিশোধ হয়েছে",
    ])
      expect(csv).not.toContain(ownerLabel);
    expect(JSON.stringify(statement)).toBe(before);
  });
  it("keeps a known historical cash amount without claiming the payment is unknown", () => {
    const source = first();
    const statement = SharedStatementSchema.parse({
      ...source,
      total: 1,
      nextOffset: null,
      totals: { cost: 0, paid: 0, payable: 0, advance: 0, historicalCost: 0 },
      rows: [
        {
          ...source.rows[0],
          kind: "payment",
          charge: 0,
          paid: 1200,
          historical: true,
        },
      ],
    });
    const csv = sharedStatementCsv(statement, {
      t: (value) => value,
      money: (value) => `৳${value}`,
      date: (value) => value ?? "",
    });
    expect(csv).toContain('"পরিশোধ","৳0"');
    expect(csv).toContain(
      '"৳0","৳1200","পুরোনো তথ্য; বর্তমান হিসাবে ধরা হয়নি"',
    );
    expect(csv).not.toContain("পরিশোধ জানা নেই");
  });
  it("loads every authorized bounded page at one revision before producing the export", async () => {
    const page = first();
    const read = vi
      .fn()
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce({
        ...page,
        nextOffset: null,
        rows: [
          {
            ...page.rows[0],
            key: "paid",
            kind: "payment",
            charge: 0,
            paid: 3000000,
            description: "",
          },
        ],
      });
    const complete = await completeSharedStatement("a".repeat(64), read);
    expect(read.mock.calls).toEqual([["a".repeat(64)], ["a".repeat(64), 1, 7]]);
    expect(complete.rows.map((row) => row.key)).toEqual(["bill", "paid"]);
    const csv = sharedStatementCsv(complete, {
      t: (value) => value,
      money: (value) => `৳${value / 100}`,
      date: (value) => value || "",
    });
    expect(csv).toContain('"৮টি দরজা"');
    expect(csv).toContain('"৳30000"');
    expect(csv).not.toContain("a".repeat(64));
  });
  it("never returns a partial export after revocation, revision changes or a failing later page", async () => {
    for (const later of [null, { ...first(), revision: 8, nextOffset: null }]) {
      const read = vi
        .fn()
        .mockResolvedValueOnce(first())
        .mockResolvedValueOnce(later);
      await expect(completeSharedStatement("token", read)).rejects.toThrow(
        later ? "share_changed" : "share_unavailable",
      );
    }
    await expect(
      completeSharedStatement(
        "token",
        vi
          .fn()
          .mockResolvedValueOnce(first())
          .mockRejectedValueOnce(new Error("network")),
      ),
    ).rejects.toThrow("network");
  });
  it("rejects looping offsets, duplicate entries and missing rows", async () => {
    await expect(
      completeSharedStatement(
        "token",
        vi.fn().mockResolvedValue({ ...first(), nextOffset: 0 }),
      ),
    ).rejects.toThrow("share_invalid_page");
    await expect(
      completeSharedStatement(
        "token",
        vi
          .fn()
          .mockResolvedValueOnce(first())
          .mockResolvedValueOnce({ ...first(), nextOffset: null }),
      ),
    ).rejects.toThrow("share_invalid_page");
    await expect(
      completeSharedStatement(
        "token",
        vi.fn().mockResolvedValue({ ...first(), nextOffset: null }),
      ),
    ).rejects.toThrow("share_invalid_page");
  });
  it("cancels an old link export before any old rows can be returned", async () => {
    const read = vi.fn().mockResolvedValue(first());
    await expect(
      completeSharedStatement("token", read, () => true),
    ).rejects.toThrow("share_cancelled");
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects skipped or empty progressing pages before requesting another page", async () => {
    const skipped = vi.fn().mockResolvedValue({
      ...first(),
      total: 3,
      nextOffset: 2,
    });
    await expect(completeSharedStatement("token", skipped)).rejects.toThrow(
      "share_invalid_page",
    );
    expect(skipped).toHaveBeenCalledOnce();
    const empty = vi
      .fn()
      .mockResolvedValueOnce({ ...first(), total: 3 })
      .mockResolvedValueOnce({ ...first(), total: 3, rows: [], nextOffset: 2 });
    await expect(completeSharedStatement("token", empty)).rejects.toThrow(
      "share_invalid_page",
    );
    expect(empty).toHaveBeenCalledTimes(2);
  });
  it("cancels the in-flight export request without returning a partial account copy", async () => {
    const controller = new AbortController();
    const read = vi.fn(
      (_token, _offset, _revision, _kind, options) =>
        new Promise<never>((_resolve, reject) => {
          options.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const exported = completeSharedStatement("token", read, () => false, {
      signal: controller.signal,
    });
    expect(read).toHaveBeenCalledWith("token", 0, undefined, undefined, {
      signal: controller.signal,
    });
    controller.abort();
    await expect(exported).rejects.toThrow("share_cancelled");
    expect(read).toHaveBeenCalledOnce();
  });
  it("stops an over-limit row count after the first valid page", async () => {
    const source = first();
    const total = SHARED_EXPORT_MAX_ROWS + 1;
    const read = vi.fn().mockResolvedValue(
      SharedStatementSchema.parse({
        ...source,
        total,
        nextOffset: 20,
        rows: Array.from({ length: 20 }, (_, index) => ({
          ...source.rows[0],
          key: `bill-${index}`,
        })),
      }),
    );
    await expect(completeSharedStatement("token", read)).rejects.toThrow(
      "share_export_too_large",
    );
    expect(read).toHaveBeenCalledOnce();
    expect(total).toBe(2001);
  });
  it("refuses an oversized first page before requesting any more export rows", async () => {
    const source = first();
    const description = "ম".repeat(310000);
    const works = "খ".repeat(210000);
    const rows = Array.from({ length: 17 }, (_, index) => ({
      ...source.rows[0],
      key: `bill-${index}`,
      description,
      works,
    }));
    expect(
      rows.reduce(
        (total, row) =>
          total + row.key.length + row.description.length + row.works.length,
        0,
      ),
    ).toBeGreaterThan(SHARED_EXPORT_MAX_CHARACTERS);
    const read = vi.fn().mockResolvedValue(
      SharedStatementSchema.parse({
        ...source,
        total: 17,
        nextOffset: null,
        rows,
      }),
    );
    await expect(completeSharedStatement("token", read)).rejects.toThrow(
      "share_export_too_large",
    );
    expect(read).toHaveBeenCalledOnce();
  });
  it("stops a later export page when its text would exceed the combined budget", async () => {
    const source = first();
    const description = "ম".repeat(310000);
    const rows = (offset: number, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        ...source.rows[0],
        key: `bill-${offset + index}`,
        description,
        works: "",
      }));
    const firstRows = rows(0, 20);
    expect(
      firstRows.reduce(
        (total, row) => total + row.key.length + row.description.length,
        0,
      ),
    ).toBeLessThan(SHARED_EXPORT_MAX_CHARACTERS);
    const read = vi
      .fn()
      .mockResolvedValueOnce(
        SharedStatementSchema.parse({
          ...source,
          total: 40,
          nextOffset: 20,
          rows: firstRows,
        }),
      )
      .mockResolvedValueOnce(
        SharedStatementSchema.parse({
          ...source,
          total: 40,
          nextOffset: 30,
          rows: rows(20, 10),
        }),
      );
    await expect(completeSharedStatement("token", read)).rejects.toThrow(
      "share_export_too_large",
    );
    expect(read.mock.calls).toEqual([["token"], ["token", 20, 7]]);
  });
  it("exports only public fields and neutralizes spreadsheet formulas in contact-controlled text", () => {
    const page = SharedStatementSchema.parse({
      ...first(),
      person: { name: "=HYPERLINK(1)", role: "", secret: "private" },
      source: "private",
      rows: [
        {
          ...first().rows[0],
          description: "@SUM(1)",
          note: "private-owner-note",
        },
      ],
    });
    const csv = sharedStatementCsv(page, {
      t: (value) => value,
      money: String,
      date: (value) => value || "",
    });
    expect(csv).toContain("'=HYPERLINK(1)");
    expect(csv).toContain("'@SUM(1)");
    expect(csv).not.toContain("private");
    expect(sharedExportFilename("../../দোকান")).toBe("দোকান.csv");
  });
});
