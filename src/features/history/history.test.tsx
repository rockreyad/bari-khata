import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { LedgerSchema, EntrySchema } from "../../domain/model";
import { replaceEntry, setEntryVoided } from "../../domain/ledger";
import { EntryList } from "../../components/ui/EntryList";
import { entryAudit, snapshotTotal } from "./audit";
import { filterHistory, sortHistory, validHistoryDate } from "./history";
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string, values: Record<string, string | number> = {}) =>
      text.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
        String(values[key] ?? ""),
      ),
    money: (amount: number) => `৳${amount / 100}`,
    date: (value: string | null, options?: Intl.DateTimeFormatOptions) =>
      value && options
        ? new Intl.DateTimeFormat("en-BD", {
            day: "numeric",
            month: "short",
            ...options,
          }).format(new Date(`${value}T12:00:00+06:00`))
        : (value ?? "তারিখ দেওয়া নেই"),
    language: "en",
  }),
}));
function fixture() {
  return LedgerSchema.parse({
    works: [
      { id: "door", name: "দরজার কাজ" },
      { id: "roof", name: "ছাদের কাজ" },
    ],
    people: [
      { id: "shop", name: "দরজার দোকান" },
      { id: "worker", name: "রহিম মিস্ত্রি" },
    ],
    materialGroups: [{ id: "chemical", name: "কেমিক্যাল" }],
    items: [
      {
        id: "adhesive",
        name: "আঠা",
        brand: "Crown",
        usage: "প্লাস্টার",
        materialGroupId: "chemical",
      },
    ],
    entries: [
      {
        id: "old",
        kind: "expense",
        date: "2026-01-01",
        personId: "shop",
        lines: [
          {
            id: "old-line",
            workId: "door",
            itemId: "adhesive",
            label: "আঠা",
            amount: 25000,
          },
        ],
        createdAt: "2026-01-01T08:00:00.000Z",
      },
      {
        id: "recent",
        kind: "payment",
        date: "2026-11-01",
        personId: "worker",
        account: "labour",
        paymentParts: [{ method: "bkash", amount: 120000 }],
        allocations: [{ workId: "roof", amount: 120000 }],
        createdAt: "2026-11-01T08:00:00.000Z",
      },
      {
        id: "unknown",
        kind: "expense",
        date: null,
        balanceImpact: "historical",
        reviewStatus: "needs_review",
        lines: [
          {
            id: "unknown-line",
            workId: "roof",
            label: "পুরোনো লেখা",
            amount: 5000,
          },
        ],
      },
      {
        id: "voided",
        kind: "expense",
        voided: true,
        date: "2026-11-02",
        lines: [
          {
            id: "void-line",
            workId: "door",
            label: "বাতিল লেখা",
            amount: 9000,
          },
        ],
      },
    ],
  });
}

describe("minimal homeowner history", () => {
  it("finds a purchase by brand, usage, work, party and Bengali amount without adding payments to it", () => {
    const ledger = fixture();
    expect(
      filterHistory(ledger, { query: "Crown প্লাস্টার দরজা ২৫০" }).map(
        (e) => e.id,
      ),
    ).toEqual(["old"]);
    expect(
      filterHistory(ledger, { personId: "worker", account: "labour" }).map(
        (e) => e.id,
      ),
    ).toEqual(["recent"]);
    expect(
      filterHistory(ledger, { costType: "material", from: "2026-01-01" }).map(
        (e) => e.id,
      ),
    ).toEqual(["old"]);
    expect(filterHistory(ledger, { includeVoided: true })).toHaveLength(4);
  });
  it("keeps known dates in either chronology and undated records last without mutating source order", () => {
    const entries = fixture().entries;
    const ids = entries.map((e) => e.id);
    expect(sortHistory(entries, "oldest").map((e) => e.id)).toEqual([
      "old",
      "recent",
      "voided",
      "unknown",
    ]);
    expect(sortHistory(entries).map((e) => e.id)).toEqual([
      "voided",
      "recent",
      "old",
      "unknown",
    ]);
    expect(entries.map((e) => e.id)).toEqual(ids);
    expect(validHistoryDate("2026-02-30")).toBe("");
    expect(validHistoryDate("2024-02-29")).toBe("2024-02-29");
  });
  it("shows a compact row with a year and no source badges, payment arrows or review prompts", () => {
    const ledger = fixture();
    const html = renderToString(
      <EntryList ledger={ledger} entries={ledger.entries} onEntry={() => {}} />,
    );
    expect(html).toContain("রহিম মিস্ত্রি");
    expect(html).toContain("৳1200");
    expect(html).toContain('dateTime="2026-11-01"');
    expect(html).toContain("Nov 1, 2026");
    expect(html).not.toContain("গুছিয়ে");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("পুরোনো খাতা");
  });
  it("uses one month header for a group and respects report-scoped line amounts", () => {
    const ledger = fixture();
    const original = ledger.entries[0];
    const second = EntrySchema.parse({
      ...original,
      id: "same-month",
      date: "2026-01-02",
      lines: [{ ...original.lines[0], id: "second-line", amount: 100000 }],
    });
    ledger.entries.push(second);
    const html = renderToString(
      <EntryList
        ledger={ledger}
        entries={[original, second]}
        grouped
        amounts={{ old: 10000, "same-month": 5000 }}
        onEntry={() => {}}
      />,
    );
    expect(html.match(/January 2026/g)).toHaveLength(1);
    expect(html).not.toContain("1 January");
    expect(html).toContain('dateTime="2026-01-01"');
    expect(html).toContain("৳100");
    expect(html).toContain("৳50");
    expect(html).not.toContain("৳1000");
  });
});

