import { describe, expect, it } from "vitest";
import {
  applicableContracts,
  contractAppliesToWork,
  preservesContractHistory,
  saveContractChange,
} from "./contracts";
import { ContractSchema, LedgerSchema, PersonSchema } from "./model";
import {
  contractSummary,
  partyAccountBalance,
  personSummary,
  summarize,
} from "./ledger";
import { savePersonWithContract } from "./personContract";
import {
  buildQuickEntry,
  QuickDraftSchema,
  quickWageAmount,
} from "../features/entries/quickEntry";
import {
  entryContext,
  entryContactChange,
  entryWorkChange,
  changeEntryType,
} from "../features/entries/entryContext";

function fixture() {
  return LedgerSchema.parse({
    works: [
      { id: "door", name: "দরজা" },
      { id: "roof", name: "ছাদ" },
    ],
    people: [
      { id: "shop", name: "দোকান", kind: "shop" },
      { id: "shah", name: "শাহ আলম", kind: "worker" },
      { id: "tiles", name: "টাইলস মিস্ত্রি", kind: "worker" },
    ],
  });
}
const purchase = (id: string, workId: string, amount: string, paid?: string) =>
  QuickDraftSchema.parse({
    id,
    paymentId: `${id}-paid`,
    workId,
    personId: "shop",
    date: "2026-11-02",
    payment: paid ? "partial" : "full",
    paid: paid ?? "",
    rows: [{ id: `${id}-line`, label: "মাল", amount }],
  });

describe("practical running accounts", () => {
  it("settles earlier shop dues when the next payment exceeds the new bill in another work", () => {
    let ledger = buildQuickEntry(
      fixture(),
      purchase("first", "door", "60000", "20000"),
    );
    expect(personSummary(ledger, "shop").payable).toBe(4000000);
    ledger = buildQuickEntry(
      ledger,
      purchase("second", "roof", "10000", "20000"),
    );
    expect(summarize(ledger)).toMatchObject({
      cost: 7000000,
      netPaid: 4000000,
      payable: 3000000,
      advance: 0,
    });
    expect(personSummary(ledger, "shop")).toMatchObject({
      cost: 7000000,
      netPaid: 4000000,
      payable: 3000000,
      advance: 0,
    });
    expect(partyAccountBalance(ledger, "shop", "materials")).toMatchObject({
      payable: 3000000,
      advance: 0,
    });
    expect(summarize(ledger, "door")).toMatchObject({ payable: 4000000 });
    expect(summarize(ledger, "roof")).toMatchObject({ advance: 1000000 });
    expect(
      ledger.entries.find((entry) => entry.id === "second-paid")?.allocations,
    ).toEqual([{ workId: "roof", amount: 2000000 }]);
  });
  it("keeps a separate paid purchase from consuming a shop's existing advance", () => {
    let ledger = buildQuickEntry(
      fixture(),
      QuickDraftSchema.parse({
        id: "advance",
        kind: "payment",
        purpose: "advance",
        workId: "door",
        personId: "shop",
        account: "materials",
        date: "2026-11-02",
        amount: "20000",
      }),
    );
    ledger = buildQuickEntry(ledger, purchase("small", "roof", "500"));
    expect(summarize(ledger)).toMatchObject({
      cost: 50000,
      netPaid: 2050000,
      advance: 2000000,
      payable: 0,
    });
    expect(partyAccountBalance(ledger, "shop", "materials")).toMatchObject({
      cost: 50000,
      netPaid: 2050000,
      advance: 2000000,
    });
    expect(
      ledger.entries.filter((entry) => entry.kind === "expense"),
    ).toHaveLength(1);
  });
});

