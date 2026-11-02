import { localizedDigits } from "../../lib/numerals";
import { formatMoney } from "../../lib/formatMoney";
import { describe, expect, it } from "vitest";
import { LedgerSchema } from "../../domain/model";
import {
  contactStatement,
  statementFilename,
  statementHtml,
} from "./statement";
const ledger = () =>
  LedgerSchema.parse({
    project: { name: "বাড়ি" },
    works: [
      { id: "tiles", name: "টাইলস" },
      { id: "door", name: "দরজা" },
    ],
    people: [
      { id: "worker", name: "রহিম <script>", kind: "worker" },
      { id: "shop", name: "দোকান", kind: "shop" },
    ],
    entries: [
      {
        id: "wage",
        kind: "expense",
        date: "2026-11-02",
        personId: "worker",
        account: "labour",
        note: "private-note-other-name",
        lines: [
          {
            id: "wage-line",
            workId: "tiles",
            amount: 600000,
            costType: "labour",
            label: "মজুরি",
          },
        ],
        source: {
          file: "private-source.html",
          cell: "J20",
          checksum: "private-checksum",
        },
      },
      {
        id: "payment",
        kind: "payment",
        date: "2026-11-03",
        personId: "worker",
        account: "labour",
        allocations: [
          { workId: "tiles", amount: 100000 },
          { workId: "door", amount: 200000 },
        ],
        paymentParts: [{ amount: 300000 }],
      },
      {
        id: "worker-material",
        kind: "expense",
        date: "2026-11-01",
        personId: "worker",
        lines: [
          { id: "material", workId: "tiles", amount: 150000, label: "আঠা" },
        ],
      },
      {
        id: "other-contact",
        kind: "expense",
        date: "2026-11-01",
        personId: "shop",
        lines: [
          {
            id: "secret-shop",
            workId: "door",
            amount: 900000,
            label: "other-contact-secret",
          },
        ],
      },
    ],
  });
describe("read-only contact statements", () => {
  it.each(["bn", "en"] as const)(
    "retains nonbreaking currency spacing in exported %s HTML",
    (language) => {
      const document = ledger();
      const statement = contactStatement(document, document.people[0]);
      const html = statementHtml(statement, {
        language,
        t: (key) => key,
        money: (amount) => formatMoney(amount, language),
        date: (value) => value ?? "—",
      });
      expect(html).toContain(
        language === "bn" ? "৳\u202f৩,০০০" : "৳\u202f3,000",
      );
      expect(html).not.toMatch(/৳[0-9০-৯-]/u);
    },
  );
  it("nets the selected person's running wage account across works and keeps chronological rows", () => {
    const document = ledger();
    const statement = contactStatement(document, document.people[0]);
    expect(statement.account).toBe("labour");
    expect(statement.rows).toHaveLength(2);
    expect(statement.rows.map((row) => row.date)).toEqual([
      "2026-11-02",
      "2026-11-03",
    ]);
    expect(statement.totals).toMatchObject({
      cost: 600000,
      paid: 300000,
      payable: 300000,
      advance: 0,
    });
    const serialized = JSON.stringify(statement);
    for (const privateValue of [
      "worker-material",
      "other-contact-secret",
      "private-note-other-name",
      "private-source.html",
      "private-checksum",
      "shop",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });
  it("exports only a selected work's portion of a mixed payment", () => {
    const document = ledger();
    const statement = contactStatement(document, document.people[0], {
      workId: "tiles",
    });
    expect(statement.rows[1].paid).toBe(100000);
    expect(statement.rows[1].works).toBe("টাইলস");
    expect(statement.totals).toMatchObject({
      paid: 100000,
      payable: 500000,
      advance: 0,
    });
  });
  it("escapes untrusted data and never adds scripts, source IDs or private notes by default", () => {
    const document = ledger();
    const statement = contactStatement(document, document.people[0]);
    const html = statementHtml(statement, {
      t: (key) => key,
      money: (value) => String(value / 100),
      date: (value) => value ?? "—",
    });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("private-note");
    expect(html).not.toContain("private-source");
    expect(html).not.toContain('id="worker"');
    expect(html).toContain("default-src 'none'");
    expect(statementFilename("../রহিম<script>.html")).toBe(
      "রহিমscripthtml-statement.html",
    );
    const withNotes = contactStatement(document, document.people[0], {
      includeNotes: true,
    });
    expect(withNotes.rows[0].note).toBe("private-note-other-name");
  });
  it("preserves an unknown historical payment state without manufacturing a running balance", () => {
    const document = LedgerSchema.parse({
      works: [{ id: "work", name: "কাজ" }],
      people: [{ id: "worker", name: "রহিম", kind: "worker" }],
      entries: [
        {
          id: "old",
          kind: "expense",
          personId: "worker",
          account: "labour",
          balanceImpact: "historical",
          lines: [
            { id: "line", workId: "work", amount: 800000, costType: "labour" },
          ],
        },
      ],
    });
    const statement = contactStatement(document, document.people[0]);
    expect(statement.rows[0].balance).toBeNull();
    expect(statement.totals).toMatchObject({
      cost: 800000,
      paid: 0,
      payable: 0,
      advance: 0,
      historicalCost: 800000,
    });
  });
  it("never leaks a driver's mixed material bill or its linked cash into a transport-only copy", () => {
    const document = LedgerSchema.parse({
      works: [{ id: "door", name: "দরজা" }],
      people: [{ id: "driver", name: "রনি", kind: "driver" }],
      entries: [
        {
          id: "trip",
          kind: "expense",
          personId: "driver",
          lines: [
            {
              id: "van",
              workId: "door",
              costType: "transport",
              amount: 50000,
              label: "ভ্যানভাড়া",
            },
          ],
        },
        {
          id: "mixed",
          kind: "expense",
          personId: "driver",
          lines: [
            {
              id: "m1",
              workId: "door",
              costType: "transport",
              amount: 20000,
              label: "mixed-trip",
            },
            {
              id: "m2",
              workId: "door",
              amount: 80000,
              label: "private-other-material",
            },
          ],
        },
        {
          id: "mixed-paid",
          kind: "payment",
          personId: "driver",
          relatedEntryId: "mixed",
          allocations: [{ workId: "door", amount: 100000 }],
          paymentParts: [{ amount: 100000 }],
        },
      ],
    });
    const statement = contactStatement(document, document.people[0]);
    expect(statement.rows).toHaveLength(1);
    expect(statement.totals.cost).toBe(50000);
    expect(JSON.stringify(statement)).not.toContain("private-other-material");
    expect(JSON.stringify(statement)).not.toContain("mixed-trip");
    expect(document.entries).toHaveLength(3);
  });
});

it("exports untrusted labels using the selected numerals without changing saved account data", () => {
  const document = ledger();
  document.people[0].name = "মিস্ত্রি 12 <script>";
  document.entries[0].lines[0].label = "দরজা 8টি";
  const statement = contactStatement(document, document.people[0]);
  const before = JSON.stringify(statement);
  for (const language of ["bn", "en"] as const) {
    const html = statementHtml(statement, {
      t: String,
      money: String,
      date: (value) => value ?? "",
      language,
      formatDigits: (value) => localizedDigits(value, language),
    });
    expect(html).toContain(`<html lang="${language}">`);
    expect(html).toContain(
      localizedDigits("মিস্ত্রি 12 &lt;script&gt;", language),
    );
    expect(html).toContain(localizedDigits("দরজা 8টি", language));
    expect(html).not.toContain("<script>");
  }
  expect(JSON.stringify(statement)).toBe(before);
});
