import { describe, expect, it } from "vitest";
import { LedgerSchema } from "../../domain/model";
import { appendBalanceAdjustment } from "../../domain/balanceAdjustments";
import {
  entryContext,
  entryContactChange,
  changeEntryType,
  restoreEntryContext,
} from "./entryContext";
import {
  changePaymentPurpose,
  paymentIntent,
  paymentPurpose,
  paymentScopeChange,
} from "./paymentIntent";

function fixture(amount = 0, paid = 0) {
  return LedgerSchema.parse({
    works: [{ id: "work", name: "নমুনা কাজ" }],
    people: [
      { id: "person", name: "নমুনা ব্যক্তি", kind: "other" },
      { id: "worker", name: "নমুনা মিস্ত্রি", kind: "worker" },
    ],
    entries: [
      ...(amount
        ? [
            {
              id: "bill",
              kind: "expense",
              account: "other",
              personId: "person",
              lines: [
                { id: "line", workId: "work", costType: "other", amount },
              ],
            },
          ]
        : []),
      ...(paid
        ? [
            {
              id: "paid",
              kind: "payment",
              account: "other",
              personId: "person",
              allocations: [{ workId: "work", amount: paid }],
              paymentParts: [{ amount: paid }],
            },
          ]
        : []),
    ],
  });
}
const scope = { personId: "person", account: "other" as const, contractId: "" };

