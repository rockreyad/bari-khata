import { expect, it } from "vitest";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { partyDueItems, partyDuePaymentUrl } from "./partyDueItems";
const base = (entries: unknown[] = []) =>
  LedgerSchema.parse({
    architectureVersion: 2,
    paymentAllocations: [],
    works: [
      { id: "roof", name: "ছাদ" },
      { id: "wall", name: "দেয়াল" },
    ],
    people: [
      {
        id: "person",
        name: "নমুনা কর্মী",
        roles: ["supplier", "craftsperson"],
      },
    ],
    entries,
  });
const bill = (id: string, amount: number, workId = "roof", extra = {}) => ({
  id,
  kind: "expense",
  account: "materials",
  personId: "person",
  date: "2026-11-01",
  lines: [
    { id: `${id}-line`, workId, amount, label: id, costType: "material" },
  ],
  ...extra,
});
const cash = (amount: number, workId = "roof", extra = {}) => ({
  id: "cash",
  kind: "payment",
  personId: "person",
  account: "materials",
  paymentContext: "settlement",
  allocations: [{ workId, amount }],
  paymentParts: [{ amount }],
  ...extra,
});
const correction = (delta: number) => ({
  id: "correction",
  kind: "adjustment",
  personId: "person",
  account: "materials",
  note: "নমুনা সংশোধন",
  adjustment: {
    target: "person",
    basis: "balance",
    calculationVersion: 2,
    account: "materials",
    workId: "roof",
    before: 10000,
    after: 10000 + delta,
    delta,
  },
});
it("keeps a finished unpaid job attached to its settlement even before its first entry", () => {
  const ledger = LedgerSchema.parse({
    ...base(),
    contracts: [
      {
        id: "finished",
        personId: "person",
        workId: "roof",
        total: 3500000,
        status: "done",
      },
      {
        id: "planned",
        personId: "person",
        workId: "wall",
        total: 9000000,
        status: "planned",
      },
    ],
  });
  const before = structuredClone(ledger);
  const rows = partyDueItems(ledger, "person");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    contractId: "finished",
    account: "labour",
    workId: "roof",
    amount: 3500000,
  });
  expect(rows[0].billId).toBeUndefined();
  expect(
    new URL(
      partyDuePaymentUrl(rows[0], "/parties/person"),
      "https://bari.invalid",
    ).searchParams.get("contract"),
  ).toBe("finished");
  expect(partyDueItems(ledger, "person", { workId: "wall" })).toEqual([]);
  expect(partyDueItems(ledger, "person", { account: "materials" })).toEqual([]);
  expect(ledger).toEqual(before);
});
it("keeps unmatched cash as one neutral net balance without assigning it to guessed old bills", () => {
  const ledger = base([
    bill("first", 10000),
    bill("second", 20000),
    cash(10000),
  ]);
  const source = structuredClone(ledger);
  const rows = partyDueItems(ledger, "person");
  expect(rows).toMatchObject([{ amount: 20000, label: "বাকির হিসাব" }]);
  expect(rows).toHaveLength(1);
  expect(rows[0].billId).toBeUndefined();
  expect(ledger).toEqual(source);
  expect(ledger.paymentAllocations).toEqual([]);
});
it("presents corrected bucket balances neutrally rather than assigning a correction to a bill", () => {
  for (const delta of [-5000, 5000]) {
    const rows = partyDueItems(
      base([bill("bill", 10000), correction(delta)]),
      "person",
    );
    expect(rows).toMatchObject([
      { amount: 10000 + delta, label: "বাকির হিসাব" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].billId).toBeUndefined();
  }
});
it("does not borrow payments from another work when a work filter is explicit", () => {
  const ledger = base([bill("bill", 10000), cash(10000, "wall")]);
  expect(partyDueItems(ledger, "person")).toEqual([]);
  expect(partyDueItems(ledger, "person", { workId: "roof" })).toMatchObject([
    { billId: "bill", amount: 10000, workId: "roof" },
  ]);
});
it("caps existing bill allocations and returned credits before suggesting any more cash", () => {
  const ledger = LedgerSchema.parse({
    ...base([bill("bill", 10000), cash(4000)]),
    paymentAllocations: [
      {
        id: "allocation",
        paymentId: "cash",
        billId: "bill",
        workId: "roof",
        amount: 4000,
        createdAt: "2026-11-01T00:00:00Z",
      },
    ],
  });
  expect(partyDueItems(ledger, "person")).toMatchObject([
    { billId: "bill", amount: 6000 },
  ]);
});
it("keeps a legacy transport bill's original account in its settlement link while using canonical net caps", () => {
  const ledger = base([
    bill("transport", 10000, "roof", {
      lines: [
        {
          id: "line",
          workId: "roof",
          amount: 10000,
          costType: "transport",
          label: "নমুনা পরিবহন",
        },
      ],
    }),
  ]);
  expect(partyDueItems(ledger, "person", { account: "other" })).toMatchObject([
    { billId: "transport", account: "materials", amount: 10000 },
  ]);
});
it("omits unresolved legacy correction scopes rather than presenting an invented current due", () => {
  const ledger = LedgerSchema.parse({
    ...base(),
    contracts: [
      { id: "job", personId: "person", workId: "roof", total: 100000 },
    ],
    entries: [
      bill("earned", 30000, "roof", {
        account: "labour",
        contractId: "job",
        lines: [
          { id: "line", workId: "roof", amount: 30000, costType: "labour" },
        ],
      }),
      {
        id: "old",
        kind: "adjustment",
        personId: "person",
        account: "labour",
        contractId: "job",
        note: "পুরোনো অঙ্ক",
        adjustment: {
          target: "person",
          basis: "balance",
          account: "labour",
          workId: "roof",
          before: 100000,
          after: 90000,
          delta: -10000,
        },
      },
    ],
  });
  expect(partyDueItems(ledger, "person")).toEqual([]);
});
it("returns no other person's dues for an unknown person and creates a fully scoped paisa URL", () => {
  const ledger: Ledger = base([bill("bill", 125050)]);
  expect(partyDueItems(ledger, "missing")).toEqual([]);
  const url = new URL(
    partyDuePaymentUrl(
      partyDueItems(ledger, "person")[0],
      "/sample/dues?person=person&keep=1",
    ),
    "https://example.invalid",
  );
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    person: "person",
    account: "materials",
    contract: "none",
    work: "roof",
    bill: "bill",
    amount: "125050",
    purpose: "settle",
    back: "/sample/dues?person=person&keep=1",
  });
});

