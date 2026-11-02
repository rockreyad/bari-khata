import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { LedgerSchema } from "../../domain/model";
import { replaceEntry, setEntryVoided } from "../../domain/ledger";
import { EntryDetail } from "./EntryDetail";
const { notebook } = vi.hoisted(() => ({ notebook: vi.fn() }));
vi.mock("../../app/NotebookProvider", () => ({ useNotebook: notebook }));
vi.mock("../../components/Sheet", () => ({
  Sheet: ({ children, title }: { children: ReactNode; title: string }) => (
    <section>
      <h1>{title}</h1>
      {children}
    </section>
  ),
}));
vi.mock("../../data/repository", () => ({
  createWorkspaceStorage: () => ({ getReceipt: vi.fn() }),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string, values: Record<string, string | number> = {}) =>
      text.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
        String(values[key] ?? ""),
      ),
    money: (amount: number) => `৳${amount / 100}`,
    date: (value: string | null, options?: Intl.DateTimeFormatOptions) =>
      value
        ? new Intl.DateTimeFormat("en-BD", {
            day: "numeric",
            month: "short",
            ...options,
          }).format(
            new Date(value.length > 10 ? value : `${value}T12:00:00+06:00`),
          )
        : "তারিখ দেওয়া নেই",
    language: "en",
    formatDigits: (value: string | number) => String(value),
  }),
}));
const calendarLabel = (value: string) =>
  new Intl.DateTimeFormat("en-BD", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00+06:00`));
describe("transaction detail activity", () => {
  it("renders assistant provenance changes as names, origin and reason without raw identifiers", () => {
    const source = {
      version: 1 as const,
      origin: "image" as const,
      connectionId: "private-connection-one",
      actorName: "ছবি পড়ার সহকারী",
      sourceEventId: "private-image-event",
      assetDigests: ["private-image-digest"],
      recordedAt: "2026-11-02T08:00:00.000Z",
      reason: "বিলের ছবি থেকে লেখা",
    };
    let ledger = LedgerSchema.parse({
      works: [{ id: "roof", name: "ছাদের কাজ" }],
      entries: [
        {
          id: "assistant-bill",
          kind: "expense",
          date: "2026-11-02",
          createdAt: source.recordedAt,
          provenance: source,
          lines: [
            {
              id: "assistant-line",
              workId: "roof",
              label: "সিমেন্ট",
              amount: 6000000,
            },
          ],
        },
      ],
    });
    ledger = replaceEntry(ledger, {
      ...ledger.entries[0],
      note: "পরিমাণ ঠিক হয়েছে",
      provenance: {
        ...source,
        origin: "voice",
        connectionId: "private-connection-two",
        actorName: "আমার কথা শোনার সহকারী",
        sourceEventId: "private-voice-event",
        recordedAt: "2026-11-02T09:00:00.000Z",
        reason: "বলে দেওয়া সংশোধন",
      },
    });
    notebook.mockReturnValue({
      ledger,
      mode: "demo",
      close: vi.fn(),
      add: vi.fn(),
      save: vi.fn(),
      notify: vi.fn(),
      go: vi.fn(),
      detail: vi.fn(),
    });
    const html = renderToString(<EntryDetail id="assistant-bill" />);
    expect(html).toContain("যে সহকারী লিখেছে");
    expect(html).toContain("ছবি পড়ার সহকারী");
    expect(html).toContain("আমার কথা শোনার সহকারী");
    expect(html).toContain("ছবির তথ্য থেকে");
    expect(html).toContain("ভয়েসের নির্দেশ থেকে");
    expect(html).toContain("কারণ: বলে দেওয়া সংশোধন");
    expect(html).toContain("2026-11-02T09:00:00.000Z");
    expect(html).not.toContain("[object Object]");
    expect(html).not.toContain("private-connection");
    expect(html).not.toContain("private-image-event");
    expect(html).not.toContain("private-voice-event");
    expect(html).not.toContain("private-image-digest");
  });
  it("renders every edited version with original and changed amounts, note and date", () => {
    let ledger = LedgerSchema.parse({
      works: [{ id: "roof", name: "ছাদের কাজ" }],
      entries: [
        {
          id: "bill",
          kind: "expense",
          date: "2026-01-01",
          createdAt: "2026-01-01T03:00:00.000Z",
          note: "প্রথম নোট",
          lines: [
            {
              id: "line",
              workId: "roof",
              label: "Crown সিমেন্ট",
              amount: 100000,
            },
          ],
        },
      ],
    });
    const original = ledger.entries[0];
    ledger = replaceEntry(ledger, {
      ...original,
      note: "সংশোধিত নোট",
      date: "2026-01-02",
      lines: [{ ...original.lines[0], amount: 125000 }],
    });
    ledger = setEntryVoided(ledger, "bill", true);
    ledger = setEntryVoided(ledger, "bill", false);
    notebook.mockReturnValue({
      ledger,
      mode: "demo",
      close: vi.fn(),
      add: vi.fn(),
      save: vi.fn(),
      notify: vi.fn(),
      go: vi.fn(),
    });
    const html = renderToString(<EntryDetail id="bill" />);
    expect(html).toContain("কখন কী বদলেছে");
    expect(html).toContain("প্রথম নোট");
    expect(html).toContain("সংশোধিত নোট");
    expect(html).toContain("৳1000");
    expect(html).toContain("৳1250");
    expect(html).toContain(calendarLabel("2026-01-01"));
    expect(html).toContain(calendarLabel("2026-01-02"));
    expect(html).toContain("হিসাব বাতিল করা হয়েছে");
    expect(html).toContain("আবার হিসাবে যোগ করা হয়েছে");
    expect(html.match(/তখনকার পুরো হিসাব/g)).toHaveLength(3);
    expect(html).not.toContain("আগের তথ্য ব্যাকআপে");
  });
  it("shows every linked cash event and method after the purchase row is compacted", () => {
    const ledger = LedgerSchema.parse({
      works: [{ id: "door", name: "দরজার কাজ" }],
      people: [{ id: "shop", name: "দোকান" }],
      entries: [
        {
          id: "bill",
          kind: "expense",
          personId: "shop",
          date: "2026-11-01",
          createdAt: "2026-11-01T08:00:00.000Z",
          lines: [
            { id: "line", workId: "door", label: "দরজা", amount: 200000 },
          ],
        },
        {
          id: "cash",
          kind: "payment",
          relatedEntryId: "bill",
          personId: "shop",
          date: "2026-11-01",
          createdAt: "2026-11-01T08:00:00.000Z",
          paymentParts: [{ method: "bkash", amount: 100000 }],
          allocations: [{ workId: "door", amount: 100000 }],
        },
        {
          id: "later",
          kind: "payment",
          relatedEntryId: "bill",
          personId: "shop",
          date: "2026-11-02",
          createdAt: "2026-11-02T08:00:00.000Z",
          paymentParts: [{ method: "cash", amount: 50000 }],
          allocations: [{ workId: "door", amount: 50000 }],
        },
        {
          id: "void-cash",
          kind: "payment",
          voided: true,
          relatedEntryId: "bill",
          personId: "shop",
          date: "2026-11-03",
          createdAt: "2026-11-03T08:00:00.000Z",
          paymentParts: [{ method: "bank", amount: 90000 }],
          allocations: [{ workId: "door", amount: 90000 }],
        },
      ],
    });
    notebook.mockReturnValue({
      ledger,
      mode: "demo",
      close: vi.fn(),
      add: vi.fn(),
      save: vi.fn(),
      notify: vi.fn(),
      go: vi.fn(),
      detail: vi.fn(),
    });
    const html = renderToString(<EntryDetail id="bill" />);
    expect(html).toContain("এই বিলের সঙ্গে রাখা পরিশোধ");
    expect(html).toContain('<details class="entry-payment-fold-v5">');
    expect(html).not.toContain("এই বিলের টাকার হিসাব");
    expect(html).not.toContain("লেনদেন চাপলে সেই টাকার পুরো ইতিহাস দেখবেন।");
    expect(html.match(/৳2000/g)).toHaveLength(1);
    expect(html).toContain("৳1500");
    expect(html).toContain("৳1000");
    expect(html).toContain("৳500");
    expect(html).toContain("৳900");
    expect(html).toContain("বিকাশ");
    expect(html).toContain("নগদ");
    expect(html).toContain("ব্যাংক");
    expect(html).toContain(calendarLabel("2026-11-02"));
    expect(html).not.toContain("৳2400");
    expect(html).not.toContain("কখন কী বদলেছে");
    expect(html).not.toContain("প্রথম লেখা হয়েছে");
  });
  it("shows the year in a date correction even when its day and month stay the same", () => {
    let ledger = LedgerSchema.parse({
      works: [{ id: "roof", name: "ছাদের কাজ" }],
      entries: [
        {
          id: "year-change",
          kind: "expense",
          date: "2025-11-01",
          lines: [
            { id: "line", workId: "roof", label: "সিমেন্ট", amount: 100000 },
          ],
        },
      ],
    });
    ledger = replaceEntry(ledger, { ...ledger.entries[0], date: "2026-11-01" });
    notebook.mockReturnValue({
      ledger,
      mode: "demo",
      close: vi.fn(),
      add: vi.fn(),
      save: vi.fn(),
      notify: vi.fn(),
      go: vi.fn(),
      detail: vi.fn(),
    });
    const html = renderToString(<EntryDetail id="year-change" />);
    expect(html).toContain(`<del>${calendarLabel("2025-11-01")}</del>`);
    expect(html).toContain(`<ins>${calendarLabel("2026-11-01")}</ins>`);
  });
});

it("does not label a new unreviewed bill as an old-notebook import", () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
    entries: [
      {
        id: "new-bill",
        kind: "expense",
        reviewStatus: "needs_review",
        lines: [
          { id: "line", workId: "door", label: "৮টি দরজা", amount: 9300000 },
        ],
      },
    ],
  });
  notebook.mockReturnValue({
    ledger,
    mode: "demo",
    close: vi.fn(),
    add: vi.fn(),
    save: vi.fn(),
    notify: vi.fn(),
    go: vi.fn(),
    detail: vi.fn(),
  });
  const html = renderToString(<EntryDetail id="new-bill" />);
  expect(html).toContain("তথ্য যোগ করা বাকি");
  expect(html).not.toContain("পুরোনো খাতার তথ্য");
  expect(html).not.toContain("পুরোনো খাতা থেকে এসেছে");
});
it("keeps a linked material return reachable without presenting it as a zero payment", () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
    entries: [
      {
        id: "bill",
        kind: "expense",
        lines: [{ id: "line", workId: "door", label: "দরজা", amount: 9300000 }],
      },
      {
        id: "return",
        kind: "expense_credit",
        relatedEntryId: "bill",
        lines: [
          {
            id: "return-line",
            workId: "door",
            label: "দরজা ফেরত",
            amount: 1000000,
          },
        ],
      },
    ],
  });
  notebook.mockReturnValue({
    ledger,
    mode: "demo",
    close: vi.fn(),
    add: vi.fn(),
    save: vi.fn(),
    notify: vi.fn(),
    go: vi.fn(),
    detail: vi.fn(),
  });
  const html = renderToString(<EntryDetail id="bill" />);
  expect(html).toContain("বিলের লেনদেন");
  expect(html).toContain("মাল ফেরত");
  expect(html).not.toContain("৳0");
});