describe("payment intent from confirmed balances", () => {
  it.each([
    [0, 0, false, "charge"],
    [100000, 30000, true, "settle"],
    [100000, 100000, false, "charge"],
    [100000, 120000, false, "charge"],
  ] as const)(
    "defaults a bill %i and cash %i to %s/%s",
    (cost, paid, canSettle, purpose) => {
      const ledger = fixture(cost, paid);
      expect(paymentIntent(ledger, scope)).toMatchObject({
        canSettle,
        defaultPurpose: purpose,
        hasJob: false,
      });
      expect(
        entryContext(ledger, {
          kind: "payment",
          personId: "person",
          account: "other",
        }).purpose,
      ).toBe(purpose);
      expect(paymentPurpose(ledger, scope, "advance")).toBe("advance");
    },
  );

  it("does not offer an old balance after it was reconciled to zero", () => {
    const ledger = appendBalanceAdjustment(fixture(100000, 30000), {
      target: "person",
      basis: "balance",
      personId: "person",
      account: "other",
      expectedBefore: 70000,
      after: 0,
      reason: "নমুনা হিসাব মেলানো",
    });
    expect(paymentIntent(ledger, scope)).toMatchObject({
      balance: 0,
      canSettle: false,
      defaultPurpose: "charge",
    });
    expect(paymentPurpose(ledger, scope, "settle")).toBe("charge");
  });

  it("reads a selected job's agreed amount and correction without inventing another bill", () => {
    const original = LedgerSchema.parse({
      ...fixture(),
      contracts: [
        { id: "job", personId: "person", workId: "work", total: 100000 },
      ],
      entries: [
        {
          id: "paid",
          kind: "payment",
          account: "labour",
          personId: "person",
          contractId: "job",
          allocations: [{ workId: "work", amount: 40000 }],
          paymentParts: [{ amount: 40000 }],
        },
      ],
    });
    const job = { ...scope, account: "labour" as const, contractId: "job" };
    expect(paymentIntent(original, job)).toMatchObject({
      balance: 60000,
      canSettle: true,
      defaultPurpose: "settle",
      hasJob: true,
    });
    const ledger = appendBalanceAdjustment(original, {
      target: "person",
      basis: "paid",
      personId: "person",
      account: "labour",
      contractId: "job",
      expectedBefore: 40000,
      after: 100000,
      reason: "নমুনা কাজের টাকা মেলানো",
    });
    expect(paymentIntent(ledger, job)).toMatchObject({
      balance: 0,
      canSettle: false,
      defaultPurpose: "advance",
      hasJob: true,
    });
    expect(
      ledger.entries.filter((entry) => entry.kind === "expense"),
    ).toHaveLength(0);
  });

  it("keeps an ambiguous job account neutral until a person explicitly chooses", () => {
    const original = LedgerSchema.parse({
      ...fixture(),
      contracts: [
        { id: "job", personId: "person", workId: "work", total: 100000 },
      ],
      entries: [
        {
          id: "bill",
          kind: "expense",
          account: "labour",
          personId: "person",
          lines: [
            { id: "line", workId: "work", costType: "labour", amount: 100000 },
          ],
        },
      ],
    });
    const ledger = appendBalanceAdjustment(original, {
      target: "person",
      basis: "paid",
      personId: "person",
      account: "labour",
      expectedBefore: 0,
      after: 10000,
      reason: "নমুনা দেওয়া টাকা মেলানো",
    });
    const state = paymentIntent(ledger, { ...scope, account: "labour" });
    expect(state).toMatchObject({
      balance: null,
      canSettle: false,
      defaultPurpose: "settle",
    });
    expect(
      paymentIntent(ledger, { ...scope, account: "labour", contractId: "job" }),
    ).toMatchObject({ balance: 100000, canSettle: true });
  });

  it("does not turn an explicit material bill into a wage payment when choosing a worker", () => {
    const ledger = fixture();
    const draft = entryContext(ledger, {
      kind: "expense",
      account: "materials",
      costType: "material",
      workId: "work",
      personId: "worker",
    });
    draft.rows[0].label = "নমুনা মাল";
    draft.rows[0].amount = "100";
    const change = entryContactChange(ledger, draft, "person");
    expect({ ...draft, ...change }).toMatchObject({
      kind: "expense",
      account: "materials",
      costType: "material",
      rows: draft.rows,
    });
    expect(
      entryContext(ledger, {
        kind: "expense",
        account: "materials",
        costType: "material",
        personId: "worker",
      }),
    ).toMatchObject({
      kind: "expense",
      account: "materials",
      costType: "material",
    });
  });

  it("preserves a saved cash draft when there is no due, and recalculates only a fresh empty scope", () => {
    const ledger = fixture();
    const fresh = entryContext(ledger, {
      kind: "payment",
      account: "other",
      personId: "person",
    });
    const saved = {
      ...fresh,
      purpose: "settle" as const,
      amount: "125",
      paid: "50",
      note: "অসমাপ্ত নমুনা",
      wageDays: "2",
      wageRate: "100",
    };
    expect(restoreEntryContext(saved, fresh)).toMatchObject(saved);
    expect(
      paymentScopeChange(ledger, saved, { account: "materials" }),
    ).toMatchObject({
      purpose: "settle",
      amount: "125",
      paid: "50",
      note: "অসমাপ্ত নমুনা",
    });
    expect(
      paymentScopeChange(
        ledger,
        { ...fresh, purpose: "settle" },
        { account: "materials" },
      ),
    ).toMatchObject({ purpose: "charge" });
    expect(
      paymentScopeChange(
        ledger,
        { ...fresh, purpose: "advance" },
        { account: "materials" },
      ).purpose,
    ).toBe("advance");
  });
});

