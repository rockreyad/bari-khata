// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LedgerSchema } from "../../domain/model";
import { QuickActionsSheet } from "./QuickActionsSheet";
const state = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    add: state.add,
    entity: vi.fn(),
    close: vi.fn(),
    ledger: LedgerSchema.parse({
      works: [
        {
          id: "sand",
          name: "বালু কেনা",
          quickActions: ["expense", "transport"],
        },
        { id: "worker", name: "মিস্ত্রির খাতা", quickActions: ["labour"] },
        {
          id: "worker-pay",
          name: "শ্রমিকের টাকা",
          quickActions: ["payment", "labour"],
        },
        {
          id: "mixed",
          name: "দরজার সব কাজ",
          quickActions: ["expense", "payment", "labour", "transport"],
        },
        { id: "hidden", name: "লুকানো", quickActions: [] },
        { id: "default", name: "সাধারণ", quickActions: null },
      ],
    }),
  }),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    formatDigits: String,
    t: (text: string) => text,
  }),
}));
vi.mock("../../components/Sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
afterEach(() => {
  cleanup();
  state.add.mockClear();
});
describe("configured notebook shortcuts", () => {
  it("shows only chosen actions without unrelated counts and sends exact work/cost preset", async () => {
    const user = userEvent.setup();
    render(<QuickActionsSheet />);
    const card = screen.getByText("বালু কেনা").closest("article")!;
    expect(screen.queryByText("লুকানো")).toBeNull();
    expect(screen.queryByText("সাধারণ")).toBeNull();
    expect(
      within(card).queryByRole("button", { name: "টাকা দিলাম" }),
    ).toBeNull();
    await user.click(within(card).getByRole("button", { name: "আনার খরচ" }));
    expect(state.add).toHaveBeenCalledWith({
      kind: "expense",
      workId: "sand",
      account: "other",
      costType: "transport",
    });
    await user.click(within(card).getByRole("button", { name: "খরচ লিখি" }));
    expect(state.add).toHaveBeenLastCalledWith({
      kind: "expense",
      workId: "sand",
      account: "materials",
      costType: "material",
    });
  });
});

it("opens the labour preset as contextual payment without forcing earned wages or settlement", async () => {
  render(<QuickActionsSheet />);
  const user = userEvent.setup();
  const worker = screen.getByText("মিস্ত্রির খাতা").closest("article")!;
  expect(within(worker).getAllByRole("button")).toHaveLength(1);
  expect(
    within(worker).queryByRole("button", { name: "মজুরির বিল" }),
  ).toBeNull();
  await user.click(
    within(worker).getByRole("button", { name: "মিস্ত্রির টাকা" }),
  );
  expect(state.add).toHaveBeenLastCalledWith({
    kind: "payment",
    workId: "worker",
    account: "labour",
    costType: "labour",
  });
  const labourPayment = screen.getByText("শ্রমিকের টাকা").closest("article")!;
  await user.click(
    within(labourPayment).getByRole("button", { name: "টাকা দিলাম" }),
  );
  expect(state.add).toHaveBeenLastCalledWith({
    kind: "payment",
    workId: "worker-pay",
    account: "labour",
    costType: "labour",
  });
});

it("preserves material payment and purchase scopes beside a worker shortcut in a mixed notebook", async () => {
  render(<QuickActionsSheet />);
  const user = userEvent.setup();
  const card = screen.getByText("দরজার সব কাজ").closest("article")!;
  expect(within(card).getAllByRole("button")).toHaveLength(4);
  await user.click(
    within(card).getByRole("button", { name: "মিস্ত্রির টাকা" }),
  );
  expect(state.add).toHaveBeenLastCalledWith({
    kind: "payment",
    workId: "mixed",
    account: "labour",
    costType: "labour",
  });
  await user.click(within(card).getByRole("button", { name: "টাকা দিলাম" }));
  expect(state.add).toHaveBeenLastCalledWith({
    kind: "payment",
    workId: "mixed",
    account: "materials",
    costType: "material",
  });
  await user.click(within(card).getByRole("button", { name: "খরচ লিখি" }));
  expect(state.add).toHaveBeenLastCalledWith({
    kind: "expense",
    workId: "mixed",
    account: "materials",
    costType: "material",
  });
});
