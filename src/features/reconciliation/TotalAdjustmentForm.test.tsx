// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, type ReactNode, type SelectHTMLAttributes } from "react";
import { MemoryRouter } from "react-router";
import { LedgerSchema, type Ledger } from "../../domain/model";
import {
  appendBalanceAdjustment,
  readBalanceAdjustmentScope,
} from "../../domain/balanceAdjustments";
import { TotalAdjustmentForm } from "./TotalAdjustmentForm";
import { TotalAdjustmentSheet } from "./TotalAdjustmentSheet";

const context = vi.hoisted(() => ({
  ledger: null as unknown,
  save: vi.fn(),
  go: vi.fn(),
  saved: vi.fn(),
  drafts: new Map<string, unknown>(),
  draftSave: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    ledger: context.ledger as Ledger,
    save: context.save,
    go: context.go,
    mode: "demo",
    base: "/sample",
  }),
}));
vi.mock("../../components/ui/AppSelect", () => ({
  AppSelect: (props: SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props} />
  ),
}));
vi.mock("../../components/Sheet", () => ({
  Sheet: ({
    title,
    subtitle,
    children,
    onClose,
  }: {
    title: string;
    subtitle?: string;
    children: ReactNode;
    onClose: () => void;
  }) => (
    <section role="dialog" aria-label={title}>
      <p>{subtitle}</p>
      {children}
      <button onClick={onClose}>বন্ধ করুন</button>
    </section>
  ),
}));
vi.mock("../../data/repository", () => ({
  createWorkspaceStorage: () => ({
    readDraft: async (key: string) => context.drafts.get(key) ?? null,
    saveDraft: async (key: string, value: unknown) => {
      context.draftSave(key, value);
      context.drafts.set(key, structuredClone(value));
    },
    removeDraft: async (key: string) => {
      context.drafts.delete(key);
    },
  }),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    language: "bn",
    formatDigits: String,
    number: String,
    money: (value: number) => `৳${value / 100}`,
    date: String,
    t: (value: string, params: Record<string, string | number> = {}) =>
      value.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
        String(params[key] ?? ""),
      ),
  }),
}));

function fixture() {
  return LedgerSchema.parse({
    works: [{ id: "work", name: "নমুনা খাতা" }],
    people: [{ id: "shop", name: "নমুনা দোকান", kind: "shop" }],
    entries: [
      {
        id: "bill",
        kind: "expense",
        personId: "shop",
        account: "materials",
        lines: [
          { id: "line", workId: "work", label: "নমুনা মাল", amount: 5000000 },
        ],
      },
      {
        id: "paid",
        kind: "payment",
        personId: "shop",
        account: "materials",
        allocations: [{ workId: "work", amount: 3000000 }],
        paymentParts: [{ amount: 3000000 }],
      },
    ],
  });
}
function scopedFixture() {
  const base = fixture();
  return LedgerSchema.parse({
    ...base,
    works: [...base.works, { id: "other-work", name: "দ্বিতীয় নমুনা খাতা" }],
    people: [...base.people, { id: "other-shop", name: "অন্য নমুনা দোকান" }],
    entries: [
      ...base.entries,
      {
        id: "other-work-bill",
        kind: "expense",
        personId: "shop",
        account: "materials",
        lines: [
          {
            id: "other-work-line",
            workId: "other-work",
            label: "অন্য খাতার মাল",
            amount: 2000000,
          },
        ],
      },
      {
        id: "other-work-paid",
        kind: "payment",
        personId: "shop",
        account: "materials",
        allocations: [{ workId: "other-work", amount: 500000 }],
        paymentParts: [{ amount: 500000 }],
      },
      {
        id: "other-shop-bill",
        kind: "expense",
        personId: "other-shop",
        account: "materials",
        lines: [
          {
            id: "other-shop-line",
            workId: "work",
            label: "মাল",
            amount: 900000,
          },
        ],
      },
    ],
  });
}
beforeEach(() => {
  context.ledger = fixture();
  context.drafts.clear();
  context.go.mockReset();
  context.saved.mockReset();
  context.draftSave.mockReset();
  context.save
    .mockReset()
    .mockImplementation(async (change: (ledger: Ledger) => Ledger) => {
      context.ledger = change(context.ledger as Ledger);
    });
});
afterEach(cleanup);
const target = {
  target: "person" as const,
  id: "shop",
  account: "materials" as const,
};
function show() {
  return render(
    <MemoryRouter>
      <TotalAdjustmentForm target={target} onSaved={context.saved} />
    </MemoryRouter>,
  );
}
async function enter(
  amount = "23500",
  reason = "নমুনা হিসাব মিলিয়ে ঠিক করেছি",
) {
  await waitFor(() =>
    expect(screen.getByLabelText("সঠিক অঙ্ক").hasAttribute("disabled")).toBe(
      false,
    ),
  );
  fireEvent.change(screen.getByLabelText("সঠিক অঙ্ক"), {
    target: { value: amount },
  });
  if (reason)
    fireEvent.change(screen.getByLabelText("কারণ"), {
      target: { value: reason },
    });
}

