import { describe, expect, it } from "vitest";
import { LedgerSchema } from "../../domain/model";
import {
  entryContext,
  entryContactChange,
  restoreEntryContext,
  changeEntryType,
} from "./entryContext";
import { buildQuickEntry } from "./quickEntry";
import { summarize } from "../../domain/ledger";
const base = () =>
  LedgerSchema.parse({
    works: [
      { id: "wallet-cement", name: "সিমেন্ট কেনা" },
      { id: "wallet-sand", name: "বালু কেনা" },
      { id: "other", name: "প্লাস্টার" },
    ],
    materialGroups: [
      { id: "cement", name: "সিমেন্ট", aliases: ["cement"] },
      { id: "sand", name: "বালু", aliases: ["sand"] },
    ],
    items: [
      {
        id: "crown",
        name: "সিমেন্ট",
        brand: "Crown",
        materialGroupId: "cement",
        unit: "বস্তা",
      },
      {
        id: "shah",
        name: "সিমেন্ট",
        brand: "Shah",
        materialGroupId: "cement",
        unit: "বস্তা",
      },
    ],
    people: [
      { id: "worker", name: "শাহ আলম", kind: "worker" },
      { id: "shop", name: "দোকান", kind: "shop" },
    ],
  });
describe("entry context", () => {
  it("clears a prior worker agreement while preserving the globally chosen payment reason", () => {
    const ledger = base();
    const saved = entryContext(ledger, { kind: "payment", personId: "worker" });
    saved.contractId = "old-contract";
    saved.paymentPurposeId = "old-purpose";
    for (const id of ["__new__", ""])
      expect(entryContactChange(ledger, saved, id)).toMatchObject({
        personId: id,
        contractId: "",
        paymentPurposeId: "old-purpose",
      });
  });
  it("upgrades only an untouched blank row in an older context draft without discarding draft identity", () => {
    const context = entryContext(base(), { workId: "wallet-cement" });
    const saved = {
      ...context,
      rows: [
        { ...context.rows[0], label: "", groupId: "", groupName: "", unit: "" },
      ],
    };
    expect(restoreEntryContext(saved, context).rows[0]).toMatchObject({
      id: saved.rows[0].id,
      label: "সিমেন্ট",
      unit: "বস্তা",
    });
    saved.rows[0].amount = "1500";
    expect(restoreEntryContext(saved, context)).toBe(saved);
  });
  it("prefills cement taxonomy and bags without guessing among brands, saves with only amount and quantity", () => {
    const ledger = base();
    const draft = entryContext(ledger, { workId: "wallet-cement" });
    expect(draft.rows[0]).toMatchObject({
      label: "সিমেন্ট",
      groupId: "cement",
      unit: "বস্তা",
      brand: "",
    });
    draft.rows[0].amount = "5000";
    draft.rows[0].quantity = "10";
    const next = buildQuickEntry(ledger, draft);
    expect(next.entries[0]).toMatchObject({
      reviewStatus: "confirmed",
      account: "materials",
      lines: [
        expect.objectContaining({
          materialGroupId: "cement",
          quantity: "10",
          unit: "বস্তা",
          workId: "wallet-cement",
        }),
      ],
    });
    expect(summarize(next).cost).toBe(500000);
  });
  it("prefills sand but never assumes materials for a generic work", () => {
    expect(
      entryContext(base(), { workId: "wallet-sand" }).rows[0],
    ).toMatchObject({ label: "বালু", groupId: "sand" });
    expect(entryContext(base(), { workId: "other" }).rows[0].groupId).toBe("");
  });
  it("fills a known material for a new notebook and adds missing taxonomy atomically", () => {
    const ledger = LedgerSchema.parse({
      works: [{ id: "new", name: "বালু কেনা" }],
    });
    const draft = entryContext(ledger, { workId: "new" });
    draft.rows[0].amount = "100";
    expect(draft.rows[0]).toMatchObject({
      label: "বালু",
      groupId: "__new__",
      groupName: "বালু",
    });
    const next = buildQuickEntry(ledger, draft);
    expect(next.materialGroups[0].name).toBe("বালু");
    expect(next.entries[0].reviewStatus).toBe("confirmed");
  });
  it("prefills worker's sole contract and work, never guesses across two works", () => {
    const ledger = base();
    ledger.contracts.push({
      id: "contract",
      personId: "worker",
      workId: "other",
      basis: "fixed",
      quantity: "1",
      rate: 60000000,
      total: 60000000,
      title: "",
      notes: "",
      scope: "work",
      status: null,
      archivedAt: null,
      removalHistory: [],
      agreedOn: null,
      activity: [],
      history: [],
    });
    expect(
      entryContext(ledger, { kind: "payment", personId: "worker" }),
    ).toMatchObject({
      account: "labour",
      costType: "labour",
      workId: "other",
      contractId: "contract",
    });
    ledger.contracts.push({
      ...ledger.contracts[0],
      id: "contract2",
      workId: "wallet-sand",
    });
    expect(
      entryContext(ledger, { kind: "payment", personId: "worker" }).workId,
    ).toBe("");
  });
  it("starts a wage bill unpaid and keeps payments separate", () => {
    const ledger = base();
    const draft = entryContext(ledger, {
      kind: "wage",
      workId: "other",
      personId: "worker",
    });
    expect(draft).toMatchObject({
      account: "labour",
      costType: "labour",
      payment: "due",
    });
    draft.amount = "16000";
    const next = buildQuickEntry(ledger, draft);
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0]).toMatchObject({
      kind: "expense",
      account: "labour",
    });
    expect(summarize(next, "other")).toMatchObject({ cost: 1600000, paid: 0 });
  });
  it("clears incompatible subject details while retaining money when changing cost type", () => {
    const ledger = base();
    const material = entryContext(ledger, { workId: "wallet-cement" });
    material.rows[0].amount = "5000";
    material.rows[0].quantity = "10";
    const labour = changeEntryType(ledger, material, "labour");
    expect(labour).toMatchObject({
      account: "labour",
      rows: [
        expect.objectContaining({
          label: "",
          groupId: "",
          unit: "",
          quantity: "",
          amount: "5000",
        }),
      ],
    });
    labour.rows[0].label = "মজুরি";
    expect(changeEntryType(ledger, labour, "material").rows[0]).toMatchObject({
      label: "সিমেন্ট",
      groupId: "cement",
      amount: "5000",
    });
  });
});

