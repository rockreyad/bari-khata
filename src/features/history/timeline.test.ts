import { describe, expect, it } from "vitest";
import { EntryCoreSchema, LedgerSchema } from "../../domain/model";
import {
  indexTimeline,
  notebookTimeline,
  searchTimeline,
  timelinePage,
  type TimelineEvent,
} from "./timeline";
import { saveWorkChange } from "../../domain/workActivity";
import { saveContractChange } from "../../domain/contracts";
import { setEntityRemoved } from "../../domain/entityDeletion";

describe("recorded notebook activity", () => {
  it("names a signed adjustment without presenting it as a payment and preserves the recorded balance change", () => {
    const ledger = LedgerSchema.parse({
      people: [{ id: "person", name: "পরীক্ষার নাম" }],
      entries: [
        {
          id: "adjust",
          kind: "adjustment",
          personId: "person",
          createdAt: "2026-11-03T10:00:00Z",
          note: "আগের অঙ্ক মিলিয়েছি",
          adjustment: {
            target: "person",
            basis: "balance",
            account: "materials",
            before: 500000,
            after: -100000,
            delta: -600000,
            workId: null,
          },
        },
      ],
    });
    expect(notebookTimeline(ledger)).toMatchObject([
      {
        title: "হিসাবের সমন্বয় রেখেছি",
        state: "adjustment",
        subject: "পরীক্ষার নাম",
        amount: -600000,
        adjustmentChange: { basis: "balance", before: 500000, after: -100000 },
        note: "আগের অঙ্ক মিলিয়েছি",
      },
    ]);
  });
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
  it("orders different UTC offsets by their actual time and skips invalid or date-only legacy history", () => {
    let ledger = LedgerSchema.parse({
      works: [{ id: "work", name: "খাতা" }],
      people: [{ id: "worker", name: "মিস্ত্রি", kind: "worker" }],
      contracts: [
        {
          id: "job",
          workId: "work",
          personId: "worker",
          total: 100000,
          history: [
            { at: "old time", total: 90000, note: "সময় অজানা" },
            { at: "2026-11-01", total: 95000, note: "শুধু দিন জানা" },
          ],
        },
      ],
      entries: [
        {
          id: "bill",
          kind: "expense",
          createdAt: "2026-11-03T08:00:00Z",
          lines: [{ id: "line", workId: "work", amount: 1000 }],
        },
      ],
    });
    ledger = saveContractChange(
      ledger,
      { ...ledger.contracts[0], total: 110000 },
      "নতুন দর",
      "2026-11-03T09:00:00+06:00",
    );
    const events = notebookTimeline(ledger);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.at)).toEqual([
      "2026-11-03T08:00:00Z",
      "2026-11-03T09:00:00+06:00",
    ]);
  });
});

describe("large timeline navigation", () => {
  const event = (index: number): TimelineEvent => ({
    id: `event${index}`,
    at: "2026-11-03T10:00:00Z",
    category: "money",
    title: "খরচের হিসাব রেখেছি",
    subject: `নমুনা ${index}`,
    note: "",
    changes: [],
    amount: 100,
    target: { kind: "entry", id: `bill${index}` },
  });

  it("pages a large event set without accumulating previous records or mutating the audit data", () => {
    const events = Array.from({ length: 10005 }, (_, index) => event(index));
    const before = JSON.stringify(events);
    expect(timelinePage(events, null)).toMatchObject({
      page: 1,
      count: 251,
      from: 1,
      to: 40,
    });
    expect(
      timelinePage(events, "125").events.map((record) => record.id),
    ).toEqual(events.slice(4960, 5000).map((record) => record.id));
    const last = timelinePage(events, "999999");
    expect(last).toMatchObject({
      page: 251,
      count: 251,
      from: 10001,
      to: 10005,
    });
    expect(last.events).toHaveLength(5);
    expect(timelinePage(events, "9007199254740993").page).toBe(1);
    expect(JSON.stringify(events)).toBe(before);
  });

  it("searches a reusable localized index with either numeral script and the recorded status labels", () => {
    const events = [
      event(16),
      {
        ...event(17),
        category: "jobs" as const,
        title: "কাজের তথ্য বদলেছি",
        changes: ["অবস্থা"],
        statusChange: { before: "শুরু হয়নি", after: "চলছে" },
      },
    ];
    const translations: Record<string, string> = {
      "খরচের হিসাব রেখেছি": "Recorded a bill",
      "কাজের তথ্য বদলেছি": "Changed a job",
      অবস্থা: "Status",
      "শুরু হয়নি": "Not started",
      চলছে: "In progress",
    };
    const index = indexTimeline(events, (text) => translations[text] ?? text);
    expect(searchTimeline(index, "১৬").map((record) => record.id)).toEqual([
      "event16",
    ]);
    expect(
      searchTimeline(index, "  IN   PROGRESS  ", "jobs").map(
        (record) => record.id,
      ),
    ).toEqual(["event17"]);
    expect(searchTimeline(index, "recorded A BILL", "money")).toEqual([
      events[0],
    ]);
    expect(searchTimeline(index, "16", "jobs")).toEqual([]);
    expect(searchTimeline(index, " ")).toEqual(events);
  });

  it("keeps payment subjects resolved to the right person or purpose with many contacts", () => {
    const ledger = LedgerSchema.parse({
      works: [{ id: "work", name: "নমুনার খাতা" }],
      people: Array.from({ length: 2000 }, (_, index) => ({
        id: `person${index}`,
        name: `নমুনা মানুষ ${index}`,
      })),
      paymentPurposes: [
        { id: "purpose", name: "নমুনা কারণ", account: "materials" },
      ],
      entries: [
        {
          id: "named",
          kind: "payment",
          personId: "person1999",
          createdAt: "2026-11-03T10:00:00Z",
          allocations: [{ workId: "work", amount: 100 }],
          paymentParts: [{ amount: 100 }],
        },
        {
          id: "purpose",
          kind: "payment",
          paymentPurposeId: "purpose",
          createdAt: "2026-11-03T10:00:00Z",
          allocations: [{ workId: "work", amount: 100 }],
          paymentParts: [{ amount: 100 }],
        },
        {
          id: "refund",
          kind: "refund",
          createdAt: "2026-11-03T10:00:00Z",
          allocations: [{ workId: "work", amount: 100 }],
          paymentParts: [{ amount: 100 }],
        },
      ],
    });
    const events = notebookTimeline(ledger);
    expect(events.find((record) => record.target.id === "named")?.subject).toBe(
      "নমুনা মানুষ 1999",
    );
    expect(
      events.find((record) => record.target.id === "purpose")?.subject,
    ).toBe("নমুনা কারণ");
    expect(
      events.find((record) => record.target.id === "refund")?.subject,
    ).toBe("টাকা ফেরত পেয়েছি");
  });
});
