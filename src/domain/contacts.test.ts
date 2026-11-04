import { describe, expect, it } from "vitest";
import { createDemoLedger } from "./demo";
import { LedgerSchema, PersonSchema } from "./model";
import { appendBalanceAdjustment } from "./balanceAdjustments";
import { contactStatement } from "../features/people/statement";
import {
  allowedContactActions,
  contactAccountSummary,
  contactSummary,
  defaultContactAccount,
  personKind,
} from "./contacts";

describe("contact identities and financial accounts", () => {
  it("adds each account's reconciled balance without offsetting different accounts or reviving settled job debt", () => {
    const original = LedgerSchema.parse({
      works: [{ id: "work", name: "নমুনা কাজ" }],
      people: [{ id: "person", name: "নমুনা ব্যক্তি", kind: "worker" }],
      contracts: [
        { id: "first", personId: "person", workId: "work", total: 100000 },
        { id: "second", personId: "person", workId: "work", total: 100000 },
      ],
      entries: [
        {
          id: "first-paid",
          kind: "payment",
          account: "labour",
          personId: "person",
          contractId: "first",
          allocations: [{ workId: "work", amount: 130000 }],
          paymentParts: [{ amount: 130000 }],
        },
        {
          id: "second-paid",
          kind: "payment",
          account: "labour",
          personId: "person",
          contractId: "second",
          allocations: [{ workId: "work", amount: 70000 }],
          paymentParts: [{ amount: 70000 }],
        },
        {
          id: "material",
          kind: "expense",
          account: "materials",
          personId: "person",
          lines: [
            {
              id: "material-line",
              workId: "work",
              costType: "material",
              amount: 50000,
            },
          ],
        },
        {
          id: "other-advance",
          kind: "payment",
          account: "other",
          personId: "person",
          allocations: [{ workId: "work", amount: 20000 }],
          paymentParts: [{ amount: 20000 }],
        },
      ],
    });
    const entries = JSON.stringify(original.entries);
    for (const kind of ["worker", "shop", "driver", "other"] as const) {
      const ledger = LedgerSchema.parse({
        ...original,
        people: [{ ...original.people[0], kind }],
      });
      const person = ledger.people[0];
      expect(contactAccountSummary(ledger, person, "labour")).toMatchObject({
        reconciledNetPaid: 200000,
        reconciledPayable: 0,
        reconciledAdvance: 0,
      });
      expect(contactSummary(ledger, person)).toMatchObject({
        cost: 50000,
        netPaid: 220000,
        reconciledCost: 50000,
        reconciledNetPaid: 220000,
        reconciledPayable: 50000,
        reconciledAdvance: 20000,
      });
      expect(contactSummary(ledger, person, "work")).toMatchObject({
        reconciledPayable: 50000,
        reconciledAdvance: 20000,
      });
      expect(JSON.stringify(ledger.entries)).toBe(entries);
      expect(ledger.contracts).toEqual(original.contracts);
    }
  });

  it.each(["cost", "paid", "balance"] as const)(
    "keeps a driver's %s correction, profile and exported totals in the whole selected account",
    (basis) => {
      const source = LedgerSchema.parse({
        works: [
          { id: "door", name: "দরজা" },
          { id: "roof", name: "ছাদ" },
        ],
        people: [{ id: "driver", name: "রনি", kind: "driver" }],
        entries: [
          {
            id: "trip",
            kind: "expense",
            personId: "driver",
            account: "other",
            lines: [
              {
                id: "trip-line",
                workId: "door",
                costType: "transport",
                amount: 100000,
              },
            ],
          },
          {
            id: "trip-paid",
            kind: "payment",
            personId: "driver",
            account: "other",
            relatedEntryId: "trip",
            allocations: [{ workId: "door", amount: 40000 }],
            paymentParts: [{ amount: 40000 }],
          },
          {
            id: "refund",
            kind: "refund",
            personId: "driver",
            account: "other",
            relatedEntryId: "trip",
            allocations: [{ workId: "door", amount: 10000 }],
            paymentParts: [{ amount: 10000 }],
          },
          {
            id: "unload",
            kind: "expense",
            personId: "driver",
            account: "other",
            lines: [
              {
                id: "unload-line",
                workId: "door",
                costType: "unload",
                amount: 200000,
              },
            ],
          },
          {
            id: "unload-paid",
            kind: "payment",
            personId: "driver",
            account: "other",
            relatedEntryId: "unload",
            allocations: [{ workId: "door", amount: 50000 }],
            paymentParts: [{ amount: 50000 }],
          },
          {
            id: "other-trip",
            kind: "expense",
            personId: "driver",
            account: "other",
            lines: [
              {
                id: "other-trip-line",
                workId: "roof",
                costType: "transport",
                amount: 60000,
              },
            ],
          },
        ],
      });
      const before =
        basis === "paid" ? 80000 : basis === "cost" ? 300000 : 220000;
      const after = basis === "paid" ? 100000 : before - 20000;
      const ledger = appendBalanceAdjustment(
        source,
        {
          target: "person",
          basis,
          personId: "driver",
          account: "other",
          workId: "door",
          expectedBefore: before,
          after,
          reason: "গাড়িভাড়ার হিসাব মিলিয়েছি",
        },
        "2026-11-04T08:00:00.000Z",
      );
      const person = ledger.people[0];
      const summary = contactAccountSummary(ledger, person, "other", "door");
      const copy = contactStatement(ledger, person, {
        account: "other",
        workId: "door",
      });
      expect(summary.entries.map((entry) => entry.id)).toEqual([
        "trip",
        "trip-paid",
        "refund",
        "unload",
        "unload-paid",
        ledger.entries.at(-1)!.id,
      ]);
      expect(summary).toMatchObject({
        cost: 300000,
        paid: 90000,
        refunds: 10000,
        netPaid: 80000,
        reconciledCost: basis === "cost" ? after : 300000,
        reconciledNetPaid: basis === "paid" ? after : 80000,
        reconciledPayable: 200000,
        reconciledAdvance: 0,
      });
      expect(copy.totals).toMatchObject({
        reconciledCost: summary.reconciledCost,
        reconciledNetPaid: summary.reconciledNetPaid,
        reconciledPayable: summary.reconciledPayable,
        reconciledAdvance: summary.reconciledAdvance,
      });
      expect(copy.rows).toHaveLength(6);
      expect(
        contactAccountSummary(ledger, person, "other", "roof"),
      ).toMatchObject({
        reconciledCost: 60000,
        reconciledNetPaid: 0,
        reconciledPayable: 60000,
      });
    },
  );

  it("uses legacy clues only when a category has not been selected", () => {
    expect(
      personKind(
        PersonSchema.parse({ id: "w", name: "রহিম", role: "মিস্ত্রি" }),
      ),
    ).toBe("worker");
    expect(
      personKind(PersonSchema.parse({ id: "s", name: "সুন্দর হার্ডওয়্যার" })),
    ).toBe("shop");
    expect(personKind(PersonSchema.parse({ id: "d", name: "ভ্যানচালক" }))).toBe(
      "driver",
    );
    expect(
      personKind(
        PersonSchema.parse({ id: "o", name: "রহিম মিস্ত্রি", kind: "other" }),
      ),
    ).toBe("other");
  });
  it("allows only useful chosen shortcuts, including intentionally hiding them all", () => {
    const worker = PersonSchema.parse({
      id: "w",
      name: "রহিম",
      kind: "worker",
      quickActions: ["payment", "return", "purchase"],
    });
    expect(allowedContactActions(worker)).toEqual(["payment"]);
    expect(allowedContactActions({ ...worker, quickActions: [] })).toEqual([]);
    expect(
      allowedContactActions(
        PersonSchema.parse({
          id: "s",
          name: "দোকান",
          kind: "shop",
          quickActions: ["purchase"],
        }),
      ),
    ).toEqual(["purchase"]);
    const driver = PersonSchema.parse({ id: "d", name: "রনি", kind: "driver" });
    expect(defaultContactAccount(driver)).toBe("other");
    expect(allowedContactActions(driver)).toEqual(["payment", "transport"]);
  });
  it("never mixes a worker's old material voucher into the wage balance", () => {
    const ledger = LedgerSchema.parse({
      works: [{ id: "work", name: "কাজ" }],
      people: [{ id: "w", name: "রহিম", kind: "worker" }],
      entries: [
        {
          id: "material",
          kind: "expense",
          personId: "w",
          lines: [{ id: "m", workId: "work", amount: 150000 }],
        },
        {
          id: "wage",
          kind: "expense",
          account: "labour",
          personId: "w",
          lines: [
            { id: "w", workId: "work", amount: 600000, costType: "labour" },
          ],
        },
        {
          id: "paid",
          kind: "payment",
          account: "labour",
          personId: "w",
          allocations: [{ workId: "work", amount: 400000 }],
          paymentParts: [{ amount: 400000 }],
        },
      ],
    });
    expect(contactAccountSummary(ledger, ledger.people[0])).toMatchObject({
      cost: 600000,
      netPaid: 400000,
      payable: 200000,
      advance: 0,
    });
    expect(
      contactAccountSummary(ledger, ledger.people[0], "materials").cost,
    ).toBe(150000);
  });
  it("keeps legacy transport and its own payment visible without treating a driver's materials as transport", () => {
    const ledger = LedgerSchema.parse({
      works: [{ id: "door", name: "দরজা" }],
      people: [{ id: "d", name: "রনি", kind: "driver" }],
      entries: [
        {
          id: "van",
          kind: "expense",
          personId: "d",
          lines: [
            { id: "v", workId: "door", costType: "transport", amount: 100000 },
          ],
        },
        {
          id: "van-paid",
          kind: "payment",
          relatedEntryId: "van",
          personId: "d",
          allocations: [{ workId: "door", amount: 100000 }],
          paymentParts: [{ amount: 100000 }],
        },
        {
          id: "mixed",
          kind: "expense",
          personId: "d",
          lines: [
            {
              id: "mixed-trip",
              workId: "door",
              costType: "transport",
              amount: 20000,
            },
            {
              id: "mixed-material",
              workId: "door",
              amount: 80000,
              label: "private mixed material",
            },
          ],
        },
        {
          id: "mixed-paid",
          kind: "payment",
          personId: "d",
          relatedEntryId: "mixed",
          allocations: [{ workId: "door", amount: 100000 }],
          paymentParts: [{ amount: 100000 }],
        },
        {
          id: "material",
          kind: "expense",
          personId: "d",
          lines: [{ id: "m", workId: "door", amount: 300000 }],
        },
      ],
    });
    expect(contactAccountSummary(ledger, ledger.people[0])).toMatchObject({
      cost: 100000,
      netPaid: 100000,
      payable: 0,
    });
  });
  it("settles unlinked legacy driver cash only within a purely transport account/work bucket", () => {
    const demo = createDemoLedger();
    const driver = demo.people.find((person) => person.id === "driver")!;
    expect(contactAccountSummary(demo, driver)).toMatchObject({
      cost: 400000,
      netPaid: 400000,
      payable: 0,
      advance: 0,
    });
    const ambiguous = LedgerSchema.parse({
      ...demo,
      entries: [
        ...demo.entries,
        {
          id: "driver-material",
          kind: "expense",
          personId: "driver",
          account: "materials",
          lines: [
            {
              id: "other-material",
              workId: "tiles",
              amount: 50000,
              label: "আলাদা মাল",
            },
          ],
        },
      ],
    });
    expect(
      contactAccountSummary(ambiguous, driver).entries.some(
        (entry) => entry.id === "tiles-transport-paid-cash",
      ),
    ).toBe(false);
    expect(
      demo.entries.find((entry) => entry.id === "tiles-transport-paid-cash")
        ?.allocations[0].amount,
    ).toBe(400000);
  });
});
