// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { Blob as NodeBlob } from "node:buffer";
import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
  LedgerDatabase,
  setActiveOwner,
} from "../data/database";
import { createWorkspaceStorage, LedgerRepository } from "../data/repository";
import {
  EntryCoreSchema,
  LedgerSchema,
  type Entry,
  type Ledger,
} from "../domain/model";
import { entryTotal, personSummary } from "../domain/ledger";
import {
  buildQuickEntry,
  QuickDraftSchema,
} from "../features/entries/quickEntry";
import { latinDigits } from "../lib/numerals";
import { savePreferences } from "../lib/preferences";
import { EntrySheet } from "./EntrySheet";

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
const billId = "sample-simple-bill";
const cashId = "sample-simple-cash";
const receiptId = "sample-disclosure-voucher";
const receipt = () =>
  new Blob(["sample disclosure voucher"], { type: "application/pdf" });
beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob);
  savePreferences({ language: "bn" });
});
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  for (const database of databases.splice(0)) await database.delete();
  setActiveOwner(null);
  localStorage.clear();
  vi.unstubAllGlobals();
});
const base = () =>
  LedgerSchema.parse({
    works: [
      { id: "sample-one", name: "নমুনা দরজা" },
      { id: "sample-two", name: "নমুনা ছাদ" },
    ],
    people: [{ id: "sample-shop", name: "নমুনা দোকান", kind: "shop" }],
    materialGroups: [{ id: "sample-group", name: "নমুনা মাল" }],
  });
function purchase(payment: "full" | "partial") {
  return buildQuickEntry(
    base(),
    QuickDraftSchema.parse({
      id: billId,
      paymentId: cashId,
      refundId: "sample-simple-refund",
      workId: "sample-one",
      personId: "sample-shop",
      date: "2026-11-01",
      payment,
      paid: "400",
      rows: [
        {
          id: "sample-simple-line",
          label: "নমুনা মাল",
          groupId: "sample-group",
          amount: "1000",
        },
      ],
    }),
  );
}
function complex(kind: "expense" | "payment") {
  const common = {
    id: kind === "expense" ? billId : cashId,
    kind,
    personId: "sample-shop",
    account: "materials",
    date: null,
    note: "নমুনা আগের নোট",
    createdAt: "2026-11-01T08:00:00.000Z",
    updatedAt: "2026-11-01T08:00:00.000Z",
    receipts: [
      {
        id: receiptId,
        name: "sample.pdf",
        mime: "application/pdf",
        size: receipt().size,
      },
    ],
  };
  return LedgerSchema.parse({
    ...base(),
    items: [
      {
        id: "sample-first-item",
        materialGroupId: "sample-group",
        name: "নমুনা মাল এক",
        unit: "বস্তা",
      },
      {
        id: "sample-second-item",
        materialGroupId: "sample-group",
        name: "নমুনা মাল দুই",
        unit: "পিস",
      },
    ],
    entries: [
      kind === "expense"
        ? {
            ...common,
            lines: [
              {
                id: "sample-first-line",
                itemId: "sample-first-item",
                workId: "sample-one",
                label: "নমুনা মাল এক",
                materialGroupId: "sample-group",
                amount: 60000,
                quantity: "2.5",
                unit: "বস্তা",
                usage: "নমুনা ব্যবহার এক",
              },
              {
                id: "sample-second-line",
                itemId: "sample-second-item",
                workId: "sample-two",
                label: "নমুনা মাল দুই",
                materialGroupId: "sample-group",
                amount: 40000,
                quantity: "3",
                unit: "পিস",
                usage: "নমুনা ব্যবহার দুই",
              },
            ],
          }
        : {
            ...common,
            allocations: [
              { workId: "sample-one", amount: 60000 },
              { workId: "sample-two", amount: 40000 },
            ],
            paymentParts: [
              { method: "cash", amount: 70000 },
              { method: "bkash", amount: 30000 },
            ],
          },
    ],
  });
}
async function repository(ledger: Ledger) {
  const owner = crypto.randomUUID();
  setActiveOwner(owner);
  const database = getAccountDatabase(owner);
  databases.push(database);
  const repo = new LedgerRepository(database);
  await repo.ensure("real", LedgerSchema.parse({}));
  const attachment = ledger.entries.find((entry) => entry.receipts.length);
  await repo.save(
    ledger,
    "real",
    attachment
      ? [
          {
            id: receiptId,
            entryId: attachment.id,
            file: receipt(),
            name: "sample.pdf",
          },
        ]
      : [],
  );
  return repo;
}
function mount(
  ledger: Ledger,
  id: string,
  onSave: (next: Ledger) => Promise<void>,
  onClose: () => void,
) {
  return render(
    <LanguageProvider>
      <EntrySheet
        presentation="page"
        ledger={ledger}
        editEntryId={id}
        onSave={onSave}
        onClose={onClose}
      />
    </LanguageProvider>,
  );
}
const save = () =>
  screen.getByRole("button", { name: /^(?:রাখুন|সংরক্ষণ করুন)$/ });
