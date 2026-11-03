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
import { createRef, type SelectHTMLAttributes } from "react";
import { MemoryRouter } from "react-router";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { readBalanceAdjustmentScope } from "../../domain/balanceAdjustments";
import { TotalAdjustmentForm } from "./TotalAdjustmentForm";
import { ReconciliationPage } from "./ReconciliationPage";

const context = vi.hoisted(() => ({
  ledger: null as unknown,
  save: vi.fn(),
  go: vi.fn(),
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
beforeEach(() => {
  context.ledger = fixture();
  context.drafts.clear();
  context.go.mockReset();
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
      <TotalAdjustmentForm target={target} />
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
  await enter();
  expect(screen.getByText("৳6500")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "সমন্বয় রাখুন" }));
  await waitFor(() => expect(context.go).toHaveBeenCalled());
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
  await waitFor(() => expect(context.go).toHaveBeenCalled());
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
  await waitFor(() => expect(context.go).toHaveBeenCalledTimes(1));
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
  render(<TotalAdjustmentForm target={target} beforeCloseRef={beforeClose} />);
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

it("uses the existing reconciliation page for an unallocated notebook adjustment", async () => {
  render(
    <MemoryRouter initialEntries={["/reconcile?target=work&work=work"]}>
      <ReconciliationPage />
    </MemoryRouter>,
  );
  await screen.findByText("৳30000");
  await enter("28000");
  await userEvent.click(screen.getByRole("button", { name: "সমন্বয় রাখুন" }));
  await waitFor(() => expect(context.go).toHaveBeenCalledWith("/works/work"));
  expect((context.ledger as Ledger).entries[2]).toMatchObject({
    kind: "adjustment",
    personId: null,
    contractId: null,
    adjustment: {
      target: "work",
      basis: "paid",
      account: null,
      workId: "work",
      delta: -200000,
    },
  });
  expect(
    readBalanceAdjustmentScope(context.ledger as Ledger, {
      target: "person",
      basis: "paid",
      personId: "shop",
      account: "materials",
    }).value,
  ).toBe(3000000);
});
