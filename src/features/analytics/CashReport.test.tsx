// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { LanguageProvider } from "../../context/LanguageProvider";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { mixedLedger } from "../../domain/testing/mixedNumericLedger";
import { savePreferences } from "../../lib/preferences";
import { CashReport } from "./CashReport";

afterEach(() => {
  cleanup();
  localStorage.clear();
});
it("keeps cash rows actual and shows a paid-total correction separately", () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "work", name: "পরীক্ষার খাতা" }],
    entries: [
      {
        id: "paid",
        kind: "payment",
        date: "2026-11-03",
        allocations: [{ workId: "work", amount: 10000 }],
        paymentParts: [{ method: "cash", amount: 10000 }],
      },
      {
        id: "adjust",
        kind: "adjustment",
        personId: null,
        account: "other",
        date: "2026-11-03",
        note: "অঙ্ক মিলিয়েছি",
        adjustment: {
          target: "work",
          basis: "paid",
          account: null,
          before: 10000,
          after: 15000,
          delta: 5000,
          workId: "work",
        },
      },
    ],
  });
  const { container } = mount(ledger, "en");
  expect(container.querySelector(".report-total > strong")?.textContent).toBe(
    "৳\u202f100",
  );
  expect(container.querySelector(".report-total")?.textContent).toContain(
    "Adjustment",
  );
  expect(container.querySelector(".report-total")?.textContent).toContain(
    "৳\u202f50",
  );
  expect(container.querySelector(".history-adjustment")).toBeNull();
});
function CurrentRoute() {
  const location = useLocation();
  return <output data-testid="route">{location.search}</output>;
}
function mount(
  ledger: Ledger,
  language: "bn" | "en" = "bn",
  path = "/reports",
  onEntry = vi.fn(),
) {
  savePreferences({ language });
  return {
    onEntry,
    ...render(
      <MemoryRouter initialEntries={[path]}>
        <LanguageProvider>
          <CashReport ledger={ledger} onEntry={onEntry} />
          <CurrentRoute />
        </LanguageProvider>
      </MemoryRouter>,
    ),
  };
}
function screenshotLedger() {
  return LedgerSchema.parse({
    works: [{ id: "general", name: "সাধারণ খরচ" }],
    people: [{ id: "golam", name: "Golam", kind: "worker" }],
    entries: [
      {
        id: "che-bill",
        kind: "expense",
        date: "2026-11-02",
        lines: [
          { id: "che-line", workId: "general", label: "che", amount: 100 },
        ],
      },
      {
        id: "che-cash",
        kind: "payment",
        relatedEntryId: "che-bill",
        date: "2026-11-02",
        allocations: [{ workId: "general", amount: 100 }],
        paymentParts: [{ method: "cash", amount: 100 }],
      },
      {
        id: "golam-cash",
        kind: "payment",
        account: "labour",
        personId: "golam",
        date: "2026-11-01",
        allocations: [{ workId: "general", amount: 16200 }],
        paymentParts: [{ method: "bkash", amount: 16200 }],
      },
    ],
  });
}
const copy = {
  bn: {
    heading: "টাকা কোথায় দিলাম",
    total: "৳\u202f১৬৩",
    one: "৳\u202f১",
    payment: "৳\u202f১৬২",
    split: "৳\u202f১,৫০০",
    refund: "৳\u202f-১,০০০",
  },
  en: {
    heading: "Where I paid",
    total: "৳\u202f163",
    one: "৳\u202f1",
    payment: "৳\u202f162",
    split: "৳\u202f1,500",
    refund: "৳\u202f-1,000",
  },
};

describe.each(["bn", "en"] as const)("cash report in %s", (language) => {
  it("shows the one-taka paid purchase and standalone 162-taka payment as 163, counting its bill only once", () => {
    const ledger = screenshotLedger();
    const before = JSON.stringify(ledger);
    const { container } = mount(ledger, language);
    expect(
      screen.getByRole("heading", { name: copy[language].heading }),
    ).toBeTruthy();
    expect(container.querySelector(".report-total strong")?.textContent).toBe(
      copy[language].total,
    );
    expect(
      container.querySelector(".report-breakdown-list button > strong")
        ?.textContent,
    ).toBe(copy[language].total);
    expect(container.querySelector(".report-history")).toBeNull();
    expect(container.querySelector(".history-expense")).toBeNull();
    expect(container.querySelector(".history-load-more")).toBeNull();
    expect(JSON.stringify(ledger)).toBe(before);
  });

  it("displays only the selected work allocation in its breakdown", () => {
    const { container, onEntry } = mount(
      mixedLedger("Bengali"),
      language,
      "/reports?work=roof&person=shop",
    );
    expect(container.querySelector(".report-total strong")?.textContent).toBe(
      copy[language].split,
    );
    expect(
      container.querySelector(".report-breakdown-list button > strong")
        ?.textContent,
    ).toBe(copy[language].split);
    expect(
      container.querySelectorAll(".report-breakdown-list button"),
    ).toHaveLength(1);
    expect(container.querySelector(".report-history")).toBeNull();
    expect(onEntry).not.toHaveBeenCalled();
  });

  it("subtracts a received refund once in its signed work breakdown", () => {
    const { container } = mount(
      mixedLedger("English"),
      language,
      "/reports?person=return-shop&from=2026-10-06&to=2026-10-06",
    );
    expect(container.querySelector(".report-total strong")?.textContent).toBe(
      copy[language].refund,
    );
    expect(
      container.querySelector(".report-breakdown-list button > strong")
        ?.textContent,
    ).toBe(copy[language].refund);
    expect(container.querySelector(".report-history")).toBeNull();
    expect(container.querySelector(".report-total p")?.textContent).toContain(
      language === "bn" ? "৳\u202f১,০০০" : "৳\u202f1,000",
    );
  });
});

