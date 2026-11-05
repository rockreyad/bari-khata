// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { LedgerSchema } from "../../domain/model";
import { AnalyticsPage } from "./AnalyticsPage";

vi.mock("../../components/ui/AppSelect", () => ({
  AppSelect: (props: SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props} />
  ),
}));

vi.mock("../../components/Sheet", () => ({
  Sheet: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => (
    <section>
      {children}
      {footer}
    </section>
  ),
}));

vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string, values: Record<string, string | number> = {}) =>
      text.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(values[name] ?? ""),
      ),
    money: (value: number) => `৳${value / 100}`,
    number: String,
    formatDigits: String,
    date: String,
  }),
}));

afterEach(cleanup);

const ledger = LedgerSchema.parse({
  works: [
    { id: "work", name: "নমুনা খাতা" },
    { id: "elsewhere", name: "অন্য খাতা" },
  ],
  people: [
    { id: "person", name: "নমুনা মানুষ" },
    { id: "someone-else", name: "অন্য মানুষ" },
  ],
  entries: [
    ...(
      [
        ["wage", "labour", "work", "person", "2026-11-02", 70000],
        ["materials", "materials", "work", "person", "2026-11-02", 200000],
        ["other", "other", "work", "person", "2026-11-02", 10000],
        ["other-work", "labour", "elsewhere", "person", "2026-11-02", 90000],
        ["other-person", "labour", "work", "someone-else", "2026-11-02", 90000],
        ["older", "labour", "work", "person", "2026-10-01", 90000],
      ] as const
    ).map(([id, account, workId, personId, date, amount]) => ({
      id,
      kind: "payment",
      account,
      personId,
      date,
      allocations: [{ workId, amount }],
      paymentParts: [{ amount }],
    })),
  ],
});

function CurrentRoute() {
  const location = useLocation();
  return <output data-testid="route">{location.search}</output>;
}

function open(section: string, account = "") {
  return render(
    <MemoryRouter
      initialEntries={[
        `/reports?mode=cost&section=${section}&work=work&person=person&from=2026-11-01&to=2026-11-03${account ? `&account=${account}` : ""}`,
      ]}
    >
      <AnalyticsPage ledger={ledger} />
      <CurrentRoute />
    </MemoryRouter>,
  );
}

it.each([
  ["labour", "labour", "৳700"],
  ["material", "materials", "৳2000"],
])(
  "keeps the %s account and the work, person and dates when opening payments",
  (section, account, amount) => {
    const { container } = open(section);
    fireEvent.click(
      screen.getByRole("button", { name: "টাকা দেওয়ার হিসাব দেখি" }),
    );
    expect(
      Object.fromEntries(
        new URLSearchParams(screen.getByTestId("route").textContent ?? ""),
      ),
    ).toEqual({
      mode: "cash",
      work: "work",
      person: "person",
      from: "2026-11-01",
      to: "2026-11-03",
      account,
    });
    expect(container.querySelector(".report-total > strong")?.textContent).toBe(
      amount,
    );
    expect(container.querySelector(".report-history")).toBeNull();
  },
);

it("shows recorded wages even when no separate labour bill was written", () => {
  const before = structuredClone(ledger);
  const { container } = open("labour");
  expect(container.querySelector(".report-total > span")?.textContent).toBe(
    "মজুরির বিল",
  );
  expect(container.querySelector(".report-total > strong")?.textContent).toBe(
    "৳0",
  );
  expect(
    container.querySelector(".report-paid-summary > button > strong")
      ?.textContent,
  ).toBe("৳700");
  expect(screen.getByText("এই বাছাইয়ে মজুরির বিল নেই।")).toBeTruthy();
  expect(screen.queryByText("এই বাছাইয়ে কোনো খরচ নেই।")).toBeNull();
  expect(container.querySelectorAll(".history-expense")).toHaveLength(0);
  expect(ledger).toEqual(before);
});

it("keeps the search and worker scope when opening paid wages", () => {
  const { container } = open("labour");
  fireEvent.change(screen.getByRole("textbox", { name: "রিপোর্টে খুঁজুন" }), {
    target: { value: "নমুনা খাতা" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "টাকা দেওয়ার হিসাব দেখি" }),
  );
  expect(
    Object.fromEntries(
      new URLSearchParams(screen.getByTestId("route").textContent ?? ""),
    ),
  ).toEqual({
    mode: "cash",
    work: "work",
    person: "person",
    from: "2026-11-01",
    to: "2026-11-03",
    q: "নমুনা খাতা",
    account: "labour",
  });
  expect(container.querySelector(".report-total > strong")?.textContent).toBe(
    "৳700",
  );
});

