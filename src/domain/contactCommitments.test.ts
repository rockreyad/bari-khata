import { describe, expect, it } from "vitest";
import { jobBalances } from "../features/jobs/jobView";
import { appendBalanceAdjustment } from "./balanceAdjustments";
import { contactCommitmentSummary } from "./contactCommitments";
import { contactSummary } from "./contacts";
import { contractSummary, summarize } from "./ledger";
import { LedgerSchema } from "./model";

const cash = (
  id: string,
  contractId: string | null,
  workId: string,
  amount: number,
  extra = {},
) => ({
  id,
  kind: "payment",
  personId: "worker",
  account: "labour",
  contractId,
  paymentParts: [{ amount }],
  allocations: [{ workId, amount }],
  ...extra,
});
const bill = (id: string, amount: number, extra = {}) => ({
  id,
  kind: "expense",
  personId: "worker",
  account: "labour",
  lines: [{ id: `${id}-line`, workId: "roof", amount, costType: "labour" }],
  ...extra,
});
function fixture() {
  return LedgerSchema.parse({
    works: [
      { id: "roof", name: "নমুনা ছাদ" },
      { id: "sand", name: "নমুনা বালুর কাজ" },
      { id: "other", name: "নমুনা অন্য কাজ" },
    ],
    people: [{ id: "worker", name: "নমুনা কর্মী", kind: "worker" }],
    contracts: [
      {
        id: "house",
        personId: "worker",
        scope: "house",
        status: "ongoing",
        total: 60000000,
      },
      {
        id: "sand-job",
        personId: "worker",
        workId: "sand",
        status: "done",
        total: 600000,
      },
      {
        id: "other-job",
        personId: "worker",
        workId: "other",
        status: "done",
        total: 140000,
      },
    ],
    entries: [
      cash("house-cash", "house", "roof", 54150000),
      cash("sand-cash", "sand-job", "sand", 300000),
    ],
  });
}
function reconcilePaidTotal(after: number) {
  const ledger = fixture();
  return appendBalanceAdjustment(ledger, {
    target: "person",
    basis: "paid",
    personId: "worker",
    account: "labour",
    expectedBefore: 54450000,
    after,
    reason: "নমুনা দেওয়া টাকার মোট মিলিয়েছি",
  });
}

