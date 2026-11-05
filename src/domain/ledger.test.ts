import { describe, expect, it } from "vitest";
import { createDemoLedger, createEmptyLedger } from "./demo";
import {
  EntrySchema,
  LedgerSchema,
  validateLedger,
  type Entry,
  type Ledger,
} from "./model";
import {
  appendEntries,
  contractSummary,
  entryTotal,
  parseAmount,
  personSummary,
  replaceEntry,
  setEntryVoided,
  summarize,
} from "./ledger";

function base(): Ledger {
  return validateLedger({
    ...createEmptyLedger(),
    works: [
      { id: "tiles", name: "টাইলস" },
      { id: "electric", name: "বিদ্যুৎ" },
    ],
    people: [{ id: "worker", name: "মিস্ত্রি" }],
    items: [{ id: "adhesive", name: "আঠা" }],
  });
}

function cost(
  id: string,
  amount: number,
  account: "materials" | "labour" = "materials",
  workId = "tiles",
  contractId: string | null = null,
): Entry {
  return EntrySchema.parse({
    id,
    kind: "expense",
    personId: "worker",
    account,
    contractId,
    lines: [
      {
        id: `${id}-line`,
        workId,
        itemId: account === "materials" ? "adhesive" : null,
        amount: amount * 100,
        costType: account === "labour" ? "labour" : "material",
      },
    ],
  });
}

function payment(
  id: string,
  amount: number,
  account: "materials" | "labour" = "materials",
  workId = "tiles",
  contractId: string | null = null,
): Entry {
  return EntrySchema.parse({
    id,
    kind: "payment",
    personId: "worker",
    account,
    contractId,
    allocations: [{ workId, amount: amount * 100 }],
    paymentParts: [{ method: "bkash", amount: amount * 100 }],
  });
}

