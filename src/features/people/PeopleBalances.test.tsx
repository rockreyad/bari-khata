// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { LanguageProvider } from "../../context/LanguageProvider";
import { appendBalanceAdjustment } from "../../domain/balanceAdjustments";
import { LedgerSchema, type Account, type Ledger } from "../../domain/model";
import { savePreferences } from "../../lib/preferences";
import { PeoplePage } from "./PeoplePage";

const state = vi.hoisted(() => ({
  ledger: null as unknown,
  go: vi.fn(),
  entity: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    ...state,
    ledger: state.ledger as Ledger,
    mode: "demo",
  }),
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

function fixture() {
  const bill = (personId: string, amount: number, account: Account) => ({
    id: `${personId}-bill`,
    kind: "expense",
    personId,
    account,
    date: "2026-11-08",
    lines: [
      {
        id: `${personId}-line`,
        workId: "sample-work",
        label: "Sample bill",
        costType: account === "labour" ? "labour" : "material",
        amount,
      },
    ],
  });
  const payment = (
    id: string,
    personId: string,
    amount: number,
    account: Account,
    paymentContext: "advance" | "receivable" | "settlement",
    contractId?: string,
  ) => ({
    id,
    kind: "payment",
    personId,
    account,
    paymentContext,
    contractId,
    date: "2026-11-08",
    allocations: [{ workId: "sample-work", amount }],
    paymentParts: [{ amount }],
  });
  const ledger = LedgerSchema.parse({
    works: [{ id: "sample-work", name: "Sample notebook" }],
    people: [
      "mixed",
      "ongoing",
      "extra",
      "credit",
      "plain",
      "settled",
      "empty",
    ].map((id) => ({ id, name: `Sample ${id}`, kind: "worker" })),
    contracts: [
      {
        id: "ongoing-contract",
        personId: "ongoing",
        workId: "sample-work",
        total: 500000,
        status: "ongoing",
      },
      {
        id: "sample-contract",
        personId: "extra",
        workId: "sample-work",
        total: 10000,
        status: "ongoing",
      },
    ],
    entries: [
      bill("mixed", 10000, "materials"),
      payment("mixed-advance", "mixed", 2500, "labour", "advance"),
      payment("mixed-deposit", "mixed", 3000, "other", "receivable"),
      payment(
        "ongoing-payment",
        "ongoing",
        200000,
        "labour",
        "settlement",
        "ongoing-contract",
      ),
      payment(
        "extra-payment",
        "extra",
        13000,
        "labour",
        "settlement",
        "sample-contract",
      ),
      bill("credit", 10000, "labour"),
      payment("plain-payment", "plain", 7000, "labour", "settlement"),
      bill("settled", 9000, "labour"),
      payment("settled-payment", "settled", 9000, "labour", "settlement"),
    ],
  });
  return appendBalanceAdjustment(ledger, {
    target: "person",
    basis: "paid",
    personId: "credit",
    account: "labour",
    expectedBefore: 0,
    after: 15000,
    reason: "Sample total correction",
  });
}

function Location() {
  return <output data-testid="people-route">{useLocation().search}</output>;
}

function mount(path = "/parties", language: "bn" | "en" = "bn") {
  savePreferences({ language });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LanguageProvider>
        <PeoplePage />
        <Location />
      </LanguageProvider>
    </MemoryRouter>,
  );
}

function row(name: string) {
  return screen.getByRole("button", { name: new RegExp(`Sample ${name}`) });
}

function statuses(name: string) {
  return Object.fromEntries(
    [...row(name).querySelectorAll<HTMLElement>(".contact-balance-status")].map(
      (status) => [status.dataset.balanceKind, status.textContent],
    ),
  );
}

