import { describe, expect, it } from "vitest";
import { contactAccountLedger, contactAccountSummary } from "./contacts";
import { effectiveAccounts } from "./effectiveAccounts";
import { personSummary, summarize } from "./ledger";
import { LedgerSchema, type Ledger } from "./model";

function fixture({
  legacyCash = false,
  cancelledMixed = false,
  mixed = false,
  cancelledTrip = false,
  linked = false,
} = {}) {
  return LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
    people: [{ id: "driver", name: "রনি", kind: "driver" }],
    entries: [
      {
        id: "trip",
        kind: "expense",
        account: "materials",
        personId: "driver",
        voided: cancelledTrip,
        lines: [
          {
            id: "t",
            workId: "door",
            costType: "transport",
            label: "ভ্যানভাড়া",
            amount: 100000,
          },
        ],
      },
      {
        id: "paid",
        kind: "payment",
        account: legacyCash ? "materials" : "other",
        personId: "driver",
        relatedEntryId: linked ? "trip" : null,
        allocations: [{ workId: "door", amount: 100000 }],
        paymentParts: [{ amount: 100000 }],
      },
      ...(mixed || cancelledMixed
        ? [
            {
              id: "mixed",
              kind: "expense",
              account: "materials",
              personId: "driver",
              voided: cancelledMixed,
              lines: [
                {
                  id: "m",
                  workId: "door",
                  costType: "material",
                  label: "মাল",
                  amount: 10000,
                },
                {
                  id: "v",
                  workId: "door",
                  costType: "transport",
                  label: "আলাদা গাড়িভাড়া",
                  amount: 10000,
                },
              ],
            },
          ]
        : []),
    ],
  });
}
function expectSettled(ledger: Ledger) {
  const expected = { cost: 100000, netPaid: 100000, payable: 0, advance: 0 };
  expect(summarize(ledger)).toMatchObject(expected);
  expect(summarize(ledger, "door")).toMatchObject(expected);
  expect(personSummary(ledger, "driver")).toMatchObject(expected);
  expect(personSummary(ledger, "driver", "door")).toMatchObject(expected);
  expect(contactAccountSummary(ledger, ledger.people[0])).toMatchObject(
    expected,
  );
  expect(
    contactAccountSummary(ledger, ledger.people[0], "other", "door"),
  ).toMatchObject(expected);
}

describe("a driver's effective transport account", () => {
  it("settles an older materials-account transport bill with a payment from the current driver account", () => {
    const ledger = fixture();
    const before = structuredClone(ledger);
    expectSettled(ledger);
    const summary = personSummary(ledger, "driver");
    expect(summary.accounts.other).toMatchObject({
      cost: 100000,
      netPaid: 100000,
      payable: 0,
      advance: 0,
    });
    expect(summary.accounts.materials).toMatchObject({ cost: 0, netPaid: 0 });
    expect(
      contactAccountLedger(ledger, ledger.people[0], "materials").entries,
    ).toEqual([]);
    expect(ledger).toEqual(before);
    expect(ledger.entries.map((entry) => entry.account)).toEqual([
      "materials",
      "other",
    ]);
  });
  it("ignores a cancelled mixed bill when identifying older unlinked transport payments", () => {
    const ledger = fixture({ legacyCash: true, cancelledMixed: true });
    expectSettled(ledger);
    expect(effectiveAccounts(ledger).get("paid")).toBe("other");
    expect(
      contactAccountLedger(ledger, ledger.people[0]).entries.map(
        (entry) => entry.id,
      ),
    ).toEqual(["trip", "paid"]);
    expect(ledger.entries.find((entry) => entry.id === "mixed")?.voided).toBe(
      true,
    );
  });
  it("keeps a mixed active bill and ambiguous unlinked material cash in the original material account", () => {
    const ledger = fixture({ legacyCash: true, mixed: true });
    const accounts = effectiveAccounts(ledger);
    expect(accounts.get("trip")).toBe("other");
    expect(accounts.get("mixed")).toBe("materials");
    expect(accounts.get("paid")).toBe("materials");
    expect(contactAccountSummary(ledger, ledger.people[0])).toMatchObject({
      cost: 100000,
      netPaid: 0,
      payable: 100000,
      advance: 0,
    });
    expect(
      contactAccountSummary(ledger, ledger.people[0], "materials"),
    ).toMatchObject({ cost: 20000, netPaid: 100000, advance: 80000 });
  });
  it("keeps linked paid money visible after its original transport bill is cancelled", () => {
    const ledger = fixture({
      legacyCash: true,
      cancelledTrip: true,
      linked: true,
    });
    expect(effectiveAccounts(ledger).get("paid")).toBe("other");
    expect(summarize(ledger)).toMatchObject({
      cost: 0,
      netPaid: 100000,
      payable: 0,
      advance: 100000,
    });
    expect(contactAccountSummary(ledger, ledger.people[0])).toMatchObject({
      cost: 0,
      netPaid: 100000,
      payable: 0,
      advance: 100000,
    });
    expect(
      contactAccountLedger(ledger, ledger.people[0]).entries.map(
        (entry) => entry.id,
      ),
    ).toEqual(["trip", "paid"]);
    expect(ledger.entries.find((entry) => entry.id === "trip")?.voided).toBe(
      true,
    );
  });
  it("does not reinterpret shops, workers or unrelated material and wage accounts", () => {
    for (const kind of ["shop", "worker", "other"] as const) {
      const ledger = fixture();
      ledger.people[0].kind = kind;
      expect(effectiveAccounts(ledger).get("trip")).toBe("materials");
      expect(summarize(ledger)).toMatchObject({
        cost: 100000,
        netPaid: 100000,
        payable: 100000,
        advance: 100000,
      });
    }
  });
  it("does not let another driver's material purchase make this driver's payment ambiguous", () => {
    const ledger = fixture({ legacyCash: true });
    ledger.people.push({ ...ledger.people[0], id: "another-driver" });
    ledger.entries.push({
      ...ledger.entries[0],
      id: "other-material",
      personId: "another-driver",
      lines: [{ ...ledger.entries[0].lines[0], costType: "material" }],
    });
    expect(effectiveAccounts(ledger).get("paid")).toBe("other");
    expect(contactAccountSummary(ledger, ledger.people[0])).toMatchObject({
      cost: 100000,
      netPaid: 100000,
      payable: 0,
      advance: 0,
    });
  });
  it("does not infer a normal unlinked payment's purpose from historical bills with unknown settlement", () => {
    const ledger = fixture({ legacyCash: true });
    ledger.entries[0].balanceImpact = "historical";
    expect(effectiveAccounts(ledger).get("paid")).toBe("materials");
    expect(contactAccountSummary(ledger, ledger.people[0])).toMatchObject({
      cost: 100000,
      netPaid: 0,
      payable: 0,
      advance: 0,
      historicalCost: 100000,
    });
    expect(
      contactAccountSummary(ledger, ledger.people[0], "materials"),
    ).toMatchObject({ cost: 0, netPaid: 100000, advance: 100000 });
  });
  it("does not let an old historical mixed bill make a current transport payment ambiguous", () => {
    const ledger = fixture({ legacyCash: true, mixed: true });
    ledger.entries.find((entry) => entry.id === "mixed")!.balanceImpact =
      "historical";
    expect(effectiveAccounts(ledger).get("paid")).toBe("other");
    expect(contactAccountSummary(ledger, ledger.people[0])).toMatchObject({
      cost: 100000,
      netPaid: 100000,
      payable: 0,
      advance: 0,
    });
  });
});