describe("contact remaining promises as a separate presentation", () => {
  it("includes ongoing promises and completed dues without turning promises into earned expense", () => {
    const ledger = fixture();
    const source = structuredClone(ledger);
    expect(contactCommitmentSummary(ledger, "worker")).toEqual({
      remaining: 6290000,
      extra: 0,
      contractRemaining: 6290000,
      nonContractRemaining: 0,
      baseExtra: 0,
      correctionEffect: 0,
      balanceAmbiguous: false,
      reviewEntryIds: [],
      valid: true,
    });
    expect(contractSummary(ledger, "house")).toMatchObject({
      earned: 0,
      remaining: 0,
      remainingCommitment: 5850000,
      commitmentExtra: 0,
      commitmentState: "due",
      commitmentValid: true,
    });
    expect(jobBalances(ledger).get("house")).toMatchObject({
      remainingCommitment: 5850000,
      commitmentExtra: 0,
      commitmentState: "due",
    });
    expect(summarize(ledger)).toMatchObject({
      actualCost: 0,
      reconciledCost: 740000,
      cashPaid: 54450000,
    });
    expect(ledger).toEqual(source);
  });

  it("does not let an ongoing job's unearned cash erase other promises when a correction pool nets to zero", () => {
    const increased = reconcilePaidTotal(54450100);
    const ledger = appendBalanceAdjustment(increased, {
      target: "person",
      basis: "paid",
      personId: "worker",
      account: "labour",
      expectedBefore: 54450100,
      after: 54450000,
      reason: "নমুনা আগের অঙ্ক ফিরিয়েছি",
    });
    expect(contactSummary(ledger, ledger.people[0]).reconciledPayable).toBe(0);
    expect(contactCommitmentSummary(ledger, "worker")).toMatchObject({
      remaining: 6290000,
      contractRemaining: 6290000,
      correctionEffect: 0,
      balanceAmbiguous: false,
      valid: true,
    });
  });

  it("honors a nonzero person correction once without inventing its distribution over jobs", () => {
    const ledger = reconcilePaidTotal(59100200);
    const source = structuredClone(ledger);
    expect(contactCommitmentSummary(ledger, "worker")).toMatchObject({
      remaining: 1639800,
      contractRemaining: 6290000,
      correctionEffect: -4650200,
      balanceAmbiguous: false,
    });
    expect(contractSummary(ledger, "house").remainingCommitment).toBe(5850000);
    expect(contractSummary(ledger, "sand-job").remainingCommitment).toBe(
      300000,
    );
    expect(contractSummary(ledger, "other-job").remainingCommitment).toBe(
      140000,
    );
    expect(contactSummary(ledger, ledger.people[0])).toMatchObject({
      reconciledCost: 740000,
      actualPaid: 54450000,
      reconciledNetPaid: 59100200,
    });
    expect(ledger).toEqual(source);
  });

  it("counts explicit extra bills independently and avoids adding a linked bill to its agreement twice", () => {
    const base = fixture();
    const ledger = LedgerSchema.parse({
      ...base,
      entries: [
        ...base.entries,
        bill("extra", 20000),
        bill("linked", 100000, { contractId: "house" }),
      ],
    });
    expect(contactCommitmentSummary(ledger, "worker")).toMatchObject({
      remaining: 6310000,
      contractRemaining: 6290000,
      nonContractRemaining: 20000,
      balanceAmbiguous: false,
    });
  });

  it("uses earned bills above the agreed amount and reports only excess above that promise", () => {
    const base = fixture();
    const ledger = LedgerSchema.parse({
      ...base,
      contracts: [{ ...base.contracts[0], total: 10000 }],
      entries: [
        bill("linked", 12000, { contractId: "house" }),
        cash("paid", "house", "roof", 13000),
      ],
    });
    expect(contactCommitmentSummary(ledger, "worker")).toMatchObject({
      remaining: 0,
      extra: 1000,
    });
    expect(contractSummary(ledger, "house")).toMatchObject({
      remainingCommitment: 0,
      commitmentExtra: 1000,
      commitmentState: "overpaid",
    });
    expect(jobBalances(ledger).get("house")).toMatchObject({
      commitmentExtra: 1000,
      commitmentState: "overpaid",
      commitmentValid: true,
    });
  });

  it("restores remaining money after a refund and keeps refundable deposits separate", () => {
    const base = fixture();
    const ledger = LedgerSchema.parse({
      ...base,
      entries: [
        ...base.entries,
        cash("refund", "sand-job", "sand", 100000, { kind: "refund" }),
        cash("deposit", "house", "roof", 100000, {
          paymentContext: "receivable",
        }),
      ],
    });
    expect(contactCommitmentSummary(ledger, "worker")).toMatchObject({
      remaining: 6390000,
      extra: 0,
    });
  });

  it("keeps notebook and account scopes explicit without allocating a whole-house promise arbitrarily", () => {
    const ledger = fixture();
    expect(
      contactCommitmentSummary(ledger, "worker", { workId: "sand" }).remaining,
    ).toBe(300000);
    expect(
      contactCommitmentSummary(ledger, "worker", { workId: "other" }).remaining,
    ).toBe(140000);
    expect(
      contactCommitmentSummary(ledger, "worker", { workId: "roof" }).remaining,
    ).toBe(0);
    expect(
      contactCommitmentSummary(ledger, "worker", { account: "materials" })
        .remaining,
    ).toBe(0);
    expect(
      contactCommitmentSummary(ledger, "worker", { account: "labour" })
        .remaining,
    ).toBe(6290000);
  });

  it("retains known promises but flags actual historical overlap instead of silently counting that bill again", () => {
    const base = fixture();
    const ledger = LedgerSchema.parse({
      ...base,
      entries: [
        ...base.entries,
        bill("old-unknown", 20000, { balanceImpact: "historical" }),
      ],
    });
    expect(contactCommitmentSummary(ledger, "worker")).toMatchObject({
      remaining: 6290000,
      balanceAmbiguous: true,
      reviewEntryIds: ["old-unknown"],
      valid: true,
    });
  });

  it("keeps an unmarked legacy contract correction unresolved without hiding the known commitment", () => {
    const base = fixture();
    const ledger = LedgerSchema.parse({
      ...base,
      entries: [
        ...base.entries,
        {
          id: "old-discount",
          kind: "adjustment",
          personId: "worker",
          account: "labour",
          contractId: "sand-job",
          note: "নমুনা পুরোনো সংশোধন",
          adjustment: {
            target: "person",
            basis: "balance",
            account: "labour",
            workId: "sand",
            before: 300000,
            after: 200000,
            delta: -100000,
          },
        },
      ],
    });
    expect(contactCommitmentSummary(ledger, "worker")).toMatchObject({
      remaining: 6290000,
      balanceAmbiguous: true,
      reviewEntryIds: ["old-discount"],
    });
    expect(jobBalances(ledger).get("sand-job")?.commitmentValid).toBe(false);
  });

  it("reports the full signed correction when it crosses zero into an excess credit", () => {
    const base = fixture();
    const smaller = LedgerSchema.parse({
      ...base,
      contracts: [{ ...base.contracts[0], total: 100000 }],
      entries: [cash("paid", "house", "roof", 40000)],
    });
    const ledger = appendBalanceAdjustment(smaller, {
      target: "person",
      basis: "paid",
      personId: "worker",
      account: "labour",
      expectedBefore: 40000,
      after: 110000,
      reason: "নমুনা মোট দেওয়া টাকা ঠিক করেছি",
    });
    expect(contactCommitmentSummary(ledger, "worker")).toMatchObject({
      remaining: 0,
      extra: 10000,
      contractRemaining: 60000,
      baseExtra: 0,
      correctionEffect: -70000,
    });
  });

  it("returns an invalid projection for unknown scopes instead of a trusted zero", () => {
    const ledger = fixture();
    expect(contactCommitmentSummary(ledger, "missing").valid).toBe(false);
    expect(
      contactCommitmentSummary(ledger, "worker", { workId: "missing" }).valid,
    ).toBe(false);
  });

  it("keeps allocation reference evidence when an account filter separates legacy transport cash and bills", () => {
    const base = fixture();
    const ledger = LedgerSchema.parse({
      ...base,
      entries: [
        ...base.entries,
        bill("transport", 10000, {
          account: "materials",
          lines: [
            {
              id: "transport-line",
              workId: "roof",
              amount: 10000,
              costType: "transport",
            },
          ],
        }),
        bill("material", 5000, {
          account: "materials",
          lines: [
            {
              id: "material-line",
              workId: "roof",
              amount: 5000,
              costType: "material",
            },
          ],
        }),
        cash("transport-cash", null, "roof", 10000, {
          account: "materials",
          paymentContext: "settlement",
        }),
      ],
      paymentAllocations: [
        {
          id: "match",
          billId: "transport",
          paymentId: "transport-cash",
          workId: "roof",
          amount: 10000,
          createdAt: "2026-11-05T00:00:00Z",
        },
      ],
    });
    expect(
      contactCommitmentSummary(ledger, "worker", { account: "materials" }),
    ).toMatchObject({
      remaining: 0,
      extra: 5000,
      valid: true,
      balanceAmbiguous: false,
    });
  });
});
