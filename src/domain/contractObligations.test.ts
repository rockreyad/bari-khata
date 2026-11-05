import { describe, expect, it } from "vitest";
import { LedgerSchema } from "./model";
import { appendBalanceAdjustment } from "./balanceAdjustments";
import { reconciledTotals } from "./adjustmentMath";
import {
  balanceAdjustmentHistoryIsValid,
  preservesBalanceAdjustments,
} from "./adjustmentHistory";
import { appendEntries, replaceEntry, setEntryVoided } from "./ledger";
import { saveContractChange } from "./contracts";
import { unresolvedContractAdjustmentIds } from "./contractObligations";

function base() {
  return LedgerSchema.parse({
    works: [{ id: "work", name: "নমুনা কাজ" }],
    people: [{ id: "party", name: "নমুনা ব্যক্তি" }],
    contracts: [
      { id: "agreement", personId: "party", workId: "work", total: 100000 },
    ],
    entries: [
      {
        id: "earned",
        kind: "expense",
        personId: "party",
        account: "labour",
        contractId: "agreement",
        lines: [
          { id: "line", workId: "work", costType: "labour", amount: 30000 },
        ],
      },
      {
        id: "paid",
        kind: "payment",
        personId: "party",
        account: "labour",
        contractId: "agreement",
        allocations: [{ workId: "work", amount: 10000 }],
        paymentParts: [{ amount: 10000 }],
      },
    ],
  });
}
function legacy() {
  return LedgerSchema.parse({
    ...base(),
    entries: [
      ...base().entries,
      {
        id: "old-correction",
        kind: "adjustment",
        personId: "party",
        account: "labour",
        contractId: "agreement",
        note: "নমুনা পুরোনো চুক্তির ছাড়",
        adjustment: {
          target: "person",
          basis: "balance",
          account: "labour",
          workId: "work",
          before: 90000,
          after: 80000,
          delta: -10000,
        },
      },
    ],
  });
}
function addLaterBill(ledger: ReturnType<typeof base>) {
  return appendEntries(ledger, [
    LedgerSchema.parse({
      ...base(),
      entries: [
        {
          ...base().entries[0],
          id: "later-earned",
          lines: [
            { ...base().entries[0].lines[0], id: "later-line", amount: 70000 },
          ],
        },
      ],
    }).entries[0],
  ]);
}

describe("stable interpretation of contract balance corrections", () => {
  it("never treats a later bill or changed agreement as proof of an old correction's meaning", () => {
    const original = legacy();
    const source = structuredClone(original.entries.at(-1));
    expect([...unresolvedContractAdjustmentIds(original)]).toEqual([
      "old-correction",
    ]);
    expect(reconciledTotals(original)).toMatchObject({
      reconciledPayable: 20000,
      balanceAmbiguous: true,
    });
    const later = addLaterBill(original);
    expect(reconciledTotals(later)).toMatchObject({
      reconciledPayable: 90000,
      balanceAmbiguous: true,
      reconciledAdvance: 0,
    });
    for (const total of [20000, 100000, 1000000]) {
      const edited = saveContractChange(
        later,
        { ...later.contracts[0], total },
        "নমুনা দর বদলেছি",
      );
      expect([...unresolvedContractAdjustmentIds(edited)]).toEqual([
        "old-correction",
      ]);
      expect(reconciledTotals(edited)).toMatchObject({
        reconciledPayable: 90000,
        balanceAmbiguous: true,
      });
      expect(
        edited.entries.find((entry) => entry.id === "old-correction"),
      ).toEqual(source);
    }
  });
  it("stamps a genuinely new earned correction after the stale-baseline check and retains the marker in history", () => {
    const corrected = appendBalanceAdjustment(base(), {
      target: "person",
      basis: "balance",
      personId: "party",
      account: "labour",
      contractId: "agreement",
      expectedBefore: 20000,
      after: 15000,
      reason: "নমুনা কাজের পাওনা মিলিয়েছি",
    });
    const entry = corrected.entries.at(-1)!;
    expect(entry.adjustment?.calculationVersion).toBe(2);
    expect([...unresolvedContractAdjustmentIds(corrected)]).toEqual([]);
    expect(reconciledTotals(addLaterBill(corrected))).toMatchObject({
      reconciledPayable: 85000,
      balanceAmbiguous: false,
    });
    const cancelled = setEntryVoided(corrected, entry.id, true);
    expect(
      cancelled.entries.at(-1)?.revisions[0].before.adjustment
        ?.calculationVersion,
    ).toBe(2);
    expect(preservesBalanceAdjustments(corrected, cancelled)).toBe(true);
    expect(
      setEntryVoided(cancelled, entry.id, false).entries.at(-1)?.adjustment
        ?.calculationVersion,
    ).toBe(2);
    expect(() =>
      appendBalanceAdjustment(base(), {
        target: "person",
        basis: "balance",
        personId: "party",
        account: "labour",
        contractId: "agreement",
        expectedBefore: 90000,
        after: 80000,
        reason: "নমুনা পুরোনো ভিত্তি",
      }),
    ).toThrow("stale");
  });
  it("rejects retyping an old correction as earned or stripping the marker from an established correction", () => {
    const old = legacy();
    const promoted = LedgerSchema.parse({
      ...old,
      entries: old.entries.map((entry) =>
        entry.id === "old-correction"
          ? {
              ...entry,
              adjustment: { ...entry.adjustment, calculationVersion: 2 },
            }
          : entry,
      ),
    });
    expect(preservesBalanceAdjustments(old, promoted)).toBe(false);
    expect(preservesBalanceAdjustments(promoted, old)).toBe(false);
    expect(() => replaceEntry(old, promoted.entries.at(-1)!)).toThrow(
      "immutable",
    );
    const fabricated = setEntryVoided(promoted, "old-correction", true);
    fabricated.entries.at(
      -1,
    )!.revisions[0].before.adjustment!.calculationVersion = undefined;
    expect(balanceAdjustmentHistoryIsValid(fabricated)).toBe(false);
    for (const calculationVersion of [1, 3, null])
      expect(
        LedgerSchema.safeParse({
          ...old,
          entries: old.entries.map((entry) =>
            entry.id === "old-correction"
              ? {
                  ...entry,
                  adjustment: { ...entry.adjustment, calculationVersion },
                }
              : entry,
          ),
        }).success,
      ).toBe(false);
  });
});
