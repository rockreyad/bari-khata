import { describe, expect, it } from "vitest";
import { appendBalanceAdjustment } from "./balanceAdjustments";
import { partyAccountBalance, personSummary } from "./ledger";
import { EntrySchema, LedgerSchema, type Ledger } from "./model";

const at = "2026-11-04T08:00:00.000Z";
function fixture(): Ledger {
  return LedgerSchema.parse({
    works: [
      { id: "door", name: "দরজা" },
      { id: "roof", name: "ছাদ" },
    ],
    people: [{ id: "shop", name: "দোকান", kind: "shop" }],
    entries: [
      {
        id: "bill",
        kind: "expense",
        personId: "shop",
        lines: [{ id: "line", workId: "door", amount: 100000 }],
      },
      {
        id: "paid",
        kind: "payment",
        personId: "shop",
        allocations: [{ workId: "roof", amount: 40000 }],
        paymentParts: [{ amount: 40000 }],
      },
    ],
  });
}
function cash(
  ledger: Ledger,
  id: string,
  amount: number,
  kind: "payment" | "refund",
) {
  return LedgerSchema.parse({
    ...ledger,
    entries: [
      ...ledger.entries,
      EntrySchema.parse({
        id,
        kind,
        personId: "shop",
        allocations: [{ workId: "door", amount }],
        paymentParts: [{ amount }],
      }),
    ],
  });
}