it("auto-selects only an outstanding sole job with no unallocated money or adjustments", () => {
  const original = LedgerSchema.parse({
    ...fixture(),
    contracts: [
      { id: "job", personId: "person", workId: "work", total: 100000 },
    ],
    entries: [
      {
        id: "paid",
        kind: "payment",
        account: "labour",
        personId: "person",
        contractId: "job",
        allocations: [{ workId: "work", amount: 50000 }],
        paymentParts: [{ amount: 50000 }],
      },
    ],
  });
  const options = {
    kind: "payment",
    personId: "person",
    account: "labour",
    workId: "work",
  } as const;
  expect(entryContext(original, options)).toMatchObject({
    contractId: "job",
    purpose: "settle",
  });
  const settled = LedgerSchema.parse({
    ...original,
    entries: [
      {
        ...original.entries[0],
        allocations: [{ workId: "work", amount: 100000 }],
        paymentParts: [{ amount: 100000 }],
      },
    ],
  });
  expect(entryContext(settled, options)).toMatchObject({
    contractId: "",
    purpose: "charge",
  });
  expect(
    entryContext(settled, { ...options, contractId: "job" }),
  ).toMatchObject({ contractId: "job", purpose: "advance" });
  const corrected = appendBalanceAdjustment(original, {
    target: "person",
    basis: "paid",
    personId: "person",
    account: "labour",
    expectedBefore: 50000,
    after: 100000,
    reason: "সব কাজের নমুনা হিসাব মেলানো",
  });
  expect(entryContext(corrected, options)).toMatchObject({
    contractId: "",
    purpose: "charge",
  });
  const unallocated = LedgerSchema.parse({
    ...original,
    entries: [
      ...original.entries,
      {
        id: "unallocated-bill",
        kind: "expense",
        account: "labour",
        personId: "person",
        lines: [
          { id: "new-line", workId: "work", costType: "labour", amount: 20000 },
        ],
      },
    ],
  });
  expect(entryContext(unallocated, options)).toMatchObject({
    contractId: "",
    purpose: "settle",
  });
});

it("keeps the chosen person and bill amount when explicitly changing an expense type", () => {
  const ledger = fixture();
  const draft = entryContext(ledger, {
    kind: "expense",
    account: "materials",
    costType: "material",
    personId: "person",
    workId: "work",
  });
  draft.rows[0].amount = "100";
  const changed = changeEntryType(ledger, draft, "transport");
  expect(changed).toMatchObject({
    kind: "expense",
    personId: "person",
    account: "other",
    costType: "transport",
    rows: [{ amount: "100" }],
    contractId: "",
  });
  expect(ledger.entries).toEqual([]);
});

it("keeps an explicit new-bill choice while editing a reason in the same account, and carries daily money to an explicit cash choice", () => {
  const ledger = fixture();
  const draft = entryContext(ledger, {
    kind: "payment",
    account: "labour",
    personId: "person",
    workId: "work",
  });
  expect(
    paymentScopeChange(ledger, draft, { paymentPurposeName: "নমুনা কারণ" })
      .purpose,
  ).toBe("charge");
  const daily = {
    ...draft,
    purpose: "wage" as const,
    wageBasis: "day" as const,
    wageDays: "2",
    wageRate: "125",
    amount: "",
  };
  expect(changePaymentPurpose(daily, "charge")).toBe(daily);
  expect(changePaymentPurpose(daily, "advance")).toMatchObject({
    purpose: "advance",
    amount: "250",
    wageDays: "2",
    wageRate: "125",
  });
});

it.each([
  { amount: "100" },
  { note: "নমুনা মালের বিল" },
  { paymentPurposeId: "material-reason", paymentPurposeName: "নমুনা মাল" },
])(
  "keeps written financial scope when selecting a late payee: %j",
  (writing) => {
    const ledger = LedgerSchema.parse({
      ...fixture(),
      contracts: [
        { id: "worker-job", personId: "worker", workId: "work", total: 100000 },
      ],
    });
    const draft = {
      ...entryContext(ledger, {
        kind: "payment",
        account: "materials",
        costType: "material",
        workId: "work",
      }),
      ...writing,
    };
    const changed = {
      ...draft,
      ...entryContactChange(ledger, draft, "worker"),
    };
    expect(changed).toMatchObject({
      personId: "worker",
      account: "materials",
      costType: "material",
      purpose: "charge",
      contractId: "",
      ...writing,
    });
  },
);

it("lets an explicit material account win over a transport contact's future defaults", () => {
  const ledger = fixture();
  ledger.people[0].kind = "driver";
  expect(
    entryContext(ledger, {
      kind: "payment",
      account: "materials",
      personId: "person",
    }),
  ).toMatchObject({
    account: "materials",
    costType: "material",
    purpose: "charge",
  });
});