describe("whole-house contracts and their history", () => {
  it("keeps old work-scoped data and legacy history valid without inventing audit events", () => {
    const ledger = LedgerSchema.parse({
      ...fixture(),
      contracts: [
        {
          id: "old",
          workId: "door",
          personId: "shah",
          total: 60000000,
          history: [
            { at: "old timestamp", total: 50000000, note: "আগের চুক্তি" },
          ],
        },
      ],
    });
    expect(ledger.contracts[0]).toMatchObject({
      scope: "work",
      agreedOn: null,
      activity: [],
      workId: "door",
      history: [{ at: "old timestamp", total: 50000000, note: "আগের চুক্তি" }],
    });
  });
  it("creates a house contract before any work exists and records payments from different work notebooks", () => {
    const empty = LedgerSchema.parse({});
    let ledger = savePersonWithContract(
      empty,
      PersonSchema.parse({ id: "shah", name: "শাহ আলম", kind: "worker" }),
      { id: "house", scope: "house", amount: "৬০০০০০", agreedOn: "2026-10-01" },
    );
    expect(ledger.contracts[0]).toMatchObject({
      scope: "house",
      workId: null,
      total: 60000000,
      agreedOn: "2026-10-01",
    });
    expect(ledger.contracts[0].activity[0].before).toBeNull();
    ledger = LedgerSchema.parse({ ...ledger, works: fixture().works });
    for (const [index, workId] of ["door", "roof"].entries()) {
      ledger = buildQuickEntry(
        ledger,
        QuickDraftSchema.parse({
          id: `paid-${index}`,
          kind: "payment",
          purpose: "settle",
          personId: "shah",
          account: "labour",
          contractId: "house",
          workId,
          amount: "30000",
          date: "2026-11-02",
        }),
      );
    }
    expect(contractSummary(ledger, "house")).toMatchObject({
      agreed: 60000000,
      netPaid: 6000000,
      remaining: 0,
      remainingCommitment: 54000000,
      billed: 0,
    });
    expect(summarize(ledger)).toMatchObject({ cost: 0, netPaid: 6000000 });
    expect(summarize(ledger, "door")).toMatchObject({
      netPaid: 3000000,
      contractTotal: 0,
    });
    expect(
      applicableContracts(ledger, "shah", "door").map(
        (contract) => contract.id,
      ),
    ).toEqual(["house"]);
  });
  it("records exact fixed, square-foot and daily changes with before/after, dates and mandatory reasons", () => {
    let ledger = fixture();
    const initial = ContractSchema.parse({
      id: "house",
      scope: "house",
      personId: "shah",
      total: 60000000,
      rate: 60000000,
      agreedOn: "2026-10-01",
    });
    ledger = saveContractChange(ledger, initial, "", "2026-11-01T00:00:00Z");
    const changed = ContractSchema.parse({
      ...ledger.contracts[0],
      total: 65000000,
      rate: 65000000,
      agreedOn: "2026-11-02",
    });
    expect(() => saveContractChange(ledger, changed)).toThrow("কেন বদলালেন");
    const next = saveContractChange(
      ledger,
      changed,
      "আরও কাজ যোগ হয়েছে",
      "2026-11-02T00:00:00Z",
    );
    expect(next.contracts[0].activity[1]).toMatchObject({
      at: "2026-11-02T00:00:00Z",
      before: { total: 60000000, agreedOn: "2026-10-01" },
      after: { total: 65000000, agreedOn: "2026-11-02" },
      reason: "আরও কাজ যোগ হয়েছে",
    });
    expect(preservesContractHistory(ledger, next)).toBe(true);
    expect(preservesContractHistory(next, ledger)).toBe(false);
    expect(saveContractChange(next, next.contracts[0])).toBe(next);
    ledger = saveContractChange(
      next,
      ContractSchema.parse({
        id: "area",
        personId: "tiles",
        workId: "door",
        basis: "sqft",
        quantity: "৫৭০০",
        rate: 2200,
        total: 12540000,
      }),
    );
    ledger = saveContractChange(
      ledger,
      ContractSchema.parse({
        id: "days",
        personId: "tiles",
        workId: "roof",
        basis: "day",
        quantity: "3.5",
        rate: 60000,
        total: 210000,
      }),
    );
    expect(ledger.contracts).toHaveLength(3);
    expect(() =>
      saveContractChange(
        ledger,
        ContractSchema.parse({ ...ledger.contracts[2], total: 210001 }),
        "দর ঠিক করেছি",
      ),
    ).toThrow("মিলছে না");
    const corrupt = structuredClone(next);
    corrupt.contracts[0].activity[1].before!.total = 1;
    expect(LedgerSchema.safeParse(corrupt).success).toBe(false);
    expect(
      LedgerSchema.safeParse({
        ...next,
        contracts: [{ ...next.contracts[0], agreedOn: "2026-02-31" }],
      }).success,
    ).toBe(false);
  });
  it("keeps contracts and material accounts isolated and blocks reassignment of a used contract", () => {
    let ledger = saveContractChange(
      fixture(),
      ContractSchema.parse({
        id: "house",
        scope: "house",
        personId: "shah",
        total: 60000000,
      }),
    );
    ledger = buildQuickEntry(
      ledger,
      QuickDraftSchema.parse({
        id: "cash",
        kind: "payment",
        account: "labour",
        personId: "shah",
        contractId: "house",
        workId: "door",
        amount: "30000",
        date: "2026-11-02",
      }),
    );
    expect(partyAccountBalance(ledger, "shah", "labour")).toMatchObject({
      netPaid: 0,
      advance: 0,
    });
    expect(
      partyAccountBalance(ledger, "shah", "labour", "house"),
    ).toMatchObject({ netPaid: 3000000, advance: 3000000 });
    expect(partyAccountBalance(ledger, "shop", "materials")).toMatchObject({
      netPaid: 0,
      advance: 0,
    });
    expect(() =>
      saveContractChange(
        ledger,
        ContractSchema.parse({ ...ledger.contracts[0], personId: "tiles" }),
        "অন্য মিস্ত্রি",
      ),
    ).toThrow("লেনদেন আছে");
    expect(contractAppliesToWork(ledger.contracts[0], "roof")).toBe(true);
    const scoped = ContractSchema.parse({
      id: "one-work",
      personId: "tiles",
      workId: "door",
      total: 50000,
    });
    expect(contractAppliesToWork(scoped, "roof")).toBe(false);
  });
});

