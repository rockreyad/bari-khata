import { describe, expect, it } from "vitest";
import { LedgerSchema } from "../../domain/model";
import { orderedWorks } from "./workOverview";

describe("notebook display order", () => {
  it("keeps ongoing work first, recent activity before older work, and completed work last without changing stored order", () => {
    const ledger = LedgerSchema.parse({
      works: [
        { id: "done", name: "শেষ", status: "done" },
        { id: "old", name: "আগের" },
        { id: "planned", name: "পরের", status: "planned" },
        { id: "recent", name: "নতুন" },
      ],
      entries: [
        {
          id: "bill",
          kind: "expense",
          createdAt: "2026-11-03T10:00:00Z",
          lines: [{ id: "line", workId: "recent", amount: 50000 }],
        },
        {
          id: "old-bill",
          kind: "expense",
          createdAt: "2026-11-01T10:00:00Z",
          lines: [{ id: "old-line", workId: "old", amount: 90000 }],
        },
      ],
    });
    const before = JSON.stringify(ledger);
    expect(orderedWorks(ledger).map((work) => work.id)).toEqual([
      "recent",
      "old",
      "planned",
      "done",
    ]);
    expect(JSON.stringify(ledger)).toBe(before);
  });

  it("uses recorded cost to order equally recent notebooks without double counting payments", () => {
    const ledger = LedgerSchema.parse({
      works: [
        { id: "small", name: "ছোট" },
        { id: "large", name: "বড়" },
      ],
      entries: [
        {
          id: "small-bill",
          kind: "expense",
          createdAt: "2026-11-01T10:00:00Z",
          lines: [{ id: "a", workId: "small", amount: 10000 }],
        },
        {
          id: "paid",
          kind: "payment",
          createdAt: "2026-11-01T10:00:00Z",
          allocations: [{ workId: "small", amount: 50000 }],
          paymentParts: [{ amount: 50000 }],
        },
        {
          id: "large-bill",
          kind: "expense",
          createdAt: "2026-11-01T10:00:00Z",
          lines: [{ id: "b", workId: "large", amount: 20000 }],
        },
      ],
    });
    expect(orderedWorks(ledger).map((work) => work.id)).toEqual([
      "large",
      "small",
    ]);
  });
});
