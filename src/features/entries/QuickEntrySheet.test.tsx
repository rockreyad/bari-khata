// @vitest-environment jsdom
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
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
import { entryContext } from "./entryContext";
import { summarize, personSummary } from "../../domain/ledger";
import { appendBalanceAdjustment } from "../../domain/balanceAdjustments";
const state = vi.hoisted(() => ({
  notebook: {} as Record<string, unknown>,
  drafts: new Map<string, unknown>(),
  beforeWrite: null as null | ((key: string, value: unknown) => Promise<void>),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => state.notebook,
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    formatDigits: String,
    t: (text: string) => text,
    money: (value: number) => String(value / 100),
    number: String,
  }),
}));
vi.mock("../../data/database", () => ({ getActiveOwner: () => "test-owner" }));
vi.mock("../../data/repository", () => ({
  createWorkspaceStorage: () => ({
    readDraft: async (key: string) => state.drafts.get(key) ?? null,
    saveDraft: async (key: string, value: unknown) => {
      await state.beforeWrite?.(key, value);
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
  state.beforeWrite = null;
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
  waitFor(() => {
    const fields = document.querySelector<HTMLFieldSetElement>(
      "#quick-entry fieldset",
    );
    expect(
      fields
        ? fields.disabled
        : (screen.getByRole("button", { name: "রাখুন" }) as HTMLButtonElement)
            .disabled,
    ).toBe(false);
  });

it("folds vouchers, note and date together while keeping payment method choices visible", async () => {
  state.notebook.ledger = LedgerSchema.parse({
    works: [{ id: "door", name: "নমুনা খাতা" }],
    people: [{ id: "worker", name: "নমুনা কর্মী", kind: "worker" }],
  });
  const user = userEvent.setup();
  render(
    <QuickEntrySheet
      presentation="page"
      options={{
        kind: "payment",
        personId: "worker",
        workId: "door",
        account: "labour",
        purpose: "advance",
      }}
    />,
  );
  await ready();
  const optional = screen.getByText("ভাউচার, নোট ও তারিখ").closest("details")!;
  expect(optional.open).toBe(false);
  expect(screen.getByLabelText("ভাউচারের ছবি / PDF").closest("details")).toBe(
    optional,
  );
  expect(screen.getByLabelText("নোট").closest("details")).toBe(optional);
  expect(screen.getByLabelText("তারিখ").closest("details")).toBe(optional);
  const methods = screen.getByRole("group", { name: "কীভাবে দিয়েছেন" });
  expect(methods.closest("details")).toBeNull();
  await user.click(within(methods).getByRole("button", { name: "ব্যাংক" }));
  await user.type(screen.getByLabelText("কত টাকা"), "500");
  await user.click(screen.getByText("ভাউচার, নোট ও তারিখ"));
  await user.type(screen.getByLabelText("নোট"), "নমুনা অগ্রিম");
  await user.upload(
    screen.getByLabelText("ভাউচারের ছবি / PDF"),
    new File(["sample"], "sample-voucher.pdf", { type: "application/pdf" }),
  );
  await user.click(screen.getByText("ভাউচার, নোট ও তারিখ"));
  expect(optional.open).toBe(false);
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(state.notebook.close).toHaveBeenCalledOnce());
  const saved = (state.notebook.ledger as Ledger).entries[0];
  expect(saved).toMatchObject({
    kind: "payment",
    paymentContext: "advance",
    note: "নমুনা অগ্রিম",
    paymentParts: [{ method: "bank", amount: 50000 }],
    receipts: [{ name: "sample-voucher.pdf" }],
  });
});

it("preserves a refundable legacy payment draft until an ordinary payment purpose is chosen", async () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "door", name: "নমুনা খাতা" }],
    people: [{ id: "worker", name: "নমুনা কর্মী", kind: "worker" }],
  });
  state.notebook.ledger = ledger;
  const options = {
    kind: "payment",
    personId: "worker",
    workId: "door",
    account: "labour",
    purpose: "advance",
  } as const;
  const draft = {
    ...entryContext(ledger, options),
    amount: "700",
    advanceContext: "receivable" as const,
  };
  const key = "quick-v2:payment:door:worker:advance:account=labour";
  state.drafts.set(key, { draft, files: [] });
  const user = userEvent.setup();
  let page = render(<QuickEntrySheet presentation="page" options={options} />);
  await ready();
  expect(screen.queryByLabelText("টাকা কীভাবে মিটবে")).toBeNull();
  expect(screen.queryByText("এই টাকা ফেরত পাব")).toBeNull();
  expect(screen.getByText("টাকা দেওয়ার ধরন বেছে নিন।")).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "রাখুন" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await user.click(screen.getByRole("button", { name: "ফিরুন" }));
  await waitFor(() => expect(state.notebook.close).toHaveBeenCalledOnce());
  page.unmount();
  expect(state.drafts.get(key)).toMatchObject({
    draft: { advanceContext: "receivable", amount: "700", id: draft.id },
  });
  page = render(<QuickEntrySheet presentation="page" options={options} />);
  await ready();
  await user.click(
    screen.getByRole("button", { name: "অগ্রিম", pressed: false }),
  );
  expect(screen.queryByText("টাকা দেওয়ার ধরন বেছে নিন।")).toBeNull();
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(state.notebook.save).toHaveBeenCalledOnce());
  expect((state.notebook.ledger as Ledger).entries[0]).toMatchObject({
    id: draft.id,
    kind: "payment",
    paymentContext: "advance",
    paymentParts: [{ amount: 70000 }],
  });
  page.unmount();
});

