import { describe, expect, it } from "vitest";
import { EntrySchema, LedgerSchema, type Ledger } from "./model";
import {
  planHousePayment,
  recordHousePayment,
  planHouseBillAdvance,
  applyHouseBillAdvance,
} from "./housePayments";
import { partyLedger } from "./partyLedger";
import { appendEntries, summarize, contractSummary } from "./ledger";
import { legacyCommitmentTotals, reconciledTotals } from "./adjustmentMath";

const fixture = (): Ledger =>
  LedgerSchema.parse({
    architectureVersion: 2,
    paymentAllocations: [],
    works: [
      { id: "roof", name: "নমুনা ছাদ" },
      { id: "paint", name: "নমুনা রং" },
    ],
    people: [
      {
        id: "party",
        name: "নমুনা ব্যক্তি",
        roles: ["supplier", "craftsperson"],
      },
    ],
    contracts: [
      { id: "contract", personId: "party", workId: "roof", total: 10000 },
    ],
  });
const bill = (
  id: string,
  amount: number,
  options: {
    workId?: string;
    labour?: boolean;
    contractId?: string;
    date?: string;
  } = {},
) =>
  EntrySchema.parse({
    id,
    kind: "expense",
    personId: "party",
    account: options.labour ? "labour" : "materials",
    contractId: options.contractId ?? null,
    date: options.date ?? "2026-11-01",
    lines: [
      {
        id: `${id}-line`,
        workId: options.workId ?? "roof",
        label: `নমুনা ${id}`,
        amount,
        costType: options.labour ? "labour" : "material",
      },
    ],
  });
const request = {
  personId: "party",
  amount: 8000,
  intent: "settlement" as const,
};
const record = {
  id: "new-payment",
  date: "2026-11-05",
  method: "cash" as const,
};

