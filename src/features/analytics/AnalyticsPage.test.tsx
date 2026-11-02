import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { LedgerSchema } from "../../domain/model";
import { AnalyticsPage, filtersFromSearch } from "./AnalyticsPage";

vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    formatDigits: String,
    t: (text: string, values: Record<string, string | number> = {}) =>
      text.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(values[name] ?? ""),
      ),
    money: (poisha: number) => `৳${poisha / 100}`,
    number: String,
    date: (date: string | null) =>
      date ? new Date(date).toISOString().slice(0, 10) : "তারিখ জানা নেই",
  }),
}));

describe("report routes", () => {
  it("renders linked filters without treating material names or brands as dates", () => {
    const ledger = LedgerSchema.parse({
      materialGroups: [{ id: "cement", name: "সিমেন্ট" }],
      works: [{ id: "plaster", name: "প্লাস্টার" }],
      items: [
        {
          id: "crown",
          name: "Crown",
          brand: "Crown",
          materialGroupId: "cement",
          usage: "প্লাস্টার",
        },
      ],
      entries: [
        {
          id: "bill",
          kind: "expense",
          date: "2026-11-01",
          lines: [
            { id: "line", workId: "plaster", itemId: "crown", amount: 200000 },
          ],
        },
      ],
    });
    const html = renderToString(
      <MemoryRouter
        initialEntries={[
          "/reports?group=cement&brand=Crown&usage=প্লাস্টার&from=2026-01-01",
        ]}
      >
        <AnalyticsPage ledger={ledger} />
      </MemoryRouter>,
    );
    expect(html).toContain("সিমেন্ট — কোথায় কত");
    expect(html).toContain("৳2000");
    expect(html).toContain("2026-01-01 থেকে");
    expect(html).toContain("Crown");
  });

  it("clears invalid URL dates and enums and allows clearing a route's initial group", () => {
    expect(
      filtersFromSearch(
        new URLSearchParams(
          "from=2026-02-30&to=tomorrow&type=nope&review=bad&dates=bad",
        ),
        "cement",
      ),
    ).toMatchObject({
      groupId: "cement",
      from: "",
      to: "",
      costType: "",
      review: "all",
      dates: "all",
    });
    expect(
      filtersFromSearch(new URLSearchParams("group="), "cement").groupId,
    ).toBe("");
  });
  it("shows material-only price details and switches explicitly to labour", () => {
    const ledger = LedgerSchema.parse({
      works: [{ id: "roof", name: "ছাদের কাজ" }],
      people: [{ id: "worker", name: "রহিম" }],
      entries: [
        {
          id: "material",
          kind: "expense",
          date: "2026-11-01",
          lines: [
            {
              id: "material-line",
              workId: "roof",
              label: "সিমেন্ট",
              amount: 200000,
            },
          ],
        },
        {
          id: "wage",
          kind: "expense",
          account: "labour",
          personId: "worker",
          date: "2026-11-01",
          lines: [
            {
              id: "wage-line",
              workId: "roof",
              label: "মিস্ত্রির মজুরি",
              costType: "labour",
              amount: 70000,
            },
          ],
        },
        {
          id: "van",
          kind: "expense",
          date: "2026-11-01",
          lines: [
            {
              id: "van-line",
              workId: "roof",
              label: "ভ্যানের ভাড়া",
              costType: "transport",
              amount: 10000,
            },
          ],
        },
      ],
    });
    const material = renderToString(
      <MemoryRouter initialEntries={["/reports?mode=cost"]}>
        <AnalyticsPage ledger={ledger} />
      </MemoryRouter>,
    );
    expect(material).toContain("৳2000");
    expect(material).toContain("সিমেন্ট");
    expect(material).not.toContain("মালের ধরন দেওয়া নেই");
    expect(material).not.toContain("৳2800");
    expect(material).not.toContain("মিস্ত্রির মজুরি");
    expect(material).not.toContain("ভ্যানের ভাড়া");
    const labour = renderToString(
      <MemoryRouter initialEntries={["/reports?section=labour"]}>
        <AnalyticsPage ledger={ledger} />
      </MemoryRouter>,
    );
    expect(labour).toContain("৳700");
    expect(labour).toContain("মিস্ত্রির মজুরি");
    expect(labour).not.toContain("৳2000");
  });
});

it("keeps transport and rental prices together when drilling into other cash payments, without pulling in materials", () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "w", name: "দরজা" }],
    people: [{ id: "driver", name: "চালক", kind: "driver" }],
    entries: [
      {
        id: "old-van",
        kind: "expense",
        personId: "driver",
        lines: [
          {
            id: "van",
            workId: "w",
            costType: "transport",
            label: "ভ্যানের ভাড়া",
            amount: 20000,
          },
        ],
      },
      {
        id: "rental",
        kind: "expense",
        account: "other",
        lines: [
          {
            id: "rent",
            workId: "w",
            costType: "rental",
            label: "যন্ত্রের ভাড়া",
            amount: 50000,
          },
        ],
      },
      {
        id: "materials",
        kind: "expense",
        lines: [
          { id: "door", workId: "w", label: "দরজা কিনেছি", amount: 9300000 },
        ],
      },
    ],
  });
  const html = renderToString(
    <MemoryRouter
      initialEntries={["/reports?mode=cost&account=other&section=all"]}
    >
      <AnalyticsPage ledger={ledger} />
    </MemoryRouter>,
  );
  expect(html).toContain("৳700");
  expect(html).toContain("ভ্যানের ভাড়া");
  expect(html).toContain("যন্ত্রের ভাড়া");
  expect(html).not.toContain("৳93000");
});