it("previews adjusted shop due, pays it once and keeps the same balance when reopened", async () => {
  const original = LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
    people: [{ id: "shop", name: "দোকান", kind: "shop" }],
    entries: [
      {
        id: "bill",
        kind: "expense",
        personId: "shop",
        lines: [{ id: "line", workId: "door", amount: 100000 }],
      },
      {
        id: "paid",
        kind: "payment",
        personId: "shop",
        allocations: [{ workId: "door", amount: 40000 }],
        paymentParts: [{ amount: 40000 }],
      },
    ],
  });
  state.notebook.ledger = appendBalanceAdjustment(
    original,
    {
      target: "person",
      basis: "balance",
      personId: "shop",
      account: "materials",
      expectedBefore: 60000,
      after: 30000,
      reason: "বাকি মিলিয়েছি",
    },
    "2026-11-04T08:00:00.000Z",
  );
  const options = {
    kind: "payment",
    workId: "door",
    personId: "shop",
    account: "materials",
  } as const;
  const user = userEvent.setup();
  const view = render(
    <QuickEntrySheet presentation="page" options={options} />,
  );
  await ready();
  expect(
    view.container.querySelector(".entry-balance-items")?.textContent,
  ).toContain("আগের বাকি300");
  await user.type(screen.getByLabelText("কত টাকা"), "300");
  expect(
    view.container.querySelector(".entry-balance-result")?.textContent,
  ).toBe("বাকি থাকবে0");
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(state.notebook.close).toHaveBeenCalledOnce());
  const saved = state.notebook.ledger as Ledger;
  expect(saved.entries.slice(0, 2)).toEqual(original.entries);
  expect(saved.entries).toHaveLength(4);
  expect(personSummary(saved, "shop")).toMatchObject({
    cost: 100000,
    paid: 70000,
    reconciledPayable: 0,
    reconciledAdvance: 0,
  });
  view.unmount();
  state.notebook.ledger = LedgerSchema.parse(JSON.parse(JSON.stringify(saved)));
  const reopened = render(
    <QuickEntrySheet presentation="page" options={options} />,
  );
  await ready();
  expect(
    reopened.container.querySelector(".entry-balance-items")?.textContent ?? "",
  ).not.toContain("আগের বাকি");
  await user.type(screen.getByLabelText("কত টাকা"), "100");
  expect(
    reopened.container.querySelector(".entry-balance-result")?.textContent,
  ).toBe("বাকি থাকবে0");
  expect(
    screen.getByRole("button", { name: "নতুন বিল ও টাকা", pressed: true }),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "অগ্রিম" }));
  expect(
    reopened.container.querySelector(".entry-balance-result")?.textContent,
  ).toBe("অগ্রিম থাকবে100");
});
describe("quick entry creation flow", () => {
  it("keeps the page title aligned with material, labour and transport choices without changing the amount", async () => {
    state.notebook.ledger = LedgerSchema.parse({
      works: [{ id: "doors", name: "দরজার কাজ" }],
    });
    const user = userEvent.setup();
    render(
      <QuickEntrySheet
        presentation="page"
        options={{
          kind: "expense",
          workId: "doors",
          account: "materials",
          costType: "material",
        }}
      />,
    );
    await ready();
    expect(
      screen.getByRole("heading", { level: 1, name: "মাল কিনলাম" }),
    ).toBeTruthy();
    await user.type(screen.getByLabelText("কত টাকা"), "2000");
    await user.click(screen.getByRole("button", { name: "কর্মীর টাকা" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "কর্মীর টাকা" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "কর্মীর টাকা", pressed: true }),
    ).toBeTruthy();
    expect(screen.getByLabelText("কী কাজের মজুরি")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "মাল কেনা" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "মাল কিনলাম" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "মাল কেনা", pressed: true }),
    ).toBeTruthy();
    expect(screen.getByLabelText("কী কিনলেন")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "গাড়িভাড়া" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "গাড়িভাড়া দিই" }),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("group", { name: "হিসাবের ধরন" })).getByRole(
        "button",
        { name: "গাড়িভাড়া", pressed: true },
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText("কী বাবদ খরচ")).toBeTruthy();
    expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe(
      "2000",
    );
    expect(state.notebook.save).not.toHaveBeenCalled();
    expect((state.notebook.ledger as Ledger).entries).toEqual([]);
  });
  it("uses a restored labour draft's title despite a material entry URL and preserves its financial data and receipt", async () => {
    const ledger = LedgerSchema.parse({
      works: [{ id: "doors", name: "দরজার কাজ" }],
    });
    state.notebook.ledger = ledger;
    const base = entryContext(ledger, {
      kind: "expense",
      workId: "doors",
      account: "labour",
      costType: "labour",
    });
    const draft = {
      ...base,
      note: "আগের অসমাপ্ত কথা",
      payment: "partial" as const,
      paid: "1500",
      method: "bkash" as const,
      rows: [
        {
          ...base.rows[0],
          label: "প্লাস্টারের কাজ",
          amount: "3500",
          quantity: "7",
          unit: "দিন",
        },
      ],
    };
    const receipt = new File(["voucher"], "labour.pdf", {
      type: "application/pdf",
    });
    const saved = {
      draft,
      files: [
        {
          id: "labour-receipt",
          entryId: draft.id,
          name: receipt.name,
          file: receipt,
        },
      ],
    };
    const key = "quick-v2:expense:doors:all:material:account=materials";
    state.drafts.set(key, saved);
    const user = userEvent.setup();
    render(
      <QuickEntrySheet
        presentation="page"
        options={{
          kind: "expense",
          workId: "doors",
          account: "materials",
          costType: "material",
        }}
      />,
    );
    await ready();
    expect(
      screen.getByRole("heading", { level: 1, name: "কর্মীর টাকা" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "কর্মীর টাকা", pressed: true }),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("কী কাজের মজুরি") as HTMLInputElement).value,
    ).toBe("প্লাস্টারের কাজ");
    expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe(
      "3500",
    );
    await user.click(screen.getByText("ভাউচার, নোট ও তারিখ"));
    expect(screen.getByText("labour.pdf")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "ফিরুন" }));
    await waitFor(() => expect(state.notebook.close).toHaveBeenCalledOnce());
    expect(state.drafts.get(key)).toEqual(saved);
    expect(state.notebook.save).not.toHaveBeenCalled();
    expect(state.notebook.ledger).toEqual(ledger);
  });
  it("creates the first work inside a payment, preserving the amount and recipient, then saves it to that work", async () => {
    const user = userEvent.setup();
    render(
      <QuickEntrySheet options={{ kind: "payment", personId: "worker" }} />,
    );
    await ready();
    await user.type(screen.getByLabelText("কত টাকা"), "30000");
    await user.click(screen.getByRole("button", { name: "আগে খাতা বানান" }));
    await ready();
    await user.type(screen.getByLabelText("খাতার নাম"), "দরজার কাজ");
    await user.click(screen.getByRole("button", { name: "রাখুন" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "টাকা দিই" })).toBeTruthy(),
    );
    expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe(
      "30000",
    );
    const work = (state.notebook.ledger as Ledger).works[0];
    expect((screen.getByLabelText("খাতা") as HTMLSelectElement).value).toBe(
      work.id,
    );
    expect(work.activity).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "রাখুন" }));
    await waitFor(() => expect(state.notebook.close).toHaveBeenCalledTimes(1));
    expect(
      (state.notebook.ledger as Ledger).entries.find(
        (entry) => entry.kind === "payment",
      ),
    ).toMatchObject({
      kind: "payment",
      personId: "worker",
      account: "labour",
      allocations: [{ workId: work.id, amount: 3000000 }],
    });
    expect((state.notebook.ledger as Ledger).entries).toHaveLength(2);
    expect(summarize(state.notebook.ledger as Ledger, work.id)).toMatchObject({
      cost: 3000000,
      netPaid: 3000000,
    });
  });
  it("returns from cancelled work creation without losing the unfinished payment", async () => {
    const user = userEvent.setup();
    render(
      <QuickEntrySheet options={{ kind: "payment", personId: "worker" }} />,
    );
    await ready();
    await user.type(screen.getByLabelText("কত টাকা"), "1700");
    await user.click(screen.getByRole("button", { name: "আগে খাতা বানান" }));
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
  it("keeps an explicitly chosen material payment account after selecting a worker", async () => {
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
    fireEvent.change(screen.getByLabelText("কাকে দিচ্ছেন"), {
      target: { value: "worker" },
    });
    expect(
      screen.getByRole("button", { name: "নতুন বিল ও টাকা", pressed: true }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "মাল কেনা" })).toBeNull();
    expect(screen.queryByRole("button", { name: "গাড়িভাড়া" })).toBeNull();
  });
  it("names partial-payment and refund amount fields for assistive input", async () => {
    const user = userEvent.setup();
    const purchase = render(<QuickEntrySheet options={{ kind: "expense" }} />);
    await ready();
    await user.click(screen.getByRole("button", { name: "টাকা লিখি" }));
    expect(screen.getByRole("textbox", { name: "এখন কত দিলেন" })).toBeTruthy();
    purchase.unmount();
    render(<QuickEntrySheet options={{ kind: "return" }} />);
    await ready();
    await user.click(screen.getByText("ভাউচার, নোট ও তারিখ"));
    expect(
      screen.getByRole("textbox", { name: "নগদ টাকা ফেরত পেলে লিখুন" }),
    ).toBeTruthy();
  });
});

