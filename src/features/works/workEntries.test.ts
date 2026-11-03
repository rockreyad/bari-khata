import { expect, it } from "vitest";
import { EntrySchema, LedgerSchema } from "../../domain/model";
import { summarize } from "../../domain/ledger";
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
          target: "person", basis: "balance", account: "materials",
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
