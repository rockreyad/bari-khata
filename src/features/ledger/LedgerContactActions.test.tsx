// @vitest-environment jsdom
import "fake-indexeddb/auto";
import type { SelectHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { LedgerSchema, type Ledger, type Person } from "../../domain/model";
import { PersonPage } from "../people/PersonPage";
import { LedgerPage } from "./LedgerPage";

const state = vi.hoisted(() => ({
  ledger: null as unknown,
  go: vi.fn(),
  add: vi.fn(),
  base: "",
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    ledger: state.ledger as Ledger,
    mode: "demo",
    go: state.go,
    add: state.add,
    entity: vi.fn(),
    detail: vi.fn(),
    notify: vi.fn(),
    base: state.base,
  }),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    language: "bn",
    formatDigits: String,
    t: (text: string) => text,
    money: (value: number) => `৳${value / 100}`,
    number: String,
    date: (value: string | null) => value ?? "—",
  }),
}));
vi.mock("../../components/ui/AppSelect", () => ({
  AppSelect: (props: SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props} />
  ),
}));

afterEach(() => {
  cleanup();
  state.go.mockClear();
  state.add.mockClear();
  state.base = "";
});

function fixture(person: Partial<Person> = {}) {
  return LedgerSchema.parse({
    works: [
      { id: "work", name: "নমুনা কাজ" },
      { id: "other-work", name: "নমুনা অন্য কাজ" },
    ],
    people: [
      { id: "person", name: "নমুনা নাম", kind: "worker", ...person },
      { id: "other-person", name: "নমুনা অন্য নাম", kind: "worker" },
    ],
    contracts: [
      ...((person.kind ?? "worker") === "worker"
        ? [{ id: "contract", personId: "person", workId: "work", total: 10000 }]
        : []),
      {
        id: "other-contract",
        personId: "other-person",
        workId: "work",
        total: 10000,
      },
    ],
  });
}