it("shows each positive balance without netting unrelated accounts or classifying ordinary payments as advances", () => {
  state.ledger = fixture();
  const before = structuredClone(state.ledger);
  mount();

  expect(statuses("mixed")).toEqual({
    due: "আরও দিতে হবে ৳\u202f১০০",
    advance: "অগ্রিম ৳\u202f২৫",
    receivable: "ফেরত পাব ৳\u202f৩০",
  });
  expect(statuses("ongoing")).toEqual({ due: "আরও দিতে হবে ৳\u202f৩,০০০" });
  expect(statuses("extra")).toEqual({ extra: "বেশি দিয়েছি ৳\u202f৩০" });
  expect(statuses("credit")).toEqual({ credit: "আমার জমা ৳\u202f৫০" });
  for (const name of ["plain", "settled", "empty"])
    expect(statuses(name)).toEqual({});
  expect(state.ledger).toEqual(before);
});

it("translates balance labels and money through the language provider while retaining person navigation", async () => {
  state.ledger = fixture();
  mount("/parties", "en");

  expect(statuses("mixed")).toEqual({
    due: "Still to pay ৳\u202f100",
    advance: "Advance ৳\u202f25",
    receivable: "To recover ৳\u202f30",
  });
  expect(statuses("ongoing")).toEqual({ due: "Still to pay ৳\u202f3,000" });
  expect(statuses("extra")).toEqual({ extra: "Overpaid ৳\u202f30" });
  expect(statuses("credit")).toEqual({ credit: "My credit ৳\u202f50" });
  await userEvent.click(row("mixed"));
  expect(state.go).toHaveBeenCalledExactlyOnceWith("/parties/mixed");
});

it("marks an unmatched old refund for review while retaining another account's known receivable", () => {
  const base = fixture();
  state.ledger = LedgerSchema.parse({
    ...base,
    entries: [
      ...base.entries,
      {
        id: "old-refund",
        kind: "refund",
        personId: "mixed",
        account: "labour",
        date: "2026-11-08",
        allocations: [{ workId: "sample-work", amount: 500 }],
        paymentParts: [{ amount: 500 }],
      },
    ],
  });
  mount();

  expect(statuses("mixed")).toEqual({
    due: "জানা বাকি ৳\u202f১০০",
    receivable: "ফেরত পাব ৳\u202f৩০",
    review: "যাচাই বাকি",
  });
});

it("keeps a settled shop return and a legacy payment without a bill free of invented balances or warnings", () => {
  state.ledger = LedgerSchema.parse({
    isDemo: true,
    works: [{ id: "sample-work", name: "Sample notebook" }],
    people: [
      { id: "return", name: "Sample return", kind: "shop" },
      { id: "legacy", name: "Sample legacy", kind: "worker" },
    ],
    entries: [
      {
        id: "sample-purchase",
        kind: "expense",
        personId: "return",
        account: "materials",
        lines: [{ id: "purchase-line", workId: "sample-work", amount: 10000 }],
      },
      {
        id: "sample-settlement",
        kind: "payment",
        personId: "return",
        account: "materials",
        paymentContext: "settlement",
        allocations: [{ workId: "sample-work", amount: 10000 }],
        paymentParts: [{ amount: 10000 }],
      },
      {
        id: "sample-return",
        kind: "expense_credit",
        personId: "return",
        account: "materials",
        relatedEntryId: "sample-purchase",
        lines: [{ id: "return-line", workId: "sample-work", amount: 3000 }],
      },
      {
        id: "sample-refund",
        kind: "refund",
        personId: "return",
        account: "materials",
        allocations: [{ workId: "sample-work", amount: 3000 }],
        paymentParts: [{ amount: 3000 }],
      },
      {
        id: "sample-legacy-payment",
        kind: "payment",
        personId: "legacy",
        account: "labour",
        allocations: [{ workId: "sample-work", amount: 16200 }],
        paymentParts: [{ amount: 16200 }],
      },
    ],
  });
  const before = structuredClone(state.ledger);
  mount();

  expect(statuses("return")).toEqual({});
  expect(statuses("legacy")).toEqual({});
  expect(row("return").querySelector(".contact-paid-amount")?.textContent).toBe(
    "৳\u202f৭০",
  );
  expect(row("legacy").querySelector(".contact-paid-amount")?.textContent).toBe(
    "৳\u202f১৬২",
  );
  expect(state.ledger).toEqual(before);
});

