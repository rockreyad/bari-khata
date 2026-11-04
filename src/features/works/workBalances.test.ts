import { describe, expect, it } from "vitest";
import { createDemoLedger } from "../../domain/demo";
import { LedgerSchema } from "../../domain/model";
import { setEntityRemoved } from "../../domain/entityDeletion";
import { workBalances } from "./workBalances";

const cost = (
  id: string,
  amount: number,
  personId: string | null,
  contractId: string | null = null,
  account = "labour",
  workId = "work",
) => ({
  id,
  kind: "expense",
  account,
  personId,
  contractId,
  lines: [
    {
      id: `${id}-line`,
      workId,
      costType: account === "labour" ? "labour" : "material",
      amount,
    },
  ],
});
const cash = (
  id: string,
  amount: number,
  personId: string | null,
  contractId: string | null = null,
  account = "labour",
  workId = "work",
) => ({
  id,
  kind: "payment",
  account,
  personId,
  contractId,
  allocations: [{ workId, amount }],
  paymentParts: [{ method: "cash", amount }],
});
function fixture(entries: unknown[] = [], contracts: unknown[] = []) {
  return LedgerSchema.parse({
    works: [
      { id: "work", name: "দরজা" },
      { id: "roof", name: "ছাদ" },
    ],
    people: [
      { id: "worker", name: "মিস্ত্রি", kind: "worker" },
      { id: "other", name: "অন্য মিস্ত্রি", kind: "worker" },
      { id: "shop", name: "দোকান", kind: "shop" },
    ],
    entries,
    contracts,
  });
}
const agreement = (
  id = "job",
  personId = "worker",
  total = 12540000,
  workId = "work",
) => ({ id, personId, total, workId });

