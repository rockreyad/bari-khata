import { describe, expect, it } from "vitest";
import {
  ContractSchema,
  ContractSnapshotSchema,
  EntrySchema,
  LedgerSchema,
} from "../../domain/model";
import { appendBalanceAdjustment } from "../../domain/balanceAdjustments";
import { summarize } from "../../domain/ledger";
import {
  entryContactChange,
  entryContext,
  entryWorkChange,
  restoreEntryContext,
} from "./entryContext";
import { preferredPaymentJob } from "./paymentIntent";
import { buildQuickEntry } from "./quickEntry";

function fixture() {
  return LedgerSchema.parse({
    works: [
      { id: "tiles", name: "টাইলস" },
      { id: "paint", name: "রং" },
    ],
    people: [
      { id: "person", name: "নমুনা মিস্ত্রি", kind: "worker" },
      { id: "other-person", name: "আরেকজন", kind: "worker" },
    ],
    contracts: [
      {
        id: "completed",
        personId: "person",
        workId: "paint",
        status: "done",
        title: "রঙের কাজ",
        agreedOn: "2026-11-04",
        total: 100000,
      },
      {
        id: "ongoing",
        personId: "person",
        workId: "tiles",
        status: "ongoing",
        title: "টাইলস বসানো",
        agreedOn: "2026-10-01",
        total: 200000,
      },
    ],
  });
}