it.each([
  { language: "bn", refunded: 3000, credit: null },
  { language: "bn", refunded: 1000, credit: "আমার জমা ৳\u202f২০" },
  { language: "en", refunded: 3000, credit: null },
  { language: "en", refunded: 1000, credit: "My credit ৳\u202f20" },
] as const)(
  "separates bill-detail review from the known balance in $language after refunding $refunded",
  ({ language, refunded, credit }) => {
    state.ledger = LedgerSchema.parse({
      isDemo: true,
      works: [{ id: "sample-work", name: "Sample notebook" }],
      people: [{ id: "records", name: "Sample records", kind: "shop" }],
      entries: [
        ...[
          { id: "sample-bill", kind: "expense", amount: 10000 },
          { id: "sample-return", kind: "expense_credit", amount: 3000 },
        ].map(({ id, kind, amount }) => ({
          id,
          kind,
          personId: "records",
          account: "materials",
          reviewStatus: "needs_review",
          reviewReason: "",
          relatedEntryId: kind === "expense_credit" ? "sample-bill" : null,
          lines: [
            {
              id: `${id}-line`,
              workId: "sample-work",
              costType: "material",
              materialGroupId: null,
              amount,
            },
          ],
        })),
        {
          id: "sample-paid",
          kind: "payment",
          personId: "records",
          account: "materials",
          paymentContext: "settlement",
          allocations: [{ workId: "sample-work", amount: 10000 }],
          paymentParts: [{ amount: 10000 }],
        },
        {
          id: "sample-refund",
          kind: "refund",
          personId: "records",
          account: "materials",
          allocations: [{ workId: "sample-work", amount: refunded }],
          paymentParts: [{ amount: refunded }],
        },
      ],
    });
    const before = structuredClone(state.ledger);
    mount("/parties", language);

    expect(statuses("records")).toEqual({
      ...(credit ? { credit } : {}),
      "record-review":
        language === "bn" ? "বিলের তথ্য যাচাই বাকি" : "Bill details to check",
    });
    const marker = row("records").querySelector<HTMLElement>(
      '[data-balance-kind="record-review"]',
    )!;
    const description =
      language === "bn"
        ? "কিছু বিল বা মালের ফেরতের তথ্য যাচাই বাকি। এর মানে টাকা বকেয়া আছে, এমন নয়।"
        : "Some bill or material return details still need checking. This does not mean money is owed.";
    expect(marker.title).toBe(description);
    expect(
      document.getElementById(marker.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe(description);
    expect(state.ledger).toEqual(before);
  },
);

it.each([
  { status: "due", names: ["mixed", "ongoing"] },
  { status: "advance", names: ["credit", "extra", "mixed"] },
  { status: "receivable", names: ["mixed"] },
])(
  "keeps the $status filter consistent with the visible balance states",
  ({ status, names }) => {
    state.ledger = fixture();
    const { container } = mount(`/parties?status=${status}`);
    expect(
      [...container.querySelectorAll(".contact-row-name > strong")]
        .map((name) => name.textContent?.replace("Sample ", ""))
        .sort(),
    ).toEqual(names);
  },
);

it("selects the refundable balance filter from the menu without losing a search", async () => {
  state.ledger = fixture();
  mount("/parties?q=Sample&keep=yes");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "বাছাই" }));
  await user.click(screen.getByRole("menuitem", { name: "ফেরত পাব" }));

  const params = new URLSearchParams(
    screen.getByTestId("people-route").textContent ?? "",
  );
  expect(params.get("status")).toBe("receivable");
  expect(params.get("q")).toBe("Sample");
  expect(params.get("keep")).toBe("yes");
  expect(row("mixed")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Sample plain/ })).toBeNull();
});
