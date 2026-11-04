import { expect, it } from "vitest";
import { EntrySchema, LedgerSchema } from "../../domain/model";
import { setEntryVoided, summarize } from "../../domain/ledger";
import {
  recentWorkEntries,
  workEntryAmount,
  workTabEntries,
} from "./workEntries";

const bill = EntrySchema.parse({
  id: "bill",
  kind: "expense",
  account: "materials",
  lines: [
    { id: "door", workId: "doors", label: "দরজা", amount: 9300000 },
    { id: "window", workId: "windows", label: "জানালা", amount: 1000000 },
  ],
});
const payment = EntrySchema.parse({
  id: "payment",
  kind: "payment",
  account: "materials",
  allocations: [{ workId: "doors", amount: 3000000 }],
  paymentParts: [{ amount: 3000000 }],
});
const wage = EntrySchema.parse({ ...payment, id: "wage", account: "labour" });
const van = EntrySchema.parse({ ...payment, id: "van", account: "other" });
it("shows standalone payments in all transactions and in the correct material/labour tab without inventing a transport category", () => {
  const entries = [bill, payment, wage, van];
  expect(workTabEntries(entries, "doors", "all")).toEqual(entries);
  expect(
    workTabEntries(entries, "doors", "material").map((entry) => entry.id),
  ).toEqual(["bill", "payment"]);
  expect(
    workTabEntries(entries, "doors", "labour").map((entry) => entry.id),
  ).toEqual(["wage"]);
  expect(workTabEntries(entries, "doors", "transport")).toEqual([]);
  expect(workTabEntries(entries, "doors", "other")).toEqual([]);
});
it("uses only the current work allocation and preserves refund signs", () => {
  expect(workEntryAmount(bill, "doors", "all")).toBe(9300000);
  expect(workEntryAmount(bill, "doors", "material")).toBe(9300000);
  expect(workEntryAmount(payment, "doors", "material")).toBe(3000000);
  expect(workEntryAmount({ ...payment, kind: "refund" }, "doors", "all")).toBe(
    -3000000,
  );
  expect(
    workEntryAmount({ ...bill, kind: "expense_credit" }, "doors", "all"),
  ).toBe(-9300000);
});
it("keeps an adjustment signed in all activity without assigning it an expense category", () => {
  const entry = EntrySchema.parse({
    id: "adjust",
    kind: "adjustment",
    personId: "person",
    note: "অঙ্ক মিলিয়েছি",
    adjustment: {
      target: "person",
      basis: "balance",
      account: "materials",
      before: 100000,
      after: 50000,
      delta: -50000,
      workId: "doors",
    },
  });
  expect(workEntryAmount(entry, "doors", "all")).toBe(-50000);
  expect(workEntryAmount(entry, "windows", "all")).toBe(0);
  expect(workTabEntries([entry], "doors", "all")).toEqual([entry]);
  for (const tab of ["material", "labour", "transport", "other"] as const) {
    expect(workTabEntries([entry], "doors", tab)).toEqual([]);
    expect(workEntryAmount(entry, "doors", tab)).toBe(0);
  }
});
it("keeps linked transport payment with its bill and keeps bill/payment pairs intact at the preview boundary", () => {
  const transport = EntrySchema.parse({
    ...bill,
    id: "transport",
    account: "other",
    date: "2026-11-01",
    createdAt: "2026-11-01T10:00:00Z",
    lines: [
      {
        id: "v",
        label: "ভ্যান",
        workId: "doors",
        costType: "transport",
        amount: 20000,
      },
    ],
  });
  const linked = EntrySchema.parse({
    ...van,
    id: "linked",
    date: transport.date,
    createdAt: transport.createdAt,
    relatedEntryId: transport.id,
  });
  expect(
    workTabEntries([transport, linked, van], "doors", "transport"),
  ).toEqual([transport, linked]);
  expect(
    recentWorkEntries([transport, linked, bill], 1).map((entry) => entry.id),
  ).toEqual(["transport", "linked"]);
});
it("does not turn a payment visible in a work tab into a second cost", () => {
  const ledger = LedgerSchema.parse({
    works: [
      { id: "doors", name: "দরজা" },
      { id: "windows", name: "জানালা" },
    ],
    entries: [bill, payment, wage],
  });
  const summary = summarize(ledger, "doors");
  expect(workTabEntries(summary.entries, "doors", "all")).toHaveLength(3);
  expect(summary.cost).toBe(9300000);
  expect(summary.netPaid).toBe(6000000);
});

