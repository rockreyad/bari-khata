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
        { id: "hidden", name: "লুকানো", quickActions: [] },
        { id: "default", name: "সাধারণ", quickActions: null },
      ],
    }),
  }),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({ t: (text: string) => text }),
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