async function ready() {
  await waitFor(() =>
    expect((save() as HTMLButtonElement).disabled).toBe(false),
  );
}
function value(control: Element) {
  return latinDigits((control as HTMLInputElement).value);
}
async function reveal(
  control: Element,
  user: ReturnType<typeof userEvent.setup>,
) {
  const ancestors: HTMLDetailsElement[] = [];
  for (
    let parent = control.parentElement;
    parent;
    parent = parent.parentElement
  )
    if (parent.tagName === "DETAILS")
      ancestors.unshift(parent as HTMLDetailsElement);
  for (const details of ancestors)
    if (!details.open) await user.click(details.querySelector("summary")!);
}
async function collapse(
  page: HTMLElement,
  user: ReturnType<typeof userEvent.setup>,
) {
  for (const details of [...page.querySelectorAll("details")].reverse())
    if (details.open && !details.parentElement?.closest("details:not([open])"))
      await user.click(details.querySelector("summary")!);
  expect(
    [...page.querySelectorAll("details")]
      .filter((details) => !details.parentElement?.closest("details"))
      .every((details) => !details.open),
  ).toBe(true);
}
function financialFields(entry: Entry) {
  return {
    account: entry.account,
    personId: entry.personId,
    contractId: entry.contractId,
    relatedEntryId: entry.relatedEntryId,
    date: entry.date,
    lines: entry.lines,
    allocations: entry.allocations,
    paymentParts: entry.paymentParts,
    receipts: entry.receipts,
  };
}

it("keeps a fully paid simple purchase focused on one amount while preserving its paired save", async () => {
  const original = purchase("full");
  const repo = await repository(original);
  const onClose = vi.fn();
  const onSave = vi.fn(async (next: Ledger) => {
    await repo.save(next);
  });
  const page = mount(original, billId, onSave, onClose);
  await ready();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getAllByLabelText(/^মোট দাম/)).toHaveLength(1);
  const amount = screen.getByLabelText(/^মোট দাম/);
  expect(amount.closest("details:not([open])")).toBeNull();
  expect(
    screen.getByLabelText("নাম, খাতা ও তারিখ").closest("details")?.open,
  ).toBe(false);
  expect(
    screen.queryByRole("checkbox", { name: "পুরো টাকা দেওয়া ছিল" }),
  ).toBeNull();
  const note = screen.getByLabelText("মনে রাখার কথা");
  expect(note.closest("details")).not.toBeNull();
  expect(note.closest("details")!.open).toBe(false);
  fireEvent.change(amount, { target: { value: "100" } });
  await userEvent.click(save());
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  const saved = (await repo.read())!.ledger;
  expect(entryTotal(saved.entries[0])).toBe(10000);
  expect(entryTotal(saved.entries[1])).toBe(10000);
  expect(personSummary(saved, "sample-shop")).toMatchObject({
    payable: 0,
    advance: 0,
  });
  expect(onSave).toHaveBeenCalledOnce();
  page.unmount();
});

it("does not change an independent partial payment when the common bill amount is edited", async () => {
  const original = purchase("partial");
  const repo = await repository(original);
  const onClose = vi.fn();
  const onSave = vi.fn(async (next: Ledger) => {
    await repo.save(next);
  });
  const page = mount(original, billId, onSave, onClose);
  await ready();
  expect(
    screen.queryByRole("checkbox", { name: "পুরো টাকা দেওয়া ছিল" }),
  ).toBeNull();
  fireEvent.change(screen.getByLabelText(/^মোট দাম/), {
    target: { value: "900" },
  });
  await userEvent.click(save());
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect((await repo.read())!.ledger.entries[1]).toEqual(original.entries[1]);
  expect(
    personSummary((await repo.read())!.ledger, "sample-shop"),
  ).toMatchObject({ cost: 90000, netPaid: 40000, payable: 50000, advance: 0 });
  page.unmount();
});

it("reveals a required empty name inside the closed context instead of losing the blocked save", async () => {
  const original = purchase("full");
  const repo = await repository(original);
  const before = await repo.read();
  const onSave = vi.fn(async (next: Ledger) => {
    await repo.save(next);
  });
  const onClose = vi.fn();
  const user = userEvent.setup();
  const page = mount(original, billId, onSave, onClose);
  await ready();
  const person = screen.getByLabelText("কার সঙ্গে হিসাব");
  await reveal(person, user);
  await user.selectOptions(person, "__new__");
  const name = screen.getByLabelText(
    "ব্যক্তি বা দোকানের নাম",
  ) as HTMLInputElement;
  expect(name.required).toBe(true);
  expect(name.validity.valueMissing).toBe(true);
  const context = name.closest("details")!;
  await user.click(context.querySelector("summary")!);
  expect(context.open).toBe(false);
  await user.click(save());
  expect(context.open).toBe(true);
  expect(name.value).toBe("");
  expect(onSave).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(await repo.read()).toEqual(before);
  page.unmount();
});