it("keeps scoped labour bills separate from split cash and refunds", () => {
  const mixed = LedgerSchema.parse({
    works: ledger.works,
    people: ledger.people,
    entries: [
      {
        id: "bill",
        kind: "expense",
        account: "labour",
        personId: "person",
        date: "2026-11-02",
        lines: [
          {
            id: "work-line",
            workId: "work",
            costType: "labour",
            label: "নমুনা মজুরি",
            amount: 600000,
          },
          {
            id: "elsewhere-line",
            workId: "elsewhere",
            costType: "labour",
            label: "অন্য খাতার মজুরি",
            amount: 400000,
          },
        ],
      },
      {
        id: "split-payment",
        kind: "payment",
        relatedEntryId: "bill",
        account: "labour",
        personId: "person",
        date: "2026-11-02",
        paymentParts: [{ method: "bank", amount: 700000 }],
        allocations: [
          { workId: "work", amount: 300000 },
          { workId: "elsewhere", amount: 400000 },
        ],
      },
      {
        id: "split-refund",
        kind: "refund",
        account: "labour",
        personId: "person",
        date: "2026-11-03",
        paymentParts: [{ amount: 50000 }],
        allocations: [
          { workId: "work", amount: 20000 },
          { workId: "elsewhere", amount: 30000 },
        ],
      },
      ...ledger.entries.filter((entry) => entry.id !== "wage"),
      {
        ...ledger.entries[0],
        id: "voided-payment",
        voided: true,
      },
      {
        ...ledger.entries[0],
        id: "historical-payment",
        balanceImpact: "historical",
      },
    ],
  });
  const before = structuredClone(mixed);
  const onEntry = vi.fn();
  const { container } = render(
    <MemoryRouter
      initialEntries={[
        "/reports?mode=cost&section=labour&work=work&person=person&from=2026-11-01&to=2026-11-03",
      ]}
    >
      <AnalyticsPage ledger={mixed} onEntry={onEntry} />
      <CurrentRoute />
    </MemoryRouter>,
  );
  expect(container.querySelector(".report-total > strong")?.textContent).toBe(
    "৳6000",
  );
  expect(
    container.querySelector(".report-paid-summary > button > strong")
      ?.textContent,
  ).toBe("৳2800");
  expect(screen.getByText("ফেরত পাওয়া ৳200 বাদ দিয়ে")).toBeTruthy();
  expect(container.querySelectorAll(".history-expense")).toHaveLength(1);
  expect(container.querySelectorAll(".history-payment")).toHaveLength(0);

  fireEvent.click(
    screen.getByRole("button", { name: "টাকা দেওয়ার হিসাব দেখি" }),
  );
  expect(container.querySelector(".report-total > strong")?.textContent).toBe(
    "৳2800",
  );
  expect(container.querySelector(".report-history")).toBeNull();
  expect(container.querySelectorAll(".history-expense")).toHaveLength(0);
  expect(
    container.querySelector(".report-breakdown-list button > strong")
      ?.textContent,
  ).toBe("৳2800");
  expect(onEntry).not.toHaveBeenCalled();
  expect(mixed).toEqual(before);
});

it.each([
  ["section=labour&type=material", "", "৳700"],
  ["section=labour&type=labour&account=materials", "", "৳2000"],
  ["type=labour", "cement", "৳700"],
])(
  "honours explicit cash mode with stale %s and initial group %s",
  (stale, initialGroupId, amount) => {
    const { container } = render(
      <MemoryRouter
        initialEntries={[
          `/reports?mode=cash&${stale}&work=work&person=person&from=2026-11-01&to=2026-11-03`,
        ]}
      >
        <AnalyticsPage ledger={ledger} initialGroupId={initialGroupId} />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "টাকা কোথায় দিলাম" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "মাল ও কাজের দাম" }),
    ).toBeNull();
    expect(container.querySelector(".report-total > strong")?.textContent).toBe(
      amount,
    );
    expect(container.querySelector(".report-history")).toBeNull();
  },
);

it("clears legacy category hints when choosing all payment accounts", () => {
  const { container } = render(
    <MemoryRouter
      initialEntries={[
        "/reports?mode=cash&section=labour&type=labour&work=work&person=person&from=2026-11-01&to=2026-11-03",
      ]}
    >
      <AnalyticsPage ledger={ledger} />
      <CurrentRoute />
    </MemoryRouter>,
  );
  expect(container.querySelector(".report-total > strong")?.textContent).toBe(
    "৳700",
  );
  fireEvent.click(screen.getByRole("button", { name: "হিসাব বেছে দেখুন" }));
  fireEvent.change(screen.getByLabelText("কিসের টাকা"), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByRole("button", { name: "হিসাব দেখুন" }));
  const params = new URLSearchParams(
    screen.getByTestId("route").textContent ?? "",
  );
  expect(params.get("mode")).toBe("cash");
  expect(params.has("section")).toBe(false);
  expect(params.has("type")).toBe(false);
  expect(params.has("account")).toBe(false);
  expect(container.querySelector(".report-total > strong")?.textContent).toBe(
    "৳2800",
  );
  expect(container.querySelector(".report-history")).toBeNull();
});

it.each(["transport", "other"])(
  "labels %s payments as all accounts rather than inventing a cash category",
  (section) => {
    const { container } = open(section);
    fireEvent.click(
      screen.getByRole("button", { name: "সব ধরনের টাকা দেওয়ার হিসাব দেখি" }),
    );
    expect(
      new URLSearchParams(screen.getByTestId("route").textContent ?? "").has(
        "account",
      ),
    ).toBe(false);
    expect(container.querySelector(".report-total > strong")?.textContent).toBe(
      "৳2800",
    );
    expect(container.querySelector(".report-history")).toBeNull();
  },
);