function open(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/ledger" element={<LedgerPage />} />
        <Route path="/parties/:personId" element={<PersonPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const pages = [
  {
    name: "profile",
    path: "/parties/person",
    scope: ".contact-main-actions",
  },
  {
    name: "person-filtered history",
    path: "/ledger?person=person",
    scope: ".page-heading",
  },
];

describe.each(pages)("$name primary action", ({ path, scope }) => {
  const scopedPath = (query: string) =>
    `${path}${path.includes("?") ? "&" : "?"}${query}`;

  function primary(container: HTMLElement, label: string) {
    const buttons = container.querySelectorAll(`${scope} .primary-button`);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe(label);
    return buttons[0];
  }

  it.each([
    { kind: "worker" as const, account: "labour" },
    { kind: "driver" as const, account: "other" },
  ])("opens a payment-only form for a $kind", ({ kind, account }) => {
    state.ledger = fixture({ kind });
    const before = structuredClone(state.ledger);
    state.base = "/demo";
    const location = scopedPath(
      "work=work&account=materials&contract=contract&q=নমুনা&kind=expense&month=2026-11&order=oldest",
    );
    const { container } = open(location);
    fireEvent.click(primary(container, "টাকা দিই"));
    expect(state.add).not.toHaveBeenCalled();
    expect(state.go).toHaveBeenCalledTimes(1);
    const url = new URL(state.go.mock.calls[0][0], "https://bari.invalid");
    expect(url.pathname).toBe("/write/payment");
    const back = new URL(location, "https://bari.invalid");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      person: "person",
      account,
      work: "work",
      ...(kind === "worker" ? { contract: "contract" } : {}),
      purpose: "payment",
      back: `/demo${back.pathname}?${back.searchParams}`,
    });
    expect(state.ledger).toEqual(before);
  });

  it("keeps purchase primary for a shop even when saved actions are reordered", () => {
    state.ledger = fixture({
      kind: "shop",
      quickActions: ["return", "payment", "purchase"],
    });
    const { container } = open(scopedPath("work=work"));
    fireEvent.click(primary(container, "মাল কিনলাম"));
    expect(state.go).not.toHaveBeenCalled();
    expect(state.add).toHaveBeenCalledExactlyOnceWith({
      kind: "expense",
      personId: "person",
      workId: "work",
      account: "materials",
      costType: "material",
    });
  });

  it.each([
    {
      kind: "shop" as const,
      quickActions: ["return", "payment"] as Person["quickActions"],
      label: "টাকা দিই",
    },
    {
      kind: "driver" as const,
      quickActions: ["transport"] as Person["quickActions"],
      label: "আনার খরচ লিখি",
    },
    {
      kind: "shop" as const,
      quickActions: ["return"] as Person["quickActions"],
      label: "মাল ফেরত দিই",
    },
    {
      kind: "other" as const,
      roles: ["custom"] as Person["roles"],
      quickActions: [
        "return",
        "transport",
        "purchase",
      ] as Person["quickActions"],
      label: "মাল কিনলাম",
    },
  ])("promotes enabled $label when the usual action is hidden", (person) => {
    state.ledger = fixture(person);
    const { container } = open(scopedPath("work=work&account=other"));
    fireEvent.click(primary(container, person.label));
    if (person.quickActions?.includes("payment")) {
      const url = new URL(state.go.mock.calls[0][0], "https://bari.invalid");
      expect(url.pathname).toBe("/write");
      expect(url.searchParams.get("purpose")).toBe("party-payment");
      expect(url.searchParams.get("person")).toBe("person");
      expect(url.searchParams.get("work")).toBe("work");
      expect(url.searchParams.get("account")).toBe("materials");
      expect(url.searchParams.get("dueWork")).toBe("work");
      expect(url.searchParams.get("dueAccount")).toBe("other");
      expect(state.add).not.toHaveBeenCalled();
    } else {
      const purchase = person.label === "মাল কিনলাম";
      const transport = person.label === "আনার খরচ লিখি";
      expect(state.add).toHaveBeenCalledExactlyOnceWith({
        personId: "person",
        workId: "work",
        kind: purchase || transport ? "expense" : "return",
        account: transport ? "other" : "materials",
        ...(purchase || transport
          ? { costType: transport ? "transport" : "material" }
          : {}),
      });
      expect(state.go).not.toHaveBeenCalled();
    }
  });

  it("keeps payment primary for mixed roles despite the saved action order", () => {
    state.ledger = fixture({
      kind: "worker",
      roles: ["craftsperson", "supplier", "transport"],
      quickActions: ["return", "transport", "purchase", "payment"],
    });
    const { container } = open(path);
    primary(container, "টাকা দিই");
  });

  it.each([
    { quickActions: [] },
    {
      archivedAt: "2026-10-01T00:00:00.000Z",
      removalHistory: [
        { id: "archive", at: "2026-10-01T00:00:00.000Z", archived: true },
      ],
    },
  ])("does not promote a disabled or archived contact action", (person) => {
    state.ledger = fixture(person);
    const { container } = open(path);
    expect(container.querySelectorAll(`${scope} .primary-button`)).toHaveLength(
      0,
    );
    expect(state.add).not.toHaveBeenCalled();
    expect(state.go).not.toHaveBeenCalled();
  });

  it.each([
    "work=other-work&contract=contract",
    "work=work&contract=other-contract",
  ])("does not carry an incompatible contract (%s)", (query) => {
    state.ledger = fixture();
    const { container } = open(scopedPath(query));
    fireEvent.click(primary(container, "টাকা দিই"));
    const url = new URL(state.go.mock.calls[0][0], "https://bari.invalid");
    expect(url.pathname).toBe("/write/payment");
    expect(url.searchParams.has("contract")).toBe(false);
    expect(url.searchParams.get("work")).toBe(
      new URLSearchParams(query).get("work"),
    );
  });
});

it("keeps the generic history action and hides it for a missing contact", () => {
  state.ledger = fixture();
  const generic = open("/ledger?work=work");
  const button = generic.container.querySelector(
    ".page-heading .primary-button",
  );
  expect(button?.textContent).toBe("খরচ লিখি");
  fireEvent.click(button!);
  expect(state.add).toHaveBeenCalledExactlyOnceWith();
  generic.unmount();
  const missing = open("/ledger?person=missing");
  expect(
    missing.container.querySelector(".page-heading .primary-button"),
  ).toBeNull();
});