it("opens a full purchase page shaped for its shop and previews paying more than the new purchase against older dues", async () => {
  state.notebook.ledger = LedgerSchema.parse({
    works: [
      { id: "door", name: "দরজা" },
      { id: "old", name: "আগের কাজ" },
    ],
    people: [{ id: "shop", name: "দরজার দোকান", kind: "shop" }],
    entries: [
      {
        id: "old-bill",
        kind: "expense",
        account: "materials",
        personId: "shop",
        lines: [
          { id: "old-line", workId: "old", label: "আগের মাল", amount: 2000000 },
        ],
      },
    ],
  });
  const user = userEvent.setup();
  const { container } = render(
    <QuickEntrySheet
      presentation="page"
      options={{ kind: "expense", personId: "shop", workId: "door" }}
    />,
  );
  await ready();
  expect(
    screen.getByRole("heading", { level: 1, name: "মাল কিনলাম" }),
  ).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(container.querySelector(".expense-sections")).not.toBeNull();
  expect(
    screen.getByRole("button", { name: "মাল কেনা", pressed: true }),
  ).toBeTruthy();
  await user.type(screen.getByLabelText("কত টাকা"), "10000");
  await user.type(screen.getByLabelText("কী কিনলেন"), "দরজা");
  await user.click(screen.getByRole("button", { name: "টাকা লিখি" }));
  await user.type(screen.getByLabelText("এখন কত দিলেন"), "25000");
  const preview = screen.getByRole("region", { name: "টাকার হিসাব" });
  expect(preview.textContent).toContain("আগের বাকি20000");
  expect(preview.textContent).toContain("এবারের দাম10000");
  expect(preview.textContent).toContain("এখন দিচ্ছি25000");
  expect(preview.querySelector(".entry-balance-result")?.textContent).toBe(
    "বাকি থাকবে5000",
  );
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
    "83.33",
  );
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(state.notebook.close).toHaveBeenCalledOnce());
  const saved = state.notebook.ledger as Ledger;
  expect(
    saved.entries.filter((entry) => entry.kind === "expense"),
  ).toHaveLength(2);
  expect(
    saved.entries.find((entry) => entry.kind === "payment")?.paymentParts[0]
      .amount,
  ).toBe(2500000);
  expect(personSummary(saved, "shop")).toMatchObject({
    payable: 500000,
    advance: 0,
  });
});

it.each(["দোকান", "ডিলার"])(
  "keeps existing notebook allocation with notebook creation available for a %s purchase",
  async (role) => {
    state.notebook.ledger = LedgerSchema.parse({
      works: [{ id: "roof", name: "ছাদের খাতা" }],
      people: [{ id: "shop", name: "নমুনা বিক্রেতা", kind: "shop", role }],
    });
    const user = userEvent.setup();
    render(
      <QuickEntrySheet
        presentation="page"
        options={{ kind: "expense", personId: "shop" }}
      />,
    );
    await ready();
    const notebooks = screen.getByRole("combobox", { name: "খাতা" });
    expect(
      within(notebooks).getByRole("option", { name: "+ নতুন খাতা বানান" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "নতুন খাতা বানান" }),
    ).toBeTruthy();
    await user.selectOptions(notebooks, "roof");
    await user.type(screen.getByLabelText("কী কিনলেন"), "সিমেন্ট");
    await user.type(screen.getByLabelText("কত টাকা"), "1000");
    await user.click(screen.getByRole("button", { name: "রাখুন" }));
    await waitFor(() => expect(state.notebook.close).toHaveBeenCalledOnce());
    const saved = state.notebook.ledger as Ledger;
    expect(saved.works.map((work) => work.id)).toEqual(["roof"]);
    expect(saved.contracts).toEqual([]);
    expect(saved.entries).toHaveLength(2);
    expect(
      saved.entries.find((entry) => entry.kind === "expense"),
    ).toMatchObject({
      personId: "shop",
      account: "materials",
      contractId: null,
      lines: [{ workId: "roof", costType: "material", amount: 100000 }],
    });
    expect(
      saved.entries.find((entry) => entry.kind === "payment"),
    ).toMatchObject({
      personId: "shop",
      account: "materials",
      contractId: null,
      allocations: [{ workId: "roof", amount: 100000 }],
    });
  },
);

it.each(["payment", "return"] as const)(
  "keeps existing notebook choices and a create shortcut in a dealer %s flow",
  async (kind) => {
    state.notebook.ledger = LedgerSchema.parse({
      works: [{ id: "roof", name: "ছাদের খাতা" }],
      people: [
        { id: "shop", name: "নমুনা ডিলার", kind: "shop", role: "ডিলার" },
      ],
    });
    const user = userEvent.setup();
    render(<QuickEntrySheet options={{ kind, personId: "shop" }} />);
    await ready();
    const notebooks = screen.getByRole("combobox", { name: "খাতা" });
    expect(
      within(notebooks).getByRole("option", { name: "ছাদের খাতা" }),
    ).toBeTruthy();
    expect(
      within(notebooks).getByRole("option", { name: "+ নতুন খাতা বানান" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "নতুন খাতা বানান" }),
    ).toBeTruthy();
    await user.selectOptions(notebooks, "roof");
    expect((notebooks as HTMLSelectElement).value).toBe("roof");
    expect(state.notebook.save).not.toHaveBeenCalled();
  },
);

it("keeps sector creation and the unfinished payment when switching between configured recipients", async () => {
  state.notebook.ledger = LedgerSchema.parse({
    works: [{ id: "roof", name: "ছাদের খাতা" }],
    people: [
      { id: "shop", name: "নমুনা দোকান", kind: "shop" },
      {
        id: "worker",
        name: "নমুনা মিস্ত্রি",
        kind: "worker",
        roles: ["craftsperson", "supplier"],
      },
    ],
  });
  const user = userEvent.setup();
  render(<QuickEntrySheet options={{ kind: "payment" }} />);
  await ready();
  const notebooks = screen.getByRole("combobox", { name: "খাতা" });
  expect(
    within(notebooks).getByRole("option", { name: "+ নতুন খাতা বানান" }),
  ).toBeTruthy();
  await user.type(screen.getByLabelText("কত টাকা"), "1700");
  await user.selectOptions(screen.getByLabelText("কাকে দিচ্ছেন"), "shop");
  expect(
    within(notebooks).getByRole("option", { name: "+ নতুন খাতা বানান" }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "নতুন খাতা বানান" })).toBeTruthy();
  await user.selectOptions(screen.getByLabelText("কাকে দিচ্ছেন"), "worker");
  expect(
    within(notebooks).getByRole("option", { name: "+ নতুন খাতা বানান" }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "নতুন খাতা বানান" })).toBeTruthy();
  expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe(
    "1700",
  );
  expect(state.notebook.save).not.toHaveBeenCalled();
});

it("pays an explicitly selected house agreement without presenting unearned work as current due", async () => {
  state.notebook.ledger = LedgerSchema.parse({
    works: [
      { id: "door", name: "দরজা" },
      { id: "plaster", name: "প্লাস্টার" },
    ],
    people: [{ id: "worker", name: "শাহ আলম", kind: "worker" }],
    contracts: [
      {
        id: "house",
        scope: "house",
        workId: null,
        personId: "worker",
        total: 60000000,
      },
    ],
    entries: [
      {
        id: "door-paid",
        kind: "payment",
        account: "labour",
        personId: "worker",
        contractId: "house",
        allocations: [{ workId: "door", amount: 5000000 }],
        paymentParts: [{ amount: 5000000 }],
      },
      {
        id: "plaster-paid",
        kind: "payment",
        account: "labour",
        personId: "worker",
        contractId: "house",
        allocations: [{ workId: "plaster", amount: 2000000 }],
        paymentParts: [{ amount: 2000000 }],
      },
    ],
  });
  const user = userEvent.setup();
  const { container } = render(
    <QuickEntrySheet
      presentation="page"
      options={{
        kind: "payment",
        personId: "worker",
        workId: "door",
        contractId: "house",
      }}
    />,
  );
  await ready();
  expect(screen.getByRole("heading", { name: "টাকা দিই" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "কাজের টাকা" })).toBeNull();
  expect(screen.queryByRole("button", { name: "পুরো দিয়েছি" })).toBeNull();
  expect(screen.queryByText("মজুরির বিল")).toBeNull();
  await user.type(screen.getByLabelText("কত টাকা"), "30000");
  expect(
    container.querySelector(".entry-contract-progress .entry-balance-result")
      ?.textContent,
  ).toContain("অগ্রিম থাকবে100000");
  expect(
    container.querySelector(".entry-contract-progress")?.textContent,
  ).not.toContain("বাকি500000");
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(state.notebook.close).toHaveBeenCalledOnce());
  const saved = state.notebook.ledger as Ledger;
  expect(saved.entries).toHaveLength(3);
  expect(saved.entries[2]).toMatchObject({
    kind: "payment",
    contractId: "house",
    account: "labour",
    allocations: [{ workId: "door", amount: 3000000 }],
  });
});

