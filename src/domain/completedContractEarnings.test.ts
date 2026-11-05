import { describe, expect, it } from "vitest";
import { jobBalances } from "../features/jobs/jobView";
import { reconciledTotals } from "./adjustmentMath";
import { contractEarnings } from "./contractObligations";
import { contactAccountSummary, contactSummary } from "./contacts";
import { planHousePayment, recordHousePayment } from "./housePayments";
import {
  contractSummary,
  personSummary,
  summarize,
  workSummary,
} from "./ledger";
import { LedgerSchema } from "./model";
import { partyLedger } from "./partyLedger";

const bill = (amount = 10000, extra = {}) => ({
  id: "bill",
  kind: "expense",
  personId: "worker",
  account: "labour",
  contractId: "job",
  lines: [{ id: "line", workId: "roof", amount, costType: "labour" }],
  ...extra,
});
const cash = (amount: number, extra = {}) => ({
  id: "cash",
  kind: "payment",
  personId: "worker",
  account: "labour",
  contractId: "job",
  paymentParts: [{ amount }],
  allocations: [{ workId: "roof", amount }],
  ...extra,
});
function fixture(entries: unknown[] = [], contract = {}) {
  return LedgerSchema.parse({
    architectureVersion: 2,
    paymentAllocations: [],
    milestones: [],
    works: [
      { id: "roof", name: "ছাদ", status: "done" },
      { id: "wall", name: "দেয়াল" },
    ],
    people: [{ id: "worker", name: "নমুনা কর্মী", kind: "worker" }],
    contracts: [
      {
        id: "job",
        personId: "worker",
        workId: "roof",
        status: "done",
        total: 3500000,
        ...contract,
      },
    ],
    entries,
  });
}

