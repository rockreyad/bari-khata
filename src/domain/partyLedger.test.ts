import { describe, expect, it } from "vitest";
import {
  EntrySchema,
  LedgerSchema,
  type Account,
  type Entry,
  type Ledger,
} from "./model";
import {
  allocatePayment,
  cancelPaymentAllocation,
  partyLedger,
  preservesPaymentAllocationHistory,
} from "./partyLedger";
import {
  appendEntries,
  replaceEntry,
  setEntryVoided,
  summarize,
  personSummary,
  contractSummary,
} from "./ledger";
import { savePersonWithContract } from "./personContract";
import {
  buildQuickEntry,
  QuickDraftSchema,
} from "../features/entries/quickEntry";
import { contactStatement } from "../features/people/statement";

function base(): Ledger {
  return LedgerSchema.parse({
    architectureVersion: 2,
    paymentAllocations: [],
    works: [
      { id: "structure", name: "নমুনা কাঠামোর কাজ" },
      { id: "paint", name: "নমুনা রঙের কাজ" },
    ],
    people: [
      {
        id: "party",
        name: "নমুনা ব্যক্তি",
        kind: "worker",
        contactType: "craftsperson",
        roles: ["craftsperson", "supplier"],
        identityType: "person",
      },
      {
        id: "other",
        name: "নমুনা দোকান",
        kind: "shop",
        contactType: "supplier",
        roles: ["supplier"],
        identityType: "organization",
      },
    ],
  });
}
function bill(
  id: string,
  amount: number,
  options: {
    account?: Account;
    workId?: string;
    contractId?: string;
    personId?: string;
  } = {},
): Entry {
  const account = options.account ?? "materials";
  return EntrySchema.parse({
    id,
    kind: "expense",
    personId: options.personId ?? "party",
    account,
    contractId: options.contractId ?? null,
    date: "2026-11-01",
    note: `নমুনা ${id}`,
    lines: [
      {
        id: `${id}-line`,
        workId: options.workId ?? "structure",
        amount,
        costType:
          account === "labour"
            ? "labour"
            : account === "other"
              ? "transport"
              : "material",
      },
    ],
  });
}
function cash(
  id: string,
  amount: number,
  options: {
    account?: Account;
    workId?: string;
    contractId?: string;
    context?: Entry["paymentContext"];
    kind?: "payment" | "refund";
    personId?: string;
  } = {},
): Entry {
  return EntrySchema.parse({
    id,
    kind: options.kind ?? "payment",
    personId: options.personId ?? "party",
    account: options.account ?? "materials",
    contractId: options.contractId ?? null,
    paymentContext: options.context,
    date: "2026-11-02",
    note: `নমুনা ${id}`,
    paymentParts: [{ amount, method: "cash" }],
    allocations: [{ workId: options.workId ?? "structure", amount }],
  });
}

