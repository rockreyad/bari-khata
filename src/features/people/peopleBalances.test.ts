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
  recordReviewCount: 0,
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
  { context: undefined, advance: 0, credit: 0 },
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

it.each(["settlement", undefined])(
  "does not call a %s payment credit when its old bill is historical",
  (context) => {
    const ledger = fixture([
      bill("old-bill", 10000, "labour", { balanceImpact: "historical" }),
      cash("paid", 10000, "labour", { paymentContext: context }),
    ]);
    expect(balances(ledger)).toEqual(empty);
    expect(
      peopleBalances(ledger, ledger.people[0]).summary.reconciledNetPaid,
    ).toBe(10000);
  },
);

it.each(["settlement", undefined])(
  "does not turn a paid-only correction of %s cash into credit without liability evidence",
  (context) => {
    const original = fixture([
      cash("paid", 4000, "labour", { paymentContext: context }),
    ]);
    const ledger = appendBalanceAdjustment(original, {
      target: "person",
      personId: "person",
      account: "labour",
      basis: "paid",
      expectedBefore: 4000,
      after: 13000,
      reason: "নমুনা দেওয়া টাকা ঠিক করেছি",
    });
    expect(balances(ledger)).toEqual(empty);
    expect(
      peopleBalances(ledger, ledger.people[0]).summary.reconciledNetPaid,
    ).toBe(13000);
  },
);

it("retains only the recorded advance when a paid-total correction has no bill evidence", () => {
  const original = fixture([
    cash("advance", 4000, "materials", { paymentContext: "advance" }),
  ]);
  const ledger = appendBalanceAdjustment(original, {
    target: "person",
    personId: "person",
    account: "materials",
    basis: "paid",
    expectedBefore: 4000,
    after: 13000,
    reason: "নমুনা দেওয়া টাকা ঠিক করেছি",
  });
  expect(balances(ledger)).toEqual({ ...empty, advance: 4000 });
});

it("retains credit that the user explicitly recorded as a negative balance", () => {
  const original = fixture([cash("paid", 4000, "labour")]);
  const ledger = appendBalanceAdjustment(original, {
    target: "person",
    personId: "person",
    account: "labour",
    basis: "balance",
    expectedBefore: -4000,
    after: -5000,
    reason: "নমুনা জমা টাকা মিলিয়েছি",
  });
  expect(balances(ledger)).toEqual({ ...empty, credit: 5000 });
});

it.each([
  { refunded: 3000, credit: 0 },
  { refunded: 1000, credit: 2000 },
])(
  "keeps the known bill and return balance after an unclassified refund of $refunded",
  ({ refunded, credit }) => {
    const ledger = fixture([
      bill("bill", 10000),
      cash("paid", 10000),
      bill("return", 3000, "materials", {
        kind: "expense_credit",
        relatedEntryId: "bill",
      }),
      cash("refund", refunded, "materials", {
        kind: "refund",
        paymentContext: undefined,
      }),
      cash("unrelated-advance", 2500, "labour", { paymentContext: "advance" }),
    ]);
    expect(balances(ledger)).toEqual({ ...empty, credit, advance: 2500 });
  },
);

it("keeps unmatched settlement refunds out of contract liability review", () => {
  const ledger = fixture(
    [
      cash("paid", 13000, "labour", { contractId: "first" }),
      cash("refund", 3000, "labour", {
        contractId: "first",
        kind: "refund",
        paymentContext: undefined,
      }),
    ],
    { contracts: [contracts[0]] },
  );
  expect(balances(ledger)).toEqual(empty);
});

it("guards mixed advance and receivable refunds without hiding another account's known credit", () => {
  const ledger = fixture([
    cash("advance", 5000, "materials", { paymentContext: "advance" }),
    cash("deposit", 3000, "materials", { paymentContext: "receivable" }),
    cash("refund", 1000, "materials", {
      kind: "refund",
      paymentContext: undefined,
    }),
    cash("known-deposit", 2000, "other", { paymentContext: "receivable" }),
    bill("labour", 10000, "labour"),
    cash("labour-paid", 12000, "labour"),
  ]);
  expect(balances(ledger)).toEqual({
    ...empty,
    credit: 2000,
    receivable: 2000,
    needsReview: true,
  });
});

