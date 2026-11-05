import { expect, it } from "vitest";
import {
  EntrySchema,
  LedgerSchema,
  type Account,
  type Ledger,
} from "../../domain/model";
import {
  planHousePayment,
  recordHousePayment,
  type HousePaymentRequest,
} from "../../domain/housePayments";
import { partyLedger } from "../../domain/partyLedger";
import { paymentPresentation } from "./paymentPresentation";

const bill = (
  id: string,
  amount: number,
  workId = "roof",
  account: Account = "materials",
  contractId: string | null = null,
) =>
  EntrySchema.parse({
    id,
    kind: "expense",
    personId: "party",
    account,
    contractId,
    date: "2026-11-01",
    lines: [
      {
        id: `${id}-line`,
        workId,
        amount,
        costType: account === "labour" ? "labour" : "material",
      },
    ],
  });
const fixture = (entries: Ledger["entries"] = []) =>
  LedgerSchema.parse({
    architectureVersion: 2,
    milestones: [],
    paymentAllocations: [],
    people: [
      {
        id: "party",
        name: "নমুনা ব্যক্তি",
        roles: ["supplier", "craftsperson"],
      },
    ],
    works: [
      { id: "roof", name: "নমুনা ছাদ" },
      { id: "paint", name: "নমুনা রং" },
    ],
    entries,
  });
const input = (
  extra: Partial<HousePaymentRequest> = {},
): HousePaymentRequest => ({
  personId: "party",
  amount: 100000,
  intent: "settlement",
  ...extra,
});
const display = (ledger: Ledger, request: HousePaymentRequest) =>
  paymentPresentation(ledger, request, planHousePayment(ledger, request), {
    date: "2026-11-05",
  });

it("uses actual all-person earned due rather than unmatched bill capacity, without linking legacy cash", () => {
  const ledger = fixture([
    bill("bill", 10000),
    EntrySchema.parse({
      id: "legacy",
      kind: "payment",
      account: "materials",
      personId: "party",
      allocations: [{ workId: "roof", amount: 4000 }],
      paymentParts: [{ amount: 4000 }],
    }),
  ]);
  const original = structuredClone(ledger);
  const request = input({ amount: 3000, confirmUnallocatedCash: true });
  expect(display(ledger, request)).toMatchObject({
    beforeDue: 6000,
    afterDue: 3000,
    matchedBillAmount: 3000,
    hasScopedBills: true,
    hasOtherBills: false,
    requiresReview: true,
    legacyUnallocatedCash: 4000,
    canPreview: true,
  });
  expect(partyLedger(ledger, "party").billOutstanding).toBe(10000);
  expect(ledger).toEqual(original);
});

it("distinguishes a scope mismatch from no bills and withholds a settlement outcome until intent is resolved", () => {
  const ledger = fixture([bill("paint-bill", 10000, "paint")]);
  const request = input({ workId: "roof", account: "materials" });
  expect(display(ledger, request)).toMatchObject({
    beforeDue: 10000,
    afterDue: null,
    matchedBillAmount: 0,
    remaining: 100000,
    hasScopedBills: false,
    hasOtherBills: true,
    canPreview: false,
  });
  expect(display(ledger, input())).toMatchObject({
    beforeDue: 10000,
    afterDue: 0,
    matchedBillAmount: 10000,
    remaining: 90000,
    excess: 90000,
    hasScopedBills: true,
    hasOtherBills: false,
    canPreview: true,
  });
});

it("does not present a bill settlement when there are no bills, while an explicit advance has a valid result", () => {
  const ledger = fixture();
  const request = input({ account: "materials", workId: "roof" });
  expect(display(ledger, request)).toMatchObject({
    beforeDue: 0,
    afterDue: null,
    hasScopedBills: false,
    hasOtherBills: false,
    canPreview: false,
  });
  expect(display(ledger, { ...request, intent: "advance" })).toMatchObject({
    beforeDue: 0,
    afterDue: 0,
    excess: 100000,
    canPreview: true,
  });
});

it("projects a same-account advance through canonical accounting instead of displaying old due beside the entire cash amount", () => {
  const ledger = fixture([bill("bill", 10000)]);
  expect(
    display(
      ledger,
      input({ intent: "advance", workId: "roof", account: "materials" }),
    ),
  ).toMatchObject({
    beforeDue: 10000,
    afterDue: 0,
    matchedBillAmount: 0,
    remaining: 100000,
    excess: 90000,
    canPreview: true,
  });
});

it("keeps genuine balances in different accounts separate rather than inventing net settlement", () => {
  const ledger = fixture([bill("wages", 10000, "roof", "labour")]);
  expect(
    display(
      ledger,
      input({ intent: "advance", workId: "roof", account: "materials" }),
    ),
  ).toMatchObject({
    beforeDue: 10000,
    afterDue: 10000,
    excess: 100000,
    hasScopedBills: false,
    hasOtherBills: true,
    canPreview: true,
  });
});