it("preserves an explicit account while opening broader cash details", () => {
  const { container } = open("transport", "other");
  fireEvent.click(
    screen.getByRole("button", { name: "অন্য খাতে দেওয়া টাকার হিসাব দেখি" }),
  );
  expect(
    new URLSearchParams(screen.getByTestId("route").textContent ?? "").get(
      "account",
    ),
  ).toBe("other");
  expect(container.querySelector(".report-total > strong")?.textContent).toBe(
    "৳100",
  );
  expect(container.querySelector(".report-history")).toBeNull();
});

it("preserves an explicit account rather than replacing it with the cost section", () => {
  const { container } = open("labour", "materials");
  fireEvent.click(
    screen.getByRole("button", { name: "টাকা দেওয়ার হিসাব দেখি" }),
  );
  expect(
    new URLSearchParams(screen.getByTestId("route").textContent ?? "").get(
      "account",
    ),
  ).toBe("materials");
  expect(container.querySelector(".report-total > strong")?.textContent).toBe(
    "৳2000",
  );
});

const correctionLedger = LedgerSchema.parse({
  works: [{ id: "work", name: "নমুনা খাতা" }],
  people: [{ id: "person", name: "নমুনা মানুষ" }],
  materialGroups: [{ id: "cement", name: "সিমেন্ট" }],
  items: [
    { id: "crown", name: "সিমেন্ট", brand: "Crown", materialGroupId: "cement" },
  ],
  entries: [
    ...(
      [
        ["wage-bill", "labour", "labour", 10000],
        ["material-bill", "materials", "material", 20000],
        ["transport-bill", "other", "transport", 30000],
        ["rental-bill", "other", "rental", 40000],
      ] as const
    ).map(([id, account, costType, amount]) => ({
      id,
      kind: "expense",
      account,
      personId: "person",
      date: "2026-11-02",
      lines: [
        {
          id: `${id}-line`,
          workId: "work",
          label: costType === "material" ? "সিমেন্ট" : id,
          costType,
          amount,
          itemId: costType === "material" ? "crown" : null,
          usage: "ছাদ",
        },
      ],
    })),
    ...(
      [
        ["labour-change", "labour", 10000, 1000],
        ["material-change", "materials", 20000, 2000],
        ["other-change", "other", 70000, 3000],
      ] as const
    ).map(([id, account, before, delta]) => ({
      id,
      kind: "adjustment",
      account,
      personId: "person",
      note: "অঙ্ক মিলিয়েছি",
      date: "2026-11-02",
      adjustment: {
        target: "person",
        basis: "cost",
        account,
        before,
        after: before + delta,
        delta,
        workId: "work",
      },
    })),
    {
      id: "whole-work-change",
      kind: "adjustment",
      account: "other",
      note: "পুরো খাতার অঙ্ক মিলিয়েছি",
      date: "2026-11-02",
      adjustment: {
        target: "work",
        basis: "cost",
        account: null,
        before: 100000,
        after: 104000,
        delta: 4000,
        workId: "work",
      },
    },
  ],
});

it.each([
  ["labour", "", "৳100", "৳10"],
  ["labour", "&account=labour", "৳100", "৳10"],
  ["material", "", "৳200", "৳20"],
  ["all", "", "৳1000", "৳100"],
  ["all", "&account=other", "৳700", "৳30"],
  ["labour", "&account=materials", "৳0", null],
  ["material", "&account=labour", "৳0", null],
  ["transport", "&account=other", "৳300", null],
  ["other", "&account=other", "৳400", null],
])(
  "shows only corrections attributable to %s %s",
  (section, extra, actual, correction) => {
    const { container } = render(
      <MemoryRouter
        initialEntries={[
          `/reports?mode=cost&section=${section}&work=work${extra}`,
        ]}
      >
        <AnalyticsPage ledger={correctionLedger} />
      </MemoryRouter>,
    );
    const total = container.querySelector(".report-total")!;
    expect(total.querySelector("strong")?.textContent).toBe(actual);
    expect(total.querySelector("p")?.textContent ?? null).toBe(
      correction ? `সমন্বয় · মোট খরচ: ${correction}` : null,
    );
  },
);

it.each([
  "group=cement",
  "item=crown",
  "brand=Crown",
  "usage=ছাদ",
  "type=material",
  "q=সিমেন্ট",
  "review=confirmed",
  "dates=known",
])(
  "does not allocate an account correction to the narrower %s bill subset",
  (filter) => {
    const { container } = render(
      <MemoryRouter
        initialEntries={[
          `/reports?mode=cost&section=material&work=work&${filter}`,
        ]}
      >
        <AnalyticsPage ledger={correctionLedger} />
      </MemoryRouter>,
    );
    const total = container.querySelector(".report-total")!;
    expect(total.querySelector("strong")?.textContent).toBe("৳200");
    expect(total.querySelector("p")).toBeNull();
  },
);
