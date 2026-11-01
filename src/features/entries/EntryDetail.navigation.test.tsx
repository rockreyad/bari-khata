// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LedgerSchema } from "../../domain/model";
import { EntryDetail } from "./EntryDetail";
const { notebook } = vi.hoisted(() => ({ notebook: vi.fn() }));
vi.mock("../../app/NotebookProvider", () => ({ useNotebook: notebook }));
vi.mock("../../data/repository", () => ({
  createWorkspaceStorage: () => ({ getReceipt: vi.fn() }),
}));
vi.mock("../../components/Sheet", () => ({
  Sheet: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => (
    <section>
      {children}
      {footer}
    </section>
  ),
}));
vi.mock("../../components/ui/AppMenu", () => ({
  AppMenu: ({
    items,
  }: {
    items: { label: string; onSelect: () => void }[];
  }) => (
    <div>
      {items.map((item) => (
        <button key={item.label} onClick={item.onSelect}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string) => text,
    money: (value: number) => `৳${value / 100}`,
    date: (value: string | null) => value || "তারিখ দেওয়া নেই",
    language: "bn",
  }),
}));
afterEach(cleanup);
describe("entry detail navigation", () => {
  it("opens the exact shop, notebook and scoped history without retaining the detail modal", () => {
    const ledger = LedgerSchema.parse({
      people: [{ id: "shop", name: "বাবুল ইলেকট্রনিক্স", kind: "shop" }],
      works: [{ id: "electric", name: "বিদ্যুতের কাজ" }],
      entries: [
        {
          id: "bill",
          kind: "expense",
          account: "materials",
          personId: "shop",
          lines: [
            { id: "line", workId: "electric", label: "তার", amount: 50000 },
          ],
        },
      ],
    });
    const go = vi.fn();
    notebook.mockReturnValue({
      ledger,
      mode: "demo",
      go,
      close: vi.fn(),
      add: vi.fn(),
      save: vi.fn(),
      notify: vi.fn(),
      detail: vi.fn(),
    });
    render(<EntryDetail id="bill" />);
    fireEvent.click(screen.getByRole("button", { name: "বাবুল ইলেকট্রনিক্স" }));
    expect(go).toHaveBeenLastCalledWith("/people/shop?account=materials");
    fireEvent.click(screen.getByRole("button", { name: "বিদ্যুতের কাজ" }));
    expect(go).toHaveBeenLastCalledWith("/works/electric");
    fireEvent.click(screen.getByRole("button", { name: "এই নামের সব হিসাব" }));
    expect(go).toHaveBeenLastCalledWith(
      "/ledger?person=shop&account=materials&order=oldest",
    );
    expect(screen.queryByText("কখন কী বদলেছে")).toBeNull();
  });
});