describe("homeowner payment planning and posting", () => {
  it("proposes oldest bills across sectors without requiring a sector first and posts once", () => {
    const ledger = appendEntries(fixture(), [
      bill("old", 5000),
      bill("new", 6000, { workId: "paint", date: "2026-11-02" }),
    ]);
    const plan = planHousePayment(ledger, request);
    expect(plan.issues).toEqual([]);
    expect(plan.allocations).toEqual([
      { billId: "old", workId: "roof", amount: 5000 },
      { billId: "new", workId: "paint", amount: 3000 },
    ]);
    const next = recordHousePayment(ledger, { ...request, ...record }, plan);
    expect(next.entries).toHaveLength(3);
    expect(partyLedger(next, "party")).toMatchObject({
      payable: 3000,
      billOutstanding: 3000,
      allocated: 8000,
    });
    expect(summarize(next)).toMatchObject({ cost: 11000, paid: 8000 });
    expect(ledger.entries).toHaveLength(2);
  });
  it("can choose a different bill and splits one confirmed operation across financial scopes", () => {
    const ledger = appendEntries(fixture(), [
      bill("materials", 5000),
      bill("labour", 10000, { labour: true, contractId: "contract" }),
    ]);
    const input = {
      ...request,
      allocations: [
        { billId: "labour", workId: "roof", amount: 6000 },
        { billId: "materials", workId: "roof", amount: 2000 },
      ],
    };
    const plan = planHousePayment(ledger, input);
    expect(
      plan.groups.map((group) => [
        group.account,
        group.contractId,
        group.amount,
      ]),
    ).toEqual([
      ["labour", "contract", 6000],
      ["materials", null, 2000],
    ]);
    const next = recordHousePayment(
      ledger,
      {
        ...input,
        ...record,
        receipts: [
          { id: "receipt", name: "নমুনা রসিদ", mime: "image/png", size: 10 },
        ],
      },
      plan,
    );
    expect(next.entries.slice(-2).map((entry) => entry.id)).toEqual([
      "new-payment:0",
      "new-payment:1",
    ]);
    expect(next.entries.at(-2)?.receipts).toHaveLength(1);
    expect(next.entries.at(-1)?.receipts).toHaveLength(0);
    expect(summarize(next)).toMatchObject({
      cost: 15000,
      paid: 8000,
      reconciledPayable: 7000,
    });
  });
  it("requires a clear advance decision for money beyond the selected bills", () => {
    const ledger = appendEntries(fixture(), [bill("purchase", 5000)]);
    const plan = planHousePayment(ledger, request);
    expect(plan).toMatchObject({ remainder: 3000, issues: [] });
    expect(plan.groups.map((group) => group.context)).toEqual([
      "settlement",
      "advance",
    ]);
    expect(() =>
      recordHousePayment(ledger, { ...request, ...record }, plan),
    ).toThrow("confirm_advance");
    const next = recordHousePayment(
      ledger,
      { ...request, ...record, confirmRemainderAdvance: true },
      plan,
    );
    expect(partyLedger(next, "party")).toMatchObject({
      payable: 0,
      advance: 3000,
    });
  });
  it("never assumes old unlinked cash paid a particular historical bill", () => {
    const ledger = appendEntries(fixture(), [
      bill("old", 5000),
      EntrySchema.parse({
        id: "legacy",
        kind: "payment",
        personId: "party",
        account: "materials",
        allocations: [{ workId: "roof", amount: 5000 }],
        paymentParts: [{ amount: 5000 }],
      }),
    ]);
    const plan = planHousePayment(ledger, { ...request, amount: 1000 });
    expect(plan).toMatchObject({
      earnedPayable: 0,
      existingUnallocatedCash: 5000,
      requiresCashReview: true,
    });
    expect(plan.issues).toContain("unassigned_cash");
    expect(() =>
      recordHousePayment(ledger, { ...request, ...record, amount: 1000 }, plan),
    ).toThrow("unassigned_cash");
    expect(ledger.paymentAllocations).toEqual([]);
  });
  it("rejects stale previews, unavailable bills and unsafe amounts atomically", () => {
    const ledger = appendEntries(fixture(), [bill("purchase", 10000)]);
    const plan = planHousePayment(ledger, request);
    const changed = recordHousePayment(
      ledger,
      { ...request, ...record, amount: 2000 },
      planHousePayment(ledger, { ...request, amount: 2000 }),
    );
    expect(() =>
      recordHousePayment(
        changed,
        { ...request, ...record, id: "second", confirmUnallocatedCash: true },
        plan,
      ),
    ).toThrow("changed");
    expect(
      planHousePayment(ledger, { ...request, amount: 1.5 }).issues,
    ).toContain("invalid_amount");
    expect(
      planHousePayment(ledger, {
        ...request,
        allocations: [{ billId: "missing", workId: "roof", amount: 8000 }],
      }).issues,
    ).toContain("invalid_allocation");
    expect(ledger.entries).toHaveLength(1);
  });
  it("records a recoverable deposit without settling earned work or guessing a sector", () => {
    const ledger = appendEntries(fixture(), [bill("purchase", 10000)]);
    const input = {
      ...request,
      amount: 3000,
      intent: "receivable" as const,
      account: "materials" as const,
      workId: "roof",
    };
    const plan = planHousePayment(ledger, input);
    expect(plan.allocations).toEqual([]);
    const next = recordHousePayment(ledger, { ...input, ...record }, plan);
    expect(partyLedger(next, "party")).toMatchObject({
      payable: 10000,
      receivable: 3000,
      advance: 0,
    });
  });
  it("uses only confirmed tagged advance for a later purchase without another cash movement", () => {
    const base = fixture();
    const advance = {
      ...request,
      intent: "advance" as const,
      amount: 3000,
      account: "materials" as const,
      workId: "roof",
    };
    const funded = recordHousePayment(
      base,
      { ...advance, ...record },
      planHousePayment(base, advance),
    );
    const plan = planHouseBillAdvance(funded, {
      personId: "party",
      account: "materials",
      workId: "roof",
      amount: 5000,
    });
    expect(plan).toMatchObject({ applied: 3000, remainder: 2000 });
    const purchased = appendEntries(funded, [bill("later", 5000)]);
    const next = applyHouseBillAdvance(purchased, "later", plan);
    expect(summarize(next)).toMatchObject({
      cost: 5000,
      paid: 3000,
      reconciledPayable: 2000,
    });
    expect(partyLedger(next, "party")).toMatchObject({
      advance: 0,
      billOutstanding: 2000,
    });
    expect(next.entries).toHaveLength(2);
    expect(() => applyHouseBillAdvance(next, "later", plan)).toThrow("changed");
  });
  it("keeps agreement promises out of current due and guards ambiguous old commitment corrections", () => {
    const ledger = appendEntries(fixture(), [
      bill("earned", 3000, { labour: true, contractId: "contract" }),
    ]);
    expect(reconciledTotals(ledger).reconciledPayable).toBe(3000);
    expect(legacyCommitmentTotals(ledger).reconciledPayable).toBe(10000);
    expect(contractSummary(ledger, "contract")).toMatchObject({
      payable: 3000,
      remaining: 3000,
      unearnedCommitment: 7000,
      remainingCommitment: 10000,
    });
    const oldDiscount = EntrySchema.parse({
      id: "discount",
      kind: "adjustment",
      personId: "party",
      account: "labour",
      contractId: "contract",
      note: "নমুনা পুরোনো চুক্তির ছাড়",
      adjustment: {
        target: "person",
        basis: "balance",
        account: "labour",
        workId: "roof",
        before: 10000,
        after: 8000,
        delta: -2000,
      },
    });
    const ambiguous = appendEntries(fixture(), [oldDiscount]);
    expect(partyLedger(ambiguous, "party")).toMatchObject({
      payable: 0,
      earnedPayable: null,
      advance: 0,
      receivable: 0,
      unresolvedAdjustmentIds: ["discount"],
    });
    expect(
      planHousePayment(ambiguous, {
        ...request,
        workId: "roof",
        account: "labour",
      }).issues,
    ).toContain("unresolved_balance");
  });
});