it("carries the source view scope so revalidation cannot inflate an all-work bill cap", () => {
  const ledger = base([
    bill("first", 10000),
    bill("second", 10000, "wall"),
    cash(15000, "wall"),
  ]);
  const unfiltered = partyDueItems(ledger, "person")[0];
  expect(unfiltered.amount).toBe(5000);
  expect(partyDueItems(ledger, "person", { workId: "roof" })[0].amount).toBe(
    10000,
  );
  const all = new URL(
    partyDuePaymentUrl(unfiltered, "/dues?person=person"),
    "https://example.invalid",
  );
  expect(all.searchParams.get("dueWork")).toBe("all");
  expect(all.searchParams.get("dueAccount")).toBe("all");
  const scoped = new URL(
    partyDuePaymentUrl(
      partyDueItems(ledger, "person", { workId: "roof" })[0],
      "/dues?person=person&work=roof",
      { workId: "roof", account: "materials" },
    ),
    "https://example.invalid",
  );
  expect(scoped.searchParams.get("dueWork")).toBe("roof");
  expect(scoped.searchParams.get("dueAccount")).toBe("materials");
});

it("does not claim an exact payable amount when an old refund has no known cash source", () => {
  const ledger = base([
    bill("bill", 10000),
    {
      ...cash(4000),
      id: "old-refund",
      kind: "refund",
      paymentContext: undefined,
    },
  ]);
  expect(partyDueItems(ledger, "person")).toEqual([]);
});

it("marks a verified nonbill correction payment as cash-only instead of inventing a bill allocation", () => {
  const aggregate = partyDueItems(
    base([bill("bill", 10000), correction(5000)]),
    "person",
  ).find((row) => !row.billId)!;
  const url = new URL(
    partyDuePaymentUrl(aggregate, "/dues?person=person"),
    "https://example.invalid",
  );
  expect(url.searchParams.get("balanceOnly")).toBe("1");
  expect(url.searchParams.has("bill")).toBe(false);
  expect(url.searchParams.get("amount")).toBe("15000");
});

it("does not net another contract's cash against a confirmed contract bill", () => {
  const ledger = LedgerSchema.parse({
    ...base(),
    contracts: [
      { id: "owed", personId: "person", workId: "roof", total: 10000 },
      { id: "credit", personId: "person", workId: "wall", total: 10000 },
    ],
    entries: [
      bill("owed-bill", 10000, "roof", {
        account: "labour",
        contractId: "owed",
        lines: [
          {
            id: "line",
            workId: "roof",
            amount: 10000,
            costType: "labour",
            label: "নমুনা বিল",
          },
        ],
      }),
      cash(10000, "wall", { account: "labour", contractId: "credit" }),
    ],
  });
  expect(partyDueItems(ledger, "person")).toMatchObject([
    { billId: "owed-bill", contractId: "owed", amount: 10000 },
  ]);
  expect(partyDueItems(ledger, "person", { account: "labour" })).toMatchObject([
    { billId: "owed-bill", contractId: "owed", amount: 10000 },
  ]);
});
it("honors explicit whole-account correction semantics without inventing which contract bill was discounted", () => {
  const ledger = LedgerSchema.parse({
    ...base(),
    contracts: [
      { id: "owed", personId: "person", workId: "roof", total: 10000 },
    ],
    entries: [
      bill("owed-bill", 10000, "roof", {
        account: "labour",
        contractId: "owed",
        lines: [
          { id: "line", workId: "roof", amount: 10000, costType: "labour" },
        ],
      }),
      {
        ...correction(-5000),
        account: "labour",
        adjustment: { ...correction(-5000).adjustment, account: "labour" },
      },
    ],
  });
  const rows = partyDueItems(ledger, "person");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    amount: 5000,
    contractId: null,
    label: "বাকির হিসাব",
  });
  expect(rows[0].billId).toBeUndefined();
});

it("does not infer a bill debt merely because an unmatched payment and correction cancel numerically", () => {
  const rows = partyDueItems(
    base([bill("bill", 10000), cash(5000), correction(5000)]),
    "person",
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ amount: 10000, label: "বাকির হিসাব" });
  expect(rows[0].billId).toBeUndefined();
});
