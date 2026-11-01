import { describe, expect, it } from "vitest";
import { LedgerSchema, EntrySchema } from "../../domain/model";
import { historyPage } from "./page";

describe("history loaded on request", () => {
  const ledger = () =>
    LedgerSchema.parse({
      works: [{ id: "w", name: "কাজ" }],
      people: [{ id: "p", name: "দোকান" }],
      entries: Array.from({ length: 65 }, (_, index) => ({
        id: `e${String(index).padStart(3, "0")}`,
        kind: "expense",
        personId: "p",
        date: "2026-11-01",
        lines: [
          { id: `l${index}`, workId: "w", label: "সিমেন্ট", amount: 1000 },
        ],
      })),
    });
  it("appends fixed batches, retains earlier records and stops at the final batch", () => {
    const source = ledger();
    const first = historyPage(source, {}, "oldest", 1);
    const second = historyPage(source, {}, "oldest", 2);
    const last = historyPage(source, {}, "oldest", 999);
    expect([first.rows.length, second.rows.length, last.rows.length]).toEqual([
      30, 60, 65,
    ]);
    expect(
      new Set(
        [...first.rows, ...second.rows, ...last.rows].map((entry) => entry.id),
      ).size,
    ).toBe(65);
    expect(second.rows.slice(0, 30)).toEqual(first.rows);
    expect([first.hasMore, second.hasMore, last.hasMore]).toEqual([
      true,
      true,
      false,
    ]);
    expect(last.page).toBe(3);
    expect(historyPage(source, {}, "oldest", Number.NaN).page).toBe(1);
    expect(
      historyPage(source, {}, "oldest", Number.POSITIVE_INFINITY).rows,
    ).toHaveLength(30);
    expect(source.entries).toHaveLength(65);
  });
  it("keeps an automatic payment with its purchase at a page boundary", () => {
    const source = ledger();
    source.entries.forEach((entry) => {
      entry.createdAt = "2026-11-01T01:00:00.000Z";
    });
    source.entries.push(
      EntrySchema.parse({
        id: "cash",
        kind: "payment",
        personId: "p",
        relatedEntryId: source.entries[29].id,
        date: source.entries[29].date,
        createdAt: source.entries[29].createdAt,
        paymentParts: [{ amount: 1000 }],
        allocations: [{ workId: "w", amount: 1000 }],
      }),
    );
    const first = historyPage(source, {}, "oldest", 1);
    const second = historyPage(source, {}, "oldest", 2);
    expect(first.total).toBe(65);
    expect(first.rows.map((entry) => entry.id)).toContain("cash");
    expect(
      second.rows.map((entry) => entry.id).filter((id) => id === "cash"),
    ).toHaveLength(1);
    expect(first.rows.length).toBe(31);
    expect(second.rows.length).toBe(61);
  });
  it("applies person/search filters before paging and returns an empty page safely", () => {
    const source = ledger();
    expect(
      historyPage(source, { personId: "missing" }, "newest", 2),
    ).toMatchObject({
      rows: [],
      total: 0,
      page: 1,
      hasMore: false,
    });
    expect(
      historyPage(
        source,
        { query: "সিমেন্ট", workId: "w", personId: "p" },
        "oldest",
        2,
      ).rows[0].id,
    ).toBe("e000");
    expect(historyPage(source, { query: "missing" }, "oldest", 1).hasMore).toBe(
      false,
    );
    source.entries = source.entries.slice(0, 30);
    expect(historyPage(source, {}, "newest", 1).hasMore).toBe(false);
  });
});
