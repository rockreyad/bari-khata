// @vitest-environment jsdom
import "fake-indexeddb/auto";
import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageProvider } from "../context/LanguageProvider";
import {
  getAccountDatabase,
  setActiveOwner,
  type LedgerDatabase,
} from "../data/database";
import { LedgerRepository } from "../data/repository";
import { LedgerSchema, type Ledger } from "../domain/model";
import { parseAmount } from "../domain/ledger";
import { savePreferences } from "../lib/preferences";
import { ContractCard } from "../features/works/ContractCard";
import { EntitySheet } from "./EntitySheet";

vi.mock("./ui/AppSelect", () => ({
  AppSelect: (props: SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props} />
  ),
}));
vi.mock("./ui/AppDatePicker", () => ({
  AppDatePicker: (props: InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));
const databases: LedgerDatabase[] = [];
afterEach(async () => {
  cleanup();
  setActiveOwner(null);
  for (const database of databases.splice(0)) await database.delete();
  localStorage.clear();
});

it.each(["87000", "85000"])(
  "saves a %s-taka negotiated agreement without rewriting quantity, rate or computed total",
  async (agreed) => {
    savePreferences({ language: "bn" });
    const owner = crypto.randomUUID();
    setActiveOwner(owner);
    const database = getAccountDatabase(owner);
    databases.push(database);
    const repository = new LedgerRepository(database);
    const ledger = LedgerSchema.parse({
      works: [{ id: "work", name: "নির্মাণের কাজ" }],
      people: [{ id: "worker", name: "মিস্ত্রি", kind: "worker" }],
    });
    await repository.ensure("real", ledger);
    const onClose = vi.fn();
    const onSave = vi.fn(async (next: Ledger) => {
      await repository.save(next);
    });
    const view = render(
      <LanguageProvider>
        <EntitySheet
          presentation="page"
          kind="contract"
          ledger={ledger}
          defaultWorkId="work"
          defaultPersonId="worker"
          onSave={onSave}
          onClose={onClose}
        />
      </LanguageProvider>,
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "রাখুন" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.change(screen.getByLabelText("দর ঠিক হয়েছে"), {
      target: { value: "sqft" },
    });
    fireEvent.change(screen.getByLabelText("কত বর্গফুট"), {
      target: { value: "3796" },
    });
    fireEvent.change(screen.getByLabelText("প্রতি এককের দর"), {
      target: { value: "23" },
    });
    expect(
      parseAmount(
        (screen.getByLabelText("শেষে ঠিক করা টাকা") as HTMLInputElement).value,
      ),
    ).toBe(8730800);
    fireEvent.change(screen.getByLabelText("শেষে ঠিক করা টাকা"), {
      target: { value: agreed },
    });
    expect(view.container.querySelector("s")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledOnce();
    view.unmount();
    database.close();
    await database.open();
    const saved = (await repository.read())!.ledger;
    expect(saved.contracts[0]).toMatchObject({
      quantity: "3796",
      rate: 2300,
      calculatedTotal: 8730800,
      total: Number(agreed) * 100,
    });
    const card = render(
      <LanguageProvider>
        <ContractCard ledger={saved} contract={saved.contracts[0]} />
      </LanguageProvider>,
    );
    const calculated = card.container.querySelector(
      's[aria-label="পরিমাণ ও দর অনুযায়ী"]',
    );
    expect(calculated?.textContent).toContain("৮৭,৩০৮");
    card.unmount();
    const edit = render(
      <LanguageProvider>
        <EntitySheet
          presentation="page"
          kind="contract"
          ledger={saved}
          editId={saved.contracts[0].id}
          onSave={onSave}
          onClose={onClose}
        />
      </LanguageProvider>,
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "রাখুন" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(
      parseAmount(
        (screen.getByLabelText("শেষে ঠিক করা টাকা") as HTMLInputElement).value,
      ),
    ).toBe(Number(agreed) * 100);
    await userEvent.click(screen.getByRole("button", { name: "ফিরুন" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
    edit.unmount();
  },
);