it("withholds a projection for unconfirmed old cash, invalid allocations and stale plans", () => {
  const ledger = fixture([
    bill("bill", 10000),
    EntrySchema.parse({
      id: "legacy",
      kind: "payment",
      personId: "party",
      allocations: [{ workId: "roof", amount: 1000 }],
      paymentParts: [{ amount: 1000 }],
    }),
  ]);
  const request = input({ amount: 3000 });
  expect(display(ledger, request)).toMatchObject({
    beforeDue: 9000,
    afterDue: null,
    requiresReview: true,
    canPreview: false,
  });
  expect(
    display(ledger, {
      ...request,
      allocations: [{ billId: "missing", workId: "roof", amount: 3000 }],
    }).canPreview,
  ).toBe(false);
  const original = fixture([bill("bill", 10000)]);
  const plan = planHousePayment(original, request);
  const changed = fixture([...original.entries, bill("later", 1000)]);
  expect(paymentPresentation(changed, request, plan)).toMatchObject({
    afterDue: null,
    canPreview: false,
  });
});

it("never fabricates an all-person outcome when an old contract correction is unresolved", () => {
  const ledger = LedgerSchema.parse({
    ...fixture(),
    contracts: [
      { id: "job", personId: "party", workId: "roof", total: 100000 },
    ],
    entries: [
      bill("earned", 30000, "roof", "labour", "job"),
      {
        id: "old-discount",
        kind: "adjustment",
        note: "নমুনা পুরোনো চুক্তির ছাড়",
        personId: "party",
        account: "labour",
        contractId: "job",
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
  expect(
    display(
      ledger,
      input({ intent: "advance", account: "materials", workId: "roof" }),
    ),
  ).toMatchObject({
    beforeDue: null,
    afterDue: null,
    excess: null,
    requiresReview: true,
    canPreview: false,
  });
});

it("matches the actual recorded balance and avoids collisions with existing preview-like IDs", () => {
  const ledger = fixture([
    bill("payment-preview", 5000),
    bill("payment-preview-1:0", 10000),
  ]);
  const request = input({ amount: 8000 });
  const plan = planHousePayment(ledger, request);
  const presentation = paymentPresentation(ledger, request, plan, {
    date: "2026-11-05",
    method: "bank",
  });
  const saved = recordHousePayment(
    ledger,
    { ...request, id: "actual", date: "2026-11-05", method: "bank" },
    plan,
  );
  expect(presentation).toMatchObject({
    beforeDue: 15000,
    afterDue: partyLedger(saved, "party").earnedPayable,
    matchedBillAmount: 8000,
    excess: 0,
    canPreview: true,
  });
  expect(
    paymentPresentation(ledger, request, plan, {
      date: "2026-11-05",
      method: "bank",
    }),
  ).toEqual(presentation);
});

it("shows the selected ongoing contract's promise instead of another completed contract's due", () => {
  const ledger = LedgerSchema.parse({
    ...fixture(),
    contracts: [
      {
        id: "ongoing",
        personId: "party",
        scope: "house",
        status: "ongoing",
        total: 60000000,
      },
      {
        id: "completed",
        personId: "party",
        workId: "paint",
        status: "done",
        total: 2500000,
      },
    ],
  });
  const source = structuredClone(ledger);
  const request = input({
    intent: "payment",
    amount: 54150000,
    account: "labour",
    contractId: "ongoing",
    workId: "roof",
  });
  expect(partyLedger(ledger, "party").earnedPayable).toBe(2500000);
  expect(display(ledger, request)).toMatchObject({
    beforeDue: 60000000,
    afterDue: 5850000,
    excess: 0,
    matchedBillAmount: 0,
    canPreview: true,
  });
  const saved = recordHousePayment(ledger, {
    ...request,
    id: "actual",
    date: "2026-11-05",
    method: "cash",
  });
  expect(saved.entries).toMatchObject([
    {
      kind: "payment",
      contractId: "ongoing",
      paymentParts: [{ amount: 54150000 }],
    },
  ]);
  expect(partyLedger(saved, "party").earnedPayable).toBe(2500000);
  expect(ledger).toEqual(source);
});

it("keeps a bill settlement on the selected contract's earned amount instead of its larger promise", () => {
  const ledger = LedgerSchema.parse({
    ...fixture(),
    entries: [bill("selected-bill", 10000, "roof", "labour", "selected")],
    contracts: [
      {
        id: "selected",
        personId: "party",
        workId: "roof",
        status: "ongoing",
        total: 1000000,
      },
      {
        id: "other",
        personId: "party",
        workId: "paint",
        status: "done",
        total: 2500000,
      },
    ],
  });
  const request = input({
    intent: "payment",
    amount: 4000,
    account: "labour",
    contractId: "selected",
    workId: "roof",
    allocations: [{ billId: "selected-bill", workId: "roof", amount: 4000 }],
  });
  expect(
    paymentPresentation(ledger, request, planHousePayment(ledger, request), {
      date: "2026-11-05",
      balanceBasis: "earned",
    }),
  ).toMatchObject({
    beforeDue: 10000,
    afterDue: 6000,
    matchedBillAmount: 4000,
    excess: 0,
    canPreview: true,
  });
});
