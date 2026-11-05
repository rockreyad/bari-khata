// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { LedgerSchema } from "../../domain/model";
import { createWorkspaceStorage } from "../../data/repository";
import { PeoplePage } from "./PeoplePage";

const state = vi.hoisted(() => ({
  ledger: null as unknown,
  go: vi.fn(),
  entity: vi.fn(),
  save: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({ ...state, mode: "demo" }),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    language: "bn",
    t: (text: string, values: Record<string, string | number> = {}) =>
      text.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
        String(values[key] ?? ""),
      ),
    formatDigits: String,
    number: String,
    money: (value: number) => `৳${value / 100}`,
    date: String,
  }),
}));

const preferenceKey = "view:people-type-tabs:v1";
const legacyPreferenceKey = "view:people-role-tabs:v1";
const storage = createWorkspaceStorage("demo");
const types = [
  { id: "supplier", label: "দোকানদার", kind: "shop" },
  { id: "craftsperson", label: "মিস্ত্রি / কারিগর", kind: "worker" },
  { id: "labour", label: "শ্রমিক", kind: "worker" },
  { id: "contractor", label: "ঠিকাদার", kind: "worker" },
  { id: "professional", label: "ইঞ্জিনিয়ার / পরামর্শক", kind: "worker" },
  { id: "transport", label: "গাড়ি / পরিবহন", kind: "driver" },
  { id: "service", label: "অন্যান্য সেবা", kind: "worker" },
  { id: "custom", label: "ধরন বাছা হয়নি", kind: "other" },
];

function fixture() {
  return LedgerSchema.parse({
    works: [{ id: "work", name: "নমুনা খাতা" }],
    people: [
      ...types.map((type) => ({
        id: type.id,
        name:
          type.id === "craftsperson"
            ? "রহিম কারিগর"
            : type.id === "professional"
              ? "রহিম পরামর্শক"
              : `${type.label} নাম`,
        kind: type.kind,
        contactType: type.id,
        role:
          type.id === "professional"
            ? "উপ ঠিকাদার"
            : type.id === "custom"
              ? "গোপন পরিচয়"
              : "নিজের লেখা পরিচয়",
      })),
      {
        id: "second-craft",
        name: "আরেক কারিগর",
        kind: "worker",
        contactType: "craftsperson",
        role: "কারেন্টের মিস্ত্রি",
      },
      {
        id: "second-pro",
        name: "আরেক পরামর্শক",
        kind: "worker",
        contactType: "professional",
        role: "রাজমিস্ত্রি",
      },
      {
        id: "archived",
        name: "মুছে রাখা নাম",
        kind: "worker",
        contactType: "professional",
        role: "পুরোনো পরিচয়",
        archivedAt: "2026-11-04T00:00:00Z",
        removalHistory: [
          { id: "removed", at: "2026-11-04T00:00:00Z", archived: true },
        ],
      },
    ],
    entries: ["craftsperson", "professional"].map((personId) => ({
      id: `bill-${personId}`,
      kind: "expense",
      account: "labour",
      personId,
      lines: [
        {
          id: `line-${personId}`,
          workId: "work",
          label: "মজুরি",
          costType: "labour",
          amount: 100000,
        },
      ],
    })),
  });
}

beforeAll(() => {
  if (!window.PointerEvent)
    window.PointerEvent = MouseEvent as typeof PointerEvent;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
beforeEach(async () => {
  await storage.removeDraft(preferenceKey);
  await storage.removeDraft(legacyPreferenceKey);
  state.ledger = fixture();
  state.go.mockClear();
  state.entity.mockClear();
  state.save.mockClear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: () => true,
    })),
  );
});
afterEach(async () => {
  cleanup();
  await storage.removeDraft(preferenceKey);
  await storage.removeDraft(legacyPreferenceKey);
  vi.unstubAllGlobals();
});
function CurrentRoute() {
  const location = useLocation();
  return (
    <output data-testid="route">
      {location.pathname}
      {location.search}
    </output>
  );
}
function mount(path = "/parties") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PeoplePage />
      <CurrentRoute />
    </MemoryRouter>,
  );
}
const current = () =>
  new URL(
    screen.getByTestId("route").textContent ?? "/parties",
    "https://bari.invalid",
  );