describe("earned daily wages and entry intent", () => {
  it.each(["due", "partial", "full"] as const)(
    "honors %s for an earned payment and retains daily quantity/rate context",
    (payment) => {
      const draft = QuickDraftSchema.parse({
        id: "daily",
        paymentId: "daily-paid",
        kind: "payment",
        purpose: "wage",
        personId: "shah",
        workId: "door",
        date: "2026-11-02",
        wageBasis: "day",
        wageDays: "২.৫",
        wageRate: "৮০০",
        amount: "1",
        paid: "1700",
        payment,
      });
      expect(quickWageAmount(draft)).toBe(200000);
      const ledger = buildQuickEntry(fixture(), draft);
      expect(ledger.entries[0].lines[0]).toMatchObject({
        amount: 200000,
        quantity: "2.5",
        unit: "দিন",
        label: "মজুরি · 2.5 দিন × 800 টাকা",
      });
      expect(summarize(ledger)).toMatchObject({
        cost: 200000,
        paid: payment === "due" ? 0 : payment === "partial" ? 170000 : 200000,
        payable: payment === "due" ? 200000 : payment === "partial" ? 30000 : 0,
      });
      expect(QuickDraftSchema.parse(draft)).toMatchObject({
        wageBasis: "day",
        wageDays: "2.5",
        wageRate: "800",
      });
    },
  );
  it("defaults noncontract zero-due payments to a new bill while preserving an explicit advance intent", () => {
    const ledger = fixture();
    const draft = entryContext(ledger, {
      kind: "payment",
      personId: "shah",
      workId: "door",
    });
    expect(draft).toMatchObject({
      purpose: "charge",
      contractId: "",
      payment: "full",
    });
    expect(
      entryContext(ledger, {
        kind: "payment",
        personId: "shah",
        workId: "door",
        purpose: "advance",
      }).purpose,
    ).toBe("advance");
    const house = saveContractChange(
      ledger,
      ContractSchema.parse({
        id: "house",
        scope: "house",
        personId: "shah",
        total: 60000000,
      }),
    );
    expect(
      entryContext(house, {
        kind: "payment",
        personId: "shah",
        workId: "door",
      }),
    ).toMatchObject({ purpose: "charge", contractId: "" });
    expect(
      entryWorkChange(
        house,
        { ...draft, purpose: "settle", contractId: "house" },
        "roof",
      ),
    ).toMatchObject({
      workId: "roof",
      contractId: "house",
      purpose: "advance",
    });
    expect(
      entryContactChange(ledger, { ...draft, purpose: "advance" }, "shah"),
    ).toEqual({ personId: "shah" });
    const material = changeEntryType(
      ledger,
      { ...draft, amount: "2000" },
      "material",
    );
    expect(material).toMatchObject({
      kind: "expense",
      personId: "shah",
      contractId: "",
      account: "materials",
      rows: [{ amount: "2000" }],
    });
  });
});

