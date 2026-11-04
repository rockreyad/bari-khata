import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildQuickEntry,
  QuickDraftSchema,
} from "../features/entries/quickEntry";
import {
  EntryCoreSchema,
  LedgerSchema,
  type Entry,
  type Ledger,
} from "./model";
import {
  entryTotal,
  personSummary,
  replaceEntry,
  replaceExpenseAndSettlements,
} from "./ledger";
import {
  fullyPaidPurchasePayment,
  paidPurchasePayment,
  replacePaidPurchase,
} from "./paidPurchaseEdit";

const createdAt = "2026-11-04T01:00:00.000Z";
function fixture(payment: "full" | "partial" = "full", anonymous = false) {
  const base = LedgerSchema.parse({
    works: [
      { id: "roof", name: "নমুনা ছাদ" },
      { id: "floor", name: "নমুনা মেঝে" },
    ],
    people: [
      { id: "shop", name: "নমুনা দোকান", kind: "shop" },
      { id: "another", name: "অন্য নমুনা দোকান", kind: "shop" },
    ],
  });
  const next = buildQuickEntry(
    base,
    QuickDraftSchema.parse({
      id: "bill",
      paymentId: "paid",
      refundId: "refund",
      workId: "roof",
      personId: anonymous ? "" : "shop",
      kind: "expense",
      date: "2026-11-04",
      note: "নমুনা কেনাকাটা",
      payment,
      paid: "400",
      method: "bank",
      rows: [{ id: "line", label: "নমুনা মাল", amount: "1000" }],
    }),
  );
  return LedgerSchema.parse({
    ...next,
    entries: next.entries.map((entry) => ({
      ...entry,
      createdAt,
      updatedAt: createdAt,
    })),
  });
}
const bill = (ledger: Ledger) =>
  ledger.entries.find((entry) => entry.id === "bill")!;
const paid = (ledger: Ledger) =>
  ledger.entries.find((entry) => entry.id === "paid")!;
const price = (ledger: Ledger, amount: number): Entry => ({
  ...bill(ledger),
  lines: bill(ledger).lines.map((line) => ({ ...line, amount })),
});
const totals = (ledger: Ledger) => {
  const summary = personSummary(ledger, "shop");
  return {
    cost: summary.cost,
    paid: summary.netPaid,
    due: summary.payable,
    credit: summary.advance,
  };
};
afterEach(() => vi.useRealTimers());

describe("automatic correction of a fully paid purchase", () => {
  it("keeps a genuinely full co-created purchase eligible through repeated corrections", () => {
    const original = fixture();
    expect(fullyPaidPurchasePayment(original, "bill")).toEqual(paid(original));
    const first = replacePaidPurchase(
      original,
      price(original, 120000),
      fullyPaidPurchasePayment(original, "bill")!,
    );
    expect(fullyPaidPurchasePayment(first, "bill")).toEqual(paid(first));
    const second = replacePaidPurchase(
      first,
      price(first, 30000),
      fullyPaidPurchasePayment(first, "bill")!,
    );
    expect(fullyPaidPurchasePayment(second, "bill")).toEqual(paid(second));
    expect(totals(second)).toEqual({
      cost: 30000,
      paid: 30000,
      due: 0,
      credit: 0,
    });
  });

  it("does not turn an originally partial purchase into an automatic pair when a bill-only edit happens to equal its cash", () => {
    const original = fixture("partial");
    expect(fullyPaidPurchasePayment(original, "bill")).toBeNull();
    const equal = replaceExpenseAndSettlements(
      original,
      price(original, 40000),
    );
    expect(entryTotal(bill(equal))).toBe(entryTotal(paid(equal)));
    expect(paidPurchasePayment(equal, "bill")).toEqual(paid(equal));
    expect(fullyPaidPurchasePayment(equal, "bill")).toBeNull();
    const next = replaceExpenseAndSettlements(equal, price(equal, 30000));
    expect(paid(next)).toEqual(paid(original));
    expect(totals(next)).toEqual({
      cost: 30000,
      paid: 40000,
      due: 0,
      credit: 10000,
    });
    expect(fullyPaidPurchasePayment(next, "bill")).toBeNull();
  });

  it("does not automatically correct a currently mismatched pair, while retaining the explicit repair candidate", () => {
    const original = fixture();
    const changed = replaceExpenseAndSettlements(
      original,
      price(original, 10000),
    );
    expect(fullyPaidPurchasePayment(changed, "bill")).toBeNull();
    expect(paidPurchasePayment(changed, "bill")).toEqual(paid(changed));
    const repaired = replacePaidPurchase(changed, bill(changed), paid(changed));
    expect(fullyPaidPurchasePayment(repaired, "bill")).toEqual(paid(repaired));
  });

  it("keeps automatic amount correction after a bill date-only edit without changing the actual cash date", () => {
    const original = fixture();
    const changed = replacePaidPurchase(
      original,
      { ...bill(original), date: "2026-11-03" },
      paid(original),
    );
    expect(paid(changed)).toEqual(paid(original));
    expect(bill(changed).date).toBe("2026-11-03");
    expect(fullyPaidPurchasePayment(changed, "bill")).toEqual(paid(changed));
    const corrected = replacePaidPurchase(
      changed,
      price(changed, 10000),
      fullyPaidPurchasePayment(changed, "bill")!,
    );
    expect(paid(corrected).date).toBe(paid(original).date);
    expect(bill(corrected).date).toBe("2026-11-03");
    expect(totals(corrected)).toEqual({
      cost: 10000,
      paid: 10000,
      due: 0,
      credit: 0,
    });
    expect(fullyPaidPurchasePayment(corrected, "bill")).toEqual(
      paid(corrected),
    );
  });

  it("does not automatically pair an independently corrected cash date", () => {
    const original = fixture();
    const changed = replaceEntry(original, {
      ...paid(original),
      date: "2026-11-03",
    });
    expect(paidPurchasePayment(changed, "bill")).toBeNull();
    expect(fullyPaidPurchasePayment(changed, "bill")).toBeNull();
    expect(() =>
      replacePaidPurchase(changed, price(changed, 10000), paid(changed)),
    ).toThrow("paid_purchase_not_eligible");
  });
});

