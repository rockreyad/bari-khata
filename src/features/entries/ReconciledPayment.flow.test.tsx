// @vitest-environment jsdom
import "fake-indexeddb/auto";
import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { appendBalanceAdjustment } from "../../domain/balanceAdjustments";
import { contactAccountSummary } from "../../domain/contacts";
import {
  getAccountDatabase,
  setActiveOwner,
  LedgerDatabase,
} from "../../data/database";
import { LedgerRepository } from "../../data/repository";
import { TotalAdjustmentForm } from "../reconciliation/TotalAdjustmentForm";
import { QuickEntrySheet } from "./QuickEntrySheet";

const context = vi.hoisted(() => ({
  ledger: null as unknown,
  save: vi.fn(),
  close: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({ ...context, mode: "real" }),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    language: "bn",
    t: (text: string) => text,
    money: (amount: number) => String(amount / 100),
    number: String,
    formatDigits: String,
    date: String,
  }),
}));
vi.mock("../../components/ui/AppSelect", () => ({
  AppSelect: (props: SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props} />
  ),
}));
vi.mock("../../components/ui/AppDatePicker", () => ({
  AppDatePicker: (props: InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));
vi.mock("../../components/ui/MoneyInput", () => ({
  MoneyInput: (props: InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

const databases: LedgerDatabase[] = [];
afterEach(async () => {
  cleanup();
  setActiveOwner(null);
  for (const database of databases.splice(0)) await database.delete();
});
const ready = (name: string) =>
  waitFor(() =>
    expect(
      (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );

function fixture() {
  return LedgerSchema.parse({
    works: [
      { id: "door", name: "নমুনা দরজা" },
      { id: "roof", name: "নমুনা ছাদ" },
    ],
    people: [{ id: "worker", name: "নমুনা মিস্ত্রি", kind: "worker" }],
    contracts: [
      { id: "door-job", workId: "door", personId: "worker", total: 200000 },
      { id: "roof-job", workId: "roof", personId: "worker", total: 200000 },
    ],
    entries: [
      {
        id: "door-paid",
        kind: "payment",
        account: "labour",
        contractId: "door-job",
        personId: "worker",
        allocations: [{ workId: "door", amount: 220000 }],
        paymentParts: [{ amount: 220000 }],
      },
      {
        id: "roof-paid",
        kind: "payment",
        account: "labour",
        contractId: "roof-job",
        personId: "worker",
        allocations: [{ workId: "roof", amount: 210000 }],
        paymentParts: [{ amount: 210000 }],
      },
    ],
  });
}

it.each([
  { purpose: "wage", label: "কাজের টাকা", advance: 0, cost: 10000 },
  { purpose: "settle", label: "আগের বাকি", advance: 10000, cost: 0 },
] as const)(
  "keeps a reconciled all-job total through a new $purpose entry, draft, IndexedDB reopen and backup restore",
  async ({ label, advance, cost }) => {
    const original = fixture();
    const owner = crypto.randomUUID();
    setActiveOwner(owner);
    const database = getAccountDatabase(owner);
    databases.push(database);
    const repo = new LedgerRepository(database);
    await repo.ensure("real", original);
    context.ledger = original;
    context.close.mockReset();
    context.notify.mockReset();
    context.save.mockReset().mockImplementation(async (change) => {
      await repo.save(change);
      context.ledger = (await repo.read())!.ledger;
    });
    const adjusted = vi.fn();
    const user = userEvent.setup();
    let view = render(
      <TotalAdjustmentForm
        target={{ target: "person", id: "worker", account: "labour" }}
        onSaved={adjusted}
      />,
    );
    await ready("সমন্বয় রাখুন");
    await user.type(screen.getByLabelText("সঠিক অঙ্ক"), "4000");
    await user.type(screen.getByLabelText("কারণ"), "নমুনার মোট হিসাব মিলিয়েছি");
    await user.click(screen.getByRole("button", { name: "সমন্বয় রাখুন" }));
    await waitFor(() => expect(adjusted).toHaveBeenCalledOnce());
    view.unmount();
    const correction = (context.ledger as Ledger).entries.at(-1)!;
    expect(correction.adjustment).toMatchObject({
      basis: "paid",
      before: 430000,
      after: 400000,
      delta: -30000,
      workId: null,
    });

    const mount = () =>
      render(
        <QuickEntrySheet
          presentation="page"
          options={{ kind: "payment", personId: "worker", account: "labour" }}
        />,
      );
    view = mount();
    await ready("রাখুন");
    await user.selectOptions(screen.getByLabelText("কাজের খাতা"), "roof");
    await user.selectOptions(screen.getByLabelText("কাজ"), "");
    await user.click(screen.getByRole("button", { name: label }));
    await user.type(screen.getByLabelText("কত টাকা"), "100");
    expect(
      view.container.querySelector(".entry-balance-items")?.textContent,
    ).not.toContain("আগের বাকি300");
    expect(
      view.container.querySelector(".entry-balance-result")?.textContent,
    ).toBe(advance ? "অগ্রিম থাকবে100" : "বাকি থাকবে0");
    await user.click(screen.getByRole("button", { name: "ফিরুন" }));
    await waitFor(() => expect(context.close).toHaveBeenCalledOnce());
    view.unmount();
    database.close();
    await database.open();
    context.ledger = (await repo.read())!.ledger;
    view = mount();
    await ready("রাখুন");
    expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe(
      "100",
    );
    expect((screen.getByLabelText("কাজ") as HTMLSelectElement).value).toBe("");
    expect(
      view.container.querySelector(".entry-balance-result")?.textContent,
    ).toBe(advance ? "অগ্রিম থাকবে100" : "বাকি থাকবে0");
    await user.click(screen.getByRole("button", { name: "রাখুন" }));
    await waitFor(() => expect(context.close).toHaveBeenCalledTimes(2));
    view.unmount();
    database.close();
    await database.open();
    const saved = (await repo.read())!.ledger;
    expect(saved.entries.slice(0, 2)).toEqual(original.entries);
    expect(saved.entries[2]).toEqual(correction);
    expect(saved.entries).toHaveLength(cost ? 5 : 4);
    expect(
      contactAccountSummary(saved, saved.people[0], "labour"),
    ).toMatchObject({
      actualCost: cost,
      actualPaid: 440000,
      reconciledNetPaid: 410000,
      reconciledPayable: 0,
      reconciledAdvance: advance,
    });
    const restoredDatabase = new LedgerDatabase(
      `reconciled-payment-${crypto.randomUUID()}`,
    );
    databases.push(restoredDatabase);
    const restoredRepo = new LedgerRepository(restoredDatabase);
    await restoredRepo.ensure("real", LedgerSchema.parse({}));
    await restoredRepo.importBackup(await repo.exportBackup(), {
      replace: true,
    });
    const restored = (await restoredRepo.read())!.ledger;
    expect(restored).toEqual(saved);
    context.ledger = restored;
    view = mount();
    await ready("রাখুন");
    await user.selectOptions(screen.getByLabelText("কাজের খাতা"), "roof");
    await user.selectOptions(screen.getByLabelText("কাজ"), "");
    await user.type(screen.getByLabelText("কত টাকা"), "50");
    expect(
      view.container.querySelector(".entry-balance-result")?.textContent,
    ).toBe(advance ? "অগ্রিম থাকবে150" : "অগ্রিম থাকবে50");
  },
);

it("asks to choose a job when unlinked labour bills make the combined balance uncertain, while keeping payment available", async () => {
  const original = LedgerSchema.parse({
    works: [{ id: "work", name: "নমুনা কাজের খাতা" }],
    people: [{ id: "worker", name: "নমুনা মিস্ত্রি", kind: "worker" }],
    contracts: [
      { id: "job", personId: "worker", workId: "work", total: 100000 },
    ],
    entries: [
      {
        id: "bill",
        kind: "expense",
        account: "labour",
        personId: "worker",
        lines: [
          { id: "line", workId: "work", amount: 100000, costType: "labour" },
        ],
      },
      {
        id: "paid",
        kind: "payment",
        account: "labour",
        personId: "worker",
        allocations: [{ workId: "work", amount: 90000 }],
        paymentParts: [{ amount: 90000 }],
      },
    ],
  });
  const adjusted = appendBalanceAdjustment(
    original,
    {
      target: "person",
      basis: "paid",
      personId: "worker",
      account: "labour",
      expectedBefore: 90000,
      after: 100000,
      reason: "নমুনা দেওয়া টাকার মোট মিলিয়েছি",
    },
    "2026-11-04T08:00:00.000Z",
  );
  const owner = crypto.randomUUID();
  setActiveOwner(owner);
  const database = getAccountDatabase(owner);
  databases.push(database);
  const repo = new LedgerRepository(database);
  await repo.ensure("real", adjusted);
  context.ledger = adjusted;
  context.close.mockReset();
  context.notify.mockReset();
  context.save.mockReset().mockImplementation(async (change) => {
    await repo.save(change);
    context.ledger = (await repo.read())!.ledger;
  });
  const user = userEvent.setup();
  const view = render(
    <QuickEntrySheet
      presentation="page"
      options={{ kind: "payment", personId: "worker", account: "labour" }}
    />,
  );
  await ready("রাখুন");
  const notice =
    "কিছু মজুরির বিল কোন কাজের, তা মেলানো নেই। কাজ বেছে নিয়ে হিসাব দেখুন।";
  await user.selectOptions(screen.getByLabelText("কাজ"), "");
  await user.type(screen.getByLabelText("কত টাকা"), "100");
  expect(screen.getByText(notice)).toBeTruthy();
  expect(view.container.querySelector(".entry-balance-preview")).toBeNull();
  await user.selectOptions(screen.getByLabelText("কাজ"), "job");
  expect(screen.queryByText(notice)).toBeNull();
  expect(view.container.querySelector(".entry-contract-progress")).toBeTruthy();
  await user.selectOptions(screen.getByLabelText("কাজ"), "");
  expect(screen.getByText(notice)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(context.close).toHaveBeenCalledOnce());
  const saved = (await repo.read())!.ledger;
  expect(saved.entries.slice(0, 3)).toEqual(adjusted.entries);
  expect(saved.entries).toHaveLength(4);
  expect(saved.entries.at(-1)).toMatchObject({
    kind: "payment",
    contractId: null,
    personId: "worker",
    allocations: [{ workId: "work", amount: 10000 }],
  });
});