describe("preferred payment job", () => {
  it("chooses an ongoing job ahead of newer completed work and its notebook only when no scope was requested", () => {
    const ledger = fixture();
    const original = structuredClone(ledger);
    expect(
      entryContext(ledger, { kind: "payment", personId: "person" }),
    ).toMatchObject({
      contractId: "ongoing",
      workId: "tiles",
      purpose: "advance",
      account: "labour",
    });
    expect(
      entryContext(ledger, {
        kind: "payment",
        personId: "person",
        workId: "paint",
      }),
    ).toMatchObject({ contractId: "completed", workId: "paint" });
    expect(ledger).toEqual(original);
  });

  it("uses the latest status change among completed jobs rather than a later unrelated edit or payment", () => {
    const ledger = fixture();
    const old = ledger.contracts[0];
    const oldSnapshot = ContractSnapshotSchema.parse(old);
    old.activity = [
      {
        id: "completed-old",
        at: "2026-10-01T00:00:00Z",
        before: { ...oldSnapshot, status: "ongoing" },
        after: oldSnapshot,
        reason: "শেষ করেছি",
      },
      {
        id: "edited-old",
        at: "2026-11-05T00:00:00Z",
        before: oldSnapshot,
        after: oldSnapshot,
        reason: "নোট বদলেছি",
      },
    ];
    const newer = ContractSchema.parse({
      ...ledger.contracts[1],
      id: "latest-completed",
      status: "done",
      activity: [
        {
          id: "completed-new",
          at: "2026-10-20T00:00:00Z",
          before: ledger.contracts[1],
          after: { ...ledger.contracts[1], status: "done" },
          reason: "শেষ করেছি",
        },
      ],
    });
    ledger.contracts = [old, newer];
    expect(
      entryContext(ledger, { kind: "payment", personId: "person" }),
    ).toMatchObject({ contractId: "latest-completed", workId: "tiles" });
    expect(
      preferredPaymentJob(
        ledger,
        "person",
        "labour",
        [...ledger.contracts].reverse(),
      )?.id,
    ).toBe("latest-completed");
  });

  it("breaks equally recent ongoing-job ties consistently", () => {
    const ledger = fixture();
    ledger.contracts = [
      ContractSchema.parse({ ...ledger.contracts[1], id: "b" }),
      ContractSchema.parse({ ...ledger.contracts[1], id: "a" }),
    ];
    expect(
      preferredPaymentJob(ledger, "person", "labour", ledger.contracts)?.id,
    ).toBe("a");
    expect(
      preferredPaymentJob(
        ledger,
        "person",
        "labour",
        [...ledger.contracts].reverse(),
      )?.id,
    ).toBe("a");
  });

  it("excludes archived jobs, archived notebooks, other people and incompatible accounts", () => {
    const ledger = fixture();
    ledger.contracts[1].archivedAt = "2026-11-05T00:00:00Z";
    expect(
      entryContext(ledger, { kind: "payment", personId: "person" }).contractId,
    ).toBe("completed");
    ledger.contracts[1].archivedAt = null;
    ledger.works[0].archivedAt = "2026-11-05T00:00:00Z";
    expect(
      entryContext(ledger, { kind: "payment", personId: "person" }).contractId,
    ).toBe("completed");
    ledger.works[0].archivedAt = null;
    ledger.contracts[1].personId = "other-person";
    expect(
      entryContext(ledger, { kind: "payment", personId: "person" }).contractId,
    ).toBe("completed");
    expect(
      entryContext(ledger, {
        kind: "payment",
        personId: "person",
        account: "materials",
      }),
    ).toMatchObject({ contractId: "", account: "materials" });
  });

  it.each([
    { contractId: "" },
    { purpose: "charge" as const },
    { purpose: "wage" as const },
  ])("keeps an explicit Other work or new-bill choice: %j", (options) => {
    const ledger = fixture();
    expect(
      entryContext(ledger, { kind: "payment", personId: "person", ...options })
        .contractId,
    ).toBe("");
    expect(
      entryContext(ledger, {
        kind: "payment",
        personId: "person",
        contractId: "completed",
      }).contractId,
    ).toBe("completed");
  });

  it("restores an intentionally unassigned draft and never reclassifies later-payee writing", () => {
    const ledger = fixture();
    const fresh = entryContext(ledger, { kind: "payment", personId: "person" });
    const saved = {
      ...fresh,
      contractId: "",
      purpose: "charge" as const,
      amount: "120",
    };
    expect(restoreEntryContext(saved, fresh)).toMatchObject(saved);
    const unassigned = {
      ...entryContext(ledger, {
        kind: "payment",
        account: "labour",
        workId: "paint",
      }),
      amount: "200",
      purpose: "charge" as const,
    };
    expect(entryContactChange(ledger, unassigned, "person")).toMatchObject({
      contractId: "",
      purpose: "charge",
      amount: "200",
      workId: "paint",
    });
    const blank = entryContext(ledger, { kind: "payment" });
    expect(entryContactChange(ledger, blank, "person")).toMatchObject({
      contractId: "ongoing",
      purpose: "advance",
      workId: "tiles",
    });
  });

  it("defaults after a fresh notebook choice but preserves an explicit Other work choice and written money", () => {
    const ledger = fixture();
    const fresh = entryContext(ledger, { kind: "payment", personId: "person" });
    expect(entryWorkChange(ledger, fresh, "paint")).toMatchObject({
      contractId: "completed",
      purpose: "advance",
      workId: "paint",
    });
    const other = { ...fresh, contractId: "", purpose: "charge" as const };
    expect(entryWorkChange(ledger, other, "paint", true)).toMatchObject({
      contractId: "",
      purpose: "charge",
    });
    expect(
      entryWorkChange(ledger, { ...other, amount: "125" }, "paint"),
    ).toMatchObject({ contractId: "", purpose: "charge" });
    expect(
      entryWorkChange(ledger, { ...fresh, amount: "125" }, "paint"),
    ).toMatchObject({ contractId: "", purpose: "advance" });
  });

  it("retains aggregate corrections and unassigned bills instead of silently narrowing their balance to a job", () => {
    const ledger = fixture();
    ledger.contracts = [ledger.contracts[1]];
    ledger.entries.push(
      EntrySchema.parse({
        id: "earned-bill",
        kind: "expense",
        personId: "person",
        account: "labour",
        contractId: "ongoing",
        lines: [
          {
            id: "earned-line",
            workId: "tiles",
            costType: "labour",
            amount: 200000,
          },
        ],
      }),
    );
    const corrected = appendBalanceAdjustment(ledger, {
      target: "person",
      basis: "balance",
      personId: "person",
      account: "labour",
      expectedBefore: 200000,
      after: 0,
      reason: "নমুনা মোট হিসাব মেলানো",
    });
    expect(
      entryContext(corrected, { kind: "payment", personId: "person" }),
    ).toMatchObject({ contractId: "", purpose: "charge" });
    const unassigned = LedgerSchema.parse({
      ...ledger,
      entries: [
        {
          id: "bill",
          kind: "expense",
          account: "labour",
          personId: "person",
          lines: [
            { id: "line", workId: "tiles", amount: 50000, costType: "labour" },
          ],
        },
      ],
    });
    expect(
      entryContext(unassigned, { kind: "payment", personId: "person" }),
    ).toMatchObject({ contractId: "", purpose: "settle" });
  });

  it("falls back to a settled completed job as advance and records only cash, with no second bill", () => {
    const ledger = fixture();
    ledger.contracts = [ledger.contracts[0]];
    ledger.entries = LedgerSchema.parse({
      ...ledger,
      entries: [
        {
          id: "paid",
          kind: "payment",
          account: "labour",
          personId: "person",
          contractId: "completed",
          allocations: [{ workId: "paint", amount: 100000 }],
          paymentParts: [{ amount: 100000 }],
        },
      ],
    }).entries;
    const draft = entryContext(ledger, { kind: "payment", personId: "person" });
    expect(draft).toMatchObject({
      contractId: "completed",
      purpose: "advance",
    });
    draft.amount = "100";
    const next = buildQuickEntry(ledger, draft);
    expect(next.entries).toHaveLength(2);
    expect(next.entries[0]).toEqual(ledger.entries[0]);
    expect(next.entries[1]).toMatchObject({
      kind: "payment",
      contractId: "completed",
    });
    expect(summarize(next).cost).toBe(0);
  });
});