it("drills into an unnamed contact without dropping its payment", () => {
  const { container } = mount(screenshotLedger(), "bn", "/reports?by=person");
  fireEvent.click(screen.getByRole("button", { name: /নাম দেওয়া নেই/ }));
  expect(container.querySelector(".report-total strong")?.textContent).toBe(
    "৳\u202f১",
  );
  expect(
    container.querySelectorAll(".report-breakdown-list button"),
  ).toHaveLength(1);
  expect(
    new URLSearchParams(screen.getByTestId("route").textContent ?? "").get(
      "person",
    ),
  ).toBe("__anonymous__");
});

it("loads extra breakdown groups without repeating the ledger's transaction list", () => {
  const ledger = LedgerSchema.parse({
    works: Array.from({ length: 31 }, (_, i) => ({
      id: `work-${i}`,
      name: `কাজ ${i + 1}`,
    })),
    people: [{ id: "shop", name: "দোকান", kind: "shop" }],
    entries: Array.from({ length: 31 }, (_, i) => ({
      id: `payment-${i}`,
      kind: "payment",
      date: "2026-11-02",
      personId: "shop",
      allocations: [{ workId: `work-${i}`, amount: 100 }],
      paymentParts: [{ method: "cash", amount: 100 }],
    })),
  });
  const { container } = mount(ledger);
  expect(
    container.querySelectorAll(".report-breakdown-list button"),
  ).toHaveLength(30);
  expect(container.querySelector(".report-history")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "আরও দেখুন" }));
  expect(
    container.querySelectorAll(".report-breakdown-list button"),
  ).toHaveLength(31);
  expect(container.querySelector(".report-history")).toBeNull();
  expect(screen.queryByRole("button", { name: "আরও দেখুন" })).toBeNull();
  expect(screen.queryByRole("button", { name: "আরও হিসাব দেখুন" })).toBeNull();
  expect(container.querySelector(".history-load-more")).toBeNull();
});

it("preserves work, contact and dates when opening bill details and translates the cash account into a cost section", () => {
  mount(
    mixedLedger("English"),
    "bn",
    "/reports?work=roof&person=shop&account=materials&from=2026-09-01&to=2026-10-31&q=anything&page=4&by=person",
  );
  fireEvent.click(screen.getByRole("button", { name: "মাল ও কাজের দাম দেখি" }));
  const params = new URLSearchParams(
    screen.getByTestId("route").textContent ?? "",
  );
  expect(Object.fromEntries(params)).toEqual({
    mode: "cost",
    work: "roof",
    person: "shop",
    from: "2026-09-01",
    to: "2026-10-31",
    section: "material",
  });
});

it("preserves scoped amounts for old entry IDs that overlap object property names", () => {
  const ledger = LedgerSchema.parse({
    works: [
      { id: "roof", name: "ছাদ" },
      { id: "door", name: "দরজা" },
    ],
    entries: [
      {
        id: "__proto__",
        kind: "payment",
        allocations: [
          { workId: "roof", amount: 16200 },
          { workId: "door", amount: 100 },
        ],
        paymentParts: [{ amount: 16300 }],
      },
    ],
  });
  const { container } = mount(ledger, "bn", "/reports?work=roof");
  expect(container.querySelector(".report-total strong")?.textContent).toBe(
    "৳\u202f১৬২",
  );
  expect(
    container.querySelector(".report-breakdown-list button > strong")
      ?.textContent,
  ).toBe("৳\u202f১৬২");
});

it("preserves the whole other account when opening price details so driver transport bills are included", () => {
  mount(screenshotLedger(), "bn", "/reports?account=other");
  fireEvent.click(screen.getByRole("button", { name: "মাল ও কাজের দাম দেখি" }));
  const params = new URLSearchParams(
    screen.getByTestId("route").textContent ?? "",
  );
  expect(Object.fromEntries(params)).toEqual({
    mode: "cost",
    account: "other",
    section: "all",
  });
});