describe("adjusted running account previews", () => {
  it("keeps a legacy transport payment classified after its bill is cancelled", () => {
    const ledger = LedgerSchema.parse({
      works: [{ id: "door", name: "দরজা" }],
      people: [{ id: "driver", name: "রনি", kind: "driver" }],
      entries: [
        {
          id: "trip",
          kind: "expense",
          personId: "driver",
          account: "materials",
          voided: true,
          lines: [
            {
              id: "trip-line",
              workId: "door",
              costType: "transport",
              amount: 50000,
            },
          ],
        },
        {
          id: "trip-paid",
          kind: "payment",
          personId: "driver",
          account: "materials",
          relatedEntryId: "trip",
          allocations: [{ workId: "door", amount: 50000 }],
          paymentParts: [{ amount: 50000 }],
        },
      ],
    });
    expect(partyAccountBalance(ledger, "driver", "other")).toMatchObject({
      cost: 0,
      paid: 50000,
      balance: -50000,
      advance: 50000,
    });
  });

  it("keeps an unallocated person correction separate from the person's individual jobs", () => {
    const original = LedgerSchema.parse({
      works: [{ id: "door", name: "দরজা" }],
      people: [{ id: "worker", name: "মিস্ত্রি", kind: "worker" }],
      contracts: [
        { id: "first-job", personId: "worker", workId: "door", total: 100000 },
        { id: "second-job", personId: "worker", workId: "door", total: 200000 },
      ],
      entries: [
        {
          id: "bill",
          kind: "expense",
          personId: "worker",
          account: "labour",
          lines: [
            { id: "line", workId: "door", amount: 50000, costType: "labour" },
          ],
        },
        {
          id: "paid",
          kind: "payment",
          personId: "worker",
          account: "labour",
          allocations: [{ workId: "door", amount: 10000 }],
          paymentParts: [{ amount: 10000 }],
        },
        {
          id: "job-bill",
          kind: "expense",
          personId: "worker",
          account: "labour",
          contractId: "first-job",
          lines: [
            {
              id: "job-line",
              workId: "door",
              amount: 100000,
              costType: "labour",
            },
          ],
        },
      ],
    });
    const adjusted = appendBalanceAdjustment(
      original,
      {
        target: "person",
        basis: "paid",
        personId: "worker",
        account: "labour",
        expectedBefore: 10000,
        after: 20000,
        reason: "মোট দেওয়া টাকা মিলিয়েছি",
      },
      at,
    );
    expect(partyAccountBalance(adjusted, "worker", "labour")).toMatchObject({
      cost: 50000,
      paid: 10000,
      balance: 30000,
    });
    expect(
      partyAccountBalance(adjusted, "worker", "labour", "first-job"),
    ).toMatchObject({ cost: 100000, balance: 100000 });
    expect(
      partyAccountBalance(adjusted, "worker", "labour", "second-job"),
    ).toMatchObject({ cost: 0, balance: 0 });
  });

  it.each([
    ["balance", 60000, 30000, 30000],
    ["balance", 60000, 90000, 90000],
    ["paid", 40000, 70000, 30000],
    ["paid", 40000, 10000, 90000],
    ["cost", 100000, 70000, 30000],
    ["cost", 100000, 130000, 90000],
  ] as const)(
    "includes a %s correction from %i to %i without changing actual cash",
    (basis, expectedBefore, after, balance) => {
      const original = fixture();
      const next = appendBalanceAdjustment(
        original,
        {
          target: "person",
          basis,
          personId: "shop",
          account: "materials",
          expectedBefore,
          after,
          reason: "দোকানের সঙ্গে মিলিয়েছি",
        },
        at,
      );
      expect(partyAccountBalance(next, "shop", "materials")).toMatchObject({
        cost: 100000,
        paid: 40000,
        refunds: 0,
        netPaid: 40000,
        balance,
        payable: balance,
        advance: 0,
      });
      expect(partyAccountBalance(next, "shop", "materials").balance).toBe(
        personSummary(next, "shop").reconciledBalance,
      );
      expect(next.entries.slice(0, 2)).toEqual(original.entries);
    },
  );

  it("settles the adjusted due once and restores due after a refund", () => {
    const original = cash(fixture(), "first-refund", 10000, "refund");
    const adjusted = appendBalanceAdjustment(
      original,
      {
        target: "person",
        basis: "balance",
        personId: "shop",
        account: "materials",
        expectedBefore: 70000,
        after: 30000,
        reason: "বাকি মিলিয়েছি",
      },
      at,
    );
    const paid = cash(adjusted, "settled", 30000, "payment");
    expect(partyAccountBalance(paid, "shop", "materials")).toMatchObject({
      cost: 100000,
      paid: 70000,
      refunds: 10000,
      balance: 0,
      payable: 0,
      advance: 0,
    });
    expect(
      partyAccountBalance(
        cash(paid, "refund", 10000, "refund"),
        "shop",
        "materials",
      ),
    ).toMatchObject({ balance: 10000, payable: 10000, advance: 0 });
  });

  it("keeps corrected credit and reduces it by refunded cash", () => {
    const original = LedgerSchema.parse({
      ...fixture(),
      entries: [fixture().entries[1]],
    });
    const adjusted = appendBalanceAdjustment(
      original,
      {
        target: "person",
        basis: "paid",
        personId: "shop",
        account: "materials",
        expectedBefore: 40000,
        after: 70000,
        reason: "দেওয়া টাকা মিলিয়েছি",
      },
      at,
    );
    expect(partyAccountBalance(adjusted, "shop", "materials")).toMatchObject({
      cost: 0,
      netPaid: 40000,
      balance: -70000,
      payable: 0,
      advance: 70000,
    });
    expect(
      partyAccountBalance(
        cash(adjusted, "refund", 20000, "refund"),
        "shop",
        "materials",
      ),
    ).toMatchObject({
      netPaid: 20000,
      balance: -50000,
      payable: 0,
      advance: 50000,
    });
  });

  it("keeps other people, accounts, jobs and notebook-only corrections out of the running account", () => {
    const original = LedgerSchema.parse({
      ...fixture(),
      people: [
        ...fixture().people,
        { id: "other", name: "অন্যজন" },
        { id: "worker", name: "মিস্ত্রি", kind: "worker" },
      ],
      contracts: [
        { id: "job", personId: "worker", workId: "door", total: 100000 },
      ],
      entries: [
        ...fixture().entries,
        {
          id: "other-bill",
          kind: "expense",
          personId: "other",
          lines: [{ id: "other-line", workId: "door", amount: 50000 }],
        },
        {
          id: "other-account",
          kind: "expense",
          personId: "shop",
          account: "other",
          lines: [
            {
              id: "other-account-line",
              workId: "door",
              amount: 50000,
              costType: "transport",
            },
          ],
        },
        {
          id: "job-bill",
          kind: "expense",
          personId: "worker",
          account: "labour",
          contractId: "job",
          lines: [
            {
              id: "job-line",
              workId: "door",
              amount: 100000,
              costType: "labour",
            },
          ],
        },
      ],
    });
    let next = appendBalanceAdjustment(
      original,
      {
        target: "person",
        basis: "balance",
        personId: "shop",
        account: "materials",
        workId: "door",
        expectedBefore: 100000,
        after: 80000,
        reason: "এই খাতার বাকি মিলিয়েছি",
      },
      at,
    );
    next = appendBalanceAdjustment(
      next,
      {
        target: "person",
        basis: "balance",
        personId: "other",
        account: "materials",
        expectedBefore: 50000,
        after: 30000,
        reason: "অন্যজনের হিসাব",
      },
      at,
    );
    next = appendBalanceAdjustment(
      next,
      {
        target: "person",
        basis: "balance",
        personId: "shop",
        account: "other",
        expectedBefore: 50000,
        after: 30000,
        reason: "অন্য খরচের হিসাব",
      },
      at,
    );
    next = appendBalanceAdjustment(
      next,
      {
        target: "person",
        basis: "balance",
        personId: "worker",
        account: "labour",
        contractId: "job",
        expectedBefore: 100000,
        after: 50000,
        reason: "কাজের হিসাব",
      },
      at,
    );
    const beforeWorkOnly = partyAccountBalance(next, "shop", "materials");
    next = appendBalanceAdjustment(
      next,
      {
        target: "work",
        basis: "paid",
        account: null,
        workId: "door",
        expectedBefore: 0,
        after: 10000,
        reason: "খাতার মোট",
      },
      at,
    );
    expect(partyAccountBalance(next, "shop", "materials")).toEqual(
      beforeWorkOnly,
    );
    expect(beforeWorkOnly).toMatchObject({
      cost: 100000,
      paid: 40000,
      balance: 40000,
    });
    expect(partyAccountBalance(next, "worker", "labour")).toMatchObject({
      cost: 0,
      paid: 0,
      balance: 0,
    });
    expect(partyAccountBalance(next, "worker", "labour", "job")).toMatchObject({
      cost: 100000,
      paid: 0,
      balance: 50000,
    });
  });
});
