// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LedgerSchema, type Ledger } from "../domain/model";
import { localizedDigits } from "../lib/numerals";
import { EntitySheet } from "./EntitySheet";
import { EntrySheet } from "./EntrySheet";
const storage = vi.hoisted(() => ({
  saved: null as unknown,
  readDraft: vi.fn(),
}));
vi.mock("../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (value: string) => value,
    language: "bn",
    formatDigits: (value: string | number) => localizedDigits(value, "bn"),
    number: String,
    money: String,
    date: (value: string | null) => value ?? "—",
  }),
}));
vi.mock("../data/repository", () => ({
  createWorkspaceStorage: () => ({
    readDraft: storage.readDraft,
    saveDraft: vi.fn(),
    removeDraft: vi.fn(),
  }),
}));
vi.mock("./Sheet", () => ({
  Sheet: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}));
afterEach(() => {
  cleanup();
  storage.readDraft.mockReset();
});
function fixture() {
  return LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
    people: [
      { id: "worker", name: "মিস্ত্রি", kind: "worker" },
      { id: "shop", name: "দোকান", kind: "shop" },
    ],
  });
}
it("restores a legacy Bengali job draft, keeps its notebook and saves canonical ASCII quantity with the exact total", async () => {
  storage.readDraft.mockResolvedValue({
    id: "old-draft",
    workId: "door",
    personId: "worker",
    basis: "sqft",
    quantity: "৫,৭০০",
    rate: "২২",
    total: "০",
  });
  const save = vi.fn(async (_value: Ledger) => {});
  render(
    <EntitySheet
      kind="contract"
      ledger={fixture()}
      mode="demo"
      onClose={() => {}}
      onSave={save}
    />,
  );
  const quantity = await screen.findByRole("textbox", { name: "কত বর্গফুট" });
  await waitFor(() =>
    expect((quantity as HTMLInputElement).value).toBe("৫,৭০০"),
  );
  await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0].contracts[0]).toMatchObject({
    scope: "work",
    workId: "door",
    title: "",
    quantity: "5700",
    rate: 2200,
    total: 12540000,
  });
});
it("editing and saving a valid maximum-size old expense does not lose its last paisa", async () => {
  storage.readDraft.mockResolvedValue(null);
  const ledger = fixture();
  ledger.entries = LedgerSchema.parse({
    ...ledger,
    entries: [
      {
        id: "old-bill",
        kind: "expense",
        account: "materials",
        personId: "shop",
        date: "2026-11-01",
        lines: [
          {
            id: "old-line",
            workId: "door",
            label: "মাল",
            amount: Number.MAX_SAFE_INTEGER,
            quantity: "১৬২",
          },
        ],
      },
    ],
  }).entries;
  const save = vi.fn(async (_value: Ledger) => {});
  const { container } = render(
    <EntrySheet
      ledger={ledger}
      mode="demo"
      editEntryId="old-bill"
      onClose={() => {}}
      onSave={save}
    />,
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "সংরক্ষণ করুন",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  expect(
    [...container.querySelectorAll<HTMLInputElement>("input")].some(
      (input) => input.value === "৯০০৭১৯৯২৫৪৭৪০৯.৯১",
    ),
  ).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "সংরক্ষণ করুন" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0].entries[0].lines[0]).toMatchObject({
    amount: Number.MAX_SAFE_INTEGER,
    quantity: "162",
  });
});