it("keeps multirow, unknown-date, note and receipt values through a closed draft and collapsed save", async () => {
  const original = complex("expense");
  const repo = await repository(original);
  const before = await repo.read();
  const onClose = vi.fn();
  const onSave = vi.fn(async (next: Ledger) => {
    await repo.save(next);
  });
  const user = userEvent.setup();
  let page = mount(original, billId, onSave, onClose);
  await ready();
  expect(
    [...page.container.querySelectorAll("details")].every(
      (details) => !details.open,
    ),
  ).toBe(true);
  const amounts = screen.getAllByLabelText(/^মোট দাম/);
  expect(amounts.map(value)).toEqual(["600", "400"]);
  await reveal(amounts[0], user);
  fireEvent.change(amounts[0], { target: { value: "650" } });
  const note = screen.getByLabelText("মনে রাখার কথা");
  await reveal(note, user);
  fireEvent.change(note, { target: { value: "নমুনা অসমাপ্ত নোট" } });
  await collapse(page.container, user);
  await user.click(screen.getByRole("button", { name: "ফিরুন" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  page.unmount();
  expect(await repo.read()).toEqual(before);
  expect(
    await createWorkspaceStorage().readDraft(`entry:${billId}`),
  ).toMatchObject({
    draft: {
      note: "নমুনা অসমাপ্ত নোট",
      unknownDate: true,
      rows: [
        { workId: "sample-one", amount: "650", quantity: "2.5", unit: "বস্তা" },
        { workId: "sample-two", amount: "400", quantity: "3", unit: "পিস" },
      ],
    },
  });
  page = mount(original, billId, onSave, onClose);
  await ready();
  expect(screen.getAllByLabelText(/^মোট দাম/).map(value)).toEqual([
    "650",
    "400",
  ]);
  const unknown = screen.getByLabelText("তারিখ জানা নেই") as HTMLInputElement;
  await reveal(unknown, user);
  expect(unknown.checked).toBe(true);
  for (const quantity of screen.getAllByLabelText("পরিমাণ"))
    await reveal(quantity, user);
  expect(screen.getAllByLabelText("পরিমাণ").map(value)).toEqual(["2.5", "3"]);
  expect(screen.getAllByLabelText("একক").map(value)).toEqual(["বস্তা", "পিস"]);
  expect(
    (screen.getByLabelText("মনে রাখার কথা") as HTMLTextAreaElement).value,
  ).toBe("নমুনা অসমাপ্ত নোট");
  const voucher = screen.getByText(/আগের.*ভাউচার রাখা আছে/);
  await reveal(voucher, user);
  await collapse(page.container, user);
  await user.click(save());
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  expect(onSave).toHaveBeenCalledOnce();
  page.unmount();
  repo.database.close();
  await repo.database.open();
  const saved = (await repo.read())!.ledger.entries[0];
  expect(saved.lines).toEqual(
    original.entries[0].lines.map((line, index) => ({
      ...line,
      amount: index === 0 ? 65000 : line.amount,
    })),
  );
  expect(saved.date).toBeNull();
  expect(saved.note).toBe("নমুনা অসমাপ্ত নোট");
  expect(saved.receipts).toEqual(original.entries[0].receipts);
  expect(await (await repo.getReceipt(receiptId))!.blob.text()).toBe(
    "sample disclosure voucher",
  );
  expect(
    await createWorkspaceStorage().readDraft(`entry:${billId}`),
  ).toBeNull();
});

it("preserves split work and multiple payment methods when every optional disclosure is closed for save", async () => {
  const original = complex("payment");
  const repo = await repository(original);
  const onClose = vi.fn();
  const onSave = vi.fn(async (next: Ledger) => {
    await repo.save(next);
  });
  const user = userEvent.setup();
  const page = mount(original, cashId, onSave, onClose);
  await ready();
  expect(
    [...page.container.querySelectorAll("details")].every(
      (details) => !details.open,
    ),
  ).toBe(true);
  const parts = screen.getAllByLabelText("এই মাধ্যমে কত টাকা");
  for (const part of parts) await reveal(part, user);
  expect(parts.map(value)).toEqual(["700", "300"]);
  expect(screen.getAllByLabelText("টাকা দেওয়ার মাধ্যম").map(value)).toEqual([
    "cash",
    "bkash",
  ]);
  const splits = screen.getAllByLabelText("টাকা", { exact: true });
  for (const part of splits) await reveal(part, user);
  expect(splits.map(value)).toEqual(["600", "400"]);
  expect(
    (screen.getByLabelText("তারিখ জানা নেই") as HTMLInputElement).checked,
  ).toBe(true);
  expect(
    (screen.getByLabelText("মনে রাখার কথা") as HTMLTextAreaElement).value,
  ).toBe(original.entries[0].note);
  await collapse(page.container, user);
  await user.click(save());
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  page.unmount();
  repo.database.close();
  await repo.database.open();
  const saved = (await repo.read())!.ledger.entries[0];
  expect(financialFields(saved)).toEqual(financialFields(original.entries[0]));
  expect(saved.note).toBe(original.entries[0].note);
  expect(saved.revisions.at(-1)?.before).toEqual(
    EntryCoreSchema.parse(original.entries[0]),
  );
  expect(await (await repo.getReceipt(receiptId))!.blob.text()).toBe(
    "sample disclosure voucher",
  );
});
