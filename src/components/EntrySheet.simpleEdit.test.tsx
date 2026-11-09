// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
import { EntrySheet, type EntryAttachments } from "./EntrySheet";

await vi.hoisted(async () => {
  const { Blob, File } = await import("node:buffer");
  vi.stubGlobal("Blob", Blob);
  vi.stubGlobal("File", File);
});

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
  vi.stubGlobal("File", NodeFile);
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
  expect(screen.getByLabelText("নাম ও খাতা").closest("details")?.open).toBe(
    false,
  );
  expect(
    screen.queryByRole("checkbox", { name: "পুরো টাকা দেওয়া ছিল" }),
  ).toBeNull();
  const note = screen.getByLabelText("মনে রাখার কথা");
  expect(note.closest("details")!.open).toBe(false);
  expect(screen.getByLabelText("তারিখ").closest("details")).toBe(
    note.closest("details"),
  );
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

it("translates the compact date, notes and optional receipt area with the real language provider", async () => {
  const original = purchase("full");
  await repository(original);
  savePreferences({ language: "en" });
  mount(original, billId, vi.fn(), vi.fn());
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  const extras = screen.getByRole("group", {
    name: "Voucher, note and date",
  }) as HTMLDetailsElement;
  expect(within(extras).getByLabelText("Date").closest("details")).toBe(extras);
  const note = within(extras).getByLabelText("Notes") as HTMLTextAreaElement;
  expect(note.closest("details")).toBe(extras);
  expect(note.placeholder).toBe(
    "What it was for, where it came from, or anything else…",
  );
  expect(note.maxLength).toBe(10000);
  expect(within(extras).getByLabelText("Receipt or photo")).toBeTruthy();
  expect(within(extras).getByText("Add voucher")).toBeTruthy();
  expect(extras.open).toBe(false);
  expect(screen.queryByRole("checkbox", { name: "Date unknown" })).toBeNull();
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
    [...page.container.querySelectorAll(".entry-line-details")].every(
      (details) => (details as HTMLDetailsElement).open,
    ),
  ).toBe(true);
  const context = screen.getByLabelText("নাম ও খাতা").closest("details")!;
  for (const [index, workId] of ["sample-one", "sample-two"].entries()) {
    const work = screen.getByLabelText(`খরচ ${["১", "২"][index]}-এর খাতা`);
    expect(work.closest("details")).toBe(context);
    expect(value(work)).toBe(workId);
  }
  for (const details of page.container.querySelectorAll(
    ".entry-line-details",
  )) {
    expect(details.querySelector("select")).toBeNull();
  }
  expect(screen.queryByText("কোন খাতায় রাখবেন")).toBeNull();
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
  const dateField = screen.getByLabelText("তারিখ") as HTMLInputElement;
  await reveal(dateField, user);
  expect(dateField.value).toBe("");
  expect(dateField.disabled).toBe(false);
  expect(screen.queryByRole("checkbox", { name: "তারিখ জানা নেই" })).toBeNull();
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
    screen.queryByRole("checkbox", { name: "একাধিক খাতায় ভাগ করব" }),
  ).toBeNull();
  for (const name of [
    "অন্য মাধ্যমেও দিয়েছি",
    "এই মাধ্যম সরান",
    "এই ভাগ সরান",
    "আরেক খাতায় ভাগ করুন",
  ])
    expect(screen.queryByRole("button", { name })).toBeNull();
  expect(
    [
      ...page.container.querySelectorAll<HTMLDetailsElement>(
        "details:not(.transaction-extras)",
      ),
    ].every((details) => !details.open),
  ).toBe(true);
  expect(screen.getByText("ভাউচার, নোট ও তারিখ").closest("details")!.open).toBe(
    true,
  );
  const parts = screen.getAllByLabelText("এই মাধ্যমে কত টাকা");
  for (const part of parts) await reveal(part, user);
  expect(parts.map(value)).toEqual(["700", "300"]);
  expect(
    screen
      .getAllByRole("group", { name: "কীভাবে দিয়েছেন" })
      .map(
        (group) =>
          within(group).getByRole("button", { pressed: true }).textContent,
      ),
  ).toEqual(["ক্যাশ", "বিকাশ"]);
  const splits = screen.getAllByLabelText("টাকা", { exact: true });
  for (const part of splits) await reveal(part, user);
  expect(splits.map(value)).toEqual(["600", "400"]);
  expect((screen.getByLabelText("তারিখ") as HTMLInputElement).value).toBe("");
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