it("does not let a fully consumed old advance make a settled supplier return uncertain", () => {
  const ledger = fixture(
    [
      bill("old-bill", 5000),
      cash("old-advance", 5000, "materials", { paymentContext: "advance" }),
      bill("bill", 10000),
      cash("paid", 10000),
      bill("return", 3000, "materials", {
        kind: "expense_credit",
        relatedEntryId: "bill",
      }),
      cash("refund", 3000, "materials", {
        kind: "refund",
        paymentContext: undefined,
      }),
    ],
    {
      paymentAllocations: [
        {
          id: "old-allocation",
          paymentId: "old-advance",
          billId: "old-bill",
          workId: "work",
          amount: 5000,
          createdAt: "2026-11-08T00:00:00Z",
        },
      ],
    },
  );
  expect(balances(ledger)).toEqual(empty);
});

it("keeps deposit in another work certain when an ordinary refund has no matching context", () => {
  const ledger = fixture(
    [
      bill("bill", 10000),
      cash("paid", 10000),
      bill("return", 3000, "materials", {
        kind: "expense_credit",
        relatedEntryId: "bill",
      }),
      cash("refund", 3000, "materials", {
        kind: "refund",
        paymentContext: undefined,
      }),
      cash("other-deposit", 2000, "materials", {
        paymentContext: "receivable",
        allocations: [{ workId: "second", amount: 2000 }],
      }),
    ],
    {
      works: [
        { id: "work", name: "নমুনা খাতা" },
        { id: "second", name: "নমুনা দ্বিতীয় খাতা" },
      ],
    },
  );
  expect(balances(ledger)).toEqual({ ...empty, receivable: 2000 });
});

it("does not call unlinked legacy work cash credit beside fully settled bills in the same work", () => {
  const ledger = fixture(
    [
      bill("first-bill", 5000, "labour"),
      cash("first-paid", 5000, "labour"),
      bill("second-bill", 7000, "labour"),
      cash("second-paid", 7000, "labour"),
      cash("legacy-work-cash", 2000, "labour", { paymentContext: undefined }),
    ],
    {
      paymentAllocations: ["first", "second"].map((id, index) => ({
        id: `${id}-allocation`,
        paymentId: `${id}-paid`,
        billId: `${id}-bill`,
        workId: "work",
        amount: index === 0 ? 5000 : 7000,
        createdAt: "2026-11-08T00:00:00Z",
      })),
    },
  );
  expect(balances(ledger)).toEqual(empty);
  expect(
    peopleBalances(ledger, ledger.people[0]).summary.reconciledNetPaid,
  ).toBe(14000);
});

it("does not let unlinked old work cash revive advance already covered by a current bill", () => {
  const ledger = fixture([
    bill("bill", 10000),
    cash("advance", 10000, "materials", { paymentContext: "advance" }),
    cash("legacy-work-cash", 5000, "materials", { paymentContext: undefined }),
  ]);
  expect(balances(ledger)).toEqual(empty);
});

it("keeps a legacy payment explicitly linked to its current bill as evidence of real overpayment", () => {
  const ledger = fixture([
    bill("bill", 5000),
    cash("linked", 6000, "materials", {
      paymentContext: undefined,
      relatedEntryId: "bill",
    }),
  ]);
  expect(balances(ledger)).toEqual({ ...empty, credit: 1000 });
});