const tabs = () => within(screen.getByRole("group", { name: "ধরন অনুযায়ী" }));
const names = () =>
  [...document.querySelectorAll(".contact-row-name > strong")].map(
    (name) => name.textContent,
  );
const ready = () =>
  waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "ট্যাব সাজাই" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );

it("shows stable relationship types rather than free descriptions and preserves legacy broad-kind links", async () => {
  const before = JSON.stringify(state.ledger);
  const view = mount("/parties?type=worker");
  await ready();
  for (const type of types)
    expect(tabs().getByRole("button", { name: type.label })).toBeTruthy();
  expect(tabs().getAllByRole("button")).toHaveLength(9);
  expect(tabs().queryByRole("button", { name: "উপ ঠিকাদার" })).toBeNull();
  expect(
    tabs().queryByRole("button", { name: "কারেন্টের মিস্ত্রি" }),
  ).toBeNull();
  expect(screen.getByText("ধরন: মিস্ত্রি")).toBeTruthy();
  expect(names()).toHaveLength(7);
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "ধরনের বাছাই মুছুন" }));
  expect(current().searchParams.has("type")).toBe(false);
  expect(names()).toHaveLength(10);
  view.unmount();
  mount();
  await ready();
  await userEvent
    .setup()
    .click(tabs().getByRole("button", { name: "ইঞ্জিনিয়ার / পরামর্শক" }));
  expect(current().searchParams.get("contactType")).toBe("professional");
  expect(names()).toEqual(
    expect.arrayContaining(["রহিম পরামর্শক", "আরেক পরামর্শক"]),
  );
  expect(names()).toHaveLength(2);
  expect(JSON.stringify(state.ledger)).toBe(before);
  expect(state.save).not.toHaveBeenCalled();
});

it("keeps the tab and its filter consistent for a legacy name-inferred shop without an explicit kind", async () => {
  state.ledger = LedgerSchema.parse({
    people: [
      {
        id: "legacy-shop",
        name: "মিতালী ট্রেডার্স",
        kind: null,
        role: "সিমেন্ট ও ইট",
      },
      { id: "unclassified", name: "পরিচিতজন", role: "নিজের কাজ" },
    ],
  });
  const before = JSON.stringify(state.ledger);
  mount();
  await ready();
  const user = userEvent.setup();
  expect(tabs().getByRole("button", { name: "দোকানদার" })).toBeTruthy();
  expect(tabs().queryByRole("button", { name: "সিমেন্ট ও ইট" })).toBeNull();
  await user.click(tabs().getByRole("button", { name: "দোকানদার" }));
  expect(names()).toEqual(["মিতালী ট্রেডার্স"]);
  expect(current().searchParams.get("contactType")).toBe("supplier");
  expect(JSON.stringify(state.ledger)).toBe(before);
  expect(state.save).not.toHaveBeenCalled();
});

it("combines a type with search and payable filters and clears a legacy description filter on selection", async () => {
  mount(
    `/parties?${new URLSearchParams({ type: "worker", role: "উপ ঠিকাদার", status: "due" })}`,
  );
  await ready();
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "নাম বা নম্বর খুঁজুন" }),
    "রহিম",
  );
  await user.click(tabs().getByRole("button", { name: "মিস্ত্রি / কারিগর" }));
  expect(names()).toEqual(["রহিম কারিগর"]);
  expect(Object.fromEntries(current().searchParams)).toEqual({
    status: "due",
    q: "রহিম",
    contactType: "craftsperson",
  });
  await user.click(
    tabs().getByRole("button", { name: "ইঞ্জিনিয়ার / পরামর্শক" }),
  );
  expect(names()).toEqual(["রহিম পরামর্শক"]);
  await user.click(tabs().getByRole("button", { name: "সবাই" }));
  expect(names()).toHaveLength(2);
  expect(Object.fromEntries(current().searchParams)).toEqual({
    status: "due",
    q: "রহিম",
  });
  expect(state.save).not.toHaveBeenCalled();
});