it("corrects the person's paid total with one separate adjustment and preserves the actual payment and bill", async () => {
  show();
  await screen.findByText("৳30000");
  expect(
    screen.getByText("সব খাতার মোট মিলবে। আলাদা খাতায় ভাগ হবে না।"),
  ).toBeTruthy();
  await enter();
  expect(screen.getByText("৳6500")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "সমন্বয় রাখুন" }));
  await waitFor(() => expect(context.saved).toHaveBeenCalled());
  const ledger = context.ledger as Ledger;
  expect(ledger.entries).toHaveLength(3);
  expect(ledger.entries[2]).toMatchObject({
    kind: "adjustment",
    personId: "shop",
    note: "নমুনা হিসাব মিলিয়ে ঠিক করেছি",
    adjustment: {
      target: "person",
      basis: "paid",
      account: "materials",
      before: 3000000,
      after: 2350000,
      delta: -650000,
    },
  });
  expect(ledger.entries[1].paymentParts[0].amount).toBe(3000000);
  expect(ledger.entries[0].lines[0].amount).toBe(5000000);
  expect(
    readBalanceAdjustmentScope(ledger, {
      target: "person",
      basis: "paid",
      personId: "shop",
      account: "materials",
    }).value,
  ).toBe(2350000);
  expect(context.drafts.size).toBe(0);
});

it("requires a reason and refuses an unchanged or invalid total", async () => {
  show();
  await screen.findByText("৳30000");
  await enter("23500", "");
  await userEvent.click(screen.getByRole("button", { name: "সমন্বয় রাখুন" }));
  expect(screen.getByRole("alert").textContent).toContain("কেন বদলাচ্ছেন");
  await enter("30000");
  await userEvent.click(screen.getByRole("button", { name: "সমন্বয় রাখুন" }));
  expect(screen.getByRole("alert").textContent).toContain("অঙ্ক বদলায়নি");
  await enter("-5");
  await userEvent.click(screen.getByRole("button", { name: "সমন্বয় রাখুন" }));
  expect(context.save).not.toHaveBeenCalled();
});

it("can reconcile an amount owed to credit without recording a cash payment", async () => {
  show();
  await screen.findByText("৳30000");
  fireEvent.change(screen.getByRole("combobox", { name: "যে মোট মিলাব" }), {
    target: { value: "balance" },
  });
  await screen.findByText("দিতে বাকি ৳20000");
  fireEvent.change(screen.getByRole("combobox", { name: "সঠিক অবস্থাটি" }), {
    target: { value: "credit" },
  });
  await enter("1500");
  expect(screen.getByText("আমার জমা ৳1500")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "সমন্বয় রাখুন" }));
  await waitFor(() => expect(context.saved).toHaveBeenCalled());
  expect((context.ledger as Ledger).entries[2].adjustment).toMatchObject({
    basis: "balance",
    before: 2000000,
    after: -150000,
    delta: -2150000,
  });
  expect((context.ledger as Ledger).entries[1].paymentParts[0].amount).toBe(
    3000000,
  );
});

it("keeps an unfinished correction across closing and reopening", async () => {
  const view = show();
  await screen.findByText("৳30000");
  await enter();
  view.unmount();
  await waitFor(() => expect(context.drafts.size).toBe(1));
  show();
  await screen.findByText("আগের লেখা ফিরিয়ে আনা হয়েছে।");
  expect(
    (screen.getByLabelText("সঠিক অঙ্ক") as HTMLInputElement).value,
  ).toMatch(/23500|২৩৫০০/);
  expect((screen.getByLabelText("কারণ") as HTMLTextAreaElement).value).toBe(
    "নমুনা হিসাব মিলিয়ে ঠিক করেছি",
  );
});

