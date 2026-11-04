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

const preferenceKey = "view:people-role-tabs:v1";
const storage = createWorkspaceStorage("demo");
const roles = [
  "রাজমিস্ত্রি",
  "ইঞ্জিনিয়ার",
  "ডিলার",
  "রংমিস্ত্রি",
  "গাড়িচালক",
  "ঠিকাদার",
  "সহকারী",
];

function fixture() {
  const people = roles.flatMap((role, index) =>
    Array.from({ length: 7 - index }, (_, personIndex) => ({
      id: `person-${index}-${personIndex}`,
      name:
        personIndex === 0 && index < 2
          ? `রহিম ${role}`
          : `${role} নাম ${personIndex + 1}`,
      kind:
        index === 2
          ? "shop"
          : index === 4
            ? "driver"
            : index === 6
              ? "other"
              : "worker",
      role: index === 1 && personIndex === 1 ? "  ইঞ্জিনিয়ার   " : role,
    })),
  );
  return LedgerSchema.parse({
    works: [{ id: "work", name: "নমুনা খাতা" }],
    people: [
      ...people,
      { id: "blank", name: "পরিচয় ছাড়া নাম", kind: "worker", role: "" },
      {
        id: "archived",
        name: "মুছে রাখা নাম",
        kind: "worker",
        role: "পুরোনো পরিচয়",
        archivedAt: "2026-11-04T00:00:00Z",
        removalHistory: [
          { id: "removed", at: "2026-11-04T00:00:00Z", archived: true },
        ],
      },
    ],
    entries: [0, 1].map((index) => ({
      id: `bill-${index}`,
      kind: "expense",
      account: "labour",
      personId: `person-${index}-0`,
      lines: [
        {
          id: `line-${index}`,
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
function mount(path = "/people") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PeoplePage />
      <CurrentRoute />
    </MemoryRouter>,
  );
}
const current = () =>
  new URL(
    screen.getByTestId("route").textContent ?? "/people",
    "https://bari.invalid",
  );
const tabs = () => within(screen.getByRole("group", { name: "পরিচয় অনুযায়ী" }));
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

it("uses existing exact roles instead of broad worker kinds and keeps legacy type filtering visible and clearable", async () => {
  const before = JSON.stringify(state.ledger);
  let view = mount("/people?type=worker");
  await ready();
  for (const role of roles.slice(0, 6))
    expect(tabs().getByRole("button", { name: role })).toBeTruthy();
  expect(tabs().getAllByRole("button")).toHaveLength(7);
  expect(tabs().queryByRole("button", { name: "মিস্ত্রি" })).toBeNull();
  expect(tabs().queryByRole("button", { name: "সহকারী" })).toBeNull();
  expect(screen.getByText("ধরন: মিস্ত্রি")).toBeTruthy();
  expect(names()).toHaveLength(20);
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "ধরনের বাছাই মুছুন" }));
  expect(current().searchParams.has("type")).toBe(false);
  expect(names()).toHaveLength(29);
  view.unmount();
  view = mount("/people?type=worker");
  await ready();
  const user = userEvent.setup();
  await user.click(tabs().getByRole("button", { name: "ইঞ্জিনিয়ার" }));
  expect(current().searchParams.has("type")).toBe(false);
  expect(current().searchParams.get("role")).toBe("ইঞ্জিনিয়ার");
  expect(names()).toHaveLength(6);
  expect(names()).toContain("ইঞ্জিনিয়ার নাম 2");
  expect(names()).not.toContain("রহিম রাজমিস্ত্রি");
  await user.click(tabs().getByRole("button", { name: "সবাই" }));
  expect(current().searchParams.has("role")).toBe(false);
  expect(current().searchParams.has("type")).toBe(false);
  expect(names()).toHaveLength(29);
  expect(JSON.stringify(state.ledger)).toBe(before);
  expect(state.save).not.toHaveBeenCalled();
});

it("composes role choices with the existing search and payable filters without restoring the legacy type", async () => {
  mount("/people?type=worker&status=due");
  await ready();
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "নাম বা নম্বর খুঁজুন" }),
    "রহিম",
  );
  expect(names()).toHaveLength(2);
  await user.click(tabs().getByRole("button", { name: "রাজমিস্ত্রি" }));
  expect(names()).toEqual(["রহিম রাজমিস্ত্রি"]);
  await user.click(tabs().getByRole("button", { name: "ইঞ্জিনিয়ার" }));
  expect(names()).toEqual(["রহিম ইঞ্জিনিয়ার"]);
  expect(Object.fromEntries(current().searchParams)).toEqual({
    status: "due",
    q: "রহিম",
    role: "ইঞ্জিনিয়ার",
  });
  await user.click(tabs().getByRole("button", { name: "সবাই" }));
  expect(names()).toHaveLength(2);
  expect(Object.fromEntries(current().searchParams)).toEqual({
    status: "due",
    q: "রহিম",
  });
  expect(state.save).not.toHaveBeenCalled();
});

