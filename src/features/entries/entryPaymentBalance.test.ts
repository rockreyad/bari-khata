import { describe, expect, it } from "vitest";
import { appendBalanceAdjustment } from "../../domain/balanceAdjustments";
import { partyAccountBalance, setEntryVoided } from "../../domain/ledger";
import { EntrySchema, LedgerSchema, type Ledger } from "../../domain/model";
import { entryPaymentBalance } from "./entryPaymentBalance";

const at = "2026-11-04T08:00:00.000Z";

function fixture(): Ledger {
  return LedgerSchema.parse({
    works: [
      { id: "door", name: "নমুনা দরজা" },
      { id: "roof", name: "নমুনা ছাদ" },
    ],
    people: [
      { id: "worker", name: "নমুনা মিস্ত্রি", kind: "worker" },
      { id: "other", name: "অন্য নমুনা মিস্ত্রি", kind: "worker" },
    ],
    contracts: [
      { id: "door-job", personId: "worker", workId: "door", total: 150000 },
      { id: "roof-job", personId: "worker", workId: "roof", total: 250000 },
    ],
    entries: [
      {
        id: "door-paid",
        kind: "payment",
        personId: "worker",
        account: "labour",
        contractId: "door-job",
        allocations: [{ workId: "door", amount: 180000 }],
        paymentParts: [{ amount: 180000 }],
      },
      {
        id: "roof-paid",
        kind: "payment",
        personId: "worker",
        account: "labour",
        contractId: "roof-job",
        allocations: [{ workId: "roof", amount: 250000 }],
        paymentParts: [{ amount: 250000 }],
      },
    ],
  });
}

function reconcilePaid(ledger: Ledger, after = 400000) {
  return appendBalanceAdjustment(
    ledger,
    {
      target: "person",
      basis: "paid",
      personId: "worker",
      account: "labour",
      expectedBefore: 430000,
      after,
      reason: "নমুনা মোট দেওয়া টাকা মিলিয়েছি",
    },
    at,
  );
}

const preview = (ledger: Ledger, contractId: string | null = null) =>
  entryPaymentBalance(ledger, ledger.people[0], "labour", contractId);

