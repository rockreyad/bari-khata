import { describe, expect, it } from "vitest";
import { cashSummary } from "./cashSummary";
import { personSummary, summarize } from "./ledger";
import { EntrySchema, LedgerSchema } from "./model";
import { mixedLedger } from "./testing/mixedNumericLedger";

const paisa = (taka: number) => taka * 100;

describe.each(["English", "Bengali"] as const)("%s cash overview", (script) => {
  it("agrees with global, work and person cash totals while keeping unpaid bills out", () => {
    const ledger = mixedLedger(script);
    const snapshot = JSON.stringify(ledger);
    const cash = cashSummary(ledger);
    expect(cash).toMatchObject({
      paid: paisa(90200),
      refunds: paisa(1000),
      netPaid: paisa(89200),
    });
    expect(cash.netPaid).toBe(summarize(ledger).netPaid);
    expect(cash.netPaid).not.toBe(summarize(ledger).cost);
    expect(cash.entries).toHaveLength(9);
    expect(cash.rows).toHaveLength(10);
    for (const [workId, expected] of [
      ["door", 82700],
      ["roof", 6500],
    ] as const) {
      const own = cashSummary(ledger, { workId });
      expect(own.netPaid).toBe(paisa(expected));
      expect(own.netPaid).toBe(summarize(ledger, workId).netPaid);
      expect(own.rows.every((row) => row.workId === workId)).toBe(true);
    }
    for (const person of ledger.people) {
      expect(cashSummary(ledger, { personId: person.id }).netPaid).toBe(
        personSummary(ledger, person.id).netPaid,
      );
    }
    expect(
      cashSummary(ledger, { personId: "shop", workId: "roof" }).netPaid,
    ).toBe(paisa(1500));
    expect(JSON.stringify(ledger)).toBe(snapshot);
  });

  it("partitions every paid paisa exactly once by account, work and contact including refunds", () => {
    const ledger = mixedLedger(script);
    const cash = cashSummary(ledger);
    expect(cash.byAccount).toEqual({
      materials: paisa(48000),
      labour: paisa(41000),
      other: paisa(200),
    });
    expect(
      Object.values(cash.byAccount).reduce((sum, amount) => sum + amount, 0),
    ).toBe(cash.netPaid);
    expect(cash.byWork).toEqual([
      { id: "door", amount: paisa(82700) },
      { id: "roof", amount: paisa(6500) },
    ]);
    expect(cash.byWork.reduce((sum, row) => sum + row.amount, 0)).toBe(
      cash.netPaid,
    );
    expect(cash.byPerson.reduce((sum, row) => sum + row.amount, 0)).toBe(
      cash.netPaid,
    );
    for (const [account, expected] of Object.entries(cash.byAccount)) {
      expect(
        cashSummary(ledger, {
          account: account as "materials" | "labour" | "other",
        }).netPaid,
      ).toBe(expected);
    }
    const split = cash.rows.filter((row) => row.entry.id === "split-payment");
    expect(split.map((row) => [row.workId, row.amount])).toEqual([
      ["door", paisa(500)],
      ["roof", paisa(1500)],
    ]);
    expect(
      cash.entries.filter((entry) => entry.id === "split-payment"),
    ).toHaveLength(1);
    expect(cash.rows.every((row) => Number.isSafeInteger(row.amount))).toBe(
      true,
    );
  });

  it("includes contract cash and explicit advances immediately, without inventing another bill", () => {
    const ledger = mixedLedger(script);
    for (const [personId, account, expected] of [
      ["mason", "labour", 30000],
      ["advance-shop", "materials", 5000],
    ] as const) {
      const own = cashSummary(ledger, { personId, account });
      expect(own.netPaid).toBe(paisa(expected));
      expect(own.entries).toHaveLength(1);
      expect(own.entries[0].kind).toBe("payment");
      expect(personSummary(ledger, personId).cost).toBe(0);
      expect(personSummary(ledger, personId).advance).toBe(paisa(expected));
    }
  });

  it("uses inclusive dates, keeps a refund negative and scopes search to each split allocation", () => {
    const ledger = mixedLedger(script);
    const october = cashSummary(ledger, {
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(october).toMatchObject({
      paid: paisa(24000),
      refunds: paisa(1000),
      netPaid: paisa(23000),
    });
    expect(
      cashSummary(ledger, { from: "2026-10-06", to: "2026-10-06" }),
    ).toMatchObject({
      paid: 0,
      refunds: paisa(1000),
      netPaid: -paisa(1000),
      byAccount: { materials: -paisa(1000), labour: 0, other: 0 },
    });
    const roof = cashSummary(ledger, { query: "ছাদ" });
    expect(roof.netPaid).toBe(paisa(6500));
    expect(roof.rows.every((row) => row.workId === "roof")).toBe(true);
    const workerPayment = ledger.entries.find(
      (entry) =>
        entry.kind === "payment" &&
        entry.personId === "worker" &&
        entry.date === "2026-10-01",
    )!;
    workerPayment.note = "বিল ১৬২";
    for (const query of ["162", "১৬২"]) {
      expect(cashSummary(ledger, { query }).netPaid).toBe(paisa(5000));
    }
    expect(
      cashSummary(ledger, {
        workId: "roof",
        personId: "shop",
        account: "materials",
        from: "2026-10-07",
        to: "2026-10-07",
      }).netPaid,
    ).toBe(paisa(1500));
  });
});

it("omits historical settlement assumptions and voids, and includes undated cash only without a date filter", () => {
  const ledger = mixedLedger("Bengali");
  const historical = {
    balanceImpact: "historical",
    personId: "worker",
    account: "labour",
    date: "2026-09-01",
  };
  ledger.entries.push(
    EntrySchema.parse({
      ...historical,
      id: "historical-bill",
      kind: "expense",
      lines: [
        {
          id: "historical-line",
          workId: "door",
          label: "পুরোনো মজুরি",
          costType: "labour",
          amount: paisa(1234),
        },
      ],
    }),
    EntrySchema.parse({
      ...historical,
      id: "historical-cash",
      kind: "payment",
      allocations: [{ workId: "door", amount: paisa(9999) }],
      paymentParts: [{ method: "cash", amount: paisa(9999) }],
    }),
    EntrySchema.parse({
      ...historical,
      id: "historical-refund",
      kind: "refund",
      allocations: [{ workId: "door", amount: paisa(8888) }],
      paymentParts: [{ method: "cash", amount: paisa(8888) }],
    }),
    EntrySchema.parse({
      id: "undated-cash",
      date: null,
      kind: "payment",
      personId: "shop",
      allocations: [{ workId: "door", amount: paisa(700) }],
      paymentParts: [{ method: "cash", amount: paisa(700) }],
    }),
  );
  const restored = LedgerSchema.parse(ledger);
  expect(summarize(restored).cost).toBe(paisa(144434));
  expect(cashSummary(restored).netPaid).toBe(paisa(89900));
  expect(cashSummary(restored).netPaid).toBe(summarize(restored).netPaid);
  expect(cashSummary(restored, { from: "2026-01-01" }).netPaid).toBe(
    paisa(89200),
  );
  expect(
    cashSummary(restored).entries.some(
      (entry) => entry.balanceImpact === "historical" || entry.voided,
    ),
  ).toBe(false);
});