describe("construction ledger", () => {
  it("starts empty without inventing floors or works", () => {
    const ledger = createEmptyLedger();
    expect(ledger.works).toEqual([]);
    expect(ledger.entries).toEqual([]);
    expect(ledger.isDemo).toBe(false);
  });

  it("keeps repeated purchases and wages separate", () => {
    const ledger = createDemoLedger();
    const totals = summarize(ledger, "tiles");
    expect(totals.byItem.find((item) => item.id === "tile")?.amount).toBe(
      72000000,
    );
    expect(totals.byItem.find((item) => item.id === "adhesive")?.amount).toBe(
      2000000,
    );
    expect(totals.byType.labour).toBe(6000000);
    expect(totals.cost).toBe(80900000);
    expect(totals.netPaid).toBe(79400000);
  });

  it("reimbursing 1500 with 1700 creates 200 advance without changing cost", () => {
    const ledger = appendEntries(base(), [
      cost("voucher", 1500),
      payment("reimbursement", 1700),
    ]);
    const summary = personSummary(ledger, "worker");
    expect(summary.cost).toBe(150000);
    expect(summary.netPaid).toBe(170000);
    expect(summary.advance).toBe(20000);
    expect(summary.payable).toBe(0);
  });

  it("settles procurement money with receipts without counting it twice", () => {
    const ledger = appendEntries(base(), [
      payment("entrusted", 30000),
      cost("receipt", 25000),
    ]);
    expect(summarize(ledger).cost).toBe(2500000);
    expect(summarize(ledger).paid).toBe(3000000);
    expect(personSummary(ledger, "worker").advance).toBe(500000);
  });

  it("never offsets material advance against wages", () => {
    const ledger = appendEntries(base(), [
      payment("materials", 30000),
      cost("work", 15000, "labour"),
    ]);
    const summary = personSummary(ledger, "worker");
    expect(summary.advance).toBe(3000000);
    expect(summary.payable).toBe(1500000);
    expect(summary.accounts.materials.advance).toBe(3000000);
    expect(summary.accounts.labour.payable).toBe(1500000);
  });

  it("distinguishes agreed remaining wages from payable earned work", () => {
    const summary = contractSummary(createDemoLedger(), "tiles-contract");
    expect(summary.agreed).toBe(12540000);
    expect(summary.paid).toBe(4500000);
    expect(summary.remaining).toBe(1500000);
    expect(summary.remainingCommitment).toBe(8040000);
    expect(summary.billed).toBe(6000000);
    expect(summary.payable).toBe(1500000);
  });

  it("counts shared transport once and allocates each work correctly", () => {
    const entry = EntrySchema.parse({
      id: "shared",
      kind: "expense",
      account: "materials",
      lines: [
        { id: "a", workId: "tiles", amount: 400000, costType: "transport" },
        { id: "b", workId: "electric", amount: 200000, costType: "transport" },
      ],
    });
    const paid = EntrySchema.parse({
      id: "paid",
      kind: "payment",
      account: "materials",
      relatedEntryId: "shared",
      allocations: [
        { workId: "tiles", amount: 400000 },
        { workId: "electric", amount: 200000 },
      ],
      paymentParts: [{ method: "cash", amount: 600000 }],
    });
    const ledger = appendEntries(base(), [entry, paid]);
    expect(summarize(ledger).cost).toBe(600000);
    expect(summarize(ledger, "tiles").cost).toBe(400000);
    expect(summarize(ledger, "electric").paid).toBe(200000);
    expect(summarize(ledger).payable).toBe(0);
  });

  it("handles material return and cash refund as separate events", () => {
    const bought = cost("purchase", 1500);
    const paid = payment("paid", 1500);
    const returned = {
      ...cost("return", 500),
      kind: "expense_credit" as const,
    };
    const refund = { ...payment("cash-back", 500), kind: "refund" as const };
    const ledger = appendEntries(base(), [bought, paid, returned, refund]);
    expect(summarize(ledger).cost).toBe(100000);
    expect(summarize(ledger).netPaid).toBe(100000);
    expect(personSummary(ledger, "worker").balance).toBe(0);
  });

  it("void and restore preserve historical entries", () => {
    const ledger = appendEntries(base(), [cost("a", 1200)]);
    const removed = setEntryVoided(ledger, "a", true);
    expect(summarize(removed).cost).toBe(0);
    expect(removed.entries).toHaveLength(1);
    expect(removed.entries[0].revisions[0].before.voided).toBe(false);
    const restored = setEntryVoided(removed, "a", false);
    expect(summarize(restored).cost).toBe(120000);
    expect(restored.entries[0].revisions).toHaveLength(2);
  });

  it("validates corrupt backup relationships, duplicate ids and unsafe amounts", () => {
    const valid = appendEntries(base(), [cost("a", 10)]);
    expect(
      LedgerSchema.safeParse({
        ...valid,
        entries: [...valid.entries, valid.entries[0]],
      }).success,
    ).toBe(false);
    expect(LedgerSchema.safeParse({ ...valid, works: [] }).success).toBe(false);
    expect(LedgerSchema.safeParse({ ...valid, people: [] }).success).toBe(
      false,
    );
    expect(LedgerSchema.safeParse({ ...valid, items: [] }).success).toBe(false);
    expect(
      LedgerSchema.safeParse({
        ...valid,
        entries: [
          {
            ...valid.entries[0],
            lines: [{ ...valid.entries[0].lines[0], amount: 1.1 }],
          },
        ],
      }).success,
    ).toBe(false);
    const mismatched = {
      ...payment("a", 1200),
      allocations: [{ workId: "tiles", amount: 110000 }],
    };
    expect(
      LedgerSchema.safeParse({ ...base(), entries: [mismatched] }).success,
    ).toBe(false);
  });

  it("parses Bengali money precisely and rejects more than two decimal places", () => {
    expect(parseAmount("১,৫০০.২৫")).toBe(150025);
    expect(parseAmount("0.10")).toBe(10);
    expect(() => parseAmount("1.001")).toThrow();
    expect(() => parseAmount("-100")).toThrow();
    expect(() => parseAmount("1e5")).toThrow();
  });

  it("rejects impossible calendar dates and ledger sum overflow", () => {
    expect(
      LedgerSchema.safeParse({
        ...base(),
        entries: [{ ...cost("bad-date", 10), date: "2026-02-31" }],
      }).success,
    ).toBe(false);
    const a = {
      ...cost("a", 10),
      lines: [{ ...cost("a", 10).lines[0], amount: Number.MAX_SAFE_INTEGER }],
    };
    const b = {
      ...cost("b", 10),
      lines: [{ ...cost("b", 10).lines[0], amount: 1 }],
    };
    expect(LedgerSchema.safeParse({ ...base(), entries: [a, b] }).success).toBe(
      false,
    );
  });

  it("payment methods and work allocations must agree", () => {
    const entry = EntrySchema.parse({
      id: "split",
      kind: "payment",
      account: "materials",
      allocations: [{ workId: "tiles", amount: 1000000 }],
      paymentParts: [
        { method: "cash", amount: 700000 },
        { method: "bkash", amount: 300000 },
      ],
    });
    expect(entryTotal(entry)).toBe(1000000);
    expect(
      validateLedger({ ...base(), entries: [entry] }).entries,
    ).toHaveLength(1);
  });

  it("does not settle unrelated unnamed shops against each other", () => {
    const invoice = { ...cost("invoice-a", 1500), personId: null };
    const unrelatedPayment = { ...payment("payment-b", 1500), personId: null };
    const unrelated = appendEntries(base(), [invoice, unrelatedPayment]);
    expect(summarize(unrelated).payable).toBe(150000);
    expect(summarize(unrelated).advance).toBe(150000);
    const linked = appendEntries(base(), [
      invoice,
      { ...unrelatedPayment, relatedEntryId: invoice.id },
    ]);
    expect(summarize(linked).payable).toBe(0);
    expect(summarize(linked).advance).toBe(0);
  });

  it("does not offset an unlinked wage payment against a separate contract", () => {
    const ledger = validateLedger({
      ...base(),
      contracts: [
        {
          id: "agreement",
          workId: "tiles",
          personId: "worker",
          total: 1000000,
        },
      ],
    });
    const rows = appendEntries(ledger, [
      cost("earned", 2000, "labour", "tiles", "agreement"),
      payment("other-wages", 2000, "labour"),
    ]);
    expect(summarize(rows).payable).toBe(200000);
    expect(summarize(rows).advance).toBe(200000);
    expect(contractSummary(rows, "agreement").paid).toBe(0);
  });

  it("keeps non-recursive before snapshots and blocks linked payment identity changes", () => {
    const invoice = cost("bill", 1500);
    const linkedPayment = {
      ...payment("paid", 1700),
      relatedEntryId: invoice.id,
    };
    const ledger = appendEntries(base(), [invoice, linkedPayment]);
    const edited = replaceEntry(ledger, {
      ...invoice,
      note: "সঠিক ভাউচার",
      lines: [{ ...invoice.lines[0], amount: 160000 }],
    });
    expect(edited.entries[0].revisions[0].before.lines[0].amount).toBe(150000);
    expect("revisions" in edited.entries[0].revisions[0].before).toBe(false);
    expect(personSummary(edited, "worker").advance).toBe(10000);
    expect(() => replaceEntry(ledger, { ...invoice, personId: null })).toThrow(
      "Linked payment",
    );
    expect(() =>
      replaceEntry(ledger, {
        ...invoice,
        lines: [{ ...invoice.lines[0], workId: "electric" }],
      }),
    ).toThrow("Linked payment");
  });
});
