// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { LedgerSchema } from "../../domain/model";
import { AnalyticsPage } from "./AnalyticsPage";

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
      work: "work",
      person: "person",
      from: "2026-11-01",
      to: "2026-11-03",
      account,
    });
    expect(container.querySelector(".report-total > strong")?.textContent).toBe(
      amount,
    );
    expect(container.querySelectorAll(".history-payment")).toHaveLength(1);
  },
);

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
    expect(container.querySelectorAll(".history-payment")).toHaveLength(3);
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
  expect(container.querySelectorAll(".history-payment")).toHaveLength(1);
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