describe("party identity and explicit bill settlement", () => {
  it("keeps a craftsperson's work charge and two partial payments distinct from expense", () => {
    let ledger = appendEntries(base(), [
      bill("work", 10000, { account: "labour" }),
      cash("first", 3000, { account: "labour" }),
      cash("later", 7000, { account: "labour" }),
    ]);
    const before = ledger.entries;
    ledger = allocatePayment(ledger, "first", [
      { billId: "work", amount: 3000 },
    ]);
    expect(partyLedger(ledger, "party").bills[0].outstanding).toBe(7000);
    ledger = allocatePayment(ledger, "later", [
      { billId: "work", amount: 7000 },
    ]);
    expect(partyLedger(ledger, "party")).toMatchObject({
      billOutstanding: 0,
      allocated: 10000,
      unallocatedCash: 0,
    });
    expect(ledger.entries).toEqual(before);
    expect(summarize(ledger)).toMatchObject({ cost: 10000, paid: 10000 });
  });
  it("allocates one combined supplier payment to multiple purchases and is idempotent", () => {
    const ledger = appendEntries(base(), [
      bill("cement", 6000),
      bill("steel", 9000),
      cash("combined", 10000),
    ]);
    const requested = [
      { billId: "cement", amount: 6000 },
      { billId: "steel", amount: 4000 },
    ];
    const settled = allocatePayment(ledger, "combined", requested);
    expect(partyLedger(settled, "party")).toMatchObject({
      billOutstanding: 5000,
      allocated: 10000,
      unallocatedCash: 0,
      payable: 5000,
    });
    expect(allocatePayment(settled, settled.paymentAllocations!)).toEqual(
      settled,
    );
    expect(() =>
      allocatePayment(settled, [
        { ...settled.paymentAllocations![0], amount: 5000 },
      ]),
    ).toThrow("conflict");
    expect(() => allocatePayment(settled, "combined", requested)).toThrow(
      "exceeds",
    );
  });
  it("records an advance without expense and explicitly applies it to a later purchase", () => {
    let ledger = appendEntries(base(), [
      cash("advance", 10000, { context: "advance" }),
    ]);
    expect(summarize(ledger).cost).toBe(0);
    expect(partyLedger(ledger, "party")).toMatchObject({
      advance: 10000,
      receivable: 0,
    });
    ledger = appendEntries(ledger, [bill("purchase", 7000)]);
    ledger = allocatePayment(ledger, "advance", [
      { billId: "purchase", amount: 7000 },
    ]);
    expect(partyLedger(ledger, "party")).toMatchObject({
      billOutstanding: 0,
      advance: 3000,
      unallocatedCash: 3000,
    });
    expect(summarize(ledger)).toMatchObject({ cost: 7000, paid: 10000 });
  });
  it("preserves financial identity when a party has multiple roles or clears their roles", () => {
    const ledger = appendEntries(base(), [
      bill("material", 2500),
      bill("labour", 5000, { account: "labour" }),
    ]);
    const entries = ledger.entries;
    const edited = savePersonWithContract(ledger, {
      ...ledger.people[0],
      roles: [],
      role: "নমুনা নতুন পরিচয়",
      kind: "other",
      contactType: "custom",
    });
    expect(
      edited.people.find((person) => person.id === "party")?.roles,
    ).toEqual([]);
    expect(edited.entries).toEqual(entries);
    expect(partyLedger(edited, "party").payable).toBe(
      partyLedger(ledger, "party").payable,
    );
    expect(
      LedgerSchema.safeParse({
        ...ledger,
        people: [{ ...ledger.people[0], roles: ["supplier", "supplier"] }],
      }).success,
    ).toBe(false);
  });
  it("keeps agreement bills and payments separate without extra work metadata", () => {
    const ledger = LedgerSchema.parse({
      ...base(),
      contracts: [
        {
          id: "agreement",
          personId: "party",
          workId: "structure",
          total: 20000,
        },
      ],
    });
    expect(summarize(ledger).cost).toBe(0);
    const billed = appendEntries(ledger, [
      bill("earned", 8000, { account: "labour", contractId: "agreement" }),
      cash("part", 3000, { account: "labour", contractId: "agreement" }),
    ]);
    const settled = allocatePayment(billed, "part", [
      { billId: "earned", amount: 3000 },
    ]);
    expect(partyLedger(settled, "party").bills[0]).toMatchObject({
      outstanding: 5000,
      allocated: 3000,
    });
    expect(summarize(settled).cost).toBe(8000);
  });
  it("accepts a driver's delivery charge without any agreement and separates sector from category", () => {
    const ledger = appendEntries(base(), [
      bill("delivery", 800, { account: "other" }),
      bill("paint", 2200, { workId: "paint" }),
    ]);
    expect(ledger.contracts).toEqual([]);
    expect(summarize(ledger, "structure")).toMatchObject({
      cost: 800,
      byType: { transport: 800, material: 0 },
    });
    expect(summarize(ledger, "paint")).toMatchObject({
      cost: 2200,
      byType: { material: 2200, transport: 0 },
    });
  });
  it("keeps recoverable deposits and bills separate even for the same party and account", () => {
    const ledger = appendEntries(base(), [
      bill("purchase", 10000),
      cash("deposit", 3000, { context: "receivable" }),
    ]);
    expect(partyLedger(ledger, "party")).toMatchObject({
      payable: 10000,
      receivable: 3000,
      advance: 0,
    });
    const beforeStatement = contactStatement(ledger, ledger.people[0], {
      account: "materials",
    });
    expect(
      beforeStatement.rows.find((row) => row.kind === "payment"),
    ).toMatchObject({ paid: 3000, balance: 10000 });
    const partiallyRecovered = appendEntries(ledger, [
      cash("deposit-return", 1000, { kind: "refund", context: "receivable" }),
    ]);
    expect(partyLedger(partiallyRecovered, "party")).toMatchObject({
      payable: 10000,
      receivable: 2000,
    });
    const applied = allocatePayment(partiallyRecovered, "deposit", [
      { billId: "purchase", amount: 1500 },
    ]);
    expect(partyLedger(applied, "party")).toMatchObject({
      payable: 8500,
      receivable: 500,
    });
    expect(summarize(applied)).toMatchObject({
      cost: 10000,
      paid: 3000,
      refunds: 1000,
      payable: 8500,
      reconciledPayable: 8500,
    });
    expect(personSummary(applied, "party")).toMatchObject({
      payable: 8500,
      netPaid: 2000,
    });
    const appliedStatement = contactStatement(applied, applied.people[0], {
      account: "materials",
    });
    expect(appliedStatement.rows.at(-1)?.balance).toBe(8500);
    const topped = allocatePayment(applied, "deposit", [
      { billId: "purchase", amount: 500 },
    ]);
    expect(partyLedger(topped, "party")).toMatchObject({
      payable: 8000,
      receivable: 0,
    });
  });
  it("keeps recoverable contract deposits out of earned and agreed settlement", () => {
    const ledger = LedgerSchema.parse({
      ...base(),
      contracts: [
        {
          id: "agreement",
          personId: "party",
          workId: "structure",
          total: 10000,
        },
      ],
    });
    const records = appendEntries(ledger, [
      bill("earned", 7000, { account: "labour", contractId: "agreement" }),
      cash("deposit", 4000, {
        account: "labour",
        contractId: "agreement",
        context: "receivable",
      }),
    ]);
    expect(contractSummary(records, "agreement")).toMatchObject({
      remaining: 7000,
      remainingCommitment: 10000,
      payable: 7000,
      paid: 4000,
      advance: 0,
    });
    const applied = allocatePayment(records, "deposit", [
      { billId: "earned", amount: 2000 },
    ]);
    expect(contractSummary(applied, "agreement")).toMatchObject({
      remaining: 5000,
      remainingCommitment: 8000,
      payable: 5000,
      paid: 4000,
      advance: 0,
    });
    expect(partyLedger(applied, "party")).toMatchObject({
      payable: 5000,
      receivable: 2000,
    });
  });
  it("preserves legacy cash classification without inventing exact historical bill allocations", () => {
    const ledger = appendEntries(base(), [
      bill("old", 4000),
      { ...cash("old-cash", 6000), relatedEntryId: "old" },
    ]);
    const summary = partyLedger(ledger, "party");
    expect(summary).toMatchObject({
      legacyUnclassifiedCredit: 6000,
      advance: 0,
      receivable: 0,
      allocated: 0,
      payable: 0,
    });
    expect(summary.bills[0].outstanding).toBe(4000);
    expect(ledger.paymentAllocations).toEqual([]);
  });
  it("supports an anonymous fully paid purchase without classifying it as an advance", () => {
    const ledger = buildQuickEntry(
      base(),
      QuickDraftSchema.parse({
        id: "anonymous",
        paymentId: "anonymous-paid",
        workId: "structure",
        date: "2026-11-02",
        rows: [{ id: "anonymous-line", label: "নমুনা মাল", amount: "50" }],
        payment: "full",
      }),
    );
    expect(summarize(ledger)).toMatchObject({
      cost: 5000,
      paid: 5000,
      payable: 0,
      advance: 0,
    });
    expect(
      ledger.entries.find((entry) => entry.kind === "payment")?.paymentContext,
    ).toBe("settlement");
  });
});