describe("complete transaction activity", () => {
  it("preserves every before/after version through repeated edits, void and restore", () => {
    let ledger = fixture();
    const initial = ledger.entries[0];
    ledger = replaceEntry(ledger, {
      ...initial,
      note: "প্রথম পরিবর্তন",
      date: "2026-01-03",
      lines: [{ ...initial.lines[0], amount: 35000 }],
    });
    const afterFirst = ledger.entries.find((e) => e.id === "old")!;
    ledger = replaceEntry(ledger, {
      ...afterFirst,
      note: "দ্বিতীয় পরিবর্তন",
      lines: [{ ...afterFirst.lines[0], amount: 45000 }],
    });
    ledger = setEntryVoided(ledger, "old", true);
    ledger = setEntryVoided(ledger, "old", false);
    const final = ledger.entries.find((e) => e.id === "old")!;
    const events = entryAudit(final);
    expect(events).toHaveLength(5);
    expect(events.map((e) => e.kind)).toEqual([
      "created",
      "changed",
      "changed",
      "voided",
      "restored",
    ]);
    expect(events.map((e) => snapshotTotal(e.after))).toEqual([
      25000, 35000, 45000, 45000, 45000,
    ]);
    expect(events[1].before?.date).toBe("2026-01-01");
    expect(events[1].after.date).toBe("2026-01-03");
    expect(events[1].changes.some((c) => c.field === "note")).toBe(true);
    expect(events[1].changes.some((c) => c.field === "date")).toBe(true);
    expect(events[2].after.note).toBe("দ্বিতীয় পরিবর্তন");
    expect(events[3].after.voided).toBe(true);
    expect(events[4].after.voided).toBe(false);
    expect(final.revisions).toHaveLength(4);
  });
  it("does not invent a creation date for an imported record", () => {
    const entry = fixture().entries.find((e) => e.id === "unknown")!;
    const events = entryAudit(entry);
    expect(events).toHaveLength(1);
    expect(events[0].at).toBe("");
    expect(events[0].after.date).toBeNull();
    expect(events[0].after.balanceImpact).toBe("historical");
  });
});