it("keeps an explicitly chosen labour bill when selecting a worker and preserves the entered money", () => {
  const ledger = fixture();
  expect(
    entryContext(ledger, { kind: "expense", personId: "shah", workId: "door" }),
  ).toMatchObject({
    kind: "expense",
    purpose: "settle",
    account: "labour",
    payment: "full",
  });
  const generic = entryContext(ledger, {
    kind: "expense",
    costType: "labour",
    workId: "door",
  });
  generic.rows[0].amount = "2000";
  generic.rows[0].label = "নমুনা কাজের মজুরি";
  const patch = entryContactChange(ledger, generic, "shah");
  expect(patch).toMatchObject({
    kind: "expense",
    purpose: "settle",
    payment: "full",
    amount: "2000",
    personId: "shah",
    costType: "labour",
  });
  const saved = buildQuickEntry(ledger, { ...generic, ...patch });
  expect(summarize(saved)).toMatchObject({
    cost: 200000,
    paid: 200000,
    payable: 0,
  });
  expect(saved.entries).toHaveLength(2);
  expect(saved.entries[0]).toMatchObject({
    kind: "expense",
    account: "labour",
    personId: "shah",
    lines: [{ amount: 200000, costType: "labour", label: "নমুনা কাজের মজুরি" }],
  });
  expect(saved.entries[1]).toMatchObject({
    kind: "payment",
    account: "labour",
    personId: "shah",
  });
  expect(saved.entries[1].relatedEntryId).toBe(saved.entries[0].id);
});

it("requires the first audit event added to an old contract to start from its real existing terms", () => {
  const before = LedgerSchema.parse({
    ...fixture(),
    contracts: [
      { id: "legacy", personId: "shah", workId: "door", total: 100000 },
    ],
  });
  const after = saveContractChange(
    before,
    ContractSchema.parse({ ...before.contracts[0], total: 200000 }),
    "আরও কাজ",
  );
  expect(preservesContractHistory(before, after)).toBe(true);
  const invented = structuredClone(after);
  invented.contracts[0].activity[0].before!.total = 1;
  expect(LedgerSchema.safeParse(invented).success).toBe(true);
  expect(preservesContractHistory(before, invented)).toBe(false);
});

it("validates newly audited calculated totals while retaining old inconsistent rate-based terms", () => {
  const legacy = LedgerSchema.parse({
    ...fixture(),
    contracts: [
      {
        id: "legacy-rate",
        workId: "door",
        personId: "shah",
        basis: "day",
        quantity: "2",
        rate: 10000,
        total: 30000,
      },
    ],
  });
  expect(legacy.contracts[0].activity).toEqual([]);
  const corrected = saveContractChange(
    legacy,
    ContractSchema.parse({ ...legacy.contracts[0], total: 20000 }),
    "আগের গুণের হিসাব ঠিক করেছি",
  );
  expect(corrected.contracts[0].activity[0].before).toMatchObject({
    quantity: "2",
    rate: 10000,
    total: 30000,
  });
  expect(preservesContractHistory(legacy, corrected)).toBe(true);
  const bad = structuredClone(corrected);
  bad.contracts[0].total = 30000;
  bad.contracts[0].activity[0].after.total = 30000;
  expect(LedgerSchema.safeParse(bad).success).toBe(false);
  bad.contracts[0].activity[0].after.quantity = "2,5";
  expect(LedgerSchema.safeParse(bad).success).toBe(false);
  const rounded = saveContractChange(
    fixture(),
    ContractSchema.parse({
      id: "fraction",
      workId: "door",
      personId: "tiles",
      basis: "sqft",
      quantity: "0.005",
      rate: 100,
      total: 1,
    }),
  );
  expect(rounded.contracts[0].activity[0].after.total).toBe(1);
});