it("rejects a concurrent balance change without losing the typed correction", async () => {
  context.save.mockImplementation(
    async (change: (ledger: Ledger) => Ledger) => {
      const newer = fixture();
      newer.entries[1].paymentParts[0].amount = 3100000;
      newer.entries[1].allocations[0].amount = 3100000;
      change(LedgerSchema.parse(newer));
    },
  );
  show();
  await screen.findByText("৳30000");
  await enter();
  await userEvent.click(screen.getByRole("button", { name: "সমন্বয় রাখুন" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("হিসাব আগে বদলেছে"),
  );
  expect(context.go).not.toHaveBeenCalled();
  expect(
    (screen.getByLabelText("সঠিক অঙ্ক") as HTMLInputElement).value,
  ).toMatch(/23500|২৩৫০০/);
  expect(context.drafts.size).toBe(1);
});

it("prevents duplicate submissions while the first save is pending", async () => {
  let release!: () => void;
  context.save.mockImplementation(
    async (change: (ledger: Ledger) => Ledger) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      context.ledger = change(context.ledger as Ledger);
    },
  );
  const view = show();
  await screen.findByText("৳30000");
  await enter();
  fireEvent.submit(view.container.querySelector("form")!);
  fireEvent.submit(view.container.querySelector("form")!);
  await waitFor(() => expect(context.save).toHaveBeenCalledTimes(1));
  release();
  await waitFor(() => expect(context.saved).toHaveBeenCalledTimes(1));
  expect(
    (context.ledger as Ledger).entries.filter(
      (entry) => entry.kind === "adjustment",
    ),
  ).toHaveLength(1);
});

it("finishes the contextual panel without navigating to another page", async () => {
  const close = vi.fn();
  render(<TotalAdjustmentForm target={target} onSaved={close} />);
  await screen.findByText("৳30000");
  await enter();
  await userEvent.click(screen.getByRole("button", { name: "সমন্বয় রাখুন" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(context.go).not.toHaveBeenCalled();
});

it("keeps the panel open with its text when the final draft write fails", async () => {
  const beforeClose = createRef<(() => Promise<boolean>) | null>();
  render(
    <TotalAdjustmentForm
      target={target}
      onSaved={context.saved}
      beforeCloseRef={beforeClose}
    />,
  );
  await screen.findByText("৳30000");
  await enter();
  context.draftSave.mockImplementationOnce(() => {
    throw new Error("disk write failed");
  });
  let closed = true;
  await act(async () => {
    closed = await beforeClose.current!();
  });
  expect(closed).toBe(false);
  expect(screen.getByRole("alert").textContent).toContain("লেখা রাখা যায়নি");
  expect((screen.getByLabelText("কারণ") as HTMLTextAreaElement).value).toBe(
    "নমুনা হিসাব মিলিয়ে ঠিক করেছি",
  );
  await act(async () => {
    closed = await beforeClose.current!();
  });
  expect(closed).toBe(true);
  expect(
    context.drafts.get("total-adjustment:person:shop:materials"),
  ).toMatchObject({ amount: "23500" });
});

it("rejects a corrupted stored draft until the user explicitly discards it", async () => {
  const key = "total-adjustment:person:shop:materials";
  context.drafts.set(key, {
    basis: "paid",
    amount: "23500",
    reason: "saved",
    expectedBefore: "broken",
  });
  show();
  await screen.findByRole("alert");
  expect(context.draftSave).not.toHaveBeenCalled();
  expect(context.drafts.get(key)).toMatchObject({ expectedBefore: "broken" });
  await userEvent.click(
    screen.getByRole("button", { name: "অসমাপ্ত লেখা বাদ দিন" }),
  );
  await screen.findByText("৳30000");
  expect(context.drafts.get(key)).toBeUndefined();
});

it.each([
  { basis: "paid" as const, before: 3000000, amount: "28000", after: 2800000 },
  { basis: "cost" as const, before: 5000000, amount: "48000", after: 4800000 },
  {
    basis: "balance" as const,
    before: 2000000,
    amount: "18000",
    after: 1800000,
  },
])(
  "corrects only the selected person's notebook $basis without changing actual transactions or another notebook",
  async ({ basis, before, amount, after }) => {
    const original = scopedFixture();
    context.ledger = original;
    const read = (ledger: Ledger, personId: string, workId: string) =>
      readBalanceAdjustmentScope(ledger, {
        target: "person",
        basis,
        personId,
        account: "materials",
        workId,
      });
    const otherWorkBefore = read(original, "shop", "other-work");
    const otherPersonBefore = read(original, "other-shop", "work");
    render(
      <TotalAdjustmentForm
        target={{ ...target, workId: "work" }}
        onSaved={context.saved}
      />,
    );
    await screen.findByText("৳30000");
    expect(
      screen.queryByText("সব খাতার মোট মিলবে। আলাদা খাতায় ভাগ হবে না।"),
    ).toBeNull();
    if (basis !== "paid")
      fireEvent.change(screen.getByRole("combobox", { name: "যে মোট মিলাব" }), {
        target: { value: basis },
      });
    await waitFor(() =>
      expect(
        screen.getByText(
          basis === "balance" ? "দিতে বাকি ৳20000" : `৳${before / 100}`,
        ),
      ).toBeTruthy(),
    );
    await enter(amount);
    await userEvent.click(screen.getByRole("button", { name: "সমন্বয় রাখুন" }));
    await waitFor(() => expect(context.saved).toHaveBeenCalledOnce());
    const saved = context.ledger as Ledger;
    expect(saved.entries.slice(0, original.entries.length)).toEqual(
      original.entries,
    );
    expect(saved.entries.at(-1)).toMatchObject({
      kind: "adjustment",
      personId: "shop",
      account: "materials",
      contractId: null,
      adjustment: {
        target: "person",
        basis,
        account: "materials",
        workId: "work",
        before,
        after,
        delta: after - before,
      },
    });
    expect(read(saved, "shop", "work").value).toBe(after);
    expect(read(saved, "shop", "other-work")).toEqual(otherWorkBefore);
    expect(read(saved, "other-shop", "work")).toEqual(otherPersonBefore);
    expect(context.drafts.size).toBe(0);
  },
);

it("keeps all-notebook and legacy notebook drafts while isolating each selected notebook", async () => {
  const base = scopedFixture();
  const legacyScope = {
    target: "work" as const,
    basis: "paid" as const,
    workId: "work",
    account: null,
  };
  const legacyBefore = readBalanceAdjustmentScope(base, legacyScope).value;
  context.ledger = appendBalanceAdjustment(base, {
    ...legacyScope,
    expectedBefore: legacyBefore,
    after: legacyBefore - 10000,
    reason: "আগের খাতার সমন্বয়",
  });
  const original = context.ledger as Ledger;
  const globalKey = "total-adjustment:person:shop:materials";
  const scopedKey = `${globalKey}:work:work`;
  const legacyKey = "total-adjustment:work:work:all";
  const globalDraft = {
    basis: "paid",
    position: "due",
    amount: "33000",
    reason: "সব খাতার অসমাপ্ত লেখা",
    expectedBefore: 3500000,
  };
  const legacyDraft = { ...globalDraft, reason: "আগের খাতার অসমাপ্ত লেখা" };
  context.drafts.set(globalKey, globalDraft);
  context.drafts.set(legacyKey, legacyDraft);
  let view = render(
    <TotalAdjustmentSheet
      target={{ ...target, workId: "work" }}
      name="নমুনা দোকান"
      onClose={context.saved}
    />,
  );
  await screen.findByText("৳30000");
  expect(screen.getByRole("dialog").textContent).toContain("নমুনা খাতা");
  expect(screen.getByRole("dialog").textContent).not.toContain(
    "সব খাতা মিলিয়ে",
  );
  expect((screen.getByLabelText("সঠিক অঙ্ক") as HTMLInputElement).value).toBe(
    "",
  );
  expect((screen.getByLabelText("কারণ") as HTMLTextAreaElement).value).toBe("");
  await enter("28000", "প্রথম খাতার অসমাপ্ত লেখা");
  view.unmount();
  await waitFor(() =>
    expect(context.drafts.get(scopedKey)).toMatchObject({
      amount: "28000",
      reason: "প্রথম খাতার অসমাপ্ত লেখা",
      expectedBefore: 3000000,
    }),
  );
  expect(context.drafts.get(globalKey)).toEqual(globalDraft);
  expect(context.drafts.get(legacyKey)).toEqual(legacyDraft);

  view = show();
  await screen.findByText("আগের লেখা ফিরিয়ে আনা হয়েছে।");
  expect(
    (screen.getByLabelText("সঠিক অঙ্ক") as HTMLInputElement).value,
  ).toMatch(/33000|৩৩০০০/);
  expect((screen.getByLabelText("কারণ") as HTMLTextAreaElement).value).toBe(
    globalDraft.reason,
  );
  view.unmount();

  view = render(
    <TotalAdjustmentSheet
      target={{ ...target, workId: "work" }}
      name="নমুনা দোকান"
      onClose={context.saved}
    />,
  );
  await screen.findByText("আগের লেখা ফিরিয়ে আনা হয়েছে।");
  view.rerender(
    <TotalAdjustmentSheet
      target={{ ...target, workId: "other-work" }}
      name="নমুনা দোকান"
      onClose={context.saved}
    />,
  );
  await screen.findByText("৳5000");
  expect(screen.getByRole("dialog").textContent).toContain(
    "দ্বিতীয় নমুনা খাতা",
  );
  expect((screen.getByLabelText("সঠিক অঙ্ক") as HTMLInputElement).value).toBe(
    "",
  );
  expect((screen.getByLabelText("কারণ") as HTMLTextAreaElement).value).toBe("");
  expect(context.ledger).toEqual(original);
  expect(context.drafts.get(globalKey)).toEqual(globalDraft);
  expect(context.drafts.get(legacyKey)).toEqual(legacyDraft);
  expect(context.save).not.toHaveBeenCalled();
});
