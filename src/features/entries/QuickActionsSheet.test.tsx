// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LedgerSchema } from "../../domain/model";
import { QuickActionsSheet } from "./QuickActionsSheet";
vi.mock("../write/LegacyEntryDrafts", () => ({
  LegacyEntryDrafts: () => null,
}));
const state = vi.hoisted(() => ({
  add: vi.fn(),
  go: vi.fn(),
  entity: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    add: state.add,
    go: state.go,
    entity: state.entity,
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
  state.go.mockClear();
  state.entity.mockClear();
});
it("omits favorite notebook shortcuts even when saved notebooks configure them", () => {
  const view = render(<QuickActionsSheet />);
  expect(view.container.querySelector(".quick-sector-shortcuts")).toBeNull();
  expect(view.container.querySelector(".entry-work-shortcuts")).toBeNull();
  for (const name of [
    "বালু কেনা",
    "মিস্ত্রির খাতা",
    "শ্রমিকের টাকা",
    "দরজার সব কাজ",
  ])
    expect(screen.queryByText(name)).toBeNull();
  expect(state.add).not.toHaveBeenCalled();
});

it("offers notebook and worker creation without changing entity routes", async () => {
  const user = userEvent.setup();
  render(<QuickActionsSheet />);
  await user.click(screen.getByRole("button", { name: "নতুন খাতা বানান" }));
  expect(state.entity).toHaveBeenLastCalledWith("work");
  await user.click(screen.getByRole("button", { name: "নতুন কর্মী" }));
  expect(state.entity).toHaveBeenLastCalledWith("person");
});

it("offers the four homeowner tasks in the drawer and preserves the selected payment intent", async () => {
  const user = userEvent.setup();
  render(<QuickActionsSheet />);
  await user.click(screen.getByRole("button", { name: /^মাল কিনেছি/ }));
  expect(state.add).toHaveBeenLastCalledWith({
    kind: "expense",
    costType: "material",
    account: "materials",
  });
  await user.click(screen.getByRole("button", { name: /^কাজের বিল/ }));
  expect(state.add).toHaveBeenLastCalledWith({
    kind: "expense",
    purpose: "charge",
    costType: "labour",
    account: "labour",
  });
  await user.click(
    screen.getByRole("button", {
      name: "টাকা দিলাম যাকে টাকা দিয়েছেন, তার নামে রাখুন",
    }),
  );
  expect(state.add).toHaveBeenLastCalledWith({
    kind: "payment",
    purpose: "settle",
  });
  await user.click(screen.getByRole("button", { name: /^অগ্রিম বা বাকি/ }));
  expect(screen.queryByRole("button", { name: /^মাল কিনেছি/ })).toBeNull();
  await user.click(screen.getByRole("button", { name: /^অগ্রিম দিই/ }));
  expect(state.add).toHaveBeenLastCalledWith({
    kind: "payment",
    purpose: "advance",
  });
  await user.click(screen.getByRole("button", { name: /^বাকি দেখি/ }));
  expect(state.go).toHaveBeenLastCalledWith("/dues");
  await user.click(screen.getByRole("button", { name: "সব কাজ" }));
  expect(screen.getByRole("button", { name: /^মাল কিনেছি/ })).toBeDefined();
});
