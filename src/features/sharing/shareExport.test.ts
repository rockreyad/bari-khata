import { describe, expect, it, vi } from "vitest";
import { SharedStatementSchema } from "./shareModel";
import {
  completeSharedStatement,
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
    await expect(
      completeSharedStatement(
        "token",
        vi.fn().mockResolvedValue(first()),
        () => true,
      ),
    ).rejects.toThrow("share_cancelled");
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