it("reopens brand and quantity drafts, keeps vouchers reachable, and preserves the item used by another bill", async () => {
  const source = complex("expense");
  const original = LedgerSchema.parse({
    ...source,
    items: source.items.map((item, index) => ({
      ...item,
      brand: index === 0 ? "নমুনা পুরোনো ব্র্যান্ড" : "",
    })),
    entries: [
      ...source.entries,
      {
        ...source.entries[0],
        id: "sample-other-bill",
        lines: source.entries[0].lines.map((line) => ({
          ...line,
          id: `${line.id}-other`,
        })),
        receipts: [],
      },
    ],
  });
  const repo = await repository(original);
  const onClose = vi.fn();
  const onSave = vi.fn(async (next: Ledger) => {
    await repo.save(next);
  });
  const user = userEvent.setup();
  let page = mount(original, billId, onSave, onClose);
  await ready();
  expect(
    screen.getAllByLabelText("ব্র্যান্ড")[0].closest("details")?.open,
  ).toBe(true);
  const extras = screen.getByText("ভাউচার, নোট ও তারিখ").closest("details")!;
  expect(extras.open).toBe(true);
  expect(screen.getByLabelText("ভাউচার বা ছবি").closest("details")).toBe(
    extras,
  );
  expect(screen.getByLabelText("মনে রাখার কথা").closest("details")).toBe(
    extras,
  );
  expect(screen.getByLabelText("তারিখ").closest("details")).toBe(extras);
  expect(
    screen
      .getByRole("button", { name: "sample.pdf", hidden: true })
      .closest("details"),
  ).toBe(extras);
  fireEvent.change(screen.getAllByLabelText("ব্র্যান্ড")[0], {
    target: { value: "নমুনা নতুন ব্র্যান্ড" },
  });
  fireEvent.change(screen.getAllByLabelText("পরিমাণ")[0], {
    target: { value: "4.5" },
  });
  await user.click(screen.getByRole("button", { name: "ফিরুন" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  page.unmount();
  expect((await repo.read())!.ledger).toEqual(original);
  page = mount(original, billId, onSave, onClose);
  await ready();
  expect(
    (screen.getAllByLabelText("ব্র্যান্ড")[0] as HTMLInputElement).value,
  ).toBe("নমুনা নতুন ব্র্যান্ড");
  expect(value(screen.getAllByLabelText("পরিমাণ")[0])).toBe("4.5");
  await user.click(save());
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  page.unmount();
  repo.database.close();
  await repo.database.open();
  const saved = (await repo.read())!.ledger;
  const changed = saved.entries.find((entry) => entry.id === billId)!;
  const other = saved.entries.find(
    (entry) => entry.id === "sample-other-bill",
  )!;
  expect(changed.lines[0].itemId).not.toBe("sample-first-item");
  expect(
    saved.items.find((item) => item.id === changed.lines[0].itemId),
  ).toMatchObject({
    brand: "নমুনা নতুন ব্র্যান্ড",
    materialGroupId: "sample-group",
  });
  expect(saved.items.find((item) => item.id === "sample-first-item")).toEqual(
    original.items[0],
  );
  expect(other).toEqual(original.entries[1]);
  expect(changed.lines[0]).toMatchObject({
    amount: 60000,
    quantity: "4.5",
    unit: "বস্তা",
    usage: "নমুনা ব্যবহার এক",
    materialGroupId: "sample-group",
  });
  expect(changed.receipts).toEqual(original.entries[0].receipts);
  expect(await (await repo.getReceipt(receiptId))!.blob.text()).toBe(
    "sample disclosure voucher",
  );
  expect(saved.entries).toHaveLength(2);
  expect(
    await createWorkspaceStorage().readDraft(`entry:${billId}`),
  ).toBeNull();
});

it("restores an older edit draft without a brand field without changing the saved material", async () => {
  const source = complex("expense");
  const original = LedgerSchema.parse({
    ...source,
    items: source.items.map((item) => ({ ...item, brand: "নমুনা ব্র্যান্ড" })),
  });
  const repo = await repository(original);
  const onClose = vi.fn();
  const onSave = vi.fn(async (next: Ledger) => {
    await repo.save(next);
  });
  let page = mount(original, billId, onSave, onClose);
  await ready();
  await userEvent.click(screen.getByRole("button", { name: "ফিরুন" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  page.unmount();
  const storage = createWorkspaceStorage();
  const oldDraft = await storage.readDraft<{
    draft: { rows: { brand?: string }[] };
  }>(`entry:${billId}`);
  for (const row of oldDraft!.draft.rows) delete row.brand;
  await storage.saveDraft(`entry:${billId}`, oldDraft);
  page = mount(original, billId, onSave, onClose);
  await ready();
  expect(screen.getAllByLabelText("ব্র্যান্ড").map(value)).toEqual([
    "নমুনা ব্র্যান্ড",
    "নমুনা ব্র্যান্ড",
  ]);
  await userEvent.click(save());
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  page.unmount();
  const saved = (await repo.read())!.ledger;
  expect(saved.items).toEqual(original.items);
  expect(saved.entries[0].lines).toEqual(original.entries[0].lines);
  expect(saved.entries[0].receipts).toEqual(original.entries[0].receipts);
});

it("keeps an older work bill's quantity through amount edits without asking for quantity or unit", async () => {
  const original = LedgerSchema.parse({
    works: [{ id: "sample-one", name: "নমুনা খাতা" }],
    people: [{ id: "sample-worker", name: "নমুনা কর্মী", kind: "worker" }],
    entries: [
      {
        id: billId,
        kind: "expense",
        account: "labour",
        personId: "sample-worker",
        lines: [
          {
            id: "sample-work-line",
            workId: "sample-one",
            label: "নমুনা প্লাস্টার",
            costType: "labour",
            amount: 100000,
            quantity: "2.5",
            unit: "দিন",
          },
        ],
      },
    ],
  });
  const repo = await repository(original);
  const onClose = vi.fn();
  const onSave = vi.fn(async (next: Ledger) => {
    await repo.save(next);
  });
  const page = mount(original, billId, onSave, onClose);
  await ready();
  expect(screen.queryByLabelText("পরিমাণ")).toBeNull();
  expect(screen.queryByLabelText("একক")).toBeNull();
  expect(screen.queryByLabelText("ব্র্যান্ড")).toBeNull();
  fireEvent.change(screen.getByLabelText("মোট দাম"), {
    target: { value: "900" },
  });
  await userEvent.click(save());
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  page.unmount();
  repo.database.close();
  await repo.database.open();
  expect((await repo.read())!.ledger.entries[0].lines).toEqual([
    { ...original.entries[0].lines[0], amount: 90000 },
  ]);
});

it("edits an existing refundable payment with icon methods without changing its saved purpose", async () => {
  const original = LedgerSchema.parse({
    works: [{ id: "sample-one", name: "নমুনা খাতা" }],
    people: [{ id: "sample-shop", name: "নমুনা দোকান", kind: "shop" }],
    entries: [
      {
        id: cashId,
        kind: "payment",
        account: "materials",
        personId: "sample-shop",
        paymentContext: "receivable",
        allocations: [{ workId: "sample-one", amount: 100000 }],
        paymentParts: [{ method: "bank", amount: 100000 }],
      },
    ],
  });
  const repo = await repository(original);
  const onClose = vi.fn();
  const onSave = vi.fn(async (next: Ledger) => {
    await repo.save(next);
  });
  const user = userEvent.setup();
  const page = mount(original, cashId, onSave, onClose);
  await ready();
  expect(screen.queryByText("এই টাকা ফেরত পাব")).toBeNull();
  const methods = screen.getByRole("group", { name: "কীভাবে দিয়েছেন" });
  expect(methods.closest("details")).toBeNull();
  expect(
    within(methods).getByRole("button", { name: "ব্যাংক", pressed: true }),
  ).toBeTruthy();
  await user.click(within(methods).getByRole("button", { name: "বিকাশ" }));
  fireEvent.change(screen.getByLabelText("টাকার পরিমাণ"), {
    target: { value: "900" },
  });
  await user.click(save());
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  page.unmount();
  repo.database.close();
  await repo.database.open();
  expect((await repo.read())!.ledger.entries).toHaveLength(1);
  expect((await repo.read())!.ledger.entries[0]).toMatchObject({
    id: cashId,
    kind: "payment",
    paymentContext: "receivable",
    allocations: [{ workId: "sample-one", amount: 90000 }],
    paymentParts: [{ method: "bkash", amount: 90000 }],
  });
});

it("lets a legacy unknown date be selected without a checkbox and persists the first selection", async () => {
  const original = complex("expense");
  const repo = await repository(original);
  const onClose = vi.fn();
  const page = mount(
    original,
    billId,
    async (next) => repo.save(next),
    onClose,
  );
  await ready();
  const date = screen.getByLabelText("তারিখ") as HTMLInputElement;
  expect(date.value).toBe("");
  expect(date.disabled).toBe(false);
  expect(screen.queryByRole("checkbox", { name: "তারিখ জানা নেই" })).toBeNull();
  fireEvent.change(date, { target: { value: "2026-10-25" } });
  await userEvent.click(save());
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  page.unmount();
  repo.database.close();
  await repo.database.open();
  const saved = (await repo.read())!.ledger;
  expect(saved.entries[0].date).toBe("2026-10-25");
  expect(saved.entries[0].lines).toEqual(original.entries[0].lines);
  expect(saved.entries[0].receipts).toEqual(original.entries[0].receipts);
});

it("records a new cash payment in one work and one method without split controls", async () => {
  const original = base();
  const repo = await repository(original);
  const onClose = vi.fn();
  const user = userEvent.setup();
  const page = render(
    <LanguageProvider>
      <EntrySheet
        presentation="page"
        ledger={original}
        initialKind="payment"
        defaultWorkId="sample-one"
        defaultPersonId="sample-shop"
        onSave={async (next) => repo.save(next)}
        onClose={onClose}
      />
    </LanguageProvider>,
  );
  await ready();
  expect(
    screen.queryByRole("checkbox", { name: "একাধিক খাতায় ভাগ করব" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "অন্য মাধ্যমেও দিয়েছি" }),
  ).toBeNull();
  expect(screen.queryByRole("checkbox", { name: "তারিখ জানা নেই" })).toBeNull();
  fireEvent.change(screen.getByLabelText("টাকার পরিমাণ"), {
    target: { value: "123" },
  });
  await user.click(screen.getByRole("button", { name: "ব্যাংক" }));
  await user.click(save());
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  page.unmount();
  repo.database.close();
  await repo.database.open();
  expect((await repo.read())!.ledger.entries[0]).toMatchObject({
    kind: "payment",
    allocations: [{ workId: "sample-one", amount: 12300 }],
    paymentParts: [{ method: "bank", amount: 12300 }],
  });
});

it("rejects a new oversized batch atomically and saves an exact 5 MiB receipt after a draft reopens", async () => {
  const original = complex("expense");
  const repo = await repository(original);
  const onClose = vi.fn();
  const onSave = vi.fn(async (next: Ledger, attachments?: EntryAttachments) => {
    await repo.save(
      next,
      "real",
      attachments?.files.map(({ id, file }) => ({
        id,
        file,
        entryId: attachments.entryId,
      })),
    );
  });
  const user = userEvent.setup();
  let page = mount(original, billId, onSave, onClose);
  await ready();
  const input =
    page.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const accepted = new File(
    [new Uint8Array(5 * 1024 * 1024)],
    "sample-at-limit.pdf",
    { type: "application/pdf" },
  );
  const oversized = new File(
    [new Uint8Array(5 * 1024 * 1024 + 1)],
    "sample-too-large.pdf",
    { type: "application/pdf" },
  );
  await user.upload(input, [accepted, oversized]);
  expect(screen.getByRole("alert").textContent).toContain("৫ MB");
  expect(screen.queryByText(accepted.name)).toBeNull();
  expect(screen.queryByText(oversized.name)).toBeNull();
  expect((await repo.read())!.ledger).toEqual(original);
  await user.upload(input, accepted);
  await waitFor(() => expect(screen.getByText(accepted.name)).toBeTruthy());
  await user.click(screen.getByRole("button", { name: "ফিরুন" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  page.unmount();
  expect(
    await createWorkspaceStorage().readDraft(`entry:${billId}`),
  ).toMatchObject({
    files: [{ file: expect.objectContaining({ size: accepted.size }) }],
  });
  page = mount(original, billId, onSave, onClose);
  await ready();
  expect(screen.getByText(accepted.name)).toBeTruthy();
  await collapse(page.container, user);
  await user.click(save());
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  page.unmount();
  repo.database.close();
  await repo.database.open();
  const saved = (await repo.read())!.ledger.entries[0];
  expect(saved.lines).toEqual(original.entries[0].lines);
  const receipt = saved.receipts.find(
    (receipt) => receipt.name === accepted.name,
  )!;
  expect(receipt.size).toBe(accepted.size);
  expect((await repo.getReceipt(receipt.id))!.blob.size).toBe(accepted.size);
  expect(
    saved.receipts.some((receipt) => receipt.name === oversized.name),
  ).toBe(false);
});

it("keeps a legacy 6 MiB draft receipt through editing, another reopen and backup restore", async () => {
  const original = complex("expense");
  const repo = await repository(original);
  const onClose = vi.fn();
  const onSave = async (next: Ledger, attachments?: EntryAttachments) => {
    await repo.save(
      next,
      "real",
      attachments?.files.map(({ id, file }) => ({
        id,
        file,
        entryId: attachments.entryId,
      })),
    );
  };
  const user = userEvent.setup();
  let page = mount(original, billId, onSave, onClose);
  await ready();
  await user.click(screen.getByRole("button", { name: "ফিরুন" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  page.unmount();
  const storage = createWorkspaceStorage();
  const pending = await storage.readDraft<{ draft: unknown; files: unknown[] }>(
    `entry:${billId}`,
  );
  const legacy = new File(
    [new Uint8Array(6 * 1024 * 1024).fill(51)],
    "sample-legacy-large.pdf",
    { type: "application/pdf" },
  );
  await storage.saveDraft(`entry:${billId}`, {
    ...pending!,
    files: [{ id: "sample-legacy-3mb", file: legacy }],
  });
  page = mount(original, billId, onSave, onClose);
  await ready();
  await waitFor(() => expect(screen.getByText(legacy.name)).toBeTruthy());
  fireEvent.change(screen.getByLabelText("মনে রাখার কথা"), {
    target: { value: "নমুনা পুরোনো রসিদ রাখা হলো" },
  });
  await collapse(page.container, user);
  await user.click(save());
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  page.unmount();
  repo.database.close();
  await repo.database.open();
  const firstSave = (await repo.read())!.ledger;
  expect(firstSave.entries[0].date).toBeNull();
  expect(firstSave.entries[0].lines).toEqual(original.entries[0].lines);
  expect((await repo.getReceipt("sample-legacy-3mb"))!.blob.size).toBe(
    legacy.size,
  );
  page = mount(firstSave, billId, onSave, onClose);
  await ready();
  expect(screen.getByRole("button", { name: legacy.name })).toBeTruthy();
  await collapse(page.container, user);
  await user.click(save());
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(3));
  page.unmount();
  const backup = await repo.exportBackup();
  const target = await repository(LedgerSchema.parse({}));
  await target.importBackup(backup, { replace: true });
  target.database.close();
  await target.database.open();
  const restored = (await target.read())!.ledger;
  expect(restored.entries[0].date).toBeNull();
  expect(restored.entries[0].lines).toEqual(original.entries[0].lines);
  expect(restored.entries[0].receipts).toEqual(firstSave.entries[0].receipts);
  expect(
    await (await target.getReceipt("sample-legacy-3mb"))!.blob.text(),
  ).toBe(await legacy.text());
});

it("keeps new multi-item purchases in the selected single work without per-line split choices", async () => {
  const original = base();
  const repo = await repository(original);
  const onClose = vi.fn();
  const user = userEvent.setup();
  const page = render(
    <LanguageProvider>
      <EntrySheet
        presentation="page"
        ledger={original}
        initialKind="purchase"
        defaultWorkId="sample-one"
        defaultPersonId="sample-shop"
        onSave={async (next) => repo.save(next)}
        onClose={onClose}
      />
    </LanguageProvider>,
  );
  await ready();
  await user.click(screen.getByRole("button", { name: "আরেকটি মাল বা খরচ" }));
  expect(screen.queryByLabelText(/^খরচ.*-এর খাতা$/)).toBeNull();
  expect(
    screen.queryByRole("button", { name: "অন্য মাধ্যমেও দিয়েছি" }),
  ).toBeNull();
  await user.selectOptions(
    screen.getByLabelText("কোন খাতার হিসাব"),
    "sample-two",
  );
  const amounts = screen.getAllByLabelText("মোট দাম");
  const names = screen.getAllByRole("combobox", {
    name: "মালামাল বা খরচের নাম",
  });
  for (let index = 0; index < 2; index++) {
    fireEvent.change(amounts[index], {
      target: { value: index === 0 ? "100" : "200" },
    });
    fireEvent.change(names[index], {
      target: { value: index === 0 ? "নমুনা মাল এক" : "নমুনা মাল দুই" },
    });
  }
  await user.click(save());
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  page.unmount();
  repo.database.close();
  await repo.database.open();
  const saved = (await repo.read())!.ledger;
  const bill = saved.entries.find((entry) => entry.kind === "expense")!;
  expect(
    bill.lines.map((line) => ({ workId: line.workId, amount: line.amount })),
  ).toEqual([
    { workId: "sample-two", amount: 10000 },
    { workId: "sample-two", amount: 20000 },
  ]);
  const payment = saved.entries.find((entry) => entry.kind === "payment")!;
  expect(payment.allocations).toEqual([
    { workId: "sample-two", amount: 30000 },
  ]);
  expect(payment.paymentParts).toEqual([{ method: "cash", amount: 30000 }]);
});

it("reveals an invalid restored date for correction without discarding the pending draft", async () => {
  const original = purchase("full");
  const repo = await repository(original);
  const onClose = vi.fn();
  const onSave = vi.fn(async (next: Ledger) => repo.save(next));
  const user = userEvent.setup();
  let page = mount(original, billId, onSave, onClose);
  await ready();
  await user.click(screen.getByRole("button", { name: "ফিরুন" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  page.unmount();
  const storage = createWorkspaceStorage();
  const pending = await storage.readDraft<{
    draft: Record<string, unknown>;
    files: unknown[];
  }>(`entry:${billId}`);
  await storage.saveDraft(`entry:${billId}`, {
    ...pending!,
    draft: { ...pending!.draft, date: "invalid", unknownDate: false },
  });
  page = mount(original, billId, onSave, onClose);
  await ready();
  const date = screen.getByLabelText("তারিখ");
  const extras = date.closest("details")!;
  expect(extras.open).toBe(false);
  await user.click(save());
  expect(extras.open).toBe(true);
  expect(onSave).not.toHaveBeenCalled();
  expect(await storage.readDraft(`entry:${billId}`)).toMatchObject({
    draft: { date: "invalid", unknownDate: false },
  });
  fireEvent.change(date, { target: { value: "2026-11-04" } });
  await user.click(save());
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  page.unmount();
  expect((await repo.read())!.ledger.entries[0].date).toBe("2026-11-04");
  expect(await storage.readDraft(`entry:${billId}`)).toBeNull();
});
