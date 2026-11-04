import { describe, expect, it } from "vitest";
import { LedgerSchema } from "../domain/model.js";
import { personSummary, summarize, contractSummary } from "../domain/ledger.js";
import {
  applyMcpCommand,
  McpCommandError,
  McpCommandSchema,
  preservesMcpProvenance,
} from "./mcpCommands.js";

const context = {
  now: "2026-11-02T10:00:00.000Z",
  actor: { connectionId: "assistant-a", name: "আমার সহকারী" },
};
function fixture() {
  return LedgerSchema.parse({
    works: [
      { id: "roof", name: "ছাদ" },
      { id: "tiles", name: "টাইলস" },
    ],
    people: [
      { id: "shop", name: "দোকান", kind: "shop" },
      { id: "worker", name: "মিস্ত্রি", kind: "worker" },
      { id: "driver", name: "ভ্যানচালক", kind: "driver" },
    ],
  });
}
function purchase(extra: Record<string, unknown> = {}) {
  return {
    type: "create_purchase",
    date: "2026-11-02",
    person_id: "shop",
    work_id: "roof",
    lines: [{ label: "সিমেন্ট", cost_type: "material", amount_paisa: 6000000 }],
    payment_state: "partial",
    payment: { amount_paisa: 2000000, method: "cash" },
    ...extra,
  };
}
describe("MCP financial commands", () => {
  it("records a bill and its partial payment atomically, and a later settlement does not book another expense", () => {
    const first = applyMcpCommand(fixture(), purchase(), context);
    expect(first.ledger.entries).toHaveLength(2);
    expect(first.ledger.entries[1].relatedEntryId).toBe(
      first.ledger.entries[0].id,
    );
    expect(summarize(first.ledger)).toMatchObject({
      cost: 6000000,
      paid: 2000000,
      payable: 4000000,
    });
    const second = applyMcpCommand(
      first.ledger,
      {
        type: "record_payment",
        date: "2026-11-02",
        person_id: "shop",
        account: "materials",
        work_id: "roof",
        amount_paisa: 4000000,
        method: "bkash",
      },
      context,
    );
    expect(summarize(second.ledger)).toMatchObject({
      cost: 6000000,
      paid: 6000000,
      payable: 0,
    });
    expect(first.ledger.entries[0].provenance?.connectionId).toBe(
      "assistant-a",
    );
  });
  it("does not infer full payment from a photo of an invoice", () => {
    const ledger = fixture();
    for (const state of [undefined, "unknown"]) {
      try {
        applyMcpCommand(
          ledger,
          purchase({ payment_state: state, payment: undefined }),
          context,
        );
        throw new Error("expected rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(McpCommandError);
        expect((error as McpCommandError).code).toBe("needs_clarification");
      }
    }
    expect(ledger.entries).toEqual([]);
    expect(
      applyMcpCommand(
        ledger,
        purchase({ payment_state: "unpaid", payment: undefined }),
        context,
      ).ledger.entries,
    ).toHaveLength(1);
  });
  it("keeps worker procurement and reimbursement in materials, including excess advance", () => {
    let ledger = applyMcpCommand(
      fixture(),
      purchase({
        type: "record_procurement",
        person_id: "worker",
        payment_state: "unpaid",
        payment: undefined,
        lines: [{ label: "মাল", cost_type: "material", amount_paisa: 150000 }],
      }),
      context,
    ).ledger;
    ledger = applyMcpCommand(
      ledger,
      {
        type: "record_reimbursement",
        date: "2026-11-02",
        person_id: "worker",
        work_id: "roof",
        account: "materials",
        amount_paisa: 170000,
        method: "cash",
      },
      context,
    ).ledger;
    expect(personSummary(ledger, "worker")).toMatchObject({
      cost: 150000,
      paid: 170000,
      advance: 20000,
    });
    expect(ledger.entries.every((entry) => entry.account === "materials")).toBe(
      true,
    );
    expect(summarize(ledger).byType.labour).toBe(0);
  });
  it("treats material returns and cash refunds as separate events", () => {
    const first = applyMcpCommand(
      fixture(),
      purchase({
        payment_state: "paid",
        payment: { amount_paisa: 6000000, method: "cash" },
      }),
      context,
    ).ledger;
    const second = applyMcpCommand(
      first,
      {
        type: "record_material_return",
        date: "2026-11-02",
        person_id: "shop",
        work_id: "roof",
        related_entry_id: first.entries[0].id,
        lines: [
          {
            label: "সিমেন্ট ফেরত",
            cost_type: "material",
            amount_paisa: 1000000,
          },
        ],
      },
      context,
    ).ledger;
    expect(summarize(second)).toMatchObject({
      cost: 5000000,
      paid: 6000000,
      refunds: 0,
      advance: 1000000,
    });
    const third = applyMcpCommand(
      second,
      {
        type: "record_cash_refund",
        date: "2026-11-02",
        person_id: "shop",
        work_id: "roof",
        account: "materials",
        amount_paisa: 1000000,
        method: "cash",
      },
      context,
    ).ledger;
    expect(summarize(third)).toMatchObject({
      cost: 5000000,
      paid: 6000000,
      refunds: 1000000,
      advance: 0,
    });
  });
  it("keeps correction evidence in revisions and blocks linked-payment identity changes", () => {
    const first = applyMcpCommand(fixture(), purchase(), {
      ...context,
      source: {
        origin: "image",
        sourceEventId: "photo-1",
        assetDigests: ["hash-1"],
      },
    }).ledger;
    const id = first.entries[0].id;
    const edited = applyMcpCommand(
      first,
      {
        type: "update_entry",
        entry_id: id,
        expected_updated_at: context.now,
        reason: "বিলের অঙ্ক ঠিক করেছি",
        changes: {
          lines: [
            { label: "সিমেন্ট", cost_type: "material", amount_paisa: 5600000 },
          ],
        },
      },
      { ...context, now: "2026-11-02T11:00:00.000Z" },
    ).ledger;
    const entry = edited.entries.find((value) => value.id === id)!;
    expect(entry.revisions[0].before.provenance?.origin).toBe("image");
    expect(entry.provenance?.reason).toBe("বিলের অঙ্ক ঠিক করেছি");
    expect(preservesMcpProvenance(first, edited)).toBe(true);
    expect(
      LedgerSchema.parse(JSON.parse(JSON.stringify(edited))).entries.find(
        (value) => value.id === id,
      )?.revisions[0].before.provenance?.sourceEventId,
    ).toBe("photo-1");
    expect(() =>
      applyMcpCommand(
        first,
        {
          type: "update_entry",
          entry_id: id,
          expected_updated_at: context.now,
          reason: "অন্য কাজে",
          changes: { work_id: "tiles" },
        },
        context,
      ),
    ).toThrow("Linked payment");
    expect(() =>
      applyMcpCommand(
        edited,
        {
          type: "update_entry",
          entry_id: id,
          expected_updated_at: context.now,
          reason: "পুরোনো তথ্য",
          changes: { note: "test" },
        },
        context,
      ),
    ).toThrow("entry_changed");
  });
  it("voids and restores a bill without deleting its payment or revision history", () => {
    const first = applyMcpCommand(fixture(), purchase(), context).ledger;
    const id = first.entries[0].id;
    const removed = applyMcpCommand(
      first,
      {
        type: "void_entry",
        entry_id: id,
        expected_updated_at: context.now,
        reason: "ভুল বিল",
      },
      context,
    ).ledger;
    expect(summarize(removed)).toMatchObject({
      cost: 0,
      paid: 2000000,
      advance: 2000000,
    });
    const restored = applyMcpCommand(
      removed,
      {
        type: "restore_entry",
        entry_id: id,
        expected_updated_at: context.now,
        reason: "আবার রাখি",
      },
      context,
    ).ledger;
    expect(summarize(restored)).toMatchObject({
      cost: 6000000,
      paid: 2000000,
      payable: 4000000,
    });
    expect(restored.entries[0].revisions).toHaveLength(2);
  });
  it("creates and changes a contract without booking cash or cost, while keeping terms history", () => {
    const first = applyMcpCommand(
      fixture(),
      {
        type: "create_contract",
        person_id: "worker",
        work_id: "roof",
        scope: "work",
        title: "ছাদের কাজ",
        total_paisa: 60000000,
      },
      context,
    ).ledger;
    expect(summarize(first)).toMatchObject({ cost: 0, paid: 0 });
    const id = first.contracts[0].id;
    const updated = applyMcpCommand(
      first,
      {
        type: "update_contract",
        contract_id: id,
        reason: "আরও কাজ",
        changes: { total_paisa: 65000000 },
      },
      context,
    ).ledger;
    expect(updated.contracts[0]).toMatchObject({
      title: "ছাদের কাজ",
      workId: "roof",
      total: 65000000,
    });
    expect(updated.contracts[0].activity).toHaveLength(2);
    expect(contractSummary(updated, id)).toMatchObject({
      remaining: 65000000,
      payable: 0,
    });
  });
  it("updates metadata without defaulting untouched values, and archives without erasing transactions", () => {
    const original = fixture();
    original.people[0].phone = "01700000000";
    original.works[0].description = "নিজের ছাদের কাজ";
    let ledger = applyMcpCommand(
      original,
      {
        type: "update_person",
        person_id: "shop",
        reason: "নাম ঠিক করেছি",
        changes: { name: "নতুন দোকান" },
      },
      context,
    ).ledger;
    ledger = applyMcpCommand(
      ledger,
      {
        type: "update_work",
        work_id: "roof",
        reason: "শেষ হয়েছে",
        changes: { status: "done" },
      },
      context,
    ).ledger;
    expect(ledger.people[0].phone).toBe("01700000000");
    expect(ledger.works.find((work) => work.id === "roof")?.description).toBe(
      "নিজের ছাদের কাজ",
    );
    ledger = applyMcpCommand(
      ledger,
      {
        type: "archive_entity",
        entity_type: "person",
        entity_id: "shop",
        reason: "আপাতত রাখি না",
      },
      context,
    ).ledger;
    expect(() => applyMcpCommand(ledger, purchase(), context)).toThrow(
      "archived_entity",
    );
    ledger = applyMcpCommand(
      ledger,
      {
        type: "restore_entity",
        entity_type: "person",
        entity_id: "shop",
        reason: "ফিরিয়ে আনি",
      },
      context,
    ).ledger;
    expect(ledger.people[0].removalHistory).toHaveLength(2);
  });
  it("rejects impossible dates, fractional paisa, unsafe money, raw ledger patches and invalid allocation totals", () => {
    for (const command of [
      purchase({ date: "2026-02-31" }),
      purchase({
        lines: [{ label: "মাল", cost_type: "material", amount_paisa: 1.5 }],
      }),
      purchase({
        lines: [
          {
            label: "মাল",
            cost_type: "material",
            amount_paisa: Number.MAX_SAFE_INTEGER + 1,
          },
        ],
      }),
      purchase({ ledger: {} }),
    ]) {
      expect(McpCommandSchema.safeParse(command).success).toBe(false);
    }
    expect(() =>
      applyMcpCommand(
        fixture(),
        {
          type: "record_payment",
          date: "2026-11-02",
          person_id: "shop",
          work_id: "roof",
          account: "materials",
          amount_paisa: 10000,
          method: "cash",
          allocations: [{ work_id: "roof", amount_paisa: 9000 }],
        },
        context,
      ),
    ).toThrow("allocation_mismatch");
    expect(() =>
      applyMcpCommand(fixture(), purchase({ work_id: "missing" }), context),
    ).toThrow("unknown_work");
  });
  it("only attaches verified assets and preserves receipt/provenance through JSON backup", () => {
    const receipt = {
      id: "receipt-1",
      name: "bill.png",
      mime: "image/png",
      size: 123,
    };
    expect(() =>
      applyMcpCommand(
        fixture(),
        purchase({ receipt_ids: [receipt.id] }),
        context,
      ),
    ).toThrow("unverified_receipt");
    const next = applyMcpCommand(
      fixture(),
      purchase({ receipt_ids: [receipt.id] }),
      { ...context, receipts: [receipt] },
    ).ledger;
    expect(
      LedgerSchema.parse(JSON.parse(JSON.stringify(next))).entries[0].receipts,
    ).toEqual([receipt]);
  });
  it("does not transfer a detached historical receipt to another financial entry", () => {
    const receipt = {
      id: "receipt-1",
      name: "bill.png",
      mime: "image/png",
      size: 123,
    };
    const first = applyMcpCommand(
      fixture(),
      purchase({ receipt_ids: [receipt.id] }),
      { ...context, receipts: [receipt] },
    ).ledger;
    const detached = applyMcpCommand(
      first,
      {
        type: "detach_receipt",
        entry_id: first.entries[0].id,
        expected_updated_at: context.now,
        receipt_id: receipt.id,
        reason: "ইতিহাসে রাখি",
      },
      context,
    ).ledger;
    expect(() =>
      applyMcpCommand(
        detached,
        {
          type: "attach_receipt",
          entry_id: first.entries[1].id,
          expected_updated_at: context.now,
          receipt_id: receipt.id,
          reason: "অন্য হিসাবে",
        },
        { ...context, receipts: [receipt] },
      ),
    ).toThrow("receipt_belongs_to_another_entry");
    expect(() =>
      applyMcpCommand(detached, purchase({ receipt_ids: [receipt.id] }), {
        ...context,
        receipts: [receipt],
      }),
    ).toThrow("receipt_belongs_to_another_entry");
    const restored = applyMcpCommand(
      detached,
      {
        type: "attach_receipt",
        entry_id: first.entries[0].id,
        expected_updated_at: context.now,
        receipt_id: receipt.id,
        reason: "আগের হিসাবে ফেরত",
      },
      { ...context, receipts: [receipt] },
    ).ledger;
    expect(restored.entries[0].receipts).toEqual([receipt]);
  });
  it("requires explicit allocation when partially paying a bill spanning multiple works", () => {
    const command = purchase({
      lines: [
        {
          label: "মাল",
          cost_type: "material",
          work_id: "roof",
          amount_paisa: 300000,
        },
        {
          label: "অন্য মাল",
          cost_type: "material",
          work_id: "tiles",
          amount_paisa: 300000,
        },
      ],
      payment: { amount_paisa: 200000, method: "cash" },
    });
    expect(() => applyMcpCommand(fixture(), command, context)).toThrow(
      "payment_allocations_required",
    );
    const next = applyMcpCommand(
      fixture(),
      {
        ...command,
        payment: {
          ...command.payment,
          allocations: [
            { work_id: "roof", amount_paisa: 50000 },
            { work_id: "tiles", amount_paisa: 150000 },
          ],
        },
      },
      context,
    ).ledger;
    expect(summarize(next, "roof")).toMatchObject({
      cost: 300000,
      paid: 50000,
    });
    expect(summarize(next, "tiles")).toMatchObject({
      cost: 300000,
      paid: 150000,
    });
  });
});

it("keeps a historical labour bill editable after only the contact identity changes", () => {
  const original = LedgerSchema.parse({
    ...fixture(),
    entries: [
      {
        id: "old-labour",
        personId: "worker",
        account: "labour",
        kind: "expense",
        updatedAt: context.now,
        createdAt: context.now,
        lines: [
          {
            id: "line",
            workId: "roof",
            costType: "labour",
            amount: 10000,
            label: "নমুনা কাজ",
          },
        ],
      },
    ],
  });
  const changed = applyMcpCommand(
    original,
    {
      type: "update_person",
      person_id: "worker",
      reason: "পরিচয় ঠিক করেছি",
      changes: { kind: "shop", role: "নমুনা পরিচয়" },
    },
    context,
  ).ledger;
  expect(changed.entries).toEqual(original.entries);
  const edited = applyMcpCommand(
    changed,
    {
      type: "update_entry",
      entry_id: "old-labour",
      expected_updated_at: context.now,
      reason: "নোট ঠিক করেছি",
      changes: { note: "নতুন নমুনা নোট" },
    },
    { ...context, now: "2026-11-02T11:00:00.000Z" },
  ).ledger;
  expect(edited.entries[0]).toMatchObject({
    personId: "worker",
    account: "labour",
    note: "নতুন নমুনা নোট",
    lines: original.entries[0].lines,
  });
  expect(edited.entries[0].revisions.at(-1)?.before).toMatchObject({
    account: "labour",
    lines: original.entries[0].lines,
  });
});

it("keeps an other-kind professional's agreed job available after an identity edit", () => {
  const original = fixture();
  original.people[1].kind = "other";
  original.people[1].role = "নমুনা ইঞ্জিনিয়ার";
  const first = applyMcpCommand(
    original,
    {
      type: "create_contract",
      person_id: "worker",
      work_id: "roof",
      scope: "work",
      title: "নমুনা নকশার কাজ",
      total_paisa: 50000,
    },
    context,
  ).ledger;
  const changed = applyMcpCommand(
    first,
    {
      type: "update_person",
      person_id: "worker",
      reason: "পরিচয় ঠিক করেছি",
      changes: { kind: "shop" },
    },
    context,
  ).ledger;
  const next = applyMcpCommand(
    changed,
    {
      type: "update_contract",
      contract_id: first.contracts[0].id,
      reason: "দর ঠিক করেছি",
      changes: { total_paisa: 60000 },
    },
    context,
  ).ledger;
  expect(next.contracts[0]).toMatchObject({ personId: "worker", total: 60000 });
  expect(next.entries).toEqual([]);
});
