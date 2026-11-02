import { EntrySchema, LedgerSchema, type Ledger } from "../model";
import { parseAmount } from "../ledger";
import {
  QuickDraftSchema,
  buildQuickEntry,
} from "../../features/entries/quickEntry";

const paisa = (taka: number) => taka * 100;
export function mixedLedger(script: "English" | "Bengali"): Ledger {
  const number = (value: string) =>
    script === "English"
      ? value
      : value.replace(/\d/g, (digit) => "০১২৩৪৫৬৭৮৯"[Number(digit)]);
  let ledger = LedgerSchema.parse({
    works: [
      { id: "door", name: "দরজা" },
      { id: "roof", name: "ছাদ" },
    ],
    people: [
      { id: "shop", name: "দরজার দোকান", kind: "shop" },
      { id: "worker", name: "দরজার মিস্ত্রি", kind: "worker" },
      { id: "mason", name: "শাহ আলম", kind: "worker" },
      { id: "driver", name: "ভ্যানচালক", kind: "driver" },
      { id: "return-shop", name: "ফেরত নেওয়া দোকান", kind: "shop" },
      { id: "advance-shop", name: "আগাম নেওয়া দোকান", kind: "shop" },
    ],
    contracts: [
      {
        id: "mason-contract",
        workId: "door",
        personId: "mason",
        total: paisa(600000),
        rate: paisa(600000),
        quantity: number("1"),
      },
    ],
  });
  let index = 0;
  const add = (value: Record<string, unknown>) => {
    const id = `entry-${++index}`;
    ledger = buildQuickEntry(
      ledger,
      QuickDraftSchema.parse({
        id,
        paymentId: `${id}-payment`,
        refundId: `${id}-refund`,
        date: "2026-09-15",
        workId: "door",
        personId: "shop",
        ...value,
      }),
    );
  };
  const rows = (amount: string, label = "মাল") => [
    {
      id: `line-${index + 1}`,
      label,
      amount: number(amount),
      quantity: number("8"),
    },
  ];
  add({
    payment: "partial",
    paid: number("30000"),
    rows: rows("93000", "দরজা"),
  });
  add({ workId: "roof", payment: "due", rows: rows("24000") });
  add({
    kind: "wage",
    personId: "worker",
    amount: number("16000"),
    payment: "partial",
    paid: number("6000"),
  });
  add({
    personId: "driver",
    costType: "transport",
    rows: rows("200", "ভ্যানভাড়া"),
  });
  add({
    kind: "payment",
    personId: "worker",
    account: "labour",
    amount: number("5000"),
    date: "2026-10-01",
  });
  add({
    kind: "payment",
    personId: "mason",
    account: "labour",
    contractId: "mason-contract",
    amount: number("30000"),
    date: "2026-11-02",
  });
  add({
    kind: "payment",
    purpose: "advance",
    personId: "advance-shop",
    workId: "roof",
    amount: number("5000"),
    date: "2026-10-03",
  });
  add({ personId: "return-shop", rows: rows("12000"), date: "2026-10-05" });
  add({
    kind: "return",
    personId: "return-shop",
    rows: rows("2000"),
    refund: number("1000"),
    date: "2026-10-06",
  });
  add({ kind: "return", rows: rows("3000"), date: "2026-10-08" });
  const amount = (value: string) => parseAmount(number(value));
  ledger.entries.push(
    EntrySchema.parse({
      id: "split-bill",
      date: "2026-09-28",
      personId: "shop",
      kind: "expense",
      lines: [
        {
          id: "split-door",
          workId: "door",
          label: "দরজার মাল",
          amount: amount("1000"),
        },
        {
          id: "split-roof",
          workId: "roof",
          label: "ছাদের মাল",
          amount: amount("2000"),
        },
      ],
    }),
    EntrySchema.parse({
      id: "split-payment",
      date: "2026-10-07",
      personId: "shop",
      kind: "payment",
      relatedEntryId: "split-bill",
      allocations: [
        { workId: "door", amount: amount("500") },
        { workId: "roof", amount: amount("1500") },
      ],
      paymentParts: [{ method: "bkash", amount: amount("2000") }],
    }),
  );
  add({ rows: rows("777"), date: "2026-12-01" });
  ledger.entries = ledger.entries.map((entry, i) =>
    i >= ledger.entries.length - 2 ? { ...entry, voided: true } : entry,
  );
  return LedgerSchema.parse(ledger);
}