describe("completed contract earnings without duplicate bills", () => {
  it("recognizes completed unpaid work consistently without creating a financial record", () => {
    const ledger = fixture();
    const source = structuredClone(ledger);
    expect(reconciledTotals(ledger)).toMatchObject({
      actualCost: 0,
      completedContractCost: 3500000,
      reconciledCost: 3500000,
      reconciledPayable: 3500000,
      reconciledAdvance: 0,
    });
    expect(summarize(ledger)).toMatchObject({
      cost: 0,
      cashPaid: 0,
      reconciledCost: 3500000,
      reconciledPayable: 3500000,
    });
    expect(personSummary(ledger, "worker").reconciledPayable).toBe(3500000);
    expect(workSummary(ledger, "roof").reconciledPayable).toBe(3500000);
    expect(workSummary(ledger, "wall").reconciledPayable).toBe(0);
    expect(partyLedger(ledger, "worker").earnedPayable).toBe(3500000);
    expect(contractSummary(ledger, "job")).toMatchObject({
      billed: 0,
      earned: 3500000,
      earnedFromCompletion: true,
      remaining: 3500000,
      advance: 0,
      unearnedCommitment: 0,
    });
    expect(jobBalances(ledger).get("job")).toMatchObject({
      remaining: 3500000,
      extra: 0,
      state: "due",
    });
    expect(ledger).toEqual(source);
  });

  it("reports only the actual excess above completed earnings, with refunds reducing cash", () => {
    const ledger = fixture([cash(3600000)]);
    expect(contractSummary(ledger, "job")).toMatchObject({
      earned: 3500000,
      netPaid: 3600000,
      remaining: 0,
      advance: 100000,
    });
    expect(reconciledTotals(ledger)).toMatchObject({
      reconciledPayable: 0,
      reconciledAdvance: 100000,
    });
    expect(jobBalances(ledger).get("job")).toMatchObject({
      netPaid: 3600000,
      extra: 100000,
      state: "overpaid",
    });
    const refunded = fixture([
      cash(3600000),
      cash(100000, { id: "refund", kind: "refund" }),
    ]);
    expect(contractSummary(refunded, "job")).toMatchObject({
      netPaid: 3500000,
      remaining: 0,
      advance: 0,
    });
  });

  it.each([null, "planned", "ongoing"])(
    "keeps %s work as an agreement rather than earned cost even when its notebook is complete",
    (status) => {
      const ledger = fixture([], { status });
      expect(reconciledTotals(ledger)).toMatchObject({
        completedContractCost: 0,
        reconciledCost: 0,
        reconciledPayable: 0,
      });
      expect(contractSummary(ledger, "job")).toMatchObject({
        earned: 0,
        earnedFromCompletion: false,
        remainingCommitment: 3500000,
      });
    },
  );

  it("uses explicit partial or full bills instead of adding the completed agreement again", () => {
    for (const amount of [10000, 3500000]) {
      const ledger = fixture([bill(amount), cash(4000)]);
      expect(contractSummary(ledger, "job")).toMatchObject({
        billed: amount,
        earned: amount,
        earnedFromCompletion: false,
        remaining: amount - 4000,
      });
      expect(reconciledTotals(ledger)).toMatchObject({
        actualCost: amount,
        completedContractCost: 0,
        reconciledCost: amount,
        reconciledPayable: amount - 4000,
      });
      expect(jobBalances(ledger).get("job")?.remaining).toBe(amount - 4000);
    }
  });

  it.each([{ voided: true }, { balanceImpact: "historical" }])(
    "does not revive completed contract cost when its explicit bill is inactive: %j",
    (extra) => {
      const ledger = fixture([bill(10000, extra)]);
      expect(contractEarnings(ledger).get("job")).toMatchObject({
        hasBill: true,
        fromCompletion: false,
        earned: 0n,
      });
      expect(reconciledTotals(ledger).reconciledPayable).toBe(0);
      expect(contractSummary(ledger, "job").earned).toBe(0);
    },
  );

  it("keeps returned bill credits in the explicit bill basis", () => {
    const ledger = fixture([
      bill(),
      bill(3000, {
        id: "credit",
        kind: "expense_credit",
        relatedEntryId: "bill",
        lines: [
          {
            id: "credit-line",
            workId: "roof",
            amount: 3000,
            costType: "labour",
          },
        ],
      }),
    ]);
    expect(contractSummary(ledger, "job")).toMatchObject({
      billed: 7000,
      earned: 7000,
      earnedFromCompletion: false,
      remaining: 7000,
    });
  });

  it("settles completed earned work with one cash movement and no new bill", () => {
    const ledger = fixture();
    const request = {
      personId: "worker",
      amount: 500000,
      intent: "payment" as const,
      account: "labour" as const,
      workId: "roof",
      contractId: "job",
      allocations: [],
    };
    const plan = planHousePayment(ledger, request);
    expect(plan.issues).toEqual([]);
    const paid = recordHousePayment(
      ledger,
      { ...request, id: "paid", date: "2026-11-05", method: "cash" },
      plan,
    );
    expect(paid.entries).toHaveLength(1);
    expect(paid.entries[0]).toMatchObject({
      kind: "payment",
      contractId: "job",
      paymentContext: "settlement",
      paymentParts: [{ amount: 500000 }],
    });
    expect(paid.paymentAllocations).toEqual([]);
    expect(contractSummary(paid, "job").remaining).toBe(3000000);
    expect(reconciledTotals(paid)).toMatchObject({
      actualCost: 0,
      reconciledCost: 3500000,
      actualPaid: 500000,
      reconciledPayable: 3000000,
    });
  });

  it("never excludes refundable deposits from cash but does exclude them from settling earned work", () => {
    const ledger = fixture([cash(10000, { paymentContext: "receivable" })]);
    expect(contractSummary(ledger, "job")).toMatchObject({
      netPaid: 10000,
      obligationNetPaid: 0,
      remaining: 3500000,
      advance: 0,
    });
    expect(reconciledTotals(ledger).reconciledPayable).toBe(3500000);
  });

  it("preserves completed contract dues separately from old uncontracted cash in every profile account", () => {
    const ledger = fixture([
      cash(100000, { id: "old-cash", contractId: null }),
      bill(25000, { contractId: null }),
      cash(25000, { contractId: null, relatedEntryId: "bill" }),
    ]);
    const person = ledger.people[0];
    expect(contactSummary(ledger, person)).toMatchObject({
      reconciledCost: 3525000,
      netPaid: 125000,
      reconciledPayable: 3500000,
      reconciledAdvance: 100000,
    });
    expect(contactAccountSummary(ledger, person, "labour")).toMatchObject({
      reconciledPayable: 3500000,
      reconciledAdvance: 100000,
    });
    for (const account of ["materials", "other"] as const)
      expect(contactAccountSummary(ledger, person, account)).toMatchObject({
        completedContractCost: 0,
        reconciledCost: 0,
        reconciledPayable: 0,
      });
  });

  it("keeps corrections in their account while respecting a deliberate person correction pool", () => {
    const ledger = fixture([
      cash(100000, { contractId: null }),
      {
        id: "materials-correction",
        kind: "adjustment",
        personId: "worker",
        account: "materials",
        note: "নমুনা মালের হিসাব মিলিয়েছি",
        adjustment: {
          target: "person",
          basis: "balance",
          calculationVersion: 2,
          account: "materials",
          workId: "roof",
          before: 0,
          after: 5000,
          delta: 5000,
        },
      },
      {
        id: "labour-correction",
        kind: "adjustment",
        personId: "worker",
        account: "labour",
        note: "নমুনা কাজের হিসাব মিলিয়েছি",
        adjustment: {
          target: "person",
          basis: "balance",
          calculationVersion: 2,
          account: "labour",
          workId: "roof",
          before: 3400000,
          after: 3390000,
          delta: -10000,
        },
      },
    ]);
    const person = ledger.people[0];
    expect(contactAccountSummary(ledger, person, "materials")).toMatchObject({
      owedCorrection: 5000,
      reconciledPayable: 5000,
    });
    expect(contactAccountSummary(ledger, person, "labour")).toMatchObject({
      owedCorrection: -10000,
      reconciledPayable: 3390000,
    });
    expect(contactSummary(ledger, person).reconciledPayable).toBe(3395000);
  });

  it("recognizes a whole-house completion without assigning its earnings to an arbitrary notebook", () => {
    const ledger = fixture([], { scope: "house", workId: null });
    expect(contactSummary(ledger, ledger.people[0]).reconciledPayable).toBe(
      3500000,
    );
    expect(workSummary(ledger, "roof").reconciledPayable).toBe(0);
    expect(workSummary(ledger, "wall").reconciledPayable).toBe(0);
    expect(contractSummary(ledger, "job").remaining).toBe(3500000);
  });

  it("does not turn an old ambiguous contract correction into a verified completion discount", () => {
    const ledger = fixture([
      {
        id: "old-correction",
        kind: "adjustment",
        personId: "worker",
        account: "labour",
        contractId: "job",
        note: "নমুনা পুরোনো সংশোধন",
        adjustment: {
          target: "person",
          basis: "balance",
          account: "labour",
          workId: "roof",
          before: 3500000,
          after: 3400000,
          delta: -100000,
        },
      },
    ]);
    expect(reconciledTotals(ledger)).toMatchObject({
      balanceAmbiguous: true,
      reconciledPayable: 3500000,
      reconciledAdvance: 0,
    });
    expect(partyLedger(ledger, "worker").earnedPayable).toBeNull();
    expect(jobBalances(ledger).get("job")?.valid).toBe(false);
  });
});
