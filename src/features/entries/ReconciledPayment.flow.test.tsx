// @vitest-environment jsdom
import { migrateArchitecture } from "../../domain/architectureMigration";
import "fake-indexeddb/auto";
import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { appendBalanceAdjustment } from "../../domain/balanceAdjustments";
import { contactAccountSummary, contactSummary } from "../../domain/contacts";
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
      name === "রাখুন"
        ? screen
            .getByLabelText("কত টাকা")
            .closest<HTMLFieldSetElement>("fieldset")!.disabled
        : (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
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
      ...["door", "roof"].map((workId) => ({
        id: `${workId}-earned`,
        kind: "expense",
        account: "labour",
        contractId: `${workId}-job`,
        personId: "worker",
        lines: [
          {
            id: `${workId}-earned-line`,
            workId,
            costType: "labour",
            amount: 200000,
          },
        ],
      })),
    ],
  });
}

it("keeps a professional's reconciled jobs separate from a custom partial labour bill and a later explicitly chosen cash payment", async () => {
  const source = fixture();
  const original = LedgerSchema.parse({
    ...source,
    people: [{ ...source.people[0], kind: "other", role: "নমুনা ইঞ্জিনিয়ার" }],
    contracts: source.contracts.map((job, index) => ({
      ...job,
      total: [100000, 150000][index],
    })),
    entries: source.entries.map((entry) => {
      const index = entry.contractId === "door-job" ? 0 : 1;
      return entry.kind === "payment"
        ? {
            ...entry,
            allocations: [
              { ...entry.allocations[0], amount: [110000, 160000][index] },
            ],
            paymentParts: [
              { ...entry.paymentParts[0], amount: [110000, 160000][index] },
            ],
          }
        : {
            ...entry,
            lines: entry.lines.map((line) => ({
              ...line,
              amount: [100000, 150000][index],
            })),
          };
    }),
  });
  const adjusted = appendBalanceAdjustment(
    original,
    {
      target: "person",
      basis: "paid",
      personId: "worker",
      account: "labour",
      expectedBefore: 270000,
      after: 250000,
      reason: "নমুনা কাজগুলোর দেওয়া মোট মিলিয়েছি",
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
  expect(contactSummary(adjusted, adjusted.people[0])).toMatchObject({
    reconciledPayable: 0,
    reconciledAdvance: 0,
  });
  const user = userEvent.setup();
  const options = {
    kind: "payment",
    personId: "worker",
    account: "labour",
  } as const;
  let view = render(<QuickEntrySheet presentation="page" options={options} />);
  await ready("রাখুন");
  await user.click(screen.getByRole("button", { name: "নতুন বিল ও টাকা" }));
  await user.selectOptions(screen.getByLabelText("সেক্টর"), "roof");
  await user.selectOptions(screen.getByLabelText("কিসের টাকা"), "__new__");
  await user.type(screen.getByLabelText("কিসের টাকা লিখুন"), "নমুনা নকশা দেখা");
  await user.selectOptions(screen.getByLabelText("কোন হিসাবের অংশ"), "labour");
  await user.type(screen.getByLabelText("কত টাকা"), "300");
  await user.click(screen.getByRole("button", { name: "টাকা লিখি" }));
  await user.type(screen.getByLabelText("এখন কত দিলেন"), "120");
  expect(
    view.container.querySelector(".entry-balance-items")?.textContent,
  ).not.toContain("আগের বাকি");
  expect(
    view.container.querySelector(".entry-balance-result")?.textContent,
  ).toBe("বাকি থাকবে180");
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(context.close).toHaveBeenCalledOnce());
  view.unmount();
  database.close();
  await database.open();
  const partial = (await repo.read())!.ledger;
  expect(partial.entries.slice(0, adjusted.entries.length)).toEqual(
    adjusted.entries,
  );
  expect(partial.contracts).toEqual(original.contracts);
  expect(partial.people).toEqual(original.people);
  expect(partial.entries).toHaveLength(adjusted.entries.length + 2);
  expect(partial.paymentPurposes).toHaveLength(1);
  expect(partial.paymentPurposes[0]).toMatchObject({
    name: "নমুনা নকশা দেখা",
    account: "labour",
  });
  const bill = partial.entries[adjusted.entries.length];
  expect(bill).toMatchObject({
    kind: "expense",
    account: "labour",
    contractId: null,
    paymentPurposeId: null,
    lines: [
      {
        workId: "roof",
        label: "নমুনা নকশা দেখা",
        amount: 30000,
        costType: "labour",
      },
    ],
  });
  expect(partial.entries[adjusted.entries.length + 1]).toMatchObject({
    kind: "payment",
    relatedEntryId: bill.id,
    paymentPurposeId: partial.paymentPurposes[0].id,
    allocations: [{ workId: "roof", amount: 12000 }],
  });
  expect(contactSummary(partial, partial.people[0])).toMatchObject({
    actualCost: 280000,
    actualPaid: 282000,
    reconciledNetPaid: 262000,
    reconciledPayable: 18000,
    reconciledAdvance: 0,
  });
  context.ledger = partial;
  view = render(
    <QuickEntrySheet
      presentation="page"
      options={{ ...options, purpose: "settle" }}
    />,
  );
  await ready("রাখুন");
  expect(
    (screen.getByRole("button", { name: "রাখুন" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  await user.selectOptions(screen.getByLabelText("সেক্টর"), "roof");
  await user.selectOptions(screen.getByLabelText("কাজ"), "");
  expect(
    screen.queryByText(
      "কিছু মজুরির বিল কোন কাজের, তা মেলানো নেই। কাজ বেছে নিয়ে হিসাব দেখুন।",
    ),
  ).toBeNull();
  expect(view.container.querySelector(".entry-balance-preview")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "অগ্রিম" }));
  await user.clear(screen.getByLabelText("কত টাকা"));
  await user.type(screen.getByLabelText("কত টাকা"), "180");
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(context.close).toHaveBeenCalledTimes(2));
  view.unmount();
  database.close();
  await database.open();
  const settled = (await repo.read())!.ledger;
  expect(settled.entries.slice(0, partial.entries.length)).toEqual(
    partial.entries,
  );
  expect(
    settled.entries.filter((entry) => entry.kind === "expense"),
  ).toHaveLength(3);
  expect(contactSummary(settled, settled.people[0])).toMatchObject({
    actualCost: 280000,
    actualPaid: 300000,
    reconciledNetPaid: 280000,
    reconciledPayable: 0,
    reconciledAdvance: 0,
  });
  const restoredDatabase = new LedgerDatabase(
    `patch-013-${crypto.randomUUID()}`,
  );
  databases.push(restoredDatabase);
  const restoredRepo = new LedgerRepository(restoredDatabase);
  await restoredRepo.ensure("real", LedgerSchema.parse({}));
  await restoredRepo.importBackup(await repo.exportBackup(), { replace: true });
  expect((await restoredRepo.read())!.ledger).toEqual(
    migrateArchitecture(settled).ledger,
  );
});

it.each([
  { purpose: "charge", label: "নতুন বিল ও টাকা", advance: 0, cost: 10000 },
  { purpose: "advance", label: "অগ্রিম", advance: 10000, cost: 0 },
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
    await user.selectOptions(screen.getByLabelText("সেক্টর"), "roof");
    await user.selectOptions(screen.getByLabelText("কাজ"), "");
    expect(screen.queryByRole("button", { name: "বাকি মেটাই" })).toBeNull();
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
    expect(saved.entries.slice(0, original.entries.length)).toEqual(
      original.entries,
    );
    expect(saved.entries[original.entries.length]).toEqual(correction);
    expect(saved.entries).toHaveLength(
      original.entries.length + (cost ? 3 : 2),
    );
    expect(
      contactAccountSummary(saved, saved.people[0], "labour"),
    ).toMatchObject({
      actualCost: 400000 + cost,
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
    expect(restored).toEqual(migrateArchitecture(saved).ledger);
    context.ledger = restored;
    view = mount();
    await ready("রাখুন");
    await user.selectOptions(screen.getByLabelText("সেক্টর"), "roof");
    await user.selectOptions(screen.getByLabelText("কাজ"), "");
    await user.click(screen.getByRole("button", { name: "অগ্রিম" }));
    await user.type(screen.getByLabelText("কত টাকা"), "50");
    expect(
      view.container.querySelector(".entry-balance-result")?.textContent,
    ).toBe(advance ? "অগ্রিম থাকবে150" : "অগ্রিম থাকবে50");
  },
);

it("keeps an unlinked earned bill known without treating an unearned agreement as another bill", async () => {
  const original = LedgerSchema.parse({
    works: [{ id: "work", name: "নমুনা সেক্টর" }],
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
  await user.click(screen.getByRole("button", { name: "অগ্রিম" }));
  await user.type(screen.getByLabelText("কত টাকা"), "100");
  expect(screen.queryByText(notice)).toBeNull();
  expect(view.container.querySelector(".entry-balance-preview")).toBeTruthy();
  expect(
    view.container.querySelector(".entry-balance-result")?.textContent,
  ).toBe("অগ্রিম থাকবে100");
  await user.selectOptions(screen.getByLabelText("কাজ"), "job");
  expect(screen.queryByText(notice)).toBeNull();
  expect(view.container.querySelector(".entry-contract-progress")).toBeTruthy();
  await user.selectOptions(screen.getByLabelText("কাজ"), "");
  expect(screen.queryByText(notice)).toBeNull();
  await user.click(screen.getByRole("button", { name: "অগ্রিম" }));
  expect(
    (screen.getByRole("button", { name: "রাখুন" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(context.close).toHaveBeenCalledOnce());
  const saved = (await repo.read())!.ledger;
  expect(saved.entries.slice(0, 3)).toEqual(adjusted.entries);
  expect(saved.entries).toHaveLength(4);
  expect(contactAccountSummary(saved, saved.people[0], "labour")).toMatchObject(
    { actualCost: 100000, reconciledPayable: 0, reconciledAdvance: 10000 },
  );
  expect(saved.entries.at(-1)).toMatchObject({
    kind: "payment",
    contractId: null,
    personId: "worker",
    allocations: [{ workId: "work", amount: 10000 }],
  });
});