it("keeps old role-link filtering visible without converting its text into a type", async () => {
  mount(`/parties?${new URLSearchParams({ role: "  গোপন পরিচয়  " })}`);
  await ready();
  expect(tabs().queryByRole("button", { name: "গোপন পরিচয়" })).toBeNull();
  expect(names()).toEqual(["ধরন বাছা হয়নি নাম"]);
  expect(screen.getByText("পরিচয়: গোপন পরিচয়")).toBeTruthy();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "পরিচয়ের বাছাই মুছুন" }));
  expect(current().searchParams.has("role")).toBe(false);
  expect(names()).toHaveLength(10);
  expect(await storage.readDraft(preferenceKey)).toBeNull();
});

it("saves chosen type tabs and restores their stable ids from IndexedDB without changing the ledger", async () => {
  const before = JSON.stringify(state.ledger);
  const view = mount();
  await ready();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "ট্যাব সাজাই" }));
  const picker = within(screen.getByRole("dialog", { name: "ট্যাব সাজাই" }));
  expect(picker.getAllByRole("checkbox")).toHaveLength(8);
  expect(picker.getAllByRole("checkbox", { checked: true })).toHaveLength(8);
  expect(picker.queryByRole("checkbox", { name: "পুরোনো পরিচয়" })).toBeNull();
  for (const type of types.filter(
    (type) => !["supplier", "professional"].includes(type.id),
  )) {
    await user.click(picker.getByRole("checkbox", { name: type.label }));
  }
  await user.click(picker.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(tabs().getAllByRole("button")).toHaveLength(3);
  expect(await storage.readDraft(preferenceKey)).toEqual({
    version: 1,
    keys: ["supplier", "professional"],
  });
  view.unmount();
  mount();
  await ready();
  expect(
    tabs()
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(["সবাই", "দোকানদার", "ইঞ্জিনিয়ার / পরামর্শক"]);
  expect(JSON.stringify(state.ledger)).toBe(before);
  expect(state.save).not.toHaveBeenCalled();
});

it("cancels draft choices, searches type labels and never offers a new identity input", async () => {
  const before = JSON.stringify(state.ledger);
  mount();
  await ready();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "ট্যাব সাজাই" }));
  const picker = within(screen.getByRole("dialog", { name: "ট্যাব সাজাই" }));
  await user.click(picker.getByRole("checkbox", { name: "ঠিকাদার" }));
  const search = picker.getByRole("searchbox", { name: "ধরন খুঁজুন" });
  await user.type(search, "পরামর্শক");
  expect(picker.getAllByRole("checkbox")).toHaveLength(1);
  expect(
    picker.getByRole("checkbox", { name: "ইঞ্জিনিয়ার / পরামর্শক" }),
  ).toBeTruthy();
  expect(picker.queryAllByRole("textbox")).toHaveLength(0);
  await user.clear(search);
  await user.type(search, "একেবারে নতুন পরিচয়");
  expect(picker.queryAllByRole("checkbox")).toHaveLength(0);
  expect(picker.queryByRole("button", { name: /নতুন|যোগ/ })).toBeNull();
  await user.click(picker.getByRole("button", { name: "বাতিল" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(tabs().getAllByRole("button")).toHaveLength(9);
  expect(await storage.readDraft(preferenceKey)).toBeNull();
  expect(JSON.stringify(state.ledger)).toBe(before);
});

it("leaves old role-tab preferences untouched and makes a hidden selected type clearable", async () => {
  const old = { version: 1, keys: ["উপ ঠিকাদার"] };
  await storage.saveDraft(legacyPreferenceKey, old);
  await storage.saveDraft(preferenceKey, { version: 1, keys: ["supplier"] });
  mount("/parties?contactType=professional");
  await ready();
  expect(
    tabs().queryByRole("button", { name: "ইঞ্জিনিয়ার / পরামর্শক" }),
  ).toBeNull();
  expect(names()).toHaveLength(2);
  expect(screen.getByText("ধরন: ইঞ্জিনিয়ার / পরামর্শক")).toBeTruthy();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "ধরনের বাছাই মুছুন" }));
  expect(current().searchParams.has("contactType")).toBe(false);
  expect(names()).toHaveLength(10);
  expect(await storage.readDraft(legacyPreferenceKey)).toEqual(old);
});
