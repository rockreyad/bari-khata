import { describe, expect, it } from "vitest";
import { EntryCoreSchema, LedgerSchema } from "../../domain/model";
import { notebookTimeline } from "./timeline";
import { saveWorkChange } from "../../domain/workActivity";
import { saveContractChange } from "../../domain/contracts";
import { setEntityRemoved } from "../../domain/entityDeletion";

describe("recorded notebook activity", () => {
  it("shows the original amount and corrected amount separately at the recording time, without changing the payment or ledger", () => {
    const ledger = LedgerSchema.parse({
      works: [{ id: "work", name: "খাতা" }],
      people: [{ id: "shop", name: "দোকান", kind: "shop" }],
      entries: [
        {
          id: "bill",
          kind: "expense",
          personId: "shop",
          date: "2026-01-01",
          createdAt: "2026-11-01T10:00:00Z",
          updatedAt: "2026-11-03T10:00:00Z",
          note: "সঠিক বিল মিলিয়েছি",
          lines: [
            { id: "line", workId: "work", label: "সিমেন্ট", amount: 110000 },
          ],
          revisions: [
            {
              at: "2026-11-03T10:00:00Z",
              before: EntryCoreSchema.parse({
                id: "bill",
                kind: "expense",
                personId: "shop",
                date: "2026-01-01",
                createdAt: "2026-11-01T10:00:00Z",
                lines: [
                  {
                    id: "line",
                    workId: "work",
                    label: "সিমেন্ট",
                    amount: 100000,
                  },
                ],
              }),
            },
          ],
        },
        {
          id: "paid",
          kind: "payment",
          personId: "shop",
          relatedEntryId: "bill",
          date: "2026-01-02",
          createdAt: "2026-11-02T10:00:00Z",
          allocations: [{ workId: "work", amount: 100000 }],
          paymentParts: [{ amount: 100000 }],
        },
      ],
    });
    const before = JSON.stringify(ledger),
      events = notebookTimeline(ledger);
    expect(events[0]).toMatchObject({
      at: "2026-11-03T10:00:00Z",
      title: "হিসাব বদলেছি",
      before: 100000,
      amount: 110000,
      target: { kind: "entry", id: "bill" },
    });
    expect(
      events.find((event) => event.id === "entry:paid:created"),
    ).toMatchObject({ amount: 100000, title: "টাকা দেওয়ার হিসাব রেখেছি" });
    expect(events.at(-1)?.at).toBe("2026-11-01T10:00:00Z");
    expect(JSON.stringify(ledger)).toBe(before);
  });
  it("includes notebook, contract and reversible removal events with links to their own histories", () => {
    let ledger = LedgerSchema.parse({
      works: [{ id: "work", name: "বাথরুম" }],
      people: [{ id: "worker", name: "মিস্ত্রি", kind: "worker" }],
    });
    ledger = saveWorkChange(
      ledger,
      { ...ledger.works[0], status: "done" },
      "2026-11-01T10:00:00Z",
    );
    ledger = saveContractChange(
      ledger,
      LedgerSchema.parse({
        ...ledger,
        contracts: [
          { id: "job", workId: "work", personId: "worker", total: 100000 },
        ],
      }).contracts[0],
      "দর ঠিক করেছি",
      "2026-11-02T10:00:00Z",
    );
    ledger = setEntityRemoved(
      ledger,
      "person",
      "worker",
      true,
      undefined,
      "2026-11-03T10:00:00Z",
    );
    const events = notebookTimeline(ledger);
    expect(events[0]).toMatchObject({
      category: "removed",
      title: "নাম সরিয়েছি",
      target: { kind: "person", id: "worker" },
    });
    expect(events.find((event) => event.category === "jobs")).toMatchObject({
      amount: 100000,
      note: "দর ঠিক করেছি",
      target: { kind: "job", id: "job" },
    });
    expect(
      events.find((event) => event.category === "notebooks"),
    ).toMatchObject({
      changes: ["অবস্থা"],
      target: { kind: "work", id: "work" },
    });
  });
  it("does not invent times for old records with no recorded creation time", () => {
    const ledger = LedgerSchema.parse({
      works: [{ id: "work", name: "খাতা" }],
      entries: [
        {
          id: "bill",
          kind: "expense",
          date: "2026-01-01",
          lines: [{ id: "line", workId: "work", amount: 100 }],
        },
      ],
    });
    expect(notebookTimeline(ledger)).toEqual([]);
  });
});
