import { expect, it } from "vitest";
import { EntrySchema, LedgerSchema, PersonSchema } from "./model";
import {
  contactEntryPolicy,
  getContactEntryDefaults,
} from "./contactEntryPolicy";
import { canCreateContactJob, defaultContactAccount } from "./contacts";
import { planHousePayment, recordHousePayment } from "./housePayments";
import { saveContractChange } from "./contracts";
import { QuickDraftSchema } from "../features/entries/quickEntry";
import { recordHouseCost } from "../features/write/houseCost";

const ledger = () =>
  LedgerSchema.parse({
    works: [
      { id: "roof", name: "নমুনা ছাদ" },
      { id: "wall", name: "নমুনা দেয়াল" },
    ],
    people: [
      {
        id: "party",
        name: "নমুনা নাম",
        kind: "shop",
        contactType: "supplier",
        roles: ["supplier"],
        workIds: ["roof"],
      },
    ],
  });
const cost = (change: Record<string, unknown> = {}) =>
  QuickDraftSchema.parse({
    id: "cost",
    paymentId: "paid",
    refundId: "refund",
    personNewId: "new",
    workId: "roof",
    personId: "party",
    date: "2026-11-05",
    payment: "due",
    rows: [{ id: "line", label: "নমুনা মাল", amount: "100" }],
    ...change,
  });
const cash = {
  id: "payment",
  personId: "party",
  amount: 5000,
  intent: "advance" as const,
  workId: "roof",
  date: "2026-11-05",
  method: "cash" as const,
};

it("unions deliberately selected roles while honoring saved action restrictions without rewriting identity", () => {
  const person = PersonSchema.parse({
    ...ledger().people[0],
    roles: ["supplier", "craftsperson", "transport"],
    quickActions: ["payment", "transport"],
  });
  const before = structuredClone(person);
  expect(contactEntryPolicy(person)).toMatchObject({
    actions: ["payment", "transport"],
    accounts: ["materials", "labour", "other"],
    purchase: false,
    reimbursement: true,
    agreement: true,
    chargeCostTypes: ["labour", "transport", "unload", "rental", "other"],
  });
  expect(person).toEqual(before);
  expect(defaultContactAccount({ ...person, roles: ["transport"] })).toBe(
    "other",
  );
  expect(canCreateContactJob({ ...person, roles: ["supplier"] })).toBe(false);
  expect(canCreateContactJob({ ...person, roles: [] })).toBe(true);
});

it("uses the sole saved sector as a default and preserves a deliberately chosen sector and optional agreement", () => {
  const current = ledger();
  expect(getContactEntryDefaults(current, current.people[0])).toMatchObject({
    workId: "roof",
    account: "materials",
    contractId: "",
  });
  expect(
    getContactEntryDefaults(current, current.people[0], { workId: "wall" })
      .workId,
  ).toBe("wall");
  expect(
    getContactEntryDefaults(current, {
      ...current.people[0],
      workIds: ["roof", "wall"],
    }).workId,
  ).toBe("");
  expect(current.entries).toEqual([]);
  const preview = planHousePayment(current, {
    personId: "party",
    amount: 1000,
    intent: "settlement",
  });
  expect(preview.issues).toEqual([]);
  expect(preview.groups).toMatchObject([
    {
      account: "materials",
      context: "advance",
      works: [{ workId: "roof", amount: 1000 }],
    },
  ]);
});

it("keeps legacy worker defaults until a neutral role is deliberately saved", () => {
  const worker = PersonSchema.parse({
    id: "worker",
    name: "নমুনা মিস্ত্রি",
    kind: "worker",
  });
  expect(contactEntryPolicy(worker)).toMatchObject({
    purchase: false,
    defaultAccount: "labour",
    accounts: ["labour", "other"],
  });
  expect(contactEntryPolicy({ ...worker, roles: [] })).toMatchObject({
    purchase: true,
    defaultAccount: "other",
    accounts: ["materials", "labour", "other"],
  });
  expect(
    contactEntryPolicy({ ...worker, roles: [], quickActions: ["payment"] }),
  ).toMatchObject({
    purchase: false,
    chargeCostTypes: ["labour", "unload", "rental", "other"],
    reimbursement: true,
  });
  expect(
    contactEntryPolicy({
      ...worker,
      roles: [],
      quickActions: ["purchase", "transport"],
    }),
  ).toMatchObject({
    purchase: true,
    chargeCostTypes: ["transport"],
    payment: false,
  });
});

it("rejects a disabled purchase at mutation time, including a stale form after a profile change", () => {
  const current = ledger();
  current.people[0].quickActions = ["payment"];
  expect(() => recordHouseCost(current, cost(), [], "সাধারণ খরচ")).toThrow(
    "contact_rules",
  );
  expect(current.entries).toEqual([]);
  current.people[0].quickActions = ["purchase"];
  expect(
    recordHouseCost(current, cost(), [], "সাধারণ খরচ").entries,
  ).toHaveLength(1);
});

it("permits worker-owned materials only through the explicit reimbursement choice and keeps them out of wages", () => {
  const current = ledger();
  current.people[0] = PersonSchema.parse({
    ...current.people[0],
    kind: "worker",
    contactType: "craftsperson",
    roles: ["craftsperson"],
  });
  expect(() => recordHouseCost(current, cost(), [], "সাধারণ খরচ")).toThrow(
    "contact_rules",
  );
  const next = recordHouseCost(
    current,
    cost({ payment: "worker" }),
    [],
    "সাধারণ খরচ",
  );
  expect(next.entries).toHaveLength(1);
  expect(next.entries[0]).toMatchObject({
    account: "materials",
    lines: [{ costType: "material", amount: 10000 }],
  });
});

it("rejects disabled payments and incompatible new advance accounts in the command", () => {
  const current = ledger();
  expect(
    planHousePayment(current, { ...cash, account: "labour" }).issues,
  ).toContain("contact_rules");
  current.people[0].quickActions = ["purchase"];
  expect(() =>
    recordHousePayment(current, { ...cash, account: "materials" }),
  ).toThrow("house_payment_contact_rules");
  expect(current.entries).toEqual([]);
});

it("can settle an actual historical bill after roles change without manufacturing new wages or allowing unrelated advances", () => {
  const current = ledger();
  current.entries.push(
    EntrySchema.parse({
      id: "old",
      personId: "party",
      account: "labour",
      kind: "expense",
      lines: [
        { id: "old-line", workId: "roof", costType: "labour", amount: 5000 },
      ],
    }),
  );
  const next = recordHousePayment(current, {
    ...cash,
    intent: "settlement",
    account: "labour",
  });
  expect(next.entries[0]).toEqual(current.entries[0]);
  expect(next.paymentAllocations).toHaveLength(1);
  expect(() =>
    recordHousePayment(current, {
      ...cash,
      intent: "settlement",
      account: "labour",
      amount: 6000,
      confirmRemainderAdvance: true,
    }),
  ).toThrow("house_payment_contact_rules");
});

it("rejects new agreements for supplier-only identities but preserves corrections to an existing historical agreement", () => {
  const current = ledger();
  const agreement = {
    id: "job",
    personId: "party",
    scope: "work" as const,
    workId: "roof",
    total: 10000,
  };
  expect(() => saveContractChange(current, agreement as never)).toThrow(
    "এই ধরনের নামে",
  );
  const historical = LedgerSchema.parse({ ...current, contracts: [agreement] });
  expect(
    saveContractChange(
      historical,
      { ...historical.contracts[0], total: 12000 },
      "নমুনা সংশোধন",
    ).contracts[0].total,
  ).toBe(12000);
});
