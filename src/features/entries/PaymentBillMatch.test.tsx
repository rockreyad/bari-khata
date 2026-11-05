// @vitest-environment jsdom
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
import { summarize } from "../../domain/ledger";
import { PaymentBillMatch } from "./PaymentBillMatch";

const state = vi.hoisted(() => ({
  ledger: null as unknown,
  save: vi.fn(),
  detail: vi.fn(),
  drafts: new Map<string, unknown>(),
  readDraft: vi.fn(),
  saveDraft: vi.fn(),
  removeDraft: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    ledger: state.ledger as Ledger,
    mode: "demo",
    save: state.save,
    detail: state.detail,
  }),
}));
vi.mock("../../data/repository", () => ({
  createWorkspaceStorage: () => ({
    readDraft: state.readDraft,
    saveDraft: state.saveDraft,
    removeDraft: state.removeDraft,
  }),
}));
vi.mock("../../components/ui/MoneyInput", () => ({
  MoneyInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string, values: Record<string, string | number> = {}) =>
      Object.entries(values).reduce(
        (result, [key, value]) =>
          result.replaceAll(`{{${key}}}`, String(value)),
        text,
      ),
    money: (value: number) => `৳${value / 100}`,
    date: (value: string) => value.slice(0, 10),
    formatDigits: (value: string | number) => String(value),
  }),
}));
beforeEach(() => {
  state.drafts.clear();
  state.readDraft
    .mockReset()
    .mockImplementation(async (key: string) => state.drafts.get(key) ?? null);
  state.saveDraft
    .mockReset()
    .mockImplementation(async (key: string, value: unknown) => {
      state.drafts.set(key, structuredClone(value));
    });
  state.removeDraft.mockReset().mockImplementation(async (key: string) => {
    state.drafts.delete(key);
  });
  state.ledger = LedgerSchema.parse({
    architectureVersion: 2,
    milestones: [],
    paymentAllocations: [],
    works: [{ id: "roof", name: "নমুনা ছাদ" }],
    people: [{ id: "shop", name: "নমুনা দোকান" }],
    entries: [
      {
        id: "bill",
        kind: "expense",
        personId: "shop",
        lines: [
          { id: "line", workId: "roof", amount: 5000, label: "নমুনা সিমেন্ট" },
        ],
      },
      {
        id: "payment",
        kind: "payment",
        personId: "shop",
        allocations: [{ workId: "roof", amount: 2000 }],
        paymentParts: [{ amount: 2000 }],
      },
    ],
  });
  state.save.mockImplementation(async (change: (current: Ledger) => Ledger) => {
    state.ledger = change(state.ledger as Ledger);
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("matching one historical payment in its detail", () => {
  it("matches selected cash to a bill and changes that match with a reason without another financial event", async () => {
    const before = summarize(state.ledger as Ledger);
    render(<PaymentBillMatch paymentId="payment" />);
    await userEvent.click(screen.getByText("কোন বিলে দেওয়া হয়েছিল"));
    await waitFor(() =>
      expect(
        (
          screen.getByLabelText(
            "এই বিলে লাগাব: নমুনা সিমেন্ট",
          ) as HTMLInputElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.change(screen.getByLabelText("এই বিলে লাগাব: নমুনা সিমেন্ট"), {
      target: { value: "15" },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "এই বিলের সঙ্গে মিল রাখি" }),
    );
    await waitFor(() =>
      expect((state.ledger as Ledger).paymentAllocations).toHaveLength(1),
    );
    expect((state.ledger as Ledger).paymentAllocations![0].amount).toBe(1500);
    expect(screen.getByText("এখনও বিলে লাগানো হয়নি: ৳5")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "এই মিল বদলাই" }));
    fireEvent.change(screen.getByLabelText("কেন মিল বদলাচ্ছেন"), {
      target: { value: "নমুনা ভুল বিল বেছেছিলাম" },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "মিল খুলে রাখি" }),
    );
    await waitFor(() =>
      expect(
        (state.ledger as Ledger).paymentAllocations![0].cancelledAt,
      ).toBeTruthy(),
    );
    expect(
      (state.ledger as Ledger).paymentAllocations![0].cancellationReason,
    ).toBe("নমুনা ভুল বিল বেছেছিলাম");
    const after = summarize(state.ledger as Ledger);
    expect([after.cost, after.paid, after.refunds]).toEqual([
      before.cost,
      before.paid,
      before.refunds,
    ]);
    expect((state.ledger as Ledger).entries).toHaveLength(2);
    expect(state.drafts.size).toBe(0);
  });
  it("keeps the source untouched when the amount exceeds the payment", async () => {
    const before = structuredClone(state.ledger);
    render(<PaymentBillMatch paymentId="payment" />);
    await userEvent.click(screen.getByText("কোন বিলে দেওয়া হয়েছিল"));
    await waitFor(() =>
      expect(
        (
          screen.getByLabelText(
            "এই বিলে লাগাব: নমুনা সিমেন্ট",
          ) as HTMLInputElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.change(screen.getByLabelText("এই বিলে লাগাব: নমুনা সিমেন্ট"), {
      target: { value: "100" },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "এই বিলের সঙ্গে মিল রাখি" }),
    );
    await screen.findByRole("alert");
    expect(state.ledger).toEqual(before);
  });
  it("reopens unfinished amounts and a cancellation reason after the detail is remounted", async () => {
    state.ledger = LedgerSchema.parse({
      ...(state.ledger as Ledger),
      paymentAllocations: [
        {
          id: "existing-match",
          paymentId: "payment",
          billId: "bill",
          workId: "roof",
          amount: 500,
          createdAt: "2026-11-05T00:00:00.000Z",
        },
      ],
    });
    const before = structuredClone(state.ledger);
    const view = render(<PaymentBillMatch paymentId="payment" />);
    await userEvent.click(screen.getByText("কোন বিলে দেওয়া হয়েছিল"));
    const input = screen.getByLabelText(
      "এই বিলে লাগাব: নমুনা সিমেন্ট",
    ) as HTMLInputElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value: "12.50" } });
    await userEvent.click(screen.getByRole("button", { name: "এই মিল বদলাই" }));
    fireEvent.change(screen.getByLabelText("কেন মিল বদলাচ্ছেন"), {
      target: { value: "নমুনা মিল যাচাই করছি" },
    });
    await waitFor(() =>
      expect(state.drafts.get("payment-bill-match:payment")).toMatchObject({
        amounts: { '["bill","roof"]': "12.50" },
        cancelling: "existing-match",
        reason: "নমুনা মিল যাচাই করছি",
      }),
    );
    view.unmount();
    render(<PaymentBillMatch paymentId="payment" />);
    await userEvent.click(screen.getByText("কোন বিলে দেওয়া হয়েছিল"));
    await waitFor(() =>
      expect(
        (
          screen.getByLabelText(
            "এই বিলে লাগাব: নমুনা সিমেন্ট",
          ) as HTMLInputElement
        ).value,
      ).toBe("12.50"),
    );
    expect(
      (screen.getByLabelText("কেন মিল বদলাচ্ছেন") as HTMLTextAreaElement).value,
    ).toBe("নমুনা মিল যাচাই করছি");
    expect(state.ledger).toEqual(before);
    expect(state.save).not.toHaveBeenCalled();
  });
  it.each(["unreadable", "invalid"])(
    "disables financial changes when the unfinished draft is %s",
    async (failure) => {
      if (failure === "unreadable")
        state.readDraft.mockRejectedValue(new Error("unavailable"));
      else
        state.drafts.set("payment-bill-match:payment", {
          version: 99,
          amounts: { unsafe: 50 },
        });
      const before = structuredClone(state.ledger);
      render(<PaymentBillMatch paymentId="payment" />);
      await userEvent.click(screen.getByText("কোন বিলে দেওয়া হয়েছিল"));
      await screen.findByText(
        "অসমাপ্ত মিলের লেখা রাখা বা পড়া যায়নি। আবার খুলে চেষ্টা করুন।",
      );
      expect(
        (
          screen.getByRole("button", {
            name: "এই বিলের সঙ্গে মিল রাখি",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      expect(
        (
          screen.getByLabelText(
            "এই বিলে লাগাব: নমুনা সিমেন্ট",
          ) as HTMLInputElement
        ).disabled,
      ).toBe(true);
      expect(state.ledger).toEqual(before);
      expect(state.save).not.toHaveBeenCalled();
      expect(state.saveDraft).not.toHaveBeenCalled();
    },
  );
  it("does not duplicate a posted match when cleaning its saved draft fails", async () => {
    state.removeDraft.mockRejectedValueOnce(new Error("cleanup"));
    render(<PaymentBillMatch paymentId="payment" />);
    await userEvent.click(screen.getByText("কোন বিলে দেওয়া হয়েছিল"));
    const input = screen.getByLabelText(
      "এই বিলে লাগাব: নমুনা সিমেন্ট",
    ) as HTMLInputElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value: "5" } });
    await userEvent.click(
      screen.getByRole("button", { name: "এই বিলের সঙ্গে মিল রাখি" }),
    );
    await screen.findByRole("alert");
    expect((state.ledger as Ledger).paymentAllocations).toHaveLength(1);
    expect(
      screen.getByText(
        "মিল রাখা হয়েছে, তবে অসমাপ্ত লেখার কপিটি মুছতে পারিনি। আবার খুলে দেখুন।",
      ),
    ).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "এই বিলের সঙ্গে মিল রাখি" }),
    );
    await waitFor(() => expect(state.drafts.size).toBe(0));
    expect((state.ledger as Ledger).paymentAllocations).toHaveLength(1);
  });
});
