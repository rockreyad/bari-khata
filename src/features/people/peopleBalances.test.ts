import { expect, it } from "vitest";
import { appendBalanceAdjustment } from "../../domain/balanceAdjustments";
import {
  EntrySchema,
  LedgerSchema,
  type Account,
  type Entry,
} from "../../domain/model";
import { peopleBalances } from "./peopleBalances";

const bill = (
  id: string,
  amount: number,
  account: Account = "materials",
  extra = {},
) =>
  EntrySchema.parse({
    id,
    personId: "person",
    kind: "expense",
    account,
    lines: [
      {
        id: `${id}-line`,
        workId: "work",
        amount,
        costType:
          account === "materials"
            ? "material"
            : account === "labour"
              ? "labour"
              : "other",
      },
    ],
    ...extra,
  });
const cash = (
  id: string,
  amount: number,
  account: Account = "materials",
  extra = {},
) =>
  EntrySchema.parse({
    id,
    personId: "person",
    kind: "payment",
    account,
    paymentContext: "settlement",
    allocations: [{ workId: "work", amount }],
    paymentParts: [{ amount }],
    ...extra,
  });
const fixture = (entries: Entry[] = [], extra = {}) =>
  LedgerSchema.parse({
    architectureVersion: 2,
    paymentAllocations: [],
    works: [{ id: "work", name: "নমুনা খাতা" }],
    people: [
      {
        id: "person",
        name: "নমুনা ব্যক্তি",
        kind: "worker",
        roles: ["craftsperson", "supplier"],
      },
    ],
    entries,
    ...extra,
  });
const balances = (ledger: ReturnType<typeof fixture>) => {
  const before = structuredClone(ledger);
  const { summary: _summary, ...values } = peopleBalances(
    ledger,
    ledger.people[0],
  );
  expect(ledger).toEqual(before);
  for (const amount of [
    values.remaining,
    values.advance,
    values.extra,
    values.credit,
    values.receivable,
  ]) {
    expect(Number.isSafeInteger(amount)).toBe(true);
    expect(amount).toBeGreaterThanOrEqual(0);
  }
  return values;
};
const empty = {
  remaining: 0,
  advance: 0,
  extra: 0,
  credit: 0,
  receivable: 0,
  valid: true,
  needsReview: false,
};

it("omits balance states for an empty contact or a settled bill", () => {
  expect(balances(fixture())).toEqual(empty);
  expect(balances(fixture([bill("bill", 10000), cash("paid", 10000)]))).toEqual(
    empty,
  );
});

it("keeps due, explicit advance and refundable cash separate across accounts", () => {
  const ledger = fixture([
    bill("bill", 10000),
    cash("advance", 2500, "labour", { paymentContext: "advance" }),
    cash("deposit", 3000, "other", { paymentContext: "receivable" }),
  ]);
  expect(balances(ledger)).toEqual({
    ...empty,
    remaining: 10000,
    advance: 2500,
    receivable: 3000,
  });
});

it.each([
  { context: "advance", advance: 10000, credit: 0 },
  { context: "settlement", advance: 0, credit: 0 },
  { context: undefined, advance: 0, credit: 10000 },
])(
  "does not turn $context cash into another payment purpose",
  ({ context, advance, credit }) => {
    expect(
      balances(
        fixture([cash("paid", 10000, "labour", { paymentContext: context })]),
      ),
    ).toEqual({ ...empty, advance, credit });
  },
);

it("caps unused advance in its own account and does not borrow unrelated ordinary cash", () => {
  expect(
    balances(
      fixture([
        bill("bill", 10000),
        cash("advance", 10000, "materials", { paymentContext: "advance" }),
        cash("ordinary", 100000, "labour"),
      ]),
    ),
  ).toEqual(empty);
  expect(
    balances(
      fixture([
        bill("bill", 10000, "labour"),
        cash("advance", 5000, "labour", { paymentContext: "advance" }),
        cash("ordinary", 15000, "labour"),
      ]),
    ),
  ).toEqual({ ...empty, advance: 5000, credit: 5000 });
});

it("deducts allocated or refunded deposit money once", () => {
  const ledger = fixture(
    [
      bill("bill", 10000),
      cash("deposit", 10000, "materials", { paymentContext: "receivable" }),
      cash("returned", 2000, "materials", {
        kind: "refund",
        paymentContext: "receivable",
      }),
    ],
    {
      paymentAllocations: [
        {
          id: "allocation",
          paymentId: "deposit",
          billId: "bill",
          workId: "work",
          amount: 3000,
          createdAt: "2026-11-08T00:00:00Z",
        },
      ],
    },
  );
  expect(balances(ledger)).toEqual({
    ...empty,
    remaining: 7000,
    receivable: 5000,
  });
});

it("shows a paid material return as credit while keeping a different account's due", () => {
  const ledger = fixture([
    bill("bill", 10000),
    cash("paid", 10000),
    bill("returned", 3000, "materials", {
      kind: "expense_credit",
      relatedEntryId: "bill",
    }),
    bill("labour", 5000, "labour"),
  ]);
  expect(balances(ledger)).toEqual({ ...empty, remaining: 5000, credit: 3000 });
});

const contracts = [
  {
    id: "first",
    personId: "person",
    workId: "work",
    total: 10000,
    status: "ongoing",
  },
  {
    id: "second",
    personId: "person",
    workId: "work",
    total: 20000,
    status: "done",
  },
];
it("keeps a contract's excess separate from another contract's remaining promise", () => {
  const ledger = fixture(
    [
      cash("first-paid", 13000, "labour", { contractId: "first" }),
      cash("second-paid", 5000, "labour", { contractId: "second" }),
    ],
    { contracts },
  );
  expect(balances(ledger)).toEqual({ ...empty, remaining: 15000, extra: 3000 });
});

