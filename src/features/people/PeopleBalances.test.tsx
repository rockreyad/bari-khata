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
    people: ["mixed", "extra", "credit", "plain", "settled", "empty"].map(
      (id) => ({ id, name: `Sample ${id}`, kind: "worker" }),
    ),
    contracts: [
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
    due: "বাকি ৳\u202f১০০",
    advance: "অগ্রিম ৳\u202f২৫",
    receivable: "ফেরত পাব ৳\u202f৩০",
  });
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
    due: "Due ৳\u202f100",
    advance: "Advance ৳\u202f25",
    receivable: "To recover ৳\u202f30",
  });
  expect(statuses("extra")).toEqual({ extra: "Overpaid ৳\u202f30" });
  expect(statuses("credit")).toEqual({ credit: "My credit ৳\u202f50" });
  await userEvent.click(row("mixed"));
  expect(state.go).toHaveBeenCalledExactlyOnceWith("/parties/mixed");
});

it("marks an unmatched old refund for review instead of claiming certain advance or receivable balances", () => {
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
    review: "যাচাই বাকি",
  });
});

it.each([
  { status: "due", names: ["mixed"] },
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
