// @vitest-environment jsdom
import type { ReactNode, ChangeEvent } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { localizedDigits } from "../../lib/numerals";
import { AppSelect } from "./AppSelect";
import { AppCombobox } from "./AppCombobox";
import { EntitySheet } from "../EntitySheet";
import { LedgerSchema, type Ledger } from "../../domain/model";
const locale = vi.hoisted(() => ({ language: "bn" as "bn" | "en" }));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    language: locale.language,
    t: (value: string) => value,
    formatDigits: (value: string | number) =>
      localizedDigits(value, locale.language),
    money: String,
    number: (value: number) => localizedDigits(value, locale.language),
  }),
}));
vi.mock("../../data/repository", () => ({
  createWorkspaceStorage: () => ({
    readDraft: async () => null,
    saveDraft: async () => {},
    removeDraft: async () => {},
  }),
}));
vi.mock("../Sheet", () => ({
  Sheet: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}));
beforeAll(() => {
  if (!window.PointerEvent)
    window.PointerEvent = MouseEvent as typeof PointerEvent;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(() => {
  cleanup();
  locale.language = "bn";
});
it("localizes select labels without changing option values or a saved identifier", async () => {
  const changed = vi.fn();
  render(
    <AppSelect
      aria-label="খাতা"
      value="door16"
      onChange={(event) => changed(event.target.value)}
    >
      <option value="door16">দরজা 16টি</option>
      <option value="door8">দরজা 8টি</option>
    </AppSelect>,
  );
  expect(screen.getByRole("combobox").textContent).toContain("দরজা ১৬টি");
  screen.getByRole("combobox").focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.click(
    await screen.findByRole("option", { name: "দরজা ৮টি" }),
  );
  expect(changed).toHaveBeenCalledWith("door8");
});
it("switches suggestion number displays with the language and still returns the original material value", async () => {
  const changed = vi.fn();
  const props = {
    suggestions: [{ value: "Rod 16 mm", description: "প্যাকেট ২" }],
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      changed(event.target.value),
    "aria-label": "মাল",
  };
  const view = render(<AppCombobox {...props} />);
  await userEvent.click(screen.getByRole("combobox"));
  expect(await screen.findByRole("option", { name: /Rod ১৬ mm/ })).toBeTruthy();
  locale.language = "en";
  view.rerender(<AppCombobox {...props} />);
  const option = await screen.findByRole("option", { name: /Rod 16 mm/ });
  expect(option.textContent).toContain("প্যাকেট 2");
  await userEvent.click(option);
  expect(changed).toHaveBeenCalledWith("Rod 16 mm");
});
it.each(["bn", "en"] as const)(
  "shows a %s phone number but saves it as canonical digits",
  async (language) => {
    locale.language = language;
    const initial = LedgerSchema.parse({
      people: [
        { id: "shop", name: "দোকান", kind: "shop", phone: "01712345678" },
      ],
    });
    const onSave = vi.fn(async (_next: Ledger) => {});
    render(
      <EntitySheet
        kind="person"
        ledger={initial}
        editId="shop"
        mode="demo"
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    const input = await screen.findByRole("textbox", { name: "ফোন নম্বর" });
    expect((input as HTMLInputElement).value).toBe(
      localizedDigits("01712345678", language),
    );
    fireEvent.change(input, { target: { value: "০১৮১২৩৪৫৬৭৮" } });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "রাখুন" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].people[0].phone).toBe("01812345678");
  },
);

it("localizes a contract quantity while saving the exact numeric quantity and recalculated bill", async () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
    people: [{ id: "worker", name: "মিস্ত্রি", kind: "worker" }],
    contracts: [
      {
        id: "agreement",
        workId: "door",
        personId: "worker",
        title: "দরজার কাজ",
        basis: "sqft",
        quantity: "100",
        rate: 2200,
        total: 220000,
      },
    ],
  });
  const onSave = vi.fn(async (_next: Ledger) => {});
  render(
    <EntitySheet
      kind="contract"
      ledger={ledger}
      editId="agreement"
      mode="demo"
      onSave={onSave}
      onClose={() => {}}
    />,
  );
  const quantity = await screen.findByRole("textbox", { name: "কত বর্গফুট" });
  expect((quantity as HTMLInputElement).value).toBe("১০০");
  fireEvent.change(quantity, { target: { value: "১০১" } });
  fireEvent.change(screen.getByRole("textbox", { name: "কেন বদলালেন" }), {
    target: { value: "পরিমাণ আবার মেপে ঠিক করা হয়েছে" },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "রাখুন" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0][0].contracts[0]).toMatchObject({
    quantity: "101",
    total: 222200,
  });
});