it("keeps daily wage inputs and a receipt through back/reopen, then records one earned wage with its payment", async () => {
  state.notebook.ledger = LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
    people: [{ id: "worker", name: "শাহ আলম", kind: "worker" }],
  });
  const user = userEvent.setup();
  const options = {
    kind: "payment",
    personId: "worker",
    workId: "door",
  } as const;
  const view = render(
    <QuickEntrySheet presentation="page" options={options} />,
  );
  await ready();
  await user.click(screen.getByRole("button", { name: "দিন হিসাবে" }));
  await user.type(screen.getByLabelText("কত দিন"), "2.5");
  await user.type(screen.getByLabelText("দিনে কত টাকা"), "1200.5");
  expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe(
    "3001.25",
  );
  await user.click(screen.getByText("ভাউচার, নোট ও তারিখ"));
  const receipt = new File(["voucher"], "wage.pdf", {
    type: "application/pdf",
  });
  await user.upload(screen.getByLabelText("ভাউচারের ছবি / PDF"), receipt);
  await user.click(screen.getByRole("button", { name: "ফিরুন" }));
  await waitFor(() => expect(state.notebook.close).toHaveBeenCalledOnce());
  view.unmount();
  state.notebook.close = vi.fn();
  render(<QuickEntrySheet presentation="page" options={options} />);
  await ready();
  expect((screen.getByLabelText("কত দিন") as HTMLInputElement).value).toBe(
    "2.5",
  );
  expect(
    (screen.getByLabelText("দিনে কত টাকা") as HTMLInputElement).value,
  ).toBe("1200.5");
  expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe(
    "3001.25",
  );
  await user.click(screen.getByText("ভাউচার, নোট ও তারিখ"));
  expect(screen.getByText("wage.pdf")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(state.notebook.close).toHaveBeenCalledOnce());
  const saved = state.notebook.ledger as Ledger;
  expect(saved.entries).toHaveLength(2);
  expect(summarize(saved)).toMatchObject({
    cost: 300125,
    paid: 300125,
    payable: 0,
  });
  expect(saved.entries[0].lines[0]).toMatchObject({
    quantity: "2.5",
    unit: "দিন",
    amount: 300125,
  });
  expect(saved.entries[0].receipts[0].name).toBe("wage.pdf");
});

it.each([undefined, "settle", "advance"] as const)(
  "uses the confirmed shop balance while preserving an explicit %s intent",
  async (purpose) => {
    state.notebook.ledger = LedgerSchema.parse({
      works: [{ id: "door", name: "দরজা" }],
      people: [{ id: "shop", name: "দরজার দোকান", kind: "shop" }],
      entries: [
        {
          id: "bill",
          kind: "expense",
          account: "materials",
          personId: "shop",
          lines: [
            { id: "line", workId: "door", label: "দরজা", amount: 2000000 },
          ],
        },
      ],
    });
    const user = userEvent.setup();
    const { container } = render(
      <QuickEntrySheet
        presentation="page"
        options={{
          kind: "payment",
          purpose,
          personId: "shop",
          account: "materials",
          workId: "door",
        }}
      />,
    );
    await ready();
    expect(screen.getByRole("heading", { name: "টাকা দিই" })).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "বাকি মেটাই",
        pressed: purpose !== "advance",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "অগ্রিম",
        pressed: purpose === "advance",
      }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("কী কিনলেন")).toBeNull();
    expect(screen.queryByRole("button", { name: "কাজের টাকা" })).toBeNull();
    await user.type(screen.getByLabelText("কত টাকা"), "10000");
    expect(container.querySelector(".entry-balance-result")?.textContent).toBe(
      "বাকি থাকবে10000",
    );
    fireEvent.change(screen.getByLabelText("কত টাকা"), {
      target: { value: "30000" },
    });
    expect(container.querySelector(".entry-balance-result")?.textContent).toBe(
      "অগ্রিম থাকবে10000",
    );
    await user.click(screen.getByRole("button", { name: "রাখুন" }));
    await waitFor(() => expect(state.notebook.close).toHaveBeenCalledOnce());
    const saved = state.notebook.ledger as Ledger;
    expect(saved.entries).toHaveLength(2);
    expect(saved.entries[1]).toMatchObject({
      kind: "payment",
      account: "materials",
      paymentParts: [{ method: "cash", amount: 3000000 }],
    });
    expect(personSummary(saved, "shop")).toMatchObject({
      cost: 2000000,
      netPaid: 3000000,
      payable: 0,
      advance: 1000000,
    });
  },
);

it("filters unrelated contacts while retaining an explicitly selected labour bill", async () => {
  state.notebook.ledger = LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
    people: [
      { id: "shop", name: "দরজার দোকান", kind: "shop" },
      { id: "worker", name: "রহিম", kind: "worker" },
    ],
  });
  const user = userEvent.setup();
  const { container } = render(
    <QuickEntrySheet
      presentation="page"
      options={{ kind: "expense", workId: "door" }}
    />,
  );
  await ready();
  expect(container.querySelectorAll(".expense-sections button")).toHaveLength(
    3,
  );
  fireEvent.change(screen.getByLabelText("কোন দোকান"), {
    target: { value: "shop" },
  });
  expect(container.querySelector(".expense-sections")).not.toBeNull();
  expect((screen.getByLabelText("কী কিনলেন") as HTMLInputElement).value).toBe(
    "দরজা",
  );
  fireEvent.change(screen.getByLabelText("কোন দোকান"), {
    target: { value: "" },
  });
  await user.click(screen.getByRole("button", { name: "কর্মীর টাকা" }));
  expect(screen.queryByRole("option", { name: "দরজার দোকান" })).toBeNull();
  await user.type(screen.getByLabelText("কত টাকা"), "2000");
  fireEvent.change(screen.getByLabelText("কোন কর্মী"), {
    target: { value: "worker" },
  });
  expect(screen.queryByRole("button", { name: "নতুন বিল ও টাকা" })).toBeNull();
  expect(container.querySelector(".expense-sections")).not.toBeNull();
  expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe(
    "2000",
  );
  expect(screen.queryByLabelText("কী কিনলেন")).toBeNull();
  await user.type(screen.getByLabelText("কী কাজের মজুরি"), "নমুনা কাজের বিল");
  expect(screen.getByRole("button", { name: "পুরো দিয়েছি" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(state.notebook.close).toHaveBeenCalledOnce());
  expect(summarize(state.notebook.ledger as Ledger)).toMatchObject({
    cost: 200000,
    netPaid: 200000,
  });
});