it.each([
  { refund: 0, credit: 1000 },
  { refund: 400, credit: 600 },
  { refund: 1000, credit: 0 },
])(
  "keeps only the goods-return credit after refund $refund beside unrelated old cash",
  ({ refund, credit }) => {
    const ledger = fixture([
      bill("bill", 10000),
      cash("paid", 10000),
      bill("return", 1000, "materials", {
        kind: "expense_credit",
        relatedEntryId: "bill",
      }),
      cash("unlinked", 2000, "materials", { paymentContext: undefined }),
      ...(refund
        ? [cash("refund", refund, "materials", { kind: "refund" })]
        : []),
    ]);
    expect(balances(ledger)).toEqual({ ...empty, credit });
  },
);

it.each([
  { paid: 6000, credit: 0 },
  { paid: 6500, credit: 500 },
])(
  "keeps record review separate from the known return balance with $paid paid",
  ({ paid, credit }) => {
    const ledger = fixture([
      bill("first", 5000, "materials", {
        reviewStatus: "needs_review",
        reviewReason: "",
      }),
      bill("second", 2000, "materials", {
        reviewStatus: "needs_review",
        reviewReason: "",
      }),
      bill("return", 1000, "materials", {
        kind: "expense_credit",
        reviewStatus: "needs_review",
        reviewReason: "",
      }),
      cash("paid", paid, "materials", { paymentContext: undefined }),
    ]);
    expect(balances(ledger)).toEqual({
      ...empty,
      credit,
      recordReviewCount: 3,
    });
    expect(
      ledger.entries.filter((entry) => entry.reviewStatus === "needs_review"),
    ).toHaveLength(3);
  },
);

it("does not treat historical review rows as current financial uncertainty", () => {
  const ledger = fixture([
    bill("historical", 9000, "materials", {
      balanceImpact: "historical",
      reviewStatus: "needs_review",
    }),
    bill("bill", 5000),
    cash("paid", 5000),
  ]);
  expect(balances(ledger)).toEqual(empty);
});

function withRecordedCredit() {
  const original = fixture([
    cash("old-work-cash", 4000, "labour", { paymentContext: undefined }),
  ]);
  const corrected = appendBalanceAdjustment(
    original,
    {
      target: "person",
      personId: "person",
      account: "labour",
      basis: "balance",
      expectedBefore: -4000,
      after: -5000,
      reason: "নমুনা জমা মিলিয়েছি",
    },
    "2026-11-08T01:00:00Z",
  );
  return LedgerSchema.parse({
    ...corrected,
    entries: [
      ...corrected.entries,
      cash("later-work-cash", 2000, "labour", {
        paymentContext: undefined,
        createdAt: "2026-11-08T02:00:00Z",
      }),
    ],
  });
}

it("does not let a past negative balance correction confirm later unknown cash", () => {
  expect(balances(withRecordedCredit())).toEqual({ ...empty, credit: 5000 });
});

it("caps recorded credit by the current balance after a later expense", () => {
  const original = withRecordedCredit();
  const ledger = LedgerSchema.parse({
    ...original,
    entries: [...original.entries, bill("later-bill", 3000, "labour")],
  });
  expect(balances(ledger)).toEqual({ ...empty, credit: 4000 });
});

it.each(["2026-11-08T01:00:00Z", "2026-11-08T03:00:00Z"])(
  "lets a zero balance correction at %s supersede the older credit without depending on entry order",
  (at) => {
    const original = withRecordedCredit();
    const corrected = appendBalanceAdjustment(
      original,
      {
        target: "person",
        personId: "person",
        account: "labour",
        basis: "balance",
        expectedBefore: -7000,
        after: 0,
        reason: "নমুনা হিসাব মিটিয়েছি",
      },
      at,
    );
    const ledger = LedgerSchema.parse({
      ...corrected,
      entries: [
        ...corrected.entries,
        cash("new-work-cash", 1000, "labour", { paymentContext: undefined }),
      ],
    });
    expect(balances(ledger)).toEqual(empty);
    expect(
      balances({ ...ledger, entries: [...ledger.entries].reverse() }),
    ).toEqual(empty);
  },
);