it("clears both role and legacy type together when everyone is chosen while retaining search and balance context", async () => {
  mount(
    `/people?${new URLSearchParams({ role: "রাজমিস্ত্রি", type: "shop", q: "রহিম", status: "due" })}`,
  );
  await ready();
  expect(names()).toEqual(["রহিম রাজমিস্ত্রি"]);
  await userEvent.setup().click(tabs().getByRole("button", { name: "সবাই" }));
  expect(Object.fromEntries(current().searchParams)).toEqual({
    q: "রহিম",
    status: "due",
  });
  expect(names()).toHaveLength(2);
  expect(state.save).not.toHaveBeenCalled();
});

it("limits the picker to six existing roles, permits replacing a selected tab and restores the choice from IndexedDB", async () => {
  const before = JSON.stringify(state.ledger);
  const view = mount();
  await ready();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "ট্যাব সাজাই" }));
  const dialog = screen.getByRole("dialog", { name: "ট্যাব সাজাই" });
  const picker = within(dialog);
  expect(picker.getAllByRole("checkbox")).toHaveLength(7);
  expect(picker.getAllByRole("checkbox", { checked: true })).toHaveLength(6);
  expect(picker.queryByRole("checkbox", { name: "পুরোনো পরিচয়" })).toBeNull();
  const alternate = picker.getByRole("checkbox", {
    name: "সহকারী",
  }) as HTMLInputElement;
  expect(alternate.disabled).toBe(true);
  await user.click(picker.getByRole("checkbox", { name: "ঠিকাদার" }));
  expect(alternate.disabled).toBe(false);
  await user.click(alternate);
  expect(picker.getAllByRole("checkbox", { checked: true })).toHaveLength(6);
  expect(
    (picker.getByRole("checkbox", { name: "ঠিকাদার" }) as HTMLInputElement)
      .disabled,
  ).toBe(true);
  for (const selected of picker.getAllByRole("checkbox", { checked: true }))
    expect((selected as HTMLInputElement).disabled).toBe(false);
  await user.click(picker.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(tabs().getByRole("button", { name: "সহকারী" })).toBeTruthy();
  expect(tabs().queryByRole("button", { name: "ঠিকাদার" })).toBeNull();
  const stored = await storage.readDraft<{ version: number; keys: string[] }>(
    preferenceKey,
  );
  expect(stored?.version).toBe(1);
  expect(stored?.keys).toHaveLength(6);
  expect(stored?.keys).toContain("সহকারী".normalize("NFKC"));
  expect(stored?.keys).not.toContain("ঠিকাদার".normalize("NFKC"));
  view.unmount();
  mount();
  await screen.findByRole("button", { name: "সহকারী" });
  await ready();
  expect(tabs().queryByRole("button", { name: "ঠিকাদার" })).toBeNull();
  expect(JSON.stringify(state.ledger)).toBe(before);
  expect(state.save).not.toHaveBeenCalled();
});

it("cancels draft tab choices without persisting or offering a new occupation input", async () => {
  const before = JSON.stringify(state.ledger);
  mount();
  await ready();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "ট্যাব সাজাই" }));
  const picker = within(screen.getByRole("dialog", { name: "ট্যাব সাজাই" }));
  await user.click(picker.getByRole("checkbox", { name: "ঠিকাদার" }));
  await user.click(picker.getByRole("checkbox", { name: "সহকারী" }));
  const search = picker.getByRole("searchbox", { name: "পরিচয় খুঁজুন" });
  expect(search.getAttribute("placeholder")).toBe("পরিচয় খুঁজুন");
  expect(picker.getAllByRole("searchbox")).toHaveLength(1);
  expect(picker.queryAllByRole("textbox")).toHaveLength(0);
  await user.type(search, "একেবারে নতুন পরিচয়");
  expect(picker.queryAllByRole("checkbox")).toHaveLength(0);
  expect(picker.queryByRole("button", { name: /নতুন|যোগ/ })).toBeNull();
  await user.click(picker.getByRole("button", { name: "বাতিল" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(tabs().getByRole("button", { name: "ঠিকাদার" })).toBeTruthy();
  expect(tabs().queryByRole("button", { name: "সহকারী" })).toBeNull();
  expect(await storage.readDraft(preferenceKey)).toBeNull();
  expect(JSON.stringify(state.ledger)).toBe(before);
  expect(state.save).not.toHaveBeenCalled();
});

it("keeps a hidden role URL filter visible as a removable chip without changing preferred tabs", async () => {
  mount(`/people?${new URLSearchParams({ role: "  সহকারী  " })}`);
  await ready();
  expect(tabs().queryByRole("button", { name: "সহকারী" })).toBeNull();
  expect(names()).toEqual(["সহকারী নাম 1"]);
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "পরিচয়ের বাছাই মুছুন" }));
  expect(current().searchParams.has("role")).toBe(false);
  expect(names()).toHaveLength(29);
  expect(await storage.readDraft(preferenceKey)).toBeNull();
});