it("records an explicitly selected transport expense and its payment without limiting other categories by identity", async () => {
  state.notebook.ledger = LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
    people: [{ id: "driver", name: "রনি", kind: "driver" }],
  });
  const user = userEvent.setup();
  const { container } = render(
    <QuickEntrySheet
      presentation="page"
      options={{
        kind: "expense",
        personId: "driver",
        workId: "door",
        costType: "transport",
      }}
    />,
  );
  await ready();
  expect(container.querySelector(".expense-sections")).not.toBeNull();
  expect(screen.queryByRole("button", { name: "মাল নামানোর খরচ" })).toBeNull();
  expect(screen.queryByLabelText("কী কিনলেন")).toBeNull();
  await user.type(screen.getByLabelText("কত টাকা"), "200");
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  const notice = await screen.findByRole("alert");
  expect(notice.textContent).toBe("কী বাবদ খরচ, ছোট করে লিখুন।");
  expect(container.querySelector("form")?.firstElementChild).toBe(notice);
  await waitFor(() => expect(document.activeElement).toBe(notice));
  expect(
    screen.getByLabelText("কী বাবদ খরচ").getAttribute("aria-invalid"),
  ).toBe("true");
  expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe(
    "200",
  );
  expect((state.notebook.ledger as Ledger).entries).toHaveLength(0);
  await user.type(screen.getByLabelText("কী বাবদ খরচ"), "ভ্যানভাড়া");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(
    screen.getByLabelText("কী বাবদ খরচ").getAttribute("aria-invalid"),
  ).toBe("false");
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(state.notebook.close).toHaveBeenCalledOnce());
  const saved = state.notebook.ledger as Ledger;
  expect(saved.entries).toHaveLength(2);
  expect(saved.entries[0].lines[0]).toMatchObject({
    costType: "transport",
    amount: 20000,
  });
  expect(saved.entries[1]).toMatchObject({
    kind: "payment",
    account: "other",
    personId: "driver",
  });
});

it.each(["settle", "advance"] as const)(
  "only defaults an explicit %s to cash when that intent is an advance",
  async (purpose) => {
    state.notebook.ledger = LedgerSchema.parse({
      works: [{ id: "door", name: "দরজা" }],
      people: [{ id: "worker", name: "রহিম", kind: "worker" }],
    });
    const user = userEvent.setup();
    render(
      <QuickEntrySheet
        presentation="page"
        options={{
          kind: "payment",
          purpose,
          personId: "worker",
          workId: "door",
        }}
      />,
    );
    await ready();
    expect(screen.getByRole("heading", { name: "টাকা দিই" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "আগের বাকি" })).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "অগ্রিম",
        pressed: purpose === "advance",
      }),
    ).toBeTruthy();
    if (purpose === "advance")
      expect(screen.queryByRole("button", { name: "দিন হিসাবে" })).toBeNull();
    else
      expect(
        screen.getByRole("button", { name: "নতুন বিল ও টাকা", pressed: true }),
      ).toBeTruthy();
    await user.type(screen.getByLabelText("কত টাকা"), "1500");
    await user.click(screen.getByRole("button", { name: "রাখুন" }));
    await waitFor(() => expect(state.notebook.close).toHaveBeenCalledOnce());
    const saved = state.notebook.ledger as Ledger;
    expect(saved.entries).toHaveLength(purpose === "advance" ? 1 : 2);
    expect(
      saved.entries.find((entry) => entry.kind === "payment"),
    ).toMatchObject({
      kind: "payment",
      account: "labour",
      personId: "worker",
      paymentParts: [{ method: "cash", amount: 150000 }],
    });
  },
);

it("selects an existing job from the labour payment page before choosing a worker and saves only money paid", async () => {
  state.notebook.ledger = LedgerSchema.parse({
    works: [{ id: "bath", name: "বাথরুম" }],
    people: [{ id: "worker", name: "মোরশেদ", kind: "worker" }],
    contracts: [
      {
        id: "job",
        title: "পানির লাইন",
        personId: "worker",
        workId: "bath",
        total: 1000000,
      },
    ],
  });
  const user = userEvent.setup();
  render(
    <QuickEntrySheet
      presentation="page"
      options={{
        kind: "payment",
        workId: "bath",
        account: "labour",
        costType: "labour",
        purpose: "settle",
      }}
    />,
  );
  await ready();
  await user.selectOptions(
    screen.getByLabelText("কাজ", { exact: true }),
    "job",
  );
  expect(
    (screen.getByLabelText("কাকে দিচ্ছেন") as HTMLSelectElement).value,
  ).toBe("worker");
  await user.type(screen.getByLabelText("কত টাকা"), "1500");
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(state.notebook.close).toHaveBeenCalledOnce());
  const saved = state.notebook.ledger as Ledger;
  expect(saved.entries).toHaveLength(1);
  expect(saved.entries[0]).toMatchObject({
    kind: "payment",
    contractId: "job",
    personId: "worker",
    account: "labour",
    paymentParts: [{ amount: 150000 }],
  });
  expect(summarize(saved).cost).toBe(0);
});

it("isolates unfinished payments by account while keeping each amount when its page is reopened", async () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
    people: [{ id: "person", name: "রহিম", kind: "other" }],
  });
  state.notebook.ledger = ledger;
  const user = userEvent.setup();
  const base = {
    kind: "payment",
    purpose: "settle",
    personId: "person",
    workId: "door",
  } as const;
  const material = render(
    <QuickEntrySheet
      presentation="page"
      options={{ ...base, account: "materials" }}
    />,
  );
  await ready();
  await user.type(screen.getByLabelText("কত টাকা"), "1700");
  await user.click(screen.getByRole("button", { name: "ফিরুন" }));
  material.unmount();
  const labour = render(
    <QuickEntrySheet
      presentation="page"
      options={{ ...base, account: "labour" }}
    />,
  );
  await ready();
  expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe("");
  await user.type(screen.getByLabelText("কত টাকা"), "2300");
  await user.click(screen.getByRole("button", { name: "ফিরুন" }));
  labour.unmount();
  render(
    <QuickEntrySheet
      presentation="page"
      options={{ ...base, account: "materials" }}
    />,
  );
  await ready();
  expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe(
    "1700",
  );
  expect((screen.getByLabelText("কিসের টাকা") as HTMLSelectElement).value).toBe(
    "materials",
  );
  expect(
    state.drafts.has("quick-v2:payment:door:person:settle:account=materials"),
  ).toBe(true);
  expect(
    state.drafts.has("quick-v2:payment:door:person:settle:account=labour"),
  ).toBe(true);
});

it("recovers a compatible legacy payment draft into an account-specific page without deleting the old copy", async () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
    people: [{ id: "person", name: "রহিম", kind: "other" }],
  });
  state.notebook.ledger = ledger;
  const draft = {
    ...entryContext(ledger, {
      kind: "payment",
      account: "materials",
      workId: "door",
      personId: "person",
    }),
    purpose: "settle" as const,
    amount: "1700",
  };
  state.drafts.set("quick-v2:payment:door:person", { draft, files: [] });
  render(
    <QuickEntrySheet
      presentation="page"
      options={{
        kind: "payment",
        purpose: "settle",
        account: "materials",
        workId: "door",
        personId: "person",
      }}
    />,
  );
  await ready();
  expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe(
    "1700",
  );
  expect((screen.getByLabelText("কিসের টাকা") as HTMLSelectElement).value).toBe(
    "materials",
  );
  expect(state.drafts.get("quick-v2:payment:door:person")).toEqual({
    draft,
    files: [],
  });
});