describe("allocation financial validation", () => {
  it("caps allocations against the bill, payment, credits, and refunded cash", () => {
    const ledger = appendEntries(base(), [
      bill("purchase", 10000),
      cash("paid", 12000),
      {
        ...bill("return", 2000),
        kind: "expense_credit",
        relatedEntryId: "purchase",
      },
      cash("returned", 5000, { kind: "refund" }),
    ]);
    expect(() =>
      allocatePayment(ledger, "paid", [{ billId: "purchase", amount: 8000 }]),
    ).toThrow("Refunded cash");
    expect(() =>
      allocatePayment(ledger, "paid", [{ billId: "purchase", amount: 9000 }]),
    ).toThrow("exceeds");
    const settled = allocatePayment(ledger, "paid", [
      { billId: "purchase", amount: 7000 },
    ]);
    expect(partyLedger(settled, "party")).toMatchObject({
      billOutstanding: 1000,
      unallocatedCash: 0,
    });
    expect(
      setEntryVoided(settled, "paid", true).paymentAllocations![0].cancelledAt,
    ).toBeTruthy();
    expect(
      setEntryVoided(settled, "purchase", true).paymentAllocations![0]
        .cancelledAt,
    ).toBeTruthy();
    expect(() =>
      replaceEntry(settled, {
        ...settled.entries[0],
        lines: [{ ...settled.entries[0].lines[0], amount: 6000 }],
      }),
    ).toThrow();
  });
  it("rejects unrelated parties, accounts, agreements and historical or unreviewed events", () => {
    const ledger = appendEntries(base(), [
      bill("purchase", 10000),
      cash("paid", 10000),
      cash("other-person", 10000, { personId: "other" }),
      cash("other-account", 10000, { account: "other" }),
    ]);
    for (const id of ["other-person", "other-account", "missing"])
      expect(() =>
        allocatePayment(ledger, id, [{ billId: "purchase", amount: 1000 }]),
      ).toThrow();
    for (const changes of [
      { voided: true },
      { balanceImpact: "historical" },
      { reviewStatus: "needs_review" },
    ]) {
      const changed = LedgerSchema.parse({
        ...ledger,
        entries: ledger.entries.map((entry) =>
          entry.id === "purchase" ? { ...entry, ...changes } : entry,
        ),
      });
      expect(() =>
        allocatePayment(changed, "paid", [
          { billId: "purchase", amount: 1000 },
        ]),
      ).toThrow();
    }
    const agreement = LedgerSchema.parse({
      ...base(),
      contracts: [
        {
          id: "agreement",
          personId: "party",
          workId: "structure",
          total: 10000,
        },
      ],
    });
    const rows = appendEntries(agreement, [
      bill("contract-bill", 10000, {
        account: "labour",
        contractId: "agreement",
      }),
      cash("loose", 10000, { account: "labour" }),
    ]);
    expect(() =>
      allocatePayment(rows, "loose", [
        { billId: "contract-bill", amount: 1000 },
      ]),
    ).toThrow();
  });
  it("requires an explicit work for a multiwork bill and caps payment and bill work capacity", () => {
    const purchase = bill("mixed", 5000);
    purchase.lines.push({
      ...purchase.lines[0],
      id: "mixed-paint",
      workId: "paint",
      amount: 5000,
    });
    const paid = cash("split", 10000);
    paid.allocations = [
      { workId: "structure", amount: 3000 },
      { workId: "paint", amount: 7000 },
    ];
    const ledger = appendEntries(base(), [purchase, paid]);
    expect(() =>
      allocatePayment(ledger, "split", [{ billId: "mixed", amount: 3000 }]),
    ).toThrow("Choose the bill work");
    expect(() =>
      allocatePayment(ledger, "split", [
        { billId: "mixed", workId: "structure", amount: 4000 },
      ]),
    ).toThrow("work amount");
    expect(() =>
      allocatePayment(ledger, "split", [
        { billId: "mixed", workId: "paint", amount: 6000 },
      ]),
    ).toThrow("work amount");
    const settled = allocatePayment(ledger, "split", [
      { billId: "mixed", workId: "structure", amount: 3000 },
      { billId: "mixed", workId: "paint", amount: 5000 },
    ]);
    expect(partyLedger(settled, "party")).toMatchObject({
      allocated: 8000,
      billOutstanding: 2000,
      unallocatedCash: 2000,
    });
  });
  it("rejects contextual refunds against cash already used in a bill", () => {
    const ledger = appendEntries(base(), [
      bill("purchase", 5000),
      cash("advance", 5000, { context: "advance" }),
      cash("other-cash", 5000),
      cash("advance-return", 5000, { context: "advance", kind: "refund" }),
    ]);
    expect(() =>
      allocatePayment(ledger, "advance", [
        { billId: "purchase", amount: 1000 },
      ]),
    ).toThrow("cash context");
    expect(partyLedger(ledger, "party")).toMatchObject({
      advance: 0,
      legacyUnclassifiedCredit: 5000,
    });
  });
  it("rejects invalid new metadata and financial amounts without mutation", () => {
    const ledger = appendEntries(base(), [
      bill("purchase", 5000),
      cash("paid", 5000),
    ]);
    const original = JSON.stringify(ledger);
    for (const amount of [0, -1, 1.25, Number.MAX_SAFE_INTEGER + 1])
      expect(() =>
        allocatePayment(ledger, "paid", [{ billId: "purchase", amount }]),
      ).toThrow();
    expect(() =>
      LedgerSchema.parse({ ...ledger, architectureVersion: 3 }),
    ).toThrow();
    expect(() =>
      LedgerSchema.parse({ ...ledger, paymentAllocations: undefined }),
    ).toThrow();
    expect(() =>
      LedgerSchema.parse({
        ...ledger,
        entries: [{ ...ledger.entries[0], paymentContext: "advance" }],
      }),
    ).toThrow();
    expect(JSON.stringify(ledger)).toBe(original);
  });
  it("cancels a wrong allocation without losing history and permits refund and void afterwards", () => {
    const ledger = appendEntries(base(), [
      bill("purchase", 5000),
      cash("paid", 5000, { context: "advance" }),
    ]);
    const applied = allocatePayment(ledger, "paid", [
      { billId: "purchase", amount: 5000 },
    ]);
    const allocation = applied.paymentAllocations![0];
    const cancelled = cancelPaymentAllocation(
      applied,
      allocation.id,
      "নমুনা ভুল বিল বেছেছিলাম",
    );
    expect(cancelled.paymentAllocations).toHaveLength(1);
    expect(cancelled.paymentAllocations![0]).toMatchObject({
      ...allocation,
      cancellationReason: "নমুনা ভুল বিল বেছেছিলাম",
    });
    expect(partyLedger(cancelled, "party")).toMatchObject({
      billOutstanding: 5000,
      allocated: 0,
      advance: 5000,
    });
    expect(partyLedger(cancelled, "party").cancelledAllocations).toHaveLength(
      1,
    );
    expect(
      cancelPaymentAllocation(
        cancelled,
        allocation.id,
        "নমুনা ভুল বিল বেছেছিলাম",
      ),
    ).toEqual(cancelled);
    expect(preservesPaymentAllocationHistory(applied, cancelled)).toBe(true);
    expect(preservesPaymentAllocationHistory(cancelled, applied)).toBe(false);
    expect(
      preservesPaymentAllocationHistory(applied, { paymentAllocations: [] }),
    ).toBe(false);
    expect(
      preservesPaymentAllocationHistory(applied, {
        paymentAllocations: [{ ...allocation, amount: 4000 }],
      }),
    ).toBe(false);
    expect(() => cancelPaymentAllocation(applied, allocation.id, "")).toThrow();
    const refunded = appendEntries(cancelled, [
      cash("returned", 5000, { kind: "refund", context: "advance" }),
    ]);
    const voided = setEntryVoided(refunded, "purchase", true);
    expect(summarize(voided)).toMatchObject({
      cost: 0,
      netPaid: 0,
      payable: 0,
      advance: 0,
    });
    expect(voided.paymentAllocations![0]).toEqual(
      cancelled.paymentAllocations![0],
    );
    expect(() =>
      LedgerSchema.parse({
        ...cancelled,
        entries: cancelled.entries.filter((entry) => entry.id !== "purchase"),
      }),
    ).toThrow("references must be retained");
  });
  it("requires complete chronological cancellation metadata and preserves cancelled rows unchanged", () => {
    const ledger = appendEntries(base(), [
      bill("purchase", 5000),
      cash("paid", 5000),
    ]);
    const applied = allocatePayment(ledger, "paid", [
      { billId: "purchase", amount: 1000 },
    ]);
    const row = applied.paymentAllocations![0];
    for (const changes of [
      { cancelledAt: "2026-01-01T00:00:00.000Z", cancellationReason: "নমুনা" },
      { cancellationReason: "নমুনা" },
      { cancelledAt: new Date().toISOString() },
    ])
      expect(() =>
        LedgerSchema.parse({
          ...applied,
          paymentAllocations: [{ ...row, ...changes }],
        }),
      ).toThrow();
    const cancelled = cancelPaymentAllocation(applied, row.id, "নমুনা ভুল");
    expect(
      preservesPaymentAllocationHistory(cancelled, {
        paymentAllocations: [
          {
            ...cancelled.paymentAllocations![0],
            cancellationReason: "বদলে দিয়েছি",
          },
        ],
      }),
    ).toBe(false);
  });
  it("flags unmatched old refunds instead of guessing whether refundable or advance cash supplied them", () => {
    const ledger = appendEntries(base(), [
      cash("advance", 5000, { context: "advance" }),
      cash("deposit", 5000, { context: "receivable" }),
      cash("old-refund", 2000, { kind: "refund" }),
    ]);
    expect(partyLedger(ledger, "party")).toMatchObject({
      unallocatedCash: 8000,
      advance: 3000,
      receivable: 3000,
      ambiguousCredit: 2000,
      unclassifiedRefunds: 2000,
      creditAmbiguous: true,
    });
  });
});
