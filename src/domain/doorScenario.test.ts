import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { LedgerDatabase } from "../data/database";
import { LedgerRepository } from "../data/repository";
import {
  buildQuickEntry,
  QuickDraftSchema,
} from "../features/entries/quickEntry";
import { filterHistory } from "../features/history/history";
import { createEmptyLedger } from "./demo";
import { entryWorkAmount, personSummary, summarize } from "./ledger";
import { LedgerSchema, validateLedger, type Ledger } from "./model";

function draft(id: string, change: Record<string, unknown>) {
  return QuickDraftSchema.parse({
    id,
    paymentId: `${id}-paid`,
    refundId: `${id}-refund`,
    date: "2026-11-02",
    workId: "doors",
    ...change,
  });
}

function doorLedger(): Ledger {
  let ledger = LedgerSchema.parse({
    works: [{ id: "doors", name: "দরজার কাজ" }],
    people: [
      { id: "door-shop", name: "দরজার দোকান", kind: "shop" },
      { id: "van", name: "ভ্যানচালক", kind: "driver" },
      { id: "designer", name: "দরজার মিস্ত্রি", kind: "worker" },
      { id: "shah-alam", name: "শাহ আলম রাজমিস্ত্রি", kind: "worker" },
    ],
    materialGroups: [{ id: "door", name: "দরজা" }],
  });
  ledger = buildQuickEntry(
    ledger,
    draft("door-bill", {
      personId: "door-shop",
      payment: "partial",
      paid: "30000",
      rows: [
        {
          id: "doors-eight",
          label: "দরজা",
          groupId: "door",
          quantity: "8",
          unit: "টি",
          amount: "93000",
        },
      ],
    }),
  );
  ledger = buildQuickEntry(
    ledger,
    draft("van-bill", {
      personId: "van",
      costType: "transport",
      rows: [{ id: "van-fee", label: "দরজা আনার ভাড়া", amount: "200" }],
    }),
  );
  ledger = buildQuickEntry(
    ledger,
    draft("design-bill", {
      personId: "designer",
      costType: "labour",
      rows: [
        {
          id: "door-design",
          label: "দরজার নকশা",
          quantity: "8",
          unit: "টি",
          amount: "16000",
        },
      ],
    }),
  );
  return buildQuickEntry(
    ledger,
    draft("weekly-payment", {
      kind: "payment",
      personId: "shah-alam",
      account: "labour",
      amount: "30000",
      note: "সপ্তাহের টাকা · দরজার চৌকাঠ বসানো",
    }),
  );
}

function expectDoorBalances(ledger: Ledger) {
  expect(summarize(ledger, "doors")).toMatchObject({
    cost: 10920000,
    netPaid: 7620000,
    payable: 6300000,
    advance: 3000000,
    entryCount: 7,
    byType: { material: 9300000, labour: 1600000, transport: 20000 },
  });
  expect(personSummary(ledger, "door-shop", "doors")).toMatchObject({
    cost: 9300000,
    netPaid: 3000000,
    payable: 6300000,
    advance: 0,
  });
  expect(personSummary(ledger, "designer", "doors")).toMatchObject({
    cost: 1600000,
    netPaid: 1600000,
    payable: 0,
    advance: 0,
  });
  expect(personSummary(ledger, "van", "doors")).toMatchObject({
    cost: 20000,
    netPaid: 20000,
    payable: 0,
    advance: 0,
  });
  expect(personSummary(ledger, "shah-alam", "doors")).toMatchObject({
    cost: 0,
    netPaid: 3000000,
    payable: 0,
    advance: 3000000,
  });
}

describe("a homeowner's complete door-work ledger", () => {
  it("keeps the bill, partial settlement, van fee, design wages and weekly payment visible in the same work", () => {
    const ledger = doorLedger();
    expectDoorBalances(ledger);
    expect(filterHistory(ledger, { workId: "doors" })).toHaveLength(7);
    expect(
      filterHistory(ledger, { personId: "door-shop", workId: "doors" }).map(
        (entry) => entry.id,
      ),
    ).toEqual(["door-bill", "door-bill-paid"]);
    expect(
      filterHistory(ledger, { personId: "shah-alam", workId: "doors" }),
    ).toEqual([
      expect.objectContaining({
        id: "weekly-payment",
        kind: "payment",
        note: "সপ্তাহের টাকা · দরজার চৌকাঠ বসানো",
      }),
    ]);
    expect(
      entryWorkAmount(
        ledger.entries.find((entry) => entry.id === "weekly-payment")!,
        "doors",
      ),
    ).toBe(3000000);
  });

  it("recognizes earned mason work separately and never counts a later shop settlement as another expense", () => {
    let ledger = doorLedger();
    ledger = buildQuickEntry(
      ledger,
      draft("mason-earned", {
        personId: "shah-alam",
        costType: "labour",
        payment: "due",
        rows: [
          {
            id: "mason-work",
            label: "দরজার চৌকাঠ বসানোর মজুরি",
            amount: "30000",
          },
        ],
      }),
    );
    expect(summarize(ledger, "doors")).toMatchObject({
      cost: 13920000,
      netPaid: 7620000,
      payable: 6300000,
      advance: 0,
    });
    expect(personSummary(ledger, "shah-alam", "doors")).toMatchObject({
      cost: 3000000,
      netPaid: 3000000,
      payable: 0,
      advance: 0,
    });
    const billCount = ledger.entries.filter(
      (entry) => entry.kind === "expense",
    ).length;
    ledger = buildQuickEntry(
      ledger,
      draft("shop-settled", {
        kind: "payment",
        personId: "door-shop",
        account: "materials",
        amount: "63000",
      }),
    );
    expect(summarize(ledger, "doors")).toMatchObject({
      cost: 13920000,
      netPaid: 13920000,
      payable: 0,
      advance: 0,
    });
    expect(
      ledger.entries.filter((entry) => entry.kind === "expense"),
    ).toHaveLength(billCount);
    expect(personSummary(ledger, "door-shop", "doors").payable).toBe(0);
  });

  it("preserves both work and person balances after reopening offline storage and restoring a backup", async () => {
    const source = new LedgerDatabase(
      `test-door-source-${crypto.randomUUID()}`,
    );
    const target = new LedgerDatabase(
      `test-door-target-${crypto.randomUUID()}`,
    );
    try {
      const repository = new LedgerRepository(source);
      const ledger = doorLedger();
      await repository.ensure("real", createEmptyLedger());
      await repository.save(ledger);
      source.close();
      await source.open();
      const reopened = (await repository.read())!.ledger;
      expectDoorBalances(reopened);
      expect(validateLedger(JSON.parse(JSON.stringify(reopened)))).toEqual(
        ledger,
      );
      const backup = await repository.exportBackup();
      const restored = new LedgerRepository(target);
      await restored.ensure("real", createEmptyLedger());
      await restored.importBackup(backup, { replace: true });
      const recovered = (await restored.read())!.ledger;
      expectDoorBalances(recovered);
      expect(recovered).toEqual(ledger);
    } finally {
      await source.delete();
      await target.delete();
    }
  });
});
