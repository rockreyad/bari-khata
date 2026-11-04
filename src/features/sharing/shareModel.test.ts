import { describe, expect, it } from "vitest";
import { SharedEntrySchema, SharedStatementSchema } from "./shareModel";

const RowSchema = SharedStatementSchema.shape.rows.element;
const maximum = Number.MAX_SAFE_INTEGER;
const row = () => ({
  key: "sample-bill",
  date: "2026-11-04",
  kind: "expense",
  historical: false,
  charge: 10000,
  paid: 0,
  description: "নমুনা সিমেন্ট",
  works: "নমুনা ছাদ",
  settlement: {
    paid: 6000,
    returned: 1000,
    refunded: 500,
    balance: 3500,
    paymentCount: 2,
  },
});
const line = (amount = 10000) => ({
  label: "নমুনা সিমেন্ট",
  amount,
  workName: "নমুনা ছাদ",
  quantity: 2.5,
  unit: "বস্তা",
});
const payment = (key = "sample-payment", paid = 3000) => ({
  key,
  date: "2026-11-04",
  paid,
  description: "নমুনা কিস্তি",
  paymentParts: [{ method: "cash", amount: paid }],
  paymentMethods: ["cash"],
});
const entry = () => ({
  ...row(),
  revision: 7,
  note: "নমুনা বিল",
  paymentParts: [],
  paymentMethods: [],
  lines: [line()],
  payments: [payment("sample-first"), payment("sample-second")],
  receipts: [],
});

describe("shared bill settlement validation", () => {
  it("accepts a partial bill including material returns and money refunds without modifying raw events", () => {
    const source = row();
    const before = JSON.stringify(source);
    expect(RowSchema.parse(source)).toEqual(source);
    expect(JSON.stringify(source)).toBe(before);
    expect(RowSchema.parse(source).paid).toBe(0);
  });

  it("uses exact integer arithmetic even when intermediate balances exceed safe number precision", () => {
    const source = {
      ...row(),
      charge: 1,
      settlement: {
        paid: 3,
        returned: maximum,
        refunded: maximum,
        balance: -2,
        paymentCount: 1,
      },
    };
    expect(RowSchema.safeParse(source).success).toBe(true);
    expect(
      RowSchema.safeParse({
        ...source,
        settlement: { ...source.settlement, balance: -1 },
      }).success,
    ).toBe(false);
  });

  it.each([
    [
      "incorrect balance",
      { settlement: { ...row().settlement, balance: 3501 } },
    ],
    [
      "unsafe total paid",
      { settlement: { ...row().settlement, paid: maximum + 1 } },
    ],
    [
      "fractional paid amount",
      { settlement: { ...row().settlement, paid: 6000.5 } },
    ],
    [
      "negative returned amount",
      { settlement: { ...row().settlement, returned: -1000 } },
    ],
    ["fractional bill charge", { charge: 10000.5 }],
    ["historical bill", { historical: true }],
    ["payment event", { kind: "payment", charge: 0, paid: 10000 }],
    ["material return event", { kind: "expense_credit", charge: -10000 }],
    ["raw bill marked as payment", { paid: 1 }],
    [
      "negative bill charge",
      { charge: -1, settlement: { ...row().settlement, balance: -6501 } },
    ],
  ])(
    "rejects %s without throwing outside the validation result",
    (_name, change) => {
      const result = RowSchema.safeParse({ ...row(), ...change });
      expect(result.success).toBe(false);
    },
  );
});

describe("shared entry item and payment history validation", () => {
  it("retains quantities, units and a complete payment history matching the bill settlement", () => {
    const source = entry();
    const parsed = SharedEntrySchema.parse(source);
    expect(parsed.lines).toEqual([line()]);
    expect(parsed.payments).toEqual(source.payments);
    expect(parsed.settlement).toEqual(source.settlement);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, maximum + 1, "2.5"])(
    "rejects invalid item quantity %s",
    (quantity) => {
      expect(
        SharedEntrySchema.safeParse({
          ...entry(),
          lines: [{ ...line(), quantity }],
        }).success,
      ).toBe(false);
    },
  );

  it("accepts legacy lines without quantity or unit and rejects mismatched or overflowing line sums", () => {
    expect(
      SharedEntrySchema.safeParse({
        ...entry(),
        lines: [{ label: "নমুনা মাল", amount: 10000, workName: "নমুনা ছাদ" }],
      }).success,
    ).toBe(true);
    for (const lines of [
      [line(9999)],
      [line(maximum), line(2)],
      [line(10000.5)],
    ])
      expect(SharedEntrySchema.safeParse({ ...entry(), lines }).success).toBe(
        false,
      );
  });

  it("accepts a scoped related bill only on a payment and verifies its exact item total", () => {
    const relatedBill = {
      key: "sample-bill",
      date: "2026-11-03",
      charge: 10000,
      lines: [line()],
    };
    const source = {
      ...entry(),
      key: "sample-payment",
      kind: "payment",
      charge: 0,
      paid: 6000,
      settlement: undefined,
      payments: undefined,
      lines: [],
      relatedBill,
    };
    expect(SharedEntrySchema.parse(source).relatedBill).toEqual(relatedBill);
    for (const change of [
      { kind: "expense", charge: 6000, paid: 0 },
      { relatedBill: { ...relatedBill, charge: 9999 } },
      {
        relatedBill: {
          ...relatedBill,
          charge: maximum,
          lines: [line(maximum), line(2)],
        },
      },
      { relatedBill: { ...relatedBill, lines: [line(10000.5)] } },
    ])
      expect(
        SharedEntrySchema.safeParse({ ...source, ...change }).success,
      ).toBe(false);
  });

  it.each([
    ["duplicate keys", [payment(), payment()]],
    ["missing payment", [payment("sample-first")]],
    [
      "incorrect paid sum",
      [payment("sample-first", 2000), payment("sample-second", 3000)],
    ],
    [
      "overflowing paid sum",
      [payment("sample-first", maximum), payment("sample-second", 1)],
    ],
    [
      "incorrect payment parts",
      [
        {
          ...payment("sample-first"),
          paymentParts: [{ method: "cash", amount: 1 }],
        },
        payment("sample-second"),
      ],
    ],
    [
      "fractional payment parts",
      [
        {
          ...payment("sample-first"),
          paymentParts: [{ method: "cash", amount: 3000.5 }],
        },
        payment("sample-second"),
      ],
    ],
  ])("rejects history with %s", (_name, payments) => {
    expect(SharedEntrySchema.safeParse({ ...entry(), payments }).success).toBe(
      false,
    );
  });

  it("rejects history attached to historical bills or payment events", () => {
    for (const change of [
      { historical: true, settlement: undefined },
      {
        kind: "payment",
        charge: 0,
        paid: 6000,
        settlement: undefined,
        lines: [],
      },
    ])
      expect(
        SharedEntrySchema.safeParse({ ...entry(), ...change }).success,
      ).toBe(false);
  });
});