describe("explicit correction of a co-created paid purchase", () => {
  it.each([10000, 120000])(
    "corrects the original bill and payment together to %i without another financial event",
    (amount) => {
      const original = fixture();
      const before = structuredClone(original);
      expect(paidPurchasePayment(original, "bill")).toEqual(paid(original));
      const next = replacePaidPurchase(
        original,
        price(original, amount),
        paid(original),
      );
      expect(totals(next)).toEqual({
        cost: amount,
        paid: amount,
        due: 0,
        credit: 0,
      });
      expect(next.entries.map((entry) => entry.id)).toEqual(["bill", "paid"]);
      for (const entry of next.entries) {
        expect(entry.revisions).toHaveLength(1);
        expect(entry.revisions[0].before).toEqual(
          EntryCoreSchema.parse(
            original.entries.find((old) => old.id === entry.id),
          ),
        );
      }
      expect(bill(next).revisions[0].at).toBe(paid(next).revisions[0].at);
      expect(paid(next).paymentParts).toEqual([{ method: "bank", amount }]);
      expect(paidPurchasePayment(next, "bill")).toEqual(paid(next));
      expect(original).toEqual(before);
    },
  );

  it("remains eligible for repeated corrections even when both saves share the clock millisecond", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-04T02:00:00Z"));
    const original = fixture();
    const first = replacePaidPurchase(
      original,
      price(original, 120000),
      paid(original),
    );
    const second = replacePaidPurchase(first, price(first, 50000), paid(first));
    expect(totals(second)).toEqual({
      cost: 50000,
      paid: 50000,
      due: 0,
      credit: 0,
    });
    expect(bill(second).revisions).toHaveLength(2);
    expect(paid(second).revisions).toHaveLength(2);
    expect(
      paid(second).revisions.map(
        (revision) => revision.before.paymentParts[0].amount,
      ),
    ).toEqual([100000, 120000]);
    expect(paidPurchasePayment(second, "bill")).toEqual(paid(second));
  });

  it("combines a missing-shop assignment, work move and amount correction in one audit per record", () => {
    const original = fixture("full", true);
    const next = replacePaidPurchase(
      original,
      {
        ...price(original, 50000),
        personId: "shop",
        lines: price(original, 50000).lines.map((line) => ({
          ...line,
          workId: "floor",
        })),
      },
      paid(original),
    );
    expect(totals(next)).toEqual({
      cost: 50000,
      paid: 50000,
      due: 0,
      credit: 0,
    });
    expect(paid(next).allocations).toEqual([
      { workId: "floor", amount: 50000 },
    ]);
    for (const entry of next.entries) {
      expect(entry.personId).toBe("shop");
      expect(entry.revisions).toHaveLength(1);
      expect(entry.revisions[0].before.personId).toBeNull();
    }
    expect(bill(next).revisions[0].at).toBe(paid(next).revisions[0].at);
    expect(paidPurchasePayment(next, "bill")).toEqual(paid(next));
  });

  it("preserves cash dates, method, note, receipts, source and provenance", () => {
    const initial = fixture();
    const original = LedgerSchema.parse({
      ...initial,
      entries: initial.entries.map((entry) =>
        entry.id !== "paid"
          ? entry
          : {
              ...entry,
              note: "নমুনা ব্যাংকের তথ্য",
              receipts: [
                {
                  id: "receipt",
                  name: "sample.jpg",
                  mime: "image/jpeg",
                  size: 1,
                },
              ],
              source: { file: "sample.tsv", cell: "B2", checksum: "sample" },
              provenance: {
                version: 1,
                origin: "text",
                connectionId: "sample-connection",
                actorName: "নমুনা",
                recordedAt: createdAt,
              },
            },
      ),
    });
    const replacement = { ...price(original, 50000), date: "2026-11-03" };
    const next = replacePaidPurchase(original, replacement, paid(original));
    expect(bill(next).date).toBe("2026-11-03");
    for (const key of [
      "id",
      "date",
      "createdAt",
      "note",
      "receipts",
      "source",
      "provenance",
      "relatedEntryId",
    ] as const)
      expect(paid(next)[key]).toEqual(paid(original)[key]);
    expect(paid(next).paymentParts[0].method).toBe("bank");
  });

  it("does not revise or retimestamp cash for a bill note-only or unchanged save", () => {
    const original = fixture();
    const next = replacePaidPurchase(
      original,
      { ...bill(original), note: "নমুনা নতুন বিবরণ" },
      paid(original),
    );
    expect(bill(next).revisions).toHaveLength(1);
    expect(paid(next)).toEqual(paid(original));
    expect(paidPurchasePayment(next, "bill")).toEqual(paid(next));
    expect(
      replacePaidPurchase(original, bill(original), paid(original)),
    ).toEqual(original);
  });

  it("repairs an already edited bill only after this explicit combined API is called", () => {
    const original = fixture();
    const bad = replaceExpenseAndSettlements(original, price(original, 10000));
    expect(totals(bad)).toEqual({
      cost: 10000,
      paid: 100000,
      due: 0,
      credit: 90000,
    });
    expect(paidPurchasePayment(bad, "bill")).toEqual(paid(bad));
    const repaired = replacePaidPurchase(bad, bill(bad), paid(bad));
    expect(totals(repaired)).toEqual({
      cost: 10000,
      paid: 10000,
      due: 0,
      credit: 0,
    });
    expect(bill(repaired).revisions).toHaveLength(2);
    expect(paid(repaired).revisions).toHaveLength(1);
    expect(paidPurchasePayment(repaired, "bill")).toEqual(paid(repaired));
  });

  it("does not change partial cash through ordinary bill edits or candidate lookup", () => {
    const original = fixture("partial");
    const before = structuredClone(original);
    expect(paidPurchasePayment(original, "bill")).toEqual(paid(original));
    expect(entryTotal(bill(original))).not.toBe(entryTotal(paid(original)));
    const next = replaceExpenseAndSettlements(original, price(original, 50000));
    expect(paid(next)).toEqual(paid(original));
    expect(totals(next)).toEqual({
      cost: 50000,
      paid: 40000,
      due: 10000,
      credit: 0,
    });
    expect(original).toEqual(before);
  });

  it("rejects stale complete payment snapshots even if the id and updatedAt still match", () => {
    const original = fixture();
    const changed = LedgerSchema.parse({
      ...original,
      entries: original.entries.map((entry) =>
        entry.id === "paid" ? { ...entry, note: "আলাদা নতুন তথ্য" } : entry,
      ),
    });
    const before = structuredClone(changed);
    expect(() =>
      replacePaidPurchase(changed, price(changed, 50000), paid(original)),
    ).toThrow("paid_purchase_payment_stale");
    expect(changed).toEqual(before);
  });

  it.each(["note", "method", "amount"])(
    "rejects an independent cash %s revision",
    (change) => {
      const original = fixture();
      const payment = paid(original);
      const replacement =
        change === "note"
          ? { ...payment, note: "আলাদা তথ্য" }
          : change === "method"
            ? {
                ...payment,
                paymentParts: [{ method: "cash" as const, amount: 100000 }],
              }
            : {
                ...payment,
                allocations: [{ workId: "roof", amount: 90000 }],
                paymentParts: [{ method: "bank" as const, amount: 90000 }],
              };
      const changed = replaceEntry(original, replacement);
      expect(paidPurchasePayment(changed, "bill")).toBeNull();
      expect(() =>
        replacePaidPurchase(changed, price(changed, 50000), paid(changed)),
      ).toThrow("paid_purchase_not_eligible");
    },
  );

  it("does not mistake equal audit timestamps for a coupled cash metadata change", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-04T02:00:00Z"));
    const original = fixture();
    const billOnly = replaceExpenseAndSettlements(original, {
      ...bill(original),
      note: "বিলের নতুন তথ্য",
    });
    const independent = replaceEntry(billOnly, {
      ...paid(billOnly),
      note: "আলাদা টাকা দেওয়ার তথ্য",
    });
    expect(bill(independent).revisions[0].at).toBe(
      paid(independent).revisions[0].at,
    );
    expect(paidPurchasePayment(independent, "bill")).toBeNull();
  });

  it.each(["date", "createdAt", "missing-date", "missing-createdAt"])(
    "does not infer a co-created pair with %s differing or missing",
    (field) => {
      const original = fixture();
      const changed = LedgerSchema.parse({
        ...original,
        entries: original.entries.map((entry) =>
          entry.id !== "paid"
            ? entry
            : {
                ...entry,
                ...(field === "date"
                  ? { date: "2026-11-05" }
                  : field === "createdAt"
                    ? { createdAt: "2026-11-04T01:00:00.001Z" }
                    : field === "missing-date"
                      ? { date: null }
                      : { createdAt: "" }),
              },
        ),
      });
      expect(paidPurchasePayment(changed, "bill")).toBeNull();
    },
  );

  it.each(["payment", "refund", "expense_credit", "voided-payment"])(
    "rejects any additional linked %s without editing it",
    (kind) => {
      const original = fixture();
      const extra =
        kind === "expense_credit"
          ? {
              ...bill(original),
              id: "extra",
              kind: "expense_credit",
              relatedEntryId: "bill",
            }
          : {
              ...paid(original),
              id: "extra",
              kind: kind === "refund" ? "refund" : "payment",
              voided: kind === "voided-payment",
            };
      const changed = LedgerSchema.parse({
        ...original,
        entries: [...original.entries, extra],
      });
      const before = structuredClone(changed);
      expect(paidPurchasePayment(changed, "bill")).toBeNull();
      expect(() =>
        replacePaidPurchase(changed, price(changed, 50000), paid(changed)),
      ).toThrow("paid_purchase_not_eligible");
      expect(changed).toEqual(before);
    },
  );

  it("rejects multiple payment methods and multiple work allocations", () => {
    const original = fixture();
    const methods = LedgerSchema.parse({
      ...original,
      entries: original.entries.map((entry) =>
        entry.id !== "paid"
          ? entry
          : {
              ...entry,
              paymentParts: [
                { method: "bank", amount: 60000 },
                { method: "cash", amount: 40000 },
              ],
            },
      ),
    });
    expect(paidPurchasePayment(methods, "bill")).toBeNull();
    const works = LedgerSchema.parse({
      ...original,
      entries: original.entries.map((entry) =>
        entry.id === "paid"
          ? {
              ...entry,
              allocations: [
                { workId: "roof", amount: 60000 },
                { workId: "floor", amount: 40000 },
              ],
            }
          : {
              ...entry,
              lines: [
                { ...entry.lines[0], amount: 60000 },
                {
                  ...entry.lines[0],
                  id: "second-line",
                  workId: "floor",
                  amount: 40000,
                },
              ],
            },
      ),
    });
    expect(paidPurchasePayment(works, "bill")).toBeNull();
  });

  it.each(["historical", "voided"])("rejects %s bill or cash", (state) => {
    const original = fixture();
    for (const id of ["bill", "paid"]) {
      const changed = LedgerSchema.parse({
        ...original,
        entries: original.entries.map((entry) =>
          entry.id !== id
            ? entry
            : {
                ...entry,
                ...(state === "historical"
                  ? { balanceImpact: "historical" }
                  : { voided: true }),
              },
        ),
      });
      expect(paidPurchasePayment(changed, "bill")).toBeNull();
    }
  });

  it("keeps existing identity guards and rejects invalid or overflowing totals without mutation", () => {
    const original = fixture();
    const before = structuredClone(original);
    expect(() =>
      replacePaidPurchase(
        original,
        { ...bill(original), personId: "another" },
        paid(original),
      ),
    ).toThrow("Linked payment");
    for (const amount of [0, -1, Number.MAX_SAFE_INTEGER])
      expect(() =>
        replacePaidPurchase(original, price(original, amount), paid(original)),
      ).toThrow();
    expect(original).toEqual(before);
  });
});