it.each([
  ["labour", "settle"],
  ["materials", "advance"],
] as const)(
  "does not restore a legacy draft into an incompatible %s/%s payment",
  async (account, purpose) => {
    const ledger = LedgerSchema.parse({
      works: [{ id: "door", name: "দরজা" }],
      people: [{ id: "person", name: "রহিম", kind: "other" }],
    });
    state.notebook.ledger = ledger;
    const draft = {
      ...entryContext(ledger, {
        kind: "payment",
        account: "materials",
        workId: "door",
        personId: "person",
      }),
      amount: "1700",
    };
    state.drafts.set("quick-v2:payment:door:person", { draft, files: [] });
    render(
      <QuickEntrySheet
        presentation="page"
        options={{
          kind: "payment",
          account,
          purpose,
          workId: "door",
          personId: "person",
        }}
      />,
    );
    await ready();
    expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe(
      "",
    );
    expect(
      (screen.getByLabelText("কিসের টাকা") as HTMLSelectElement).value,
    ).toBe(account);
    expect(state.drafts.get("quick-v2:payment:door:person")).toEqual({
      draft,
      files: [],
    });
  },
);

it("waits for an unmount's pending draft write before removing a saved payment draft", async () => {
  state.notebook.ledger = LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
    people: [{ id: "shop", name: "দরজার দোকান", kind: "shop" }],
  });
  let releaseSave!: () => void;
  const saving = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  state.notebook.save = vi.fn(async (change: (current: Ledger) => Ledger) => {
    await saving;
    state.notebook.ledger = LedgerSchema.parse(
      change(state.notebook.ledger as Ledger),
    );
  });
  const user = userEvent.setup();
  const view = render(
    <QuickEntrySheet
      presentation="page"
      options={{
        kind: "payment",
        purpose: "settle",
        personId: "shop",
        workId: "door",
      }}
    />,
  );
  await ready();
  await user.type(screen.getByLabelText("কত টাকা"), "1700");
  await user.click(screen.getByRole("button", { name: "অগ্রিম" }));
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(state.notebook.save).toHaveBeenCalledOnce());
  let releaseWrite!: () => void;
  const pendingWrite = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  const writeStarted = vi.fn(async () => {
    await pendingWrite;
  });
  state.beforeWrite = writeStarted;
  view.unmount();
  await waitFor(() => expect(writeStarted).toHaveBeenCalledOnce());
  await act(async () => {
    releaseSave();
    await saving;
  });
  expect((state.notebook.ledger as Ledger).entries).toHaveLength(1);
  const key = "quick-v2:payment:door:shop:settle";
  expect(state.drafts.has(key)).toBe(true);
  await act(async () => {
    releaseWrite();
    await pendingWrite;
  });
  await waitFor(() => expect(state.drafts.has(key)).toBe(false));
  expect(state.notebook.close).not.toHaveBeenCalled();
});

it("keeps amounts and receipts isolated between two selected jobs for the same worker and work notebook", async () => {
  state.notebook.ledger = LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
    people: [{ id: "worker", name: "শাহ আলম", kind: "worker" }],
    contracts: [
      {
        id: "job-a",
        personId: "worker",
        workId: "door",
        title: "দরজা লাগানো",
        total: 6000000,
      },
      {
        id: "job-b",
        personId: "worker",
        workId: "door",
        title: "নকশার কাজ",
        total: 2000000,
      },
    ],
  });
  const user = userEvent.setup();
  const base = {
    kind: "payment",
    personId: "worker",
    account: "labour",
    workId: "door",
  } as const;
  const first = render(
    <QuickEntrySheet
      presentation="page"
      options={{ ...base, contractId: "job-a" }}
    />,
  );
  await ready();
  expect((screen.getByLabelText("কাজ") as HTMLSelectElement).value).toBe(
    "job-a",
  );
  expect(screen.queryByLabelText("চুক্তি")).toBeNull();
  expect(screen.getByRole("heading", { name: "কাজের হিসাব" })).toBeTruthy();
  await user.type(screen.getByLabelText("কত টাকা"), "1700");
  await user.click(screen.getByText("ভাউচার, নোট ও তারিখ"));
  await user.upload(
    screen.getByLabelText("ভাউচারের ছবি / PDF"),
    new File(["job a"], "job-a.pdf", { type: "application/pdf" }),
  );
  await user.click(screen.getByRole("button", { name: "ফিরুন" }));
  first.unmount();
  const second = render(
    <QuickEntrySheet
      presentation="page"
      options={{ ...base, contractId: "job-b" }}
    />,
  );
  await ready();
  expect((screen.getByLabelText("কাজ") as HTMLSelectElement).value).toBe(
    "job-b",
  );
  expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe("");
  await user.type(screen.getByLabelText("কত টাকা"), "2300");
  await user.click(screen.getByText("ভাউচার, নোট ও তারিখ"));
  expect(screen.queryByText("job-a.pdf")).toBeNull();
  await user.upload(
    screen.getByLabelText("ভাউচারের ছবি / PDF"),
    new File(["job b"], "job-b.pdf", { type: "application/pdf" }),
  );
  await user.click(screen.getByRole("button", { name: "ফিরুন" }));
  second.unmount();
  render(
    <QuickEntrySheet
      presentation="page"
      options={{ ...base, contractId: "job-a" }}
    />,
  );
  await ready();
  expect((screen.getByLabelText("কাজ") as HTMLSelectElement).value).toBe(
    "job-a",
  );
  expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe(
    "1700",
  );
  await user.click(screen.getByText("ভাউচার, নোট ও তারিখ"));
  expect(screen.getByText("job-a.pdf")).toBeTruthy();
  expect(screen.queryByText("job-b.pdf")).toBeNull();
  expect(
    state.drafts.has("quick-v2:payment:door:worker:account=labour:job=job-a"),
  ).toBe(true);
  expect(
    state.drafts.has("quick-v2:payment:door:worker:account=labour:job=job-b"),
  ).toBe(true);
});

it.each(["job-a", "job-b"])(
  "restores an older account-specific draft only when its saved job matches requested %s",
  async (contractId) => {
    const ledger = LedgerSchema.parse({
      works: [{ id: "door", name: "দরজা" }],
      people: [{ id: "worker", name: "শাহ আলম", kind: "worker" }],
      contracts: [
        {
          id: "job-a",
          personId: "worker",
          workId: "door",
          title: "দরজা লাগানো",
          total: 6000000,
        },
        {
          id: "job-b",
          personId: "worker",
          workId: "door",
          title: "নকশার কাজ",
          total: 2000000,
        },
      ],
    });
    state.notebook.ledger = ledger;
    const options = {
      kind: "payment",
      personId: "worker",
      account: "labour",
      workId: "door",
    } as const;
    const draft = {
      ...entryContext(ledger, options),
      amount: "1700",
      purpose: "settle",
      contractId: "job-a",
    };
    const file = new File(["older voucher"], "older-job-a.pdf", {
      type: "application/pdf",
    });
    const oldCopy = {
      draft,
      files: [{ id: "voucher", entryId: draft.id, name: file.name, file }],
    };
    state.drafts.set("quick-v2:payment:door:worker:account=labour", oldCopy);
    render(
      <QuickEntrySheet
        presentation="page"
        options={{ ...options, contractId }}
      />,
    );
    await ready();
    expect((screen.getByLabelText("কাজ") as HTMLSelectElement).value).toBe(
      contractId,
    );
    expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe(
      contractId === "job-a" ? "1700" : "",
    );
    await userEvent.click(screen.getByText("ভাউচার, নোট ও তারিখ"));
    if (contractId === "job-a")
      expect(screen.getByText("older-job-a.pdf")).toBeTruthy();
    else expect(screen.queryByText("older-job-a.pdf")).toBeNull();
    expect(
      state.drafts.get("quick-v2:payment:door:worker:account=labour"),
    ).toBe(oldCopy);
  },
);

