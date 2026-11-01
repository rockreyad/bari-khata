import { describe, expect, it } from "vitest";
import { EntrySchema, LedgerSchema } from "../../domain/model";
import { monthlySpending, smoothSpendingPath } from "./monthlySpending";

export function spendingFixture() {
  return LedgerSchema.parse({
    works: [
      { id: "door", name: "দরজা" },
      { id: "tiles", name: "টাইলস" },
    ],
    people: [
      { id: "shop", name: "দোকান", kind: "shop" },
      { id: "worker", name: "মিস্ত্রি", kind: "worker" },
    ],
    entries: [
      {
        id: "material",
        kind: "expense",
        personId: "shop",
        date: "2026-08-01",
        lines: [
          { id: "m", workId: "door", label: "দরজা", amount: 10000 },
          { id: "t", workId: "tiles", label: "টাইলস", amount: 1000 },
        ],
      },
      {
        id: "return",
        kind: "expense_credit",
        personId: "shop",
        date: "2026-08-20",
        lines: [{ id: "r", workId: "door", label: "ফেরত", amount: 2000 }],
      },
      {
        id: "labour",
        kind: "expense",
        personId: "worker",
        account: "labour",
        date: "2026-10-01",
        lines: [
          {
            id: "l",
            workId: "door",
            label: "মজুরি",
            costType: "labour",
            amount: 5000,
          },
        ],
      },
      {
        id: "van",
        kind: "expense",
        account: "other",
        date: "2026-11-01",
        lines: [
          {
            id: "v",
            workId: "door",
            label: "ভ্যান",
            costType: "transport",
            amount: 7000,
          },
        ],
      },
      {
        id: "payment",
        kind: "payment",
        personId: "shop",
        date: "2026-11-01",
        allocations: [{ workId: "door", amount: 25000 }],
        paymentParts: [{ amount: 25000 }],
      },
      {
        id: "voided",
        kind: "expense",
        voided: true,
        date: "2026-11-01",
        lines: [{ id: "void", workId: "door", label: "বাতিল", amount: 999999 }],
      },
      {
        id: "unknown-date",
        kind: "expense",
        lines: [{ id: "u", workId: "door", label: "তারিখ নেই", amount: 3000 }],
      },
    ],
  });
}
describe("monthly incurred spending", () => {
  it("deducts returns, splits work lines and never counts settlement or voided records as another cost", () => {
    const rows = monthlySpending(spendingFixture(), { workId: "door" });
    expect(rows.map((row) => row.month)).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    expect(rows[2]).toEqual({
      month: "2026-08",
      material: 8000,
      labour: 0,
      other: 0,
      total: 8000,
    });
    expect(rows[4].labour).toBe(5000);
    expect(rows[5].other).toBe(7000);
    expect(rows.reduce((sum, row) => sum + row.total, 0)).toBe(20000);
  });
  it("restricts a contact and account without pulling unrelated people or months into the chart", () => {
    const rows = monthlySpending(spendingFixture(), {
      personId: "shop",
      account: "materials",
    });
    expect(rows.at(-1)?.month).toBe("2026-08");
    expect(rows.at(-1)?.total).toBe(9000);
    expect(rows.every((row) => row.labour === 0 && row.other === 0)).toBe(true);
  });
  it("keeps year boundaries and negative return months honest", () => {
    const ledger = spendingFixture();
    ledger.entries.push(
      EntrySchema.parse({
        id: "return-next-year",
        personId: "shop",
        kind: "expense_credit",
        date: "2027-01-01",
        lines: [{ id: "j", workId: "door", label: "মাল ফেরত", amount: 4000 }],
      }),
    );
    const rows = monthlySpending(ledger, { workId: "door" });
    expect(rows[0].month).toBe("2026-08");
    expect(rows.at(-1)).toEqual({
      month: "2027-01",
      material: -4000,
      labour: 0,
      other: 0,
      total: -4000,
    });
  });
  it("omits an empty chart and makes finite smooth segments even for a flat or one-point series", () => {
    expect(monthlySpending(LedgerSchema.parse({}))).toEqual([]);
    expect(smoothSpendingPath([{ x: 1, y: 0 }])).toBe("M 1 0");
    const path = smoothSpendingPath([
      { x: 1, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 100 },
    ]);
    expect(path).toContain("C ");
    expect(path).not.toMatch(/NaN|Infinity/);
  });
});