describe("work notebook balances", () => {
  it("merges billed wages and their agreement without counting the same remaining wages twice", () => {
    const ledger = createDemoLedger();
    const before = structuredClone(ledger);
    expect(workBalances(ledger, "tiles")).toMatchObject({
      valid: true,
      netPaid: 79400000,
      billPayable: 1500000,
      workCommitmentOutstanding: 8040000,
      additionalCommitment: 6540000,
      totalOutstanding: 8040000,
      byAccount: { materials: 0, labour: 8040000, other: 0 },
    });
    expect(ledger).toEqual(before);
  });
  it("uses higher billed money when work has exceeded the agreement", () => {
    const ledger = fixture(
      [
        cost("bill", 16000000, "worker", "job"),
        cash("paid", 4500000, "worker", "job"),
      ],
      [agreement()],
    );
    expect(workBalances(ledger, "work")).toMatchObject({
      valid: true,
      billPayable: 11500000,
      workCommitmentOutstanding: 11500000,
      additionalCommitment: 0,
      totalOutstanding: 11500000,
    });
  });
  it("keeps every person, account and unassigned advance separate", () => {
    const ledger = fixture(
      [
        cost("wage", 6000000, "worker", "job"),
        cash("wage-paid", 4500000, "worker", "job"),
        cash("unassigned", 1000000, "worker"),
        cost("shop-bill", 1000000, "shop", null, "materials"),
        cash("other-advance", 20000000, "other"),
        cash("worker-materials", 500000, "worker", null, "materials"),
      ],
      [agreement()],
    );
    expect(workBalances(ledger, "work")).toMatchObject({
      valid: true,
      billPayable: 2500000,
      totalOutstanding: 9040000,
      unassignedAdvance: 21500000,
      byAccount: { materials: 1000000, labour: 8040000, other: 0 },
    });
  });
  it("does not let an overpaid agreement settle another job for the same person", () => {
    const ledger = fixture(
      [cash("extra", 15000000, "worker", "paid-job")],
      [
        agreement("paid-job", "worker", 10000000),
        agreement("due-job", "worker", 5000000),
      ],
    );
    expect(workBalances(ledger, "work")).toMatchObject({
      valid: true,
      totalOutstanding: 5000000,
      workCommitmentOutstanding: 5000000,
    });
  });
  it("reports an unlinked wage bill and same-worker agreement separately when their overlap is unknown", () => {
    const ledger = fixture(
      [
        cost("unlinked-bill", 6000000, "worker"),
        cash("unlinked-paid", 4500000, "worker"),
        cash("job-paid", 4500000, "worker", "job"),
      ],
      [agreement()],
    );
    expect(workBalances(ledger, "work")).toMatchObject({
      valid: true,
      billPayable: 1500000,
      workCommitmentOutstanding: 8040000,
      additionalCommitment: null,
      totalOutstanding: null,
      scopedOutstanding: null,
      byAccount: { labour: null },
      ambiguousLabourPersonIds: ["worker"],
    });
  });
  it("does not associate an unnamed wage bill with an arbitrary worker's agreement", () => {
    const ledger = fixture([cost("unnamed", 1000000, null)], [agreement()]);
    expect(workBalances(ledger, "work")).toMatchObject({
      valid: true,
      billPayable: 1000000,
      totalOutstanding: null,
      ambiguousLabourPersonIds: [null],
    });
  });
  it("does not apply unlinked bills from a different worker to the agreement", () => {
    const ledger = fixture(
      [cost("other-work", 1000000, "other")],
      [agreement()],
    );
    expect(workBalances(ledger, "work")).toMatchObject({
      valid: true,
      totalOutstanding: 13540000,
      ambiguousLabourPersonIds: [],
    });
  });
  it("keeps a house-wide balance separate and never allocates it wholesale to each notebook", () => {
    const ledger = fixture(
      [
        cost("earned", 6000000, "worker", "house"),
        cash("work-paid", 3000000, "worker", "house"),
        cash("roof-paid", 1500000, "worker", "house", "labour", "roof"),
      ],
      [{ ...agreement("house"), scope: "house", workId: null }],
    );
    expect(workBalances(ledger, "work")).toMatchObject({
      valid: true,
      netPaid: 3000000,
      billPayable: 3000000,
      scopedOutstanding: 3000000,
      totalOutstanding: null,
      sharedOutstanding: 8040000,
      sharedCommitments: [
        { id: "house", remaining: 8040000, billPayableForWork: 3000000 },
      ],
    });
    expect(workBalances(ledger, "roof")).toMatchObject({
      valid: true,
      netPaid: 1500000,
      billPayable: 0,
      scopedOutstanding: 0,
      totalOutstanding: null,
      sharedOutstanding: 8040000,
    });
  });
  it("does not turn a house agreement's optional old work ID into an allocation", () => {
    const ledger = fixture([], [{ ...agreement("house"), scope: "house" }]);
    for (const work of ["work", "roof"])
      expect(workBalances(ledger, work)).toMatchObject({
        valid: true,
        scopedOutstanding: 0,
        totalOutstanding: null,
        sharedOutstanding: 12540000,
      });
  });
  it("uses explicit payment splits once and keeps other notebooks out of the paid total", () => {
    const payment = {
      ...cash("split", 5000000, "worker", "house"),
      allocations: [
        { workId: "work", amount: 3500000 },
        { workId: "roof", amount: 1500000 },
      ],
    };
    const ledger = fixture(
      [payment],
      [{ ...agreement("house"), scope: "house", workId: null }],
    );
    expect(workBalances(ledger, "work")).toMatchObject({
      valid: true,
      netPaid: 3500000,
      sharedOutstanding: 7540000,
      totalOutstanding: null,
    });
    expect(workBalances(ledger, "roof")).toMatchObject({
      valid: true,
      netPaid: 1500000,
      sharedOutstanding: 7540000,
      totalOutstanding: null,
    });
  });
  it("keeps over-agreement shared bills visible after the agreed amount was paid", () => {
    const ledger = fixture(
      [
        cost("earned", 16000000, "worker", "house"),
        cash("paid", 12540000, "worker", "house"),
      ],
      [{ ...agreement("house"), scope: "house", workId: null }],
    );
    expect(workBalances(ledger, "work")).toMatchObject({
      valid: true,
      billPayable: 3460000,
      scopedOutstanding: 3460000,
      sharedOutstanding: 3460000,
      totalOutstanding: null,
    });
  });
  it("keeps fully settled shared contracts from making every notebook ambiguous", () => {
    const ledger = fixture(
      [cash("paid", 12540000, "worker", "house")],
      [{ ...agreement("house"), scope: "house", workId: null }],
    );
    expect(workBalances(ledger, "work")).toMatchObject({
      valid: true,
      totalOutstanding: 0,
      sharedOutstanding: 0,
      sharedCommitments: [],
    });
  });
  it("retains legacy transport classification instead of counting it as material or wages", () => {
    const ledger = LedgerSchema.parse({
      ...fixture(),
      people: [{ id: "driver", name: "গাড়িচালক", kind: "driver" }],
      entries: [
        {
          ...cost("fare", 100000, "driver", null, "materials"),
          lines: [
            {
              id: "fare-line",
              workId: "work",
              costType: "transport",
              amount: 100000,
            },
          ],
        },
        cash("paid", 40000, "driver", null, "materials"),
      ],
    });
    expect(workBalances(ledger, "work")).toMatchObject({
      valid: true,
      netPaid: 40000,
      totalOutstanding: 60000,
      byAccount: { materials: 0, labour: 0, other: 60000 },
    });
  });
  it("preserves archived obligations and includes archived people without making new costs", () => {
    let ledger = fixture([], [agreement()]);
    ledger = setEntityRemoved(ledger, "contract", "job", true);
    ledger = setEntityRemoved(ledger, "person", "worker", true);
    expect(workBalances(ledger, "work")).toMatchObject({
      valid: true,
      netPaid: 0,
      billPayable: 0,
      totalOutstanding: 12540000,
    });
  });
  it("counts known anonymous linked settlements without offsetting an unrelated unnamed bill", () => {
    const ledger = fixture([
      cost("one", 100000, null, null, "materials"),
      cost("two", 100000, null, null, "materials"),
      {
        ...cash("paid", 100000, null, null, "materials"),
        relatedEntryId: "one",
      },
    ]);
    expect(workBalances(ledger, "work")).toMatchObject({
      valid: true,
      billPayable: 100000,
      totalOutstanding: 100000,
    });
  });
  it("uses refunds and returned goods once while ignoring cancelled and historical rows", () => {
    const ledger = fixture(
      [
        cost("bill", 6000000, "worker", "job"),
        cash("paid", 4500000, "worker", "job"),
        {
          ...cost("credit", 1000000, "worker", "job"),
          kind: "expense_credit",
          relatedEntryId: "bill",
        },
        {
          ...cash("refund", 500000, "worker", "job"),
          kind: "refund",
          relatedEntryId: "bill",
        },
        { ...cash("void", 2000000, "worker", "job"), voided: true },
        {
          ...cost("old", 1000000, "worker", "job"),
          balanceImpact: "historical",
        },
      ],
      [agreement()],
    );
    expect(workBalances(ledger, "work")).toMatchObject({
      valid: true,
      paid: 4500000,
      refunds: 500000,
      netPaid: 4000000,
      billPayable: 1000000,
      workCommitmentOutstanding: 8540000,
      totalOutstanding: 8540000,
    });
  });
  it("refuses an unsafe combined due even when every stored entry is an exact safe integer", () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const ledger = fixture(
      [cost("bill", maximum, "other")],
      [agreement("job", "worker", maximum)],
    );
    expect(workBalances(ledger, "work")).toMatchObject({
      valid: false,
      netPaid: null,
      billPayable: null,
      totalOutstanding: null,
    });
  });
  it("does not show financial zeroes for an unknown notebook", () => {
    expect(workBalances(fixture(), "missing")).toMatchObject({
      valid: false,
      netPaid: null,
      totalOutstanding: null,
    });
  });
});
