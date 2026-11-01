// @vitest-environment jsdom
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { QuickEntrySheet } from "./QuickEntrySheet";
const state = vi.hoisted(() => ({
  notebook: {} as Record<string, unknown>,
  drafts: new Map<string, unknown>(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => state.notebook,
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    formatDigits: String,
    t: (text: string) => text,
    money: (value: number) => String(value / 100),
  }),
}));
vi.mock("../../data/database", () => ({ getActiveOwner: () => "test-owner" }));
vi.mock("../../data/repository", () => ({
  createWorkspaceStorage: () => ({
    readDraft: async (key: string) => state.drafts.get(key) ?? null,
    saveDraft: async (key: string, value: unknown) => {
      state.drafts.set(key, value);
    },
    removeDraft: async (key: string) => {
      state.drafts.delete(key);
    },
  }),
}));
vi.mock("../../components/Sheet", () => ({
  Sheet: ({
    title,
    children,
    footer,
    onClose,
  }: {
    title: string;
    children: ReactNode;
    footer: ReactNode;
    onClose: () => void;
  }) => (
    <section>
      <h2>{title}</h2>
      <button type="button" onClick={onClose}>
        বন্ধ করুন
      </button>
      {children}
      {footer}
    </section>
  ),
}));
vi.mock("../../components/ui/AppSelect", () => ({
  AppSelect: (props: SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props} />
  ),
}));
vi.mock("../../components/ui/AppCombobox", () => ({
  AppCombobox: ({
    suggestions: _suggestions,
    ...props
  }: InputHTMLAttributes<HTMLInputElement> & { suggestions: unknown[] }) => (
    <input {...props} />
  ),
}));
vi.mock("../../components/ui/MoneyInput", () => ({
  MoneyInput: (props: InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));
vi.mock("../../components/ui/AppDatePicker", () => ({
  AppDatePicker: (props: InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));
afterEach(cleanup);
beforeEach(() => {
  state.drafts.clear();
  state.notebook = {
    ledger: LedgerSchema.parse({
      people: [{ id: "worker", name: "শাহ আলম", kind: "worker" }],
    }),
    mode: "demo",
    close: vi.fn(),
    notify: vi.fn(),
    save: vi.fn(async (change: Ledger | ((current: Ledger) => Ledger)) => {
      const current = state.notebook.ledger as Ledger;
      state.notebook.ledger = LedgerSchema.parse(
        typeof change === "function" ? change(current) : change,
      );
    }),
  };
});
const ready = () =>
  waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "রাখুন" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
describe("quick entry creation flow", () => {
  it("creates the first work inside a payment, preserving the amount and recipient, then saves it to that work", async () => {
    const user = userEvent.setup();
    render(
      <QuickEntrySheet options={{ kind: "payment", personId: "worker" }} />,
    );
    await ready();
    await user.type(screen.getByLabelText("কত টাকা"), "30000");
    await user.click(
      screen.getByRole("button", { name: "আগে কাজের খাতা খুলুন" }),
    );
    await ready();
    await user.type(screen.getByLabelText("কাজের নাম"), "দরজার কাজ");
    await user.click(screen.getByRole("button", { name: "রাখুন" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "টাকা দিলাম" })).toBeTruthy(),
    );
    expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe(
      "30000",
    );
    const work = (state.notebook.ledger as Ledger).works[0];
    expect(
      (screen.getByLabelText("কাজের খাতা") as HTMLSelectElement).value,
    ).toBe(work.id);
    expect(work.activity).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "রাখুন" }));
    await waitFor(() => expect(state.notebook.close).toHaveBeenCalledTimes(1));
    expect((state.notebook.ledger as Ledger).entries[0]).toMatchObject({
      kind: "payment",
      personId: "worker",
      account: "labour",
      allocations: [{ workId: work.id, amount: 3000000 }],
    });
    expect((state.notebook.ledger as Ledger).entries).toHaveLength(1);
  });
  it("returns from cancelled work creation without losing the unfinished payment", async () => {
    const user = userEvent.setup();
    render(
      <QuickEntrySheet options={{ kind: "payment", personId: "worker" }} />,
    );
    await ready();
    await user.type(screen.getByLabelText("কত টাকা"), "1700");
    await user.click(
      screen.getByRole("button", { name: "আগে কাজের খাতা খুলুন" }),
    );
    await ready();
    await user.click(screen.getByRole("button", { name: "বন্ধ করুন" }));
    await waitFor(() =>
      expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe(
        "1700",
      ),
    );
    expect(state.notebook.save).not.toHaveBeenCalled();
    expect(state.notebook.close).not.toHaveBeenCalled();
  });
  it("clears a labour description and metadata when switching back to buying materials", async () => {
    const user = userEvent.setup();
    state.notebook.ledger = LedgerSchema.parse({
      works: [{ id: "doors", name: "দরজার কাজ" }],
    });
    render(
      <QuickEntrySheet
        options={{ kind: "expense", workId: "doors", costType: "labour" }}
      />,
    );
    await ready();
    await user.type(screen.getByLabelText("কী কাজের মজুরি"), "মজুরি");
    await user.type(screen.getByLabelText("কত টাকা"), "2000");
    await user.click(screen.getByRole("button", { name: "মাল কেনা" }));
    expect((screen.getByLabelText("কী কিনলেন") as HTMLInputElement).value).toBe(
      "",
    );
    expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe(
      "2000",
    );
  });
  it("selects a worker's labour account after opening payment from a material notebook", async () => {
    state.notebook.ledger = LedgerSchema.parse({
      works: [{ id: "doors", name: "দরজার কাজ" }],
      people: [{ id: "worker", name: "শাহ আলম", kind: "worker" }],
    });
    render(
      <QuickEntrySheet
        options={{ kind: "payment", workId: "doors", account: "materials" }}
      />,
    );
    await ready();
    fireEvent.change(screen.getByLabelText("কাকে দিলেন"), {
      target: { value: "worker" },
    });
    expect(
      (screen.getByLabelText("কিসের টাকা") as HTMLSelectElement).value,
    ).toBe("labour");
  });
  it("names partial-payment and refund amount fields for assistive input", async () => {
    const user = userEvent.setup();
    const purchase = render(<QuickEntrySheet options={{ kind: "expense" }} />);
    await ready();
    await user.click(screen.getByRole("button", { name: "কিছু দিয়েছি" }));
    expect(screen.getByRole("textbox", { name: "এখন কত দিলেন" })).toBeTruthy();
    purchase.unmount();
    render(<QuickEntrySheet options={{ kind: "return" }} />);
    await ready();
    await user.click(screen.getByRole("button", { name: "আরও তথ্য যোগ করি" }));
    expect(
      screen.getByRole("textbox", { name: "নগদ টাকা ফেরত পেলে লিখুন" }),
    ).toBeTruthy();
  });
});
