import { describe, expect, it } from "vitest";
import { LedgerSchema } from "../../domain/model";
import {
  entryContext,
  entryContactChange,
  restoreEntryContext,
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
  it("clears a prior worker agreement when choosing a new or unnamed person", () => {
    const ledger = base();
    const saved = entryContext(ledger, { kind: "payment", personId: "worker" });
    saved.contractId = "old-contract";
    saved.paymentPurposeId = "old-purpose";
    for (const id of ["__new__", ""])
      expect(entryContactChange(ledger, saved, id)).toMatchObject({
        personId: id,
        contractId: "",
        paymentPurposeId: "",
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
});