it("leaves ambiguous cash for a mixed transport/rental bill in all transactions", () => {
  const mixed = EntrySchema.parse({
    ...bill,
    id: "mixed",
    account: "other",
    lines: [
      {
        id: "van-line",
        workId: "doors",
        label: "ভ্যান",
        costType: "transport",
        amount: 20000,
      },
      {
        id: "rental-line",
        workId: "doors",
        label: "ভাড়া",
        costType: "rental",
        amount: 50000,
      },
    ],
  });
  const cash = EntrySchema.parse({ ...van, relatedEntryId: mixed.id });
  expect(workTabEntries([mixed, cash], "doors", "all")).toEqual([mixed, cash]);
  expect(workTabEntries([mixed, cash], "doors", "transport")).toEqual([mixed]);
  expect(workTabEntries([mixed, cash], "doors", "other")).toEqual([mixed]);
});

it.each([
  {
    tab: "material" as const,
    account: "materials" as const,
    costType: "material" as const,
  },
  {
    tab: "labour" as const,
    account: "labour" as const,
    costType: "labour" as const,
  },
])(
  "keeps split-work payment and refund in $tab after the linked bill is cancelled",
  ({ tab, account, costType }) => {
    const original = EntrySchema.parse({
      id: "cancelled-bill",
      kind: "expense",
      account,
      personId: "person",
      voided: true,
      lines: [
        { id: "door-line", workId: "doors", costType, amount: 6000 },
        { id: "window-line", workId: "windows", costType, amount: 4000 },
      ],
    });
    const cash = EntrySchema.parse({
      id: "split-payment",
      kind: "payment",
      account,
      personId: "person",
      relatedEntryId: original.id,
      allocations: [
        { workId: "doors", amount: 600 },
        { workId: "windows", amount: 400 },
      ],
      paymentParts: [{ method: "cash", amount: 1000 }],
    });
    const refund = EntrySchema.parse({
      ...cash,
      id: "split-refund",
      kind: "refund",
      allocations: [
        { workId: "doors", amount: 200 },
        { workId: "windows", amount: 100 },
      ],
      paymentParts: [{ method: "cash", amount: 300 }],
    });
    const ledger = LedgerSchema.parse({
      works: [
        { id: "doors", name: "দরজা" },
        { id: "windows", name: "জানালা" },
      ],
      people: [{ id: "person", name: "নমুনা ব্যক্তি" }],
      entries: [original, cash, refund],
    });
    const before = structuredClone(ledger);
    for (const [workId, paid, returned] of [
      ["doors", 600, 200],
      ["windows", 400, 100],
    ] as const) {
      const summary = summarize(ledger, workId);
      const visible = workTabEntries(
        summary.entries,
        workId,
        tab,
        ledger.entries,
      );
      expect(visible.map((entry) => entry.id)).toEqual([cash.id, refund.id]);
      expect(
        visible.map((entry) => workEntryAmount(entry, workId, tab)),
      ).toEqual([paid, -returned]);
      expect(recentWorkEntries(visible).map((entry) => entry.id)).toEqual([
        refund.id,
        cash.id,
      ]);
      expect(summary.cost).toBe(0);
      expect(summary.netPaid).toBe(paid - returned);
    }
    expect(ledger).toEqual(before);
  },
);