it("does not call ordinary partial payment on an ongoing promise advance", () => {
  const ledger = fixture(
    [cash("first-paid", 4000, "labour", { contractId: "first" })],
    { contracts: [contracts[0]] },
  );
  expect(balances(ledger)).toEqual({ ...empty, remaining: 6000 });
});

it.each([
  { amount: 4000, remaining: 6000, extra: 0 },
  { amount: 13000, remaining: 0, extra: 3000 },
])(
  "keeps contract advance $amount within its promise without showing the same credit twice",
  ({ amount, remaining, extra }) => {
    const ledger = fixture(
      [
        cash("paid", amount, "labour", {
          contractId: "first",
          paymentContext: "advance",
        }),
      ],
      { contracts: [contracts[0]] },
    );
    expect(balances(ledger)).toEqual({ ...empty, remaining, extra });
  },
);

it("uses a neutral credit for an unallocated total correction", () => {
  const original = fixture([bill("bill", 10000), cash("paid", 4000)]);
  const ledger = appendBalanceAdjustment(original, {
    target: "person",
    personId: "person",
    account: "materials",
    basis: "paid",
    expectedBefore: 4000,
    after: 13000,
    reason: "নমুনা মোট মিলিয়েছি",
  });
  expect(balances(ledger)).toEqual({ ...empty, credit: 3000 });
});

it("does not classify a correction of all contracts as a real advance or a specific contract overpayment", () => {
  const original = fixture(
    [cash("paid", 4000, "labour", { contractId: "first" })],
    { contracts: [contracts[0]] },
  );
  const ledger = appendBalanceAdjustment(original, {
    target: "person",
    personId: "person",
    account: "labour",
    basis: "paid",
    expectedBefore: 4000,
    after: 13000,
    reason: "নমুনা মোট মিলিয়েছি",
  });
  expect(balances(ledger)).toEqual({ ...empty, credit: 3000 });
});

it("keeps a refund with an unknown context under review instead of showing an inferred credit", () => {
  const ledger = fixture([
    bill("bill", 10000, "other"),
    cash("advance", 5000, "materials", { paymentContext: "advance" }),
    cash("returned", 1000, "materials", {
      kind: "refund",
      paymentContext: undefined,
    }),
  ]);
  expect(balances(ledger)).toEqual({
    ...empty,
    remaining: 10000,
    needsReview: true,
  });
});

it("ignores voided and historical cash without hiding a confirmed balance", () => {
  const ledger = fixture([
    bill("bill", 10000),
    cash("voided", 5000, "materials", {
      paymentContext: "advance",
      voided: true,
    }),
    cash("historical", 7000, "materials", {
      paymentContext: "receivable",
      balanceImpact: "historical",
    }),
  ]);
  expect(balances(ledger)).toEqual({ ...empty, remaining: 10000 });
});

it("keeps money waiting for review out of classified credit states", () => {
  const ledger = fixture([
    cash("unknown", 5000, "materials", {
      paymentContext: "advance",
      reviewStatus: "needs_review",
    }),
  ]);
  expect(balances(ledger)).toEqual({ ...empty, needsReview: true });
});

it("uses the effective account for old transport cash rather than borrowing its advance for materials", () => {
  const ledger = fixture([
    bill("transport", 10000, "materials", {
      lines: [
        {
          id: "transport-line",
          workId: "work",
          amount: 10000,
          costType: "transport",
        },
      ],
    }),
    cash("paid", 13000, "materials", {
      paymentContext: "advance",
      relatedEntryId: "transport",
    }),
    bill("material", 6000),
  ]);
  expect(balances(ledger)).toEqual({
    ...empty,
    remaining: 6000,
    advance: 3000,
  });
});

it("preserves the existing running account across notebooks without inventing a second credit", () => {
  const ledger = fixture(
    [
      bill("bill", 10000),
      cash("advance", 4000, "materials", {
        paymentContext: "advance",
        allocations: [{ workId: "second", amount: 4000 }],
      }),
    ],
    {
      works: [
        { id: "work", name: "নমুনা খাতা" },
        { id: "second", name: "নমুনা অন্য খাতা" },
      ],
    },
  );
  expect(balances(ledger)).toEqual({ ...empty, remaining: 6000 });
});

it("keeps receivable separate from a corrected credit in another account", () => {
  const original = fixture([
    bill("bill", 10000),
    cash("paid", 4000),
    cash("deposit", 3000, "other", { paymentContext: "receivable" }),
  ]);
  const ledger = appendBalanceAdjustment(original, {
    target: "person",
    personId: "person",
    account: "materials",
    basis: "paid",
    expectedBefore: 4000,
    after: 13000,
    reason: "নমুনা মোট মিলিয়েছি",
  });
  expect(balances(ledger)).toEqual({
    ...empty,
    credit: 3000,
    receivable: 3000,
  });
});

it("does not let a cancelled correction relabel confirmed advance", () => {
  const original = fixture([
    cash("advance", 4000, "materials", { paymentContext: "advance" }),
  ]);
  const changed = appendBalanceAdjustment(original, {
    target: "person",
    personId: "person",
    account: "materials",
    basis: "paid",
    expectedBefore: 4000,
    after: 5000,
    reason: "নমুনা মোট মিলিয়েছি",
  });
  const ledger = LedgerSchema.parse({
    ...changed,
    entries: changed.entries.map((entry) =>
      entry.kind === "adjustment" ? { ...entry, voided: true } : entry,
    ),
  });
  expect(balances(ledger)).toEqual({ ...empty, advance: 4000 });
});