it("keeps a migrated source draft if another form changes it while this entry is saved", async () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "door", name: "নমুনা দরজা" }],
    people: [{ id: "person", name: "নমুনা ব্যক্তি", kind: "other" }],
  });
  state.notebook.ledger = ledger;
  const draft = {
    ...entryContext(ledger, {
      kind: "payment",
      account: "materials",
      workId: "door",
      personId: "person",
    }),
    purpose: "settle" as const,
    amount: "1700",
  };
  const source = "quick-v2:payment:door:person";
  state.drafts.set(source, { draft, files: [] });
  const save = state.notebook.save as (
    change: Ledger | ((current: Ledger) => Ledger),
  ) => Promise<void>;
  state.notebook.save = vi.fn(async (change) => {
    await save(change);
    state.drafts.set(source, {
      draft: { ...draft, amount: "2500" },
      files: [],
    });
  });
  render(
    <QuickEntrySheet
      presentation="page"
      options={{
        kind: "payment",
        purpose: "settle",
        account: "materials",
        workId: "door",
        personId: "person",
      }}
    />,
  );
  await ready();
  expect(
    (screen.getByRole("button", { name: "রাখুন" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "অগ্রিম" }));
  await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(state.notebook.close).toHaveBeenCalledOnce());
  expect(state.drafts.get(source)).toEqual({
    draft: { ...draft, amount: "2500" },
    files: [],
  });
  expect(state.drafts.has(`${source}:settle:account=materials`)).toBe(false);
  expect((state.notebook.ledger as Ledger).entries).toHaveLength(1);
});

describe("balance-aware payment choices", () => {
  it.each([
    ["worker", "labour"],
    ["shop", "materials"],
    ["driver", "other"],
    ["other", "other"],
  ] as const)(
    "starts a fresh %s payment as a new bill when there is no debt",
    async (kind, account) => {
      state.notebook.ledger = LedgerSchema.parse({
        works: [{ id: "work", name: "নমুনা খাতা" }],
        people: [{ id: "person", name: "নমুনা নাম", kind }],
      });
      render(
        <QuickEntrySheet
          presentation="page"
          options={{
            kind: "payment",
            personId: "person",
            workId: "work",
            account,
          }}
        />,
      );
      await ready();
      expect(screen.queryByRole("button", { name: "বাকি মেটাই" })).toBeNull();
      expect(
        screen.getByRole("button", { name: "নতুন বিল ও টাকা", pressed: true }),
      ).toBeTruthy();
      await userEvent.type(screen.getByLabelText("কত টাকা"), "100");
      await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
      await waitFor(() => expect(state.notebook.close).toHaveBeenCalledOnce());
      const saved = state.notebook.ledger as Ledger;
      expect(saved.entries.map((entry) => entry.kind)).toEqual([
        "expense",
        "payment",
      ]);
      expect(saved.entries[1].relatedEntryId).toBe(saved.entries[0].id);
      expect(saved.entries[0].lines[0].amount).toBe(10000);
      expect(saved.people[0].kind).toBe(kind);
    },
  );

  it("preserves an unfinished old cash draft and requires an explicit choice when there is no longer any debt", async () => {
    const ledger = LedgerSchema.parse({
      works: [{ id: "work", name: "নমুনা খাতা" }],
      people: [{ id: "person", name: "নমুনা নাম", kind: "other" }],
    });
    state.notebook.ledger = ledger;
    const draft = {
      ...entryContext(ledger, {
        kind: "payment",
        personId: "person",
        workId: "work",
        account: "other",
      }),
      purpose: "settle" as const,
      amount: "125",
      note: "অসমাপ্ত টাকা দেওয়ার লেখা",
    };
    state.drafts.set("quick-v2:payment:work:person:account=other", {
      draft,
      files: [],
    });
    const view = render(
      <QuickEntrySheet
        presentation="page"
        options={{
          kind: "payment",
          personId: "person",
          workId: "work",
          account: "other",
        }}
      />,
    );
    await ready();
    expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe(
      "125",
    );
    expect(screen.queryByRole("button", { name: "বাকি মেটাই" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "নতুন বিল ও টাকা", pressed: false }),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "রাখুন" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.submit(view.container.querySelector("form")!);
    expect(state.notebook.save).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "অগ্রিম" }));
    await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
    await waitFor(() => expect(state.notebook.close).toHaveBeenCalledOnce());
    const saved = state.notebook.ledger as Ledger;
    expect(saved.entries).toHaveLength(1);
    expect(saved.entries[0]).toMatchObject({
      id: draft.id,
      kind: "payment",
      note: draft.note,
      allocations: [{ amount: 12500 }],
    });
  });

  it("uses the selected job's corrected balance, and never defaults another bill for a settled job", async () => {
    const original = LedgerSchema.parse({
      works: [{ id: "work", name: "নমুনা খাতা" }],
      people: [{ id: "person", name: "নমুনা নাম", kind: "other" }],
      contracts: [
        { id: "job", personId: "person", workId: "work", total: 100000 },
      ],
      entries: [
        {
          id: "paid",
          kind: "payment",
          account: "labour",
          personId: "person",
          contractId: "job",
          allocations: [{ workId: "work", amount: 50000 }],
          paymentParts: [{ amount: 50000 }],
        },
      ],
    });
    const corrected = appendBalanceAdjustment(original, {
      target: "person",
      basis: "paid",
      personId: "person",
      account: "labour",
      contractId: "job",
      expectedBefore: 50000,
      after: 100000,
      reason: "নমুনা কাজের টাকা মেলানো",
    });
    state.notebook.ledger = corrected;
    const view = render(
      <QuickEntrySheet
        presentation="page"
        options={{
          kind: "payment",
          personId: "person",
          workId: "work",
          account: "labour",
          contractId: "job",
        }}
      />,
    );
    await ready();
    expect(screen.queryByRole("button", { name: "বাকি মেটাই" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "নতুন বিল ও টাকা" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "অগ্রিম", pressed: true }),
    ).toBeTruthy();
    await userEvent.type(screen.getByLabelText("কত টাকা"), "150");
    expect(
      view.container.querySelector(".entry-balance-result")?.textContent,
    ).toBe("অগ্রিম থাকবে1150");
    await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
    await waitFor(() => expect(state.notebook.close).toHaveBeenCalledOnce());
    const saved = state.notebook.ledger as Ledger;
    expect(saved.entries.slice(0, 2)).toEqual(corrected.entries);
    expect(saved.entries).toHaveLength(3);
    expect(saved.entries.at(-1)).toMatchObject({
      kind: "payment",
      contractId: "job",
      account: "labour",
    });
    expect(
      saved.entries.filter((entry) => entry.kind === "expense"),
    ).toHaveLength(0);
  });
});