it("uses the cancelled mixed bill's current-work lines without guessing a category for ambiguous or standalone cash", () => {
  const mixed = EntrySchema.parse({
    id: "mixed-cancelled",
    kind: "expense",
    account: "other",
    voided: true,
    lines: [
      {
        id: "door-transport",
        workId: "doors",
        costType: "transport",
        amount: 20000,
      },
      {
        id: "window-rental",
        workId: "windows",
        costType: "rental",
        amount: 50000,
      },
    ],
  });
  const cash = EntrySchema.parse({
    ...van,
    id: "mixed-payment",
    relatedEntryId: mixed.id,
    allocations: [
      { workId: "doors", amount: 10000 },
      { workId: "windows", amount: 25000 },
    ],
    paymentParts: [{ amount: 35000 }],
  });
  const refund = EntrySchema.parse({
    ...cash,
    id: "mixed-refund",
    kind: "refund",
  });
  expect(
    workTabEntries([cash, refund, van], "doors", "transport", [
      mixed,
      cash,
      refund,
      van,
    ]),
  ).toEqual([cash, refund]);
  expect(
    workTabEntries([cash, refund, van], "windows", "other", [
      mixed,
      cash,
      refund,
      van,
    ]),
  ).toEqual([cash, refund]);
  expect(workEntryAmount(refund, "doors", "transport")).toBe(-10000);
  expect(workEntryAmount(refund, "windows", "other")).toBe(-25000);

  const ambiguous = EntrySchema.parse({
    ...mixed,
    lines: mixed.lines.map((line) => ({ ...line, workId: "doors" })),
  });
  for (const tab of ["transport", "other"] as const)
    expect(
      workTabEntries([cash, refund, van], "doors", tab, [
        ambiguous,
        cash,
        refund,
        van,
      ]),
    ).toEqual([]);
});

it("shows only active person labour adjustments explicitly scoped to the current work", () => {
  const adjustments = (["paid", "cost", "balance"] as const).map((basis) =>
    EntrySchema.parse({
      id: `labour-${basis}`,
      kind: "adjustment",
      account: "labour",
      personId: "worker",
      note: "নমুনা সমন্বয়",
      adjustment: {
        target: "person",
        basis,
        account: "labour",
        workId: "doors",
        before: 10000,
        after: 8000,
        delta: -2000,
      },
    }),
  );
  const unscoped = EntrySchema.parse({
    ...adjustments[0],
    id: "all-work",
    adjustment: { ...adjustments[0].adjustment!, workId: null },
  });
  const anotherWork = EntrySchema.parse({
    ...adjustments[0],
    id: "windows-only",
    adjustment: { ...adjustments[0].adjustment!, workId: "windows" },
  });
  const allAccounts = EntrySchema.parse({
    ...adjustments[0],
    id: "all-account",
    account: "other",
    personId: null,
    adjustment: {
      ...adjustments[0].adjustment!,
      target: "work",
      account: null,
    },
  });
  const material = EntrySchema.parse({
    ...adjustments[0],
    id: "material-only",
    account: "materials",
    adjustment: { ...adjustments[0].adjustment!, account: "materials" },
  });
  const ledger = LedgerSchema.parse({
    works: [
      { id: "doors", name: "দরজা" },
      { id: "windows", name: "জানালা" },
    ],
    people: [{ id: "worker", name: "নমুনা মিস্ত্রি", kind: "worker" }],
    entries: [...adjustments, unscoped, anotherWork, allAccounts, material],
  });
  const cancelled = setEntryVoided(ledger, adjustments[1].id, true);
  const visible = workTabEntries(
    cancelled.entries,
    "doors",
    "labour",
    cancelled.entries,
  );
  expect(visible.map((entry) => entry.id)).toEqual([
    adjustments[0].id,
    adjustments[2].id,
  ]);
  expect(
    visible.map((entry) => workEntryAmount(entry, "doors", "labour")),
  ).toEqual([-2000, -2000]);
  for (const excluded of [
    unscoped,
    anotherWork,
    allAccounts,
    material,
    cancelled.entries[1],
  ])
    expect(workEntryAmount(excluded, "doors", "labour")).toBe(0);
  expect(workTabEntries(cancelled.entries, "windows", "labour")).toEqual([
    anotherWork,
  ]);
});