describe("payment balance after a person's total is reconciled", () => {
  it("does not turn a paid correction into other-work debt, and keeps a later payment as credit", () => {
    const original = fixture();
    const settled = reconcilePaid(original);

    expect(preview(settled)).toEqual({ balance: 0, acrossJobs: true });
    const paidAgain = LedgerSchema.parse({
      ...settled,
      entries: [
        ...settled.entries,
        EntrySchema.parse({
          id: "later-paid",
          kind: "payment",
          personId: "worker",
          account: "labour",
          allocations: [{ workId: "door", amount: 10000 }],
          paymentParts: [{ amount: 10000 }],
        }),
      ],
    });

    expect(preview(paidAgain)).toEqual({ balance: -10000, acrossJobs: true });
    expect(
      preview(LedgerSchema.parse(JSON.parse(JSON.stringify(paidAgain)))),
    ).toEqual({ balance: -10000, acrossJobs: true });
    expect(paidAgain.entries.slice(0, 2)).toEqual(original.entries);
    expect(paidAgain.contracts).toEqual(original.contracts);
  });

  it.each([
    [390000, 10000],
    [450000, -50000],
  ])(
    "shows the real balance when paid total is corrected to %i",
    (after, balance) => {
      expect(preview(reconcilePaid(fixture(), after))).toEqual({
        balance,
        acrossJobs: true,
      });
    },
  );

  it("keeps individual jobs out of other work when there is no person correction", () => {
    expect(preview(fixture())).toEqual({ balance: 0, acrossJobs: false });
  });

  it("keeps a selected job separate from the unallocated person correction", () => {
    const ledger = reconcilePaid(fixture());
    expect(preview(ledger, "door-job")).toEqual({
      balance: partyAccountBalance(ledger, "worker", "labour", "door-job")
        .balance,
      acrossJobs: false,
    });
    expect(preview(ledger, "roof-job")).toEqual({
      balance: partyAccountBalance(ledger, "worker", "labour", "roof-job")
        .balance,
      acrossJobs: false,
    });
  });

  it("does not use a voided person correction to switch to all jobs", () => {
    const adjusted = reconcilePaid(fixture());
    const ledger = setEntryVoided(adjusted, adjusted.entries.at(-1)!.id, true);
    expect(preview(ledger)).toEqual({ balance: 0, acrossJobs: false });
  });

  it.each(["other-account", "other-person", "work-target"] as const)(
    "does not switch to all jobs for an unrelated %s correction",
    (scope) => {
      const original = fixture();
      const input =
        scope === "work-target"
          ? {
              target: "work" as const,
              account: null,
              workId: "door",
              expectedBefore: 180000,
              after: 150000,
            }
          : {
              target: "person" as const,
              personId: scope === "other-person" ? "other" : "worker",
              account:
                scope === "other-account"
                  ? ("materials" as const)
                  : ("labour" as const),
              expectedBefore: 0,
              after: 10000,
            };
      const ledger = appendBalanceAdjustment(
        original,
        {
          ...input,
          basis: "paid",
          reason: "নমুনা অন্য হিসাব মিলিয়েছি",
        },
        at,
      );
      expect(preview(ledger)).toEqual({ balance: 0, acrossJobs: false });
    },
  );

  it("includes a person correction scoped to a notebook across its jobs", () => {
    const ledger = appendBalanceAdjustment(
      fixture(),
      {
        target: "person",
        basis: "paid",
        personId: "worker",
        account: "labour",
        workId: "door",
        expectedBefore: 180000,
        after: 150000,
        reason: "নমুনা দরজার দেওয়া টাকা মিলিয়েছি",
      },
      at,
    );
    expect(preview(ledger)).toEqual({ balance: 0, acrossJobs: true });
  });

  it("includes archived jobs in the reconciled account", () => {
    const adjusted = reconcilePaid(fixture());
    const ledger = LedgerSchema.parse({
      ...adjusted,
      contracts: adjusted.contracts.map((job) => ({
        ...job,
        archivedAt: at,
        removalHistory: [{ id: `archive-${job.id}`, at, archived: true }],
      })),
    });
    expect(preview(ledger)).toEqual({ balance: 0, acrossJobs: true });
  });

  it("leaves the combined balance unknown when an unlinked wage bill may belong to an agreed job", () => {
    const ledger = appendBalanceAdjustment(
      LedgerSchema.parse({
        works: [{ id: "door", name: "নমুনা দরজা" }],
        people: [{ id: "worker", name: "নমুনা মিস্ত্রি", kind: "worker" }],
        contracts: [
          { id: "door-job", personId: "worker", workId: "door", total: 100000 },
        ],
        entries: [
          {
            id: "unlinked-wage",
            kind: "expense",
            personId: "worker",
            account: "labour",
            lines: [
              {
                id: "unlinked-line",
                workId: "door",
                costType: "labour",
                amount: 100000,
              },
            ],
          },
        ],
      }),
      {
        target: "person",
        basis: "paid",
        personId: "worker",
        account: "labour",
        expectedBefore: 0,
        after: 10000,
        reason: "নমুনা দেওয়া টাকা মিলিয়েছি",
      },
      at,
    );
    expect(preview(ledger)).toEqual({ balance: null, acrossJobs: true });
  });

  it("keeps a person with no jobs in the ordinary running account", () => {
    const ledger = appendBalanceAdjustment(
      LedgerSchema.parse({
        works: [{ id: "door", name: "নমুনা দরজা" }],
        people: [{ id: "worker", name: "নমুনা মিস্ত্রি", kind: "worker" }],
      }),
      {
        target: "person",
        basis: "paid",
        personId: "worker",
        account: "labour",
        expectedBefore: 0,
        after: 10000,
        reason: "নমুনা দেওয়া টাকা মিলিয়েছি",
      },
      at,
    );
    expect(preview(ledger)).toEqual({ balance: -10000, acrossJobs: false });
  });
});