it("keeps a typed material bill, partial payment and global reason when choosing a worker as payee", async () => {
  state.notebook.ledger = LedgerSchema.parse({
    works: [{ id: "work", name: "নমুনা খাতা" }],
    people: [
      {
        id: "worker",
        name: "নমুনা মিস্ত্রি",
        kind: "worker",
        roles: ["craftsperson", "supplier"],
      },
    ],
    contracts: [
      { id: "worker-job", personId: "worker", workId: "work", total: 100000 },
    ],
  });
  const user = userEvent.setup();
  render(
    <QuickEntrySheet
      presentation="page"
      options={{
        kind: "payment",
        account: "materials",
        costType: "material",
        workId: "work",
      }}
    />,
  );
  await ready();
  await user.type(screen.getByLabelText("কত টাকা"), "100");
  await user.selectOptions(screen.getByLabelText("কিসের টাকা"), "__new__");
  await user.type(
    screen.getByLabelText("কিসের টাকা লিখুন"),
    "নমুনা মালের টাকা",
  );
  await user.click(screen.getByRole("button", { name: "টাকা লিখি" }));
  await user.type(screen.getByLabelText("এখন কত দিলেন"), "40");
  await user.selectOptions(screen.getByLabelText("কাকে দিচ্ছেন"), "worker");
  expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe(
    "100",
  );
  expect(
    (screen.getByLabelText("এখন কত দিলেন") as HTMLInputElement).value,
  ).toBe("40");
  expect(
    (screen.getByLabelText("কিসের টাকা লিখুন") as HTMLInputElement).value,
  ).toBe("নমুনা মালের টাকা");
  expect(
    (screen.getByLabelText("কোন হিসাবের অংশ") as HTMLSelectElement).value,
  ).toBe("materials");
  expect(screen.queryByLabelText("কাজ")).toBeNull();
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(state.notebook.close).toHaveBeenCalledOnce());
  const saved = state.notebook.ledger as Ledger;
  expect(saved.entries).toHaveLength(2);
  expect(saved.entries[0]).toMatchObject({
    kind: "expense",
    account: "materials",
    personId: "worker",
    contractId: null,
    lines: [{ label: "নমুনা মালের টাকা", amount: 10000, costType: "material" }],
  });
  expect(saved.entries[1]).toMatchObject({
    kind: "payment",
    account: "materials",
    personId: "worker",
    contractId: null,
    paymentParts: [{ amount: 4000 }],
  });
  expect(saved.entries[1].relatedEntryId).toBe(saved.entries[0].id);
  expect(saved.people[0].kind).toBe("worker");
});

it("uses an explicit labour expense type consistently after a shop with a configured worker role is selected", async () => {
  state.notebook.ledger = LedgerSchema.parse({
    works: [{ id: "work", name: "নমুনা খাতা" }],
    people: [
      {
        id: "shop",
        name: "নমুনা দোকান",
        kind: "shop",
        roles: ["supplier", "craftsperson"],
      },
    ],
  });
  const user = userEvent.setup();
  const view = render(
    <QuickEntrySheet
      presentation="page"
      options={{ kind: "expense", costType: "labour", workId: "work" }}
    />,
  );
  await ready();
  await user.type(
    screen.getByLabelText("কী কাজের মজুরি"),
    "নমুনা মাটি কাটার কাজ",
  );
  await user.type(screen.getByLabelText("কত টাকা"), "300");
  await user.click(screen.getByRole("button", { name: "টাকা লিখি" }));
  await user.type(screen.getByLabelText("এখন কত দিলেন"), "100");
  await user.selectOptions(screen.getByLabelText("কোন কর্মী"), "shop");
  expect(
    view.container.querySelector(".entry-balance-result")?.textContent,
  ).toBe("বাকি থাকবে200");
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(state.notebook.close).toHaveBeenCalledOnce());
  const saved = state.notebook.ledger as Ledger;
  expect(saved.entries).toHaveLength(2);
  expect(saved.entries[0]).toMatchObject({
    kind: "expense",
    account: "labour",
    personId: "shop",
    lines: [
      { amount: 30000, costType: "labour", label: "নমুনা মাটি কাটার কাজ" },
    ],
  });
  expect(saved.entries[1]).toMatchObject({
    kind: "payment",
    account: "labour",
    personId: "shop",
    paymentParts: [{ amount: 10000 }],
  });
  expect(saved.entries[1].relatedEntryId).toBe(saved.entries[0].id);
  expect(saved.people[0].kind).toBe("shop");
});

describe("NARC-131 preferred payment job", () => {
  function jobsLedger() {
    return LedgerSchema.parse({
      works: [
        { id: "tiles", name: "টাইলসের খাতা" },
        { id: "paint", name: "রঙের খাতা" },
      ],
      people: [{ id: "person", name: "নমুনা মিস্ত্রি", kind: "worker" }],
      contracts: [
        {
          id: "done",
          title: "রং করা",
          personId: "person",
          workId: "paint",
          status: "done",
          agreedOn: "2026-11-04",
          total: 100000,
        },
        {
          id: "ongoing",
          title: "টাইলস বসানো",
          personId: "person",
          workId: "tiles",
          status: "ongoing",
          agreedOn: "2026-10-01",
          total: 200000,
        },
      ],
    });
  }

  it("opens the ongoing job and notebook, then records only its payment", async () => {
    const original = jobsLedger();
    state.notebook.ledger = original;
    const user = userEvent.setup();
    render(
      <QuickEntrySheet
        presentation="page"
        options={{ kind: "payment", personId: "person" }}
      />,
    );
    await ready();
    expect(
      (screen.getByLabelText("কাজ", { exact: true }) as HTMLSelectElement)
        .value,
    ).toBe("ongoing");
    expect((screen.getByLabelText("খাতা") as HTMLSelectElement).value).toBe(
      "tiles",
    );
    expect(
      screen.getByRole("button", { name: "অগ্রিম", pressed: true }),
    ).toBeTruthy();
    await user.type(screen.getByLabelText("কত টাকা"), "500");
    await user.click(screen.getByRole("button", { name: "রাখুন" }));
    await waitFor(() => expect(state.notebook.close).toHaveBeenCalledOnce());
    const saved = state.notebook.ledger as Ledger;
    expect(saved.contracts).toEqual(original.contracts);
    expect(saved.entries).toHaveLength(1);
    expect(saved.entries[0]).toMatchObject({
      kind: "payment",
      contractId: "ongoing",
      personId: "person",
      allocations: [{ workId: "tiles", amount: 50000 }],
    });
    expect(summarize(saved).cost).toBe(0);
  });

  it("keeps a manual Other work choice across notebook changes and reopening", async () => {
    state.notebook.ledger = jobsLedger();
    const user = userEvent.setup();
    const options = { kind: "payment", personId: "person" } as const;
    const view = render(
      <QuickEntrySheet presentation="page" options={options} />,
    );
    await ready();
    await user.selectOptions(screen.getByLabelText("কাজ", { exact: true }), "");
    await user.selectOptions(screen.getByLabelText("খাতা"), "paint");
    await user.click(screen.getByRole("button", { name: "নতুন বিল ও টাকা" }));
    expect(
      (screen.getByLabelText("কাজ", { exact: true }) as HTMLSelectElement)
        .value,
    ).toBe("");
    expect(
      screen.getByRole("button", { name: "নতুন বিল ও টাকা", pressed: true }),
    ).toBeTruthy();
    await user.type(screen.getByLabelText("কত টাকা"), "125");
    view.unmount();
    await waitFor(() => {
      expect(state.drafts.has("quick-v2:payment:all:person")).toBe(true);
    });
    render(<QuickEntrySheet presentation="page" options={options} />);
    await ready();
    expect(
      (screen.getByLabelText("কাজ", { exact: true }) as HTMLSelectElement)
        .value,
    ).toBe("");
    expect((screen.getByLabelText("খাতা") as HTMLSelectElement).value).toBe(
      "paint",
    );
    expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe(
      "125",
    );
    expect(
      screen.getByRole("button", { name: "নতুন বিল ও টাকা", pressed: true }),
    ).toBeTruthy();
  });

  it("clears an inapplicable automatic job after money is written instead of assigning it to another notebook's job", async () => {
    state.notebook.ledger = jobsLedger();
    const user = userEvent.setup();
    render(
      <QuickEntrySheet
        presentation="page"
        options={{ kind: "payment", personId: "person" }}
      />,
    );
    await ready();
    await user.type(screen.getByLabelText("কত টাকা"), "125");
    await user.selectOptions(screen.getByLabelText("খাতা"), "paint");
    expect(
      (screen.getByLabelText("কাজ", { exact: true }) as HTMLSelectElement)
        .value,
    ).toBe("");
    expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe(
      "125",
    );
    expect(state.notebook.save).not.toHaveBeenCalled();
  });
});