import { compactHistory, historyGroups } from "./history";
describe("one row for an immediate purchase and its cash event", () => {
  function pair(paid = 50000) {
    return LedgerSchema.parse({
      works: [{ id: "door", name: "দরজার কাজ" }],
      people: [{ id: "shop", name: "দোকান" }],
      entries: [
        {
          id: "bill",
          kind: "expense",
          date: "2026-11-01",
          personId: "shop",
          createdAt: "2026-11-01T08:00:00.000Z",
          lines: [
            { id: "line", workId: "door", label: "দরজা", amount: 100000 },
          ],
        },
        {
          id: "cash",
          kind: "payment",
          relatedEntryId: "bill",
          date: "2026-11-01",
          personId: "shop",
          createdAt: "2026-11-01T08:00:00.000Z",
          paymentParts: [{ method: "bkash", amount: paid }],
          allocations: [{ workId: "door", amount: paid }],
        },
      ],
    });
  }
  it("collapses a paid purchase without hiding standalone or later payments", () => {
    const ledger = pair();
    ledger.entries.push(
      EntrySchema.parse({
        ...ledger.entries[1],
        id: "later",
        createdAt: "2026-11-01T09:00:00.000Z",
      }),
    );
    expect(compactHistory(ledger.entries).map((e) => e.id)).toEqual([
      "bill",
      "later",
    ]);
    expect(
      historyGroups(ledger.entries)
        .payments.get("bill")
        ?.map((e) => e.id),
    ).toEqual(["cash"]);
    expect(ledger.entries).toHaveLength(3);
    expect(compactHistory([ledger.entries[1]])).toHaveLength(1);
  });
  it("shows partial and extra payments in the purchase subtitle while preserving the purchase amount", () => {
    for (const paid of [50000, 150000]) {
      const ledger = pair(paid);
      const html = renderToString(
        <EntryList
          ledger={ledger}
          entries={ledger.entries}
          onEntry={() => {}}
        />,
      );
      expect(html.match(/class="history-row /g)).toHaveLength(1);
      expect(html).toContain(`দিয়েছি ৳${paid / 100}`);
      expect(html).toContain("৳1000");
      expect(ledger.entries).toHaveLength(2);
    }
  });
  it("does not merge voided, undated-created or historical/current mismatches", () => {
    const ledger = pair();
    const bill = ledger.entries[0],
      cash = ledger.entries[1];
    expect(compactHistory([bill, { ...cash, voided: true }])).toHaveLength(2);
    expect(
      compactHistory([
        { ...bill, createdAt: "" },
        { ...cash, createdAt: "" },
      ]),
    ).toHaveLength(2);
    expect(
      compactHistory([bill, { ...cash, balanceImpact: "historical" }]),
    ).toHaveLength(2);
    expect(compactHistory([{ ...bill, voided: true }, cash])).toHaveLength(2);
  });
});

it("keeps a driver's full transport history consistent with its effective account without rewriting records", () => {
  const ledger = LedgerSchema.parse({
    works: [
      { id: "door", name: "দরজা" },
      { id: "other-work", name: "অন্য কাজ" },
    ],
    people: [{ id: "driver", name: "রনি", kind: "driver" }],
    entries: [
      {
        id: "trip",
        kind: "expense",
        account: "materials",
        personId: "driver",
        lines: [
          {
            id: "t",
            workId: "door",
            label: "পুরোনো ভ্যানের বিল",
            costType: "transport",
            amount: 100000,
          },
        ],
      },
      {
        id: "old-paid",
        kind: "payment",
        account: "materials",
        personId: "driver",
        allocations: [{ workId: "door", amount: 50000 }],
        paymentParts: [{ amount: 50000 }],
      },
      {
        id: "new-paid",
        kind: "payment",
        account: "other",
        personId: "driver",
        allocations: [{ workId: "door", amount: 50000 }],
        paymentParts: [{ amount: 50000 }],
      },
      {
        id: "old-cancelled-trip",
        kind: "expense",
        account: "materials",
        personId: "driver",
        voided: true,
        lines: [
          {
            id: "c",
            workId: "door",
            label: "বাতিল ভ্যানের বিল",
            costType: "transport",
            amount: 10000,
          },
        ],
      },
      {
        id: "material",
        kind: "expense",
        account: "materials",
        personId: "driver",
        lines: [
          {
            id: "m",
            workId: "other-work",
            costType: "material",
            amount: 20000,
          },
        ],
      },
    ],
  });
  const before = structuredClone(ledger);
  expect(
    filterHistory(ledger, {
      personId: "driver",
      account: "other",
      workId: "door",
    }).map((entry) => entry.id),
  ).toEqual(["trip", "old-paid", "new-paid"]);
  expect(
    filterHistory(ledger, { personId: "driver", account: "materials" }).map(
      (entry) => entry.id,
    ),
  ).toEqual(["material"]);
  expect(
    filterHistory(ledger, {
      personId: "driver",
      account: "other",
      includeVoided: true,
    }).map((entry) => entry.id),
  ).toEqual(["trip", "old-paid", "new-paid", "old-cancelled-trip"]);
  expect(ledger).toEqual(before);
});
