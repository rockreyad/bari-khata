// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { LanguageProvider } from "../../context/LanguageProvider";
import { appendBalanceAdjustment } from "../../domain/balanceAdjustments";
import { reconciledTotals } from "../../domain/adjustmentMath";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { latinDigits } from "../../lib/numerals";
import { savePreferences } from "../../lib/preferences";
import { PeoplePage } from "./PeoplePage";
import { PersonPage } from "./PersonPage";

const state = vi.hoisted(() => ({
  ledger: null as unknown,
  add: vi.fn(),
  entity: vi.fn(),
  go: vi.fn(),
  detail: vi.fn(),
  save: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("../../app/NotebookProvider", async () => {
  const { useNavigate } = await import("react-router");
  return {
    useNotebook: () => {
      const navigate = useNavigate();
      return {
        ledger: state.ledger as Ledger,
        add: state.add,
        entity: state.entity,
        detail: state.detail,
        save: state.save,
        notify: state.notify,
        go: (path: string) => {
          state.go(path);
          navigate(path);
        },
        base: "",
        mode: "demo",
      };
    },
  };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

type Correction = "none" | "net-zero" | "paid-total";

function fixture(correction: Correction = "none") {
  let ledger = LedgerSchema.parse({
    works: [
      { id: "ongoing-work", name: "নমুনা চলমান খাতা" },
      { id: "done-a-work", name: "নমুনা শেষ খাতা এক" },
      { id: "done-b-work", name: "নমুনা শেষ খাতা দুই" },
    ],
    people: [
      {
        id: "worker",
        name: "নমুনা কর্মী",
        kind: "worker",
        contactType: "craftsperson",
        roles: ["craftsperson"],
        workIds: ["ongoing-work", "done-a-work", "done-b-work"],
      },
    ],
    contracts: [
      {
        id: "ongoing",
        personId: "worker",
        workId: "ongoing-work",
        title: "নমুনা চলমান কাজ",
        status: "ongoing",
        total: 60000000,
      },
      {
        id: "done-a",
        personId: "worker",
        workId: "done-a-work",
        title: "নমুনা শেষ কাজ এক",
        status: "done",
        total: 600000,
      },
      {
        id: "done-b",
        personId: "worker",
        workId: "done-b-work",
        title: "নমুনা শেষ কাজ দুই",
        status: "done",
        total: 140000,
      },
    ],
    entries: [
      {
        id: "ongoing-cash",
        kind: "payment",
        personId: "worker",
        account: "labour",
        contractId: "ongoing",
        paymentContext: "settlement",
        date: "2026-11-01",
        allocations: [{ workId: "ongoing-work", amount: 54150000 }],
        paymentParts: [{ amount: 54150000 }],
      },
      {
        id: "done-a-cash",
        kind: "payment",
        personId: "worker",
        account: "labour",
        contractId: "done-a",
        paymentContext: "settlement",
        date: "2026-11-01",
        allocations: [{ workId: "done-a-work", amount: 300000 }],
        paymentParts: [{ amount: 300000 }],
      },
    ],
  });
  const adjust = (expectedBefore: number, after: number, at: string) => {
    ledger = appendBalanceAdjustment(
      ledger,
      {
        target: "person",
        basis: "paid",
        personId: "worker",
        account: "labour",
        expectedBefore,
        after,
        reason: "নমুনা দেওয়া টাকার মোট মিলিয়েছি",
        date: "2026-11-02",
      },
      at,
    );
  };
  if (correction === "net-zero") {
    adjust(54450000, 54450100, "2026-11-02T03:00:00Z");
    adjust(54450100, 54450000, "2026-11-02T04:00:00Z");
  } else if (correction === "paid-total") {
    adjust(54450000, 59100200, "2026-11-02T03:00:00Z");
  }
  return ledger;
}

function mount(ledger: Ledger, path: string) {
  state.ledger = ledger;
  savePreferences({ language: "bn" });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LanguageProvider>
        <Routes>
          <Route path="/parties" element={<PeoplePage />} />
          <Route path="/parties/:personId" element={<PersonPage />} />
        </Routes>
      </LanguageProvider>
    </MemoryRouter>,
  );
}

function amount(element: Element | null) {
  expect(element).not.toBeNull();
  const text = latinDigits(element!.textContent ?? "");
  expect(text).toMatch(/\d/);
  return Number(text.replace(/\u2212/g, "-").replace(/[^\d.-]/g, ""));
}

function assertCards(container: HTMLElement) {
  const expected = [
    ["নমুনা চলমান কাজ", 58500, 541500],
    ["নমুনা শেষ কাজ এক", 3000, 3000],
    ["নমুনা শেষ কাজ দুই", 1400, 0],
  ] as const;
  const cards = [...container.querySelectorAll(".job-snap-card")];
  expect(cards).toHaveLength(expected.length);
  for (const [title, remaining, paid] of expected) {
    const card = cards.find(
      (entry) => entry.querySelector(".job-tile-name")?.textContent === title,
    );
    expect(card).toBeDefined();
    expect(amount(card!.querySelector(".job-tile-balance strong"))).toBe(
      remaining,
    );
    expect(amount(card!.querySelector(".job-tile-paid strong"))).toBe(paid);
  }
}

describe("worker remaining promises from list to profile", () => {
  it.each([
    { correction: "none", remaining: 62900, paid: 544500, effect: 0 },
    { correction: "net-zero", remaining: 62900, paid: 544500, effect: 0 },
    {
      correction: "paid-total",
      remaining: 16398,
      paid: 591002,
      effect: -46502,
    },
  ] as const)(
    "keeps source job balances and the $correction total without inventing earned costs",
    ({ correction, remaining, paid, effect }) => {
      const ledger = fixture(correction);
      const source = structuredClone(ledger);
      const view = mount(ledger, "/parties");
      const row = screen.getByRole("button", { name: /নমুনা কর্মী/ });
      expect(amount(row.querySelector('[data-balance-kind="due"]'))).toBe(
        remaining,
      );
      expect(amount(row.querySelector(".contact-paid-amount"))).toBe(paid);

      fireEvent.click(row);
      expect(state.go).toHaveBeenCalledWith("/parties/worker");
      const summary = screen.getByRole("region", {
        name: "এই নামের মোট হিসাব",
      });
      expect(within(summary).getByText("আর দিতে হবে")).toBeTruthy();
      expect(
        amount(summary.querySelector(".contact-remaining-hero strong")),
      ).toBe(remaining);
      expect(
        amount(summary.querySelector(".contact-summary-hero strong")),
      ).toBe(paid);
      assertCards(view.container);
      if (effect) {
        expect(within(summary).getByText("মোটের সংশোধন")).toBeTruthy();
        expect(
          amount(summary.querySelector(".contact-total-correction dd")),
        ).toBe(effect);
      } else {
        expect(within(summary).queryByText("মোটের সংশোধন")).toBeNull();
      }
      expect(within(summary).queryByText("বেশি দিয়েছি")).toBeNull();
      expect(within(summary).queryByText("অগ্রিম দিয়েছি")).toBeNull();
      expect(reconciledTotals(ledger)).toMatchObject({
        actualCost: 0,
        reconciledCost: 740000,
        actualPaid: 54450000,
        reconciledNetPaid: paid * 100,
      });
      expect(ledger).toEqual(source);
      expect(state.save).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["ongoing-work", "নমুনা চলমান কাজ", 58500, 541500],
    ["done-a-work", "নমুনা শেষ কাজ এক", 3000, 3000],
    ["done-b-work", "নমুনা শেষ কাজ দুই", 1400, 0],
  ] as const)(
    "keeps %s scoped to its own promise without distributing a whole-person correction",
    (workId, title, remaining, paid) => {
      const ledger = fixture("paid-total");
      const source = structuredClone(ledger);
      const view = mount(ledger, `/parties/worker?work=${workId}`);
      const summary = screen.getByRole("region", {
        name: "এই নামের মোট হিসাব",
      });
      expect(
        amount(summary.querySelector(".contact-remaining-hero strong")),
      ).toBe(remaining);
      expect(
        amount(summary.querySelector(".contact-summary-hero strong")),
      ).toBe(paid);
      const cards = view.container.querySelectorAll(".job-snap-card");
      expect(cards).toHaveLength(1);
      expect(cards[0].querySelector(".job-tile-name")?.textContent).toBe(title);
      expect(amount(cards[0].querySelector(".job-tile-balance strong"))).toBe(
        remaining,
      );
      expect(within(summary).queryByText("মোটের সংশোধন")).toBeNull();
      expect(within(summary).queryByText("বেশি দিয়েছি")).toBeNull();
      expect(ledger).toEqual(source);
      expect(state.save).not.toHaveBeenCalled();
    },
  );
});