it("prefills a requested worker job and keeps wrong-person or incompatible notebook jobs unselected", () => {
  const ledger = base();
  ledger.people.push({
    ...ledger.people[0],
    id: "second-worker",
    name: "অন্য মিস্ত্রি",
  });
  ledger.contracts = LedgerSchema.parse({
    ...ledger,
    contracts: [
      { id: "house-job", scope: "house", personId: "worker", total: 60000000 },
      {
        id: "specific-job",
        workId: "other",
        personId: "worker",
        total: 2000000,
      },
      {
        id: "foreign-job",
        scope: "house",
        personId: "second-worker",
        total: 1000000,
      },
    ],
  }).contracts;
  const before = JSON.stringify(ledger);
  expect(
    entryContext(ledger, {
      kind: "payment",
      personId: "worker",
      contractId: "specific-job",
    }),
  ).toMatchObject({
    account: "labour",
    workId: "other",
    contractId: "specific-job",
    purpose: "settle",
  });
  expect(
    entryContext(ledger, {
      kind: "payment",
      personId: "worker",
      workId: "wallet-cement",
      contractId: "house-job",
    }),
  ).toMatchObject({ contractId: "house-job", workId: "wallet-cement" });
  for (const id of ["foreign-job", "missing-job", "specific-job"])
    expect(
      entryContext(ledger, {
        kind: "payment",
        personId: "worker",
        workId: "wallet-cement",
        contractId: id,
      }).contractId,
    ).toBe("");
  expect(
    entryContext(ledger, {
      kind: "payment",
      personId: "worker",
      account: "materials",
      contractId: "house-job",
    }).contractId,
  ).toBe("");
  expect(JSON.stringify(ledger)).toBe(before);
});

it("does not assign a new unlinked job to another job's notebook just because the worker used it before", () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "plaster", name: "প্লাস্টার" }],
    people: [{ id: "worker", name: "মিস্ত্রি", kind: "worker" }],
    contracts: [
      { id: "old", scope: "house", personId: "worker", total: 500000 },
      { id: "new", scope: "house", personId: "worker", total: 200000 },
    ],
    entries: [
      {
        id: "paid",
        kind: "payment",
        account: "labour",
        personId: "worker",
        contractId: "old",
        allocations: [{ workId: "plaster", amount: 50000 }],
        paymentParts: [{ amount: 50000 }],
      },
    ],
  });
  expect(
    entryContext(ledger, {
      personId: "worker",
      kind: "payment",
      contractId: "new",
    }),
  ).toMatchObject({ contractId: "new", workId: "" });
  expect(
    entryContext(ledger, {
      personId: "worker",
      kind: "payment",
      contractId: "old",
    }),
  ).toMatchObject({ contractId: "old", workId: "plaster" });
});

it("carries only the selected agreement's milestone into a wage bill context", () => {
  const ledger = LedgerSchema.parse({
    ...base(),
    contracts: [
      { id: "job", personId: "worker", workId: "other", total: 100000 },
    ],
    milestones: [
      { id: "stage", contractId: "job", title: "নমুনা ধাপ", amount: 40000 },
    ],
  });
  const context = entryContext(ledger, {
    kind: "wage",
    personId: "worker",
    workId: "other",
    contractId: "job",
    milestoneId: "stage",
  });
  expect(context.milestoneId).toBe("stage");
  const saved = buildQuickEntry(ledger, {
    ...context,
    amount: "200",
    payment: "partial",
    paid: "50",
  });
  expect(saved.entries).toHaveLength(2);
  expect(saved.entries[0]).toMatchObject({
    kind: "expense",
    milestoneId: "stage",
    contractId: "job",
  });
  expect(saved.entries[1]).toMatchObject({
    kind: "payment",
    contractId: "job",
  });
  expect(saved.entries[1].milestoneId).toBeUndefined();
  expect(
    entryContext(ledger, {
      kind: "wage",
      personId: "shop",
      milestoneId: "stage",
    }).milestoneId,
  ).toBe("");
});
