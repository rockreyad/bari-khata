import { describe, expect, it } from "vitest";
import { createDemoLedger } from "./demo";
import { LedgerSchema, PersonSchema } from "./model";
import { appendBalanceAdjustment } from "./balanceAdjustments";
import { contactStatement } from "../features/people/statement";
import {
  allowedContactActions,
  contactAccountSummary,
  defaultContactAccount,
  personKind,
} from "./contacts";

describe("role-aware contact accounts", () => {
  it.each(["cost", "paid", "balance"] as const)(
    "keeps a driver's %s correction, profile and exported totals within the same transport scope",
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
        basis === "paid" ? 30000 : basis === "cost" ? 100000 : 70000;
      const after = basis === "paid" ? 50000 : before - 20000;
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
        ledger.entries.at(-1)!.id,
      ]);
      expect(summary).toMatchObject({
        cost: 100000,
        paid: 40000,
        refunds: 10000,
        netPaid: 30000,
        reconciledCost: basis === "cost" ? after : 100000,
        reconciledNetPaid: basis === "paid" ? after : 30000,
        reconciledPayable: 50000,
        reconciledAdvance: 0,
      });
      expect(copy.totals).toMatchObject({
        reconciledCost: summary.reconciledCost,
        reconciledNetPaid: summary.reconciledNetPaid,
        reconciledPayable: summary.reconciledPayable,
        reconciledAdvance: summary.reconciledAdvance,
      });
      expect(copy.rows).toHaveLength(4);
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
