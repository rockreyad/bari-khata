// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { replaceEntry, setEntryVoided } from "../../domain/ledger";
import { EntryDetail } from "./EntryDetail";
const { notebook } = vi.hoisted(() => ({ notebook: vi.fn() }));
vi.mock("../../app/NotebookProvider", () => ({ useNotebook: notebook }));
vi.mock("../../components/Sheet", () => ({
  Sheet: ({
    children,
    title,
    subtitle,
    footer,
  }: {
    children: ReactNode;
    title: string;
    subtitle?: string;
    footer?: ReactNode;
  }) => (
    <section>
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
      {children}
      {footer}
    </section>
  ),
}));
afterEach(cleanup);
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
function renderDetail(ledger: Ledger, id = ledger.entries[0].id) {
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
  return renderToString(<EntryDetail id={id} />);
}
const revisionMarkup = (html: string) =>
  html.match(/<ol class="entry-revision-list">[\s\S]*?<\/ol>/)?.[0] ?? "";
function markup(html: string) {
  const node = document.createElement("div");
  node.innerHTML = html;
  return node;
}
function simplePurchase(payment = 100000) {
  const stamp = "2026-11-01T08:00:00.000Z";
  return LedgerSchema.parse({
    works: [{ id: "door", name: "নমুনা খাতা" }],
    people: [{ id: "shop", name: "নমুনা দোকান", kind: "shop" }],
    entries: [
      {
        id: "bill",
        kind: "expense",
        personId: "shop",
        date: "2026-11-01",
        createdAt: stamp,
        updatedAt: stamp,
        lines: [
          { id: "line", workId: "door", label: "নমুনা মাল", amount: 100000 },
        ],
      },
      {
        id: "paid",
        kind: "payment",
        relatedEntryId: "bill",
        personId: "shop",
        date: "2026-11-01",
        createdAt: stamp,
        updatedAt: stamp,
        allocations: [{ workId: "door", amount: payment }],
        paymentParts: [{ method: "bank", amount: payment }],
      },
    ],
  });
}
describe("transaction detail activity", () => {
  it.each([
    [100000, "বাকি নেই"],
    [60000, "বাকি ৳400"],
    [120000, "আমার জমা ৳200"],
  ] as const)(
    "shows a simple co-created payment of %s as a concise paid status with its true balance",
    (paid, status) => {
      const ledger = simplePurchase(paid);
      const before = JSON.stringify(ledger);
      const html = renderDetail(ledger, "bill");
      expect(html).toContain('class="entry-paid-status-v5"');
      expect(html).toContain('aria-label="পরিশোধের বিস্তারিত"');
      const row = markup(html).querySelector(".entry-paid-status-v5")!;
      expect(row.textContent).toContain("দিয়েছি");
      expect(row.querySelector("strong")?.textContent).toBe(`৳${paid / 100}`);
      expect(row.querySelector("small")?.textContent).toBe(status);
      expect(html).not.toContain('class="entry-payment-fold-v5"');
      expect(html).not.toContain("এই বিলের সঙ্গে রাখা পরিশোধ");
      expect(JSON.stringify(ledger)).toBe(before);
    },
  );

  it("keeps the exact payment and its method, date and ordinary editor reachable from the compact status", () => {
    const ledger = simplePurchase();
    const detail = vi.fn(),
      add = vi.fn(),
      save = vi.fn();
    notebook.mockReturnValue({
      ledger,
      mode: "demo",
      close: vi.fn(),
      add,
      save,
      notify: vi.fn(),
      go: vi.fn(),
      detail,
    });
    const view = render(<EntryDetail id="bill" />);
    fireEvent.click(screen.getByRole("button", { name: "পরিশোধের বিস্তারিত" }));
    expect(detail).toHaveBeenCalledExactlyOnceWith("paid");
    view.rerender(<EntryDetail id="paid" />);
    expect(screen.getByText("ব্যাংক")).toBeTruthy();
    expect(view.container.textContent).toContain(calendarLabel("2026-11-01"));
    fireEvent.click(screen.getByRole("button", { name: "সংশোধন করুন" }));
    expect(add).toHaveBeenCalledExactlyOnceWith({ editId: "paid" });
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps a later partial payment in the plain payment-history disclosure", () => {
    const source = simplePurchase(30000);
    const ledger = LedgerSchema.parse({
      ...source,
      entries: [
        source.entries[0],
        {
          ...source.entries[1],
          date: "2026-11-02",
          createdAt: "2026-11-02T08:00:00.000Z",
        },
      ],
    });
    const html = renderDetail(ledger, "bill");
    expect(html).toContain("পরিশোধের ইতিহাস");
    expect(html).toContain('class="entry-payment-fold-v5"');
    expect(html).toContain("৳300");
    expect(html).toContain("ব্যাংক");
    expect(html).toContain(calendarLabel("2026-11-02"));
    expect(html).not.toContain('class="entry-paid-status-v5"');
    expect(html).not.toContain("এই বিলের সঙ্গে রাখা পরিশোধ");
  });

  it.each([false, true])(
    "keeps refunds, returns and cancelled events distinct in payment history (material return %s)",
    (includeReturn) => {
      const source = simplePurchase(70000);
      const ledger = LedgerSchema.parse({
        ...source,
        entries: [
          ...source.entries,
          ...(
            [
              ["later", "payment", 30000, false],
              ["refund", "refund", 10000, false],
              ["void-refund", "refund", 9000, true],
              ["void-payment", "payment", 80000, true],
            ] as const
          ).map(([id, kind, amount, voided]) => ({
            id,
            kind,
            voided,
            relatedEntryId: "bill",
            personId: "shop",
            date: "2026-11-02",
            createdAt: "2026-11-02T08:00:00.000Z",
            allocations: [{ workId: "door", amount }],
            paymentParts: [{ amount }],
          })),
          ...(includeReturn
            ? [
                {
                  id: "return",
                  kind: "expense_credit",
                  relatedEntryId: "bill",
                  personId: "shop",
                  lines: [
                    {
                      id: "return-line",
                      workId: "door",
                      label: "নমুনা মাল ফেরত",
                      amount: 20000,
                    },
                  ],
                },
              ]
            : []),
        ],
      });
      const html = renderDetail(ledger, "bill");
      const node = markup(html);
      const summary = node.querySelector(".entry-payment-fold-v5 > summary")!;
      expect(summary.textContent).toContain("পরিশোধ ও ফেরত");
      if (includeReturn) expect(summary.textContent).not.toContain("৳");
      else expect(summary.querySelector("strong")?.textContent).toBe("৳900");
      expect(node.querySelectorAll(".detail-linked-row")).toHaveLength(
        includeReturn ? 6 : 5,
      );
      expect(node.querySelectorAll(".detail-linked-row.is-void")).toHaveLength(
        2,
      );
      expect(html).toContain("টাকা ফেরত পেয়েছি");
      if (includeReturn) expect(html).toContain("মাল ফেরত");
      expect(html).not.toContain('class="entry-paid-status-v5"');
    },
  );
  it("shows a notebook paid-total correction as an adjustment without inventing a person or bill", () => {
    const ledger = LedgerSchema.parse({
      works: [{ id: "work", name: "পরীক্ষার খাতা" }],
      entries: [
        {
          id: "adjust",
          kind: "adjustment",
          personId: null,
          account: "other",
          note: "অঙ্ক মিলিয়েছি",
          adjustment: {
            target: "work",
            basis: "paid",
            account: null,
            before: 100000,
            after: 150000,
            delta: 50000,
            workId: "work",
          },
        },
      ],
    });
    const html = renderDetail(ledger, "adjust");
    expect(html).toContain("সমন্বয়");
    expect(html).toContain("মোট দিয়েছি");
    expect(html).toContain("পরীক্ষার খাতা");
    expect(html).toContain("সব হিসাব");
    expect(html).toContain("<strong>৳1000</strong>");
    expect(html).toContain("<strong>৳1500</strong>");
    expect(html).not.toContain("বাকি ৳");
    expect(html).not.toContain("entry-person-card");
  });
  it("shows an immutable noncash adjustment with before/after balances and its reason", () => {
    const ledger = LedgerSchema.parse({
      works: [{ id: "roof", name: "ছাদের কাজ" }],
      people: [{ id: "worker", name: "মিস্ত্রি" }],
      entries: [
        {
          id: "adjust",
          kind: "adjustment",
          personId: "worker",
          account: "labour",
          note: "পুরোনো হিসাব মিলিয়েছি",
          adjustment: {
            target: "person",
            basis: "balance",
            account: "labour",
            before: 600000,
            after: -100000,
            delta: -700000,
            workId: "roof",
          },
        },
      ],
    });
    const html = renderDetail(ledger, "adjust");
    expect(html).toContain("সমন্বয়");
    expect(html).toContain("৳-7000");
    expect(html).toContain("বাকি ৳6000");
    expect(html).toContain("আমার জমা ৳1000");
    expect(html).toContain("ছাদের কাজ");
    expect(html).toContain("কারণ: পুরোনো হিসাব মিলিয়েছি");
    expect(html).toContain("আগের বিল বা টাকা দেওয়ার তথ্য বদলায়নি।");
    expect(html).not.toContain("সংশোধন করুন");
    expect(html).not.toContain("মজুরির বিল");
    expect(html).not.toContain("মালের বিল");
  });
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
    expect(html).toContain("<del>হিসাবে আছে</del>");
    expect(html).toContain("<ins>বাতিল</ins>");
    expect(html).toContain("<del>বাতিল</del>");
    expect(html).toContain("<ins>হিসাবে আছে</ins>");
    expect(html.match(/class="entry-revision"/g)).toHaveLength(3);
    expect(html).not.toContain("তখনকার পুরো হিসাব");
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
    expect(html).toContain("পরিশোধের ইতিহাস");
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
  it("shows only the changed amount once and keeps stored revisions intact", () => {
    let ledger = LedgerSchema.parse({
      works: [{ id: "bathroom", name: "বাথরুমের খাতা" }],
      entries: [
        {
          id: "bill",
          kind: "expense",
          account: "labour",
          note: "মজুরির বিল",
          createdAt: "2026-11-01T08:00:00.000Z",
          lines: [
            {
              id: "line",
              workId: "bathroom",
              label: "মিস্ত্রির কাজ",
              costType: "labour",
              amount: 6000000,
            },
          ],
        },
      ],
    });
    ledger = replaceEntry(ledger, {
      ...ledger.entries[0],
      lines: [{ ...ledger.entries[0].lines[0], amount: 1000000 }],
    });
    const saved = JSON.stringify(ledger);
    const html = renderDetail(ledger);
    const history = revisionMarkup(html);
    expect(history.match(/class="entry-revision-change"/g)).toHaveLength(1);
    expect(history).toContain("<del>৳60000</del>");
    expect(history).toContain("<ins>৳10000</ins>");
    expect(history).toContain("টাকার পরিমাণ");
    expect(history).not.toContain("মিস্ত্রির কাজ");
    expect(history).not.toContain("বাথরুমের খাতা");
    expect(history).not.toContain("মজুরির বিল");
    expect(history).not.toContain("খরচের বিবরণ");
    expect(html).not.toContain("তখনকার পুরো হিসাব");
    expect(history.match(/class="entry-revision"/g)).toHaveLength(1);
    expect(JSON.stringify(ledger)).toBe(saved);
  });
  it("identifies a changed line without repeating the other line or the total", () => {
    let ledger = LedgerSchema.parse({
      works: [{ id: "bathroom", name: "বাথরুমের খাতা" }],
      entries: [
        {
          id: "bill",
          kind: "expense",
          account: "labour",
          lines: [
            {
              id: "line",
              workId: "bathroom",
              label: "মিস্ত্রির কাজ",
              costType: "labour",
              amount: 6000000,
            },
            {
              id: "second",
              workId: "bathroom",
              label: "রঙের কাজ",
              costType: "labour",
              amount: 200000,
            },
          ],
        },
      ],
    });
    ledger = replaceEntry(ledger, {
      ...ledger.entries[0],
      lines: ledger.entries[0].lines.map((line) =>
        line.id === "line" ? { ...line, amount: 1000000 } : line,
      ),
    });
    const history = revisionMarkup(renderDetail(ledger));
    expect(history.match(/class="entry-revision-change"/g)).toHaveLength(1);
    expect(history).toContain("মিস্ত্রির কাজ");
    expect(history).toContain("<del>৳60000</del>");
    expect(history).toContain("<ins>৳10000</ins>");
    expect(history).not.toContain("রঙের কাজ");
    expect(history).not.toContain("৳62000");
    expect(history).not.toContain("৳12000");
  });
  it("does not repeat a payment correction in the matching work allocation", () => {
    let ledger = LedgerSchema.parse({
      works: [{ id: "bathroom", name: "বাথরুমের খাতা" }],
      entries: [
        {
          id: "payment",
          kind: "payment",
          account: "labour",
          paymentParts: [{ method: "cash", amount: 6000000 }],
          allocations: [{ workId: "bathroom", amount: 6000000 }],
        },
      ],
    });
    ledger = replaceEntry(ledger, {
      ...ledger.entries[0],
      paymentParts: [{ method: "cash", amount: 1000000 }],
      allocations: [{ workId: "bathroom", amount: 1000000 }],
    });
    const history = revisionMarkup(renderDetail(ledger));
    expect(history.match(/class="entry-revision-change"/g)).toHaveLength(1);
    expect(history.match(/৳60000/g)).toHaveLength(1);
    expect(history.match(/৳10000/g)).toHaveLength(1);
    expect(history).not.toContain("নগদ");
    expect(history).not.toContain("বাথরুমের খাতা");
  });
  it("keeps a financial correction reason as a new sentence without repeating the old note", () => {
    let ledger = LedgerSchema.parse({
      works: [{ id: "bathroom", name: "বাথরুমের খাতা" }],
      entries: [
        {
          id: "bill",
          kind: "expense",
          note: "মজুরির বিল",
          lines: [
            {
              id: "line",
              workId: "bathroom",
              label: "মিস্ত্রির কাজ",
              amount: 6000000,
            },
          ],
        },
      ],
    });
    ledger = replaceEntry(ledger, {
      ...ledger.entries[0],
      note: "মজুরির বিল\nহিসাব মেলানোর কারণ: আগের অঙ্কটি ভুল ছিল",
      lines: [{ ...ledger.entries[0].lines[0], amount: 1000000 }],
    });
    const history = revisionMarkup(renderDetail(ledger));
    expect(history.match(/class="entry-revision-change"/g)).toHaveLength(2);
    expect(history).toContain("হিসাব মেলানোর কারণ");
    expect(history).toContain("<ins>আগের অঙ্কটি ভুল ছিল</ins>");
    expect(history).not.toContain("মজুরির বিল");
    expect(history).not.toContain("লেখা নেই");
  });
  it("does not create a visible event for a new bill or internal line IDs alone", () => {
    let ledger = LedgerSchema.parse({
      works: [{ id: "bathroom", name: "বাথরুমের খাতা" }],
      entries: [
        {
          id: "bill",
          kind: "expense",
          lines: [
            {
              id: "line",
              workId: "bathroom",
              label: "মিস্ত্রির কাজ",
              amount: 6000000,
            },
          ],
        },
      ],
    });
    expect(renderDetail(ledger)).not.toContain("কখন কী বদলেছে");
    ledger = replaceEntry(ledger, {
      ...ledger.entries[0],
      lines: [{ ...ledger.entries[0].lines[0], id: "new-internal-id" }],
    });
    expect(ledger.entries[0].revisions).toHaveLength(1);
    expect(renderDetail(ledger)).not.toContain("কখন কী বদলেছে");
  });
  it("keeps an untitled contract change visible with its work, person and amount", () => {
    let ledger = LedgerSchema.parse({
      works: [{ id: "bathroom", name: "বাথরুমের খাতা" }],
      people: [{ id: "person", name: "মিস্ত্রি" }],
      contracts: [
        {
          id: "old-contract",
          workId: "bathroom",
          personId: "person",
          total: 100000,
        },
        {
          id: "new-contract",
          workId: "bathroom",
          personId: "person",
          total: 200000,
        },
      ],
      entries: [
        {
          id: "bill",
          kind: "expense",
          account: "labour",
          personId: "person",
          contractId: "old-contract",
          lines: [
            {
              id: "line",
              workId: "bathroom",
              costType: "labour",
              amount: 50000,
            },
          ],
        },
      ],
    });
    ledger = replaceEntry(ledger, {
      ...ledger.entries[0],
      contractId: "new-contract",
    });
    const history = revisionMarkup(renderDetail(ledger));
    expect(history).toContain("ঠিক করা মজুরি");
    expect(history).toContain(
      "<del>মজুরির দর · মিস্ত্রি · বাথরুমের খাতা · ৳1000</del>",
    );
    expect(history).toContain(
      "<ins>মজুরির দর · মিস্ত্রি · বাথরুমের খাতা · ৳2000</ins>",
    );
    expect(history).not.toContain("old-contract");
    expect(history).not.toContain("new-contract");
  });
  it("keeps a reference change visible even when all human-readable details match", () => {
    let ledger = LedgerSchema.parse({
      works: [{ id: "bathroom", name: "বাথরুমের খাতা" }],
      people: [
        { id: "old-person", name: "মিস্ত্রি" },
        { id: "new-person", name: "মিস্ত্রি" },
      ],
      entries: [
        {
          id: "bill",
          kind: "expense",
          personId: "old-person",
          lines: [{ id: "line", workId: "bathroom", amount: 50000 }],
        },
      ],
    });
    ledger = replaceEntry(ledger, {
      ...ledger.entries[0],
      personId: "new-person",
    });
    const history = revisionMarkup(renderDetail(ledger));
    expect(history.match(/class="entry-revision-change"/g)).toHaveLength(1);
    expect(history).toContain("ব্যক্তি বা দোকান");
    expect(history).toContain("<ins>নতুনটি বেছে নেওয়া হয়েছে</ins>");
    expect(history).not.toContain("old-person");
    expect(history).not.toContain("new-person");
  });
  it("uses unit and work description to distinguish references with equal names", () => {
    let ledger = LedgerSchema.parse({
      works: [
        { id: "old-work", name: "কাজ", description: "নিচতলা" },
        { id: "new-work", name: "কাজ", description: "দোতলা" },
      ],
      items: [
        { id: "old-item", name: "রড", unit: "কেজি" },
        { id: "new-item", name: "রড", unit: "টন" },
      ],
      entries: [
        {
          id: "bill",
          kind: "expense",
          lines: [
            {
              id: "line",
              workId: "old-work",
              itemId: "old-item",
              amount: 50000,
            },
          ],
        },
      ],
    });
    ledger = replaceEntry(ledger, {
      ...ledger.entries[0],
      lines: [
        {
          ...ledger.entries[0].lines[0],
          workId: "new-work",
          itemId: "new-item",
        },
      ],
    });
    const history = revisionMarkup(renderDetail(ledger));
    expect(history.match(/class="entry-revision-change"/g)).toHaveLength(2);
    expect(history).toContain("<del>রড · কেজি</del>");
    expect(history).toContain("<ins>রড · টন</ins>");
    expect(history).toContain("<del>কাজ · নিচতলা</del>");
    expect(history).toContain("<ins>কাজ · দোতলা</ins>");
  });
  it("shows a line addition and removal with enough work context to identify each", () => {
    let ledger = LedgerSchema.parse({
      works: [
        { id: "roof", name: "ছাদ" },
        { id: "door", name: "দরজা" },
      ],
      entries: [
        {
          id: "bill",
          kind: "expense",
          lines: [
            { id: "keep", workId: "roof", label: "রড", amount: 10000 },
            { id: "remove", workId: "door", label: "রড", amount: 10000 },
          ],
        },
      ],
    });
    ledger = replaceEntry(ledger, {
      ...ledger.entries[0],
      lines: [
        ledger.entries[0].lines[0],
        { ...ledger.entries[0].lines[1], id: "add", workId: "roof" },
      ],
    });
    const history = revisionMarkup(renderDetail(ledger));
    expect(history.match(/class="entry-revision-change"/g)).toHaveLength(2);
    expect(history).toContain("খরচ যোগ হয়েছে");
    expect(history).toContain("<ins>রড · ছাদ · ৳100</ins>");
    expect(history).toContain("খরচ বাদ গেছে");
    expect(history).toContain("<del>রড · দরজা · ৳100</del>");
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
  expect(html).toContain("পরিশোধ ও ফেরত");
  expect(html).toContain("মাল ফেরত");
  expect(html).not.toContain("৳0");
});
