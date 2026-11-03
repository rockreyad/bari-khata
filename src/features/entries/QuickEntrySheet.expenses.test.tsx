// @vitest-environment jsdom
import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { QuickEntrySheet } from "./QuickEntrySheet";

const state = vi.hoisted(() => ({
  ledger: {} as Ledger,
  save: vi.fn(),
  close: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    ledger: state.ledger,
    mode: "demo",
    save: state.save,
    close: state.close,
    notify: vi.fn(),
  }),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string) => text,
    money: (value: number) => String(value / 100),
    number: String,
    formatDigits: String,
    language: "bn",
  }),
}));
vi.mock("../../data/database", () => ({
  getActiveOwner: () => "synthetic-owner",
}));
vi.mock("../../data/repository", () => ({
  createWorkspaceStorage: () => ({
    readDraft: async () => null,
    saveDraft: async () => {},
    removeDraft: async () => {},
  }),
}));
vi.mock("../../components/ui/AppSelect", () => ({
  AppSelect: (props: SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props} />
  ),
}));
vi.mock("../../components/ui/AppDatePicker", () => ({
  AppDatePicker: (props: InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));
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
beforeEach(() => {
  state.ledger = LedgerSchema.parse({
    works: [{ id: "work", name: "ড্রিলিংয়ের কাজ" }],
  });
  state.save.mockReset();
  state.close.mockReset();
  state.save.mockImplementation(async (change: (current: Ledger) => Ledger) => {
    state.ledger = change(state.ledger);
  });
});
afterEach(cleanup);
async function ready() {
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "রাখুন" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
}

it("shows a previous uncatalogued material in the real suggestion picker and fills its known unit on the first choice", async () => {
  state.ledger = LedgerSchema.parse({
    ...state.ledger,
    entries: [
      {
        id: "old-purchase",
        kind: "expense",
        lines: [
          {
            id: "line",
            workId: "work",
            label: "সিমেন্ট",
            unit: "বস্তা",
            amount: 55000,
          },
        ],
      },
    ],
  });
  const user = userEvent.setup();
  render(
    <QuickEntrySheet
      presentation="page"
      options={{ kind: "expense", workId: "work", costType: "material" }}
    />,
  );
  await ready();
  await user.type(screen.getByLabelText("কী কিনলেন"), "সিমে");
  await user.click(
    within(screen.getByRole("listbox")).getByRole("option", {
      name: "সিমেন্ট",
    }),
  );
  expect((screen.getByLabelText("কী কিনলেন") as HTMLInputElement).value).toBe(
    "সিমেন্ট",
  );
  expect(screen.getByText("বস্তা", { exact: false })).toBeTruthy();
  expect((screen.getByLabelText("একক") as HTMLInputElement).value).toBe(
    "বস্তা",
  );
  await user.type(screen.getByLabelText("কত টাকা"), "600");
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(state.close).toHaveBeenCalledOnce());
  expect(
    state.ledger.entries.find(
      (entry) => entry.id !== "old-purchase" && entry.kind === "expense",
    )?.lines[0],
  ).toMatchObject({ label: "সিমেন্ট", unit: "বস্তা", amount: 60000 });
});

it.each(["other", "rental"] as const)(
  "uses expense language for %s and saves its own cost type without material metadata",
  async (costType) => {
    const user = userEvent.setup();
    render(
      <QuickEntrySheet
        presentation="page"
        options={{
          kind: "expense",
          workId: "work",
          costType,
          account: "other",
        }}
      />,
    );
    await ready();
    expect(screen.getByRole("heading", { name: "খরচ লিখি" })).toBeTruthy();
    expect(screen.getByLabelText("কার সঙ্গে হিসাব")).toBeTruthy();
    expect(screen.queryByLabelText("কোন দোকান")).toBeNull();
    expect(screen.queryByLabelText("কী কিনলেন")).toBeNull();
    expect(screen.queryByText("ব্র্যান্ড ও পরিমাণ লিখি")).toBeNull();
    expect(screen.queryByLabelText("মালের ধরন")).toBeNull();
    fireEvent.change(screen.getByLabelText("কত টাকা"), {
      target: { value: "250" },
    });
    await user.type(screen.getByLabelText("কী বাবদ খরচ"), "শ্রমিকদের খাবার");
    await user.click(screen.getByRole("button", { name: "রাখুন" }));
    await waitFor(() => expect(state.close).toHaveBeenCalledOnce());
    expect(
      state.ledger.entries.find((entry) => entry.kind === "expense"),
    ).toMatchObject({
      account: "other",
      lines: [
        {
          costType,
          label: "শ্রমিকদের খাবার",
          amount: 25000,
          materialGroupId: null,
          itemId: null,
        },
      ],
    });
  },
);
