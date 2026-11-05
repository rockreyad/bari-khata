// @vitest-environment jsdom
import { migrateArchitecture } from "../domain/architectureMigration";
import "fake-indexeddb/auto";
import { Blob as NodeBlob } from "node:buffer";
import type { SelectHTMLAttributes } from "react";
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
import { LedgerRepository } from "../data/repository";
import { LedgerSchema, type Ledger } from "../domain/model";
import { summarize } from "../domain/ledger";
import { savePreferences } from "../lib/preferences";
import { EntrySheet } from "./EntrySheet";

vi.mock("./ui/AppSelect", () => ({
  AppSelect: (props: SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props} />
  ),
}));

const databases: LedgerDatabase[] = [];
beforeEach(() => vi.stubGlobal("Blob", NodeBlob));
afterEach(async () => {
  cleanup();
  setActiveOwner(null);
  for (const database of databases.splice(0)) await database.delete();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function reveal<T extends HTMLElement>(element: T): T {
  const ancestors: HTMLDetailsElement[] = [];
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  )
    if (parent instanceof HTMLDetailsElement) ancestors.unshift(parent);
  for (const section of ancestors)
    if (!section.open) {
      const summary = section.querySelector<HTMLElement>(":scope > summary");
      if (!summary) throw new Error("Expected a disclosure summary");
      fireEvent.click(summary);
    }
  return element;
}

async function ready() {
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "সংরক্ষণ করুন",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
}

it.each([
  { change: "missing shop", person: "shop", work: "general" },
  { change: "work notebook", person: "", work: "preparation" },
  { change: "shop and work together", person: "shop", work: "preparation" },
])(
  "saves $change for an already paid bill and its settlement through the screen, reopen and backup restore",
  async ({ person, work }) => {
    savePreferences({ language: "bn" });
    const owner = crypto.randomUUID();
    setActiveOwner(owner);
    const database = getAccountDatabase(owner);
    databases.push(database);
    const repository = new LedgerRepository(database);
    const original = LedgerSchema.parse({
      works: [
        { id: "general", name: "সাধারণ" },
        { id: "preparation", name: "নির্মাণ-পূর্ব কাজ" },
      ],
      people: [{ id: "shop", name: "মিটারের দোকান", kind: "shop" }],
      entries: [
        {
          id: "bill",
          kind: "expense",
          date: "2026-11-01",
          createdAt: "2026-11-01T08:00:00Z",
          updatedAt: "2026-11-01T08:00:00Z",
          lines: [
            {
              id: "meter-line",
              workId: "general",
              label: "পিডিবি মিটার",
              amount: 123456,
            },
          ],
          receipts: [
            {
              id: "receipt",
              name: "meter.pdf",
              mime: "application/pdf",
              size: 4,
            },
          ],
        },
        {
          id: "paid",
          kind: "payment",
          relatedEntryId: "bill",
          date: "2026-11-02",
          createdAt: "2026-11-02T08:00:00Z",
          updatedAt: "2026-11-02T08:00:00Z",
          allocations: [{ workId: "general", amount: 123456 }],
          paymentParts: [{ method: "cash", amount: 123456 }],
        },
      ],
    });
    await repository.ensure("real", LedgerSchema.parse({}));
    await repository.save(original, "real", [
      {
        id: "receipt",
        entryId: "bill",
        file: new Blob(["bill"], { type: "application/pdf" }),
        name: "meter.pdf",
      },
    ]);
    const onSave = vi.fn(async (next: Ledger) => {
      await repository.save(next);
    });
    const onClose = vi.fn();
    const mount = (ledger: Ledger) =>
      render(
        <LanguageProvider>
          <EntrySheet
            presentation="page"
            ledger={ledger}
            editEntryId="bill"
            onSave={onSave}
            onClose={onClose}
          />
        </LanguageProvider>,
      );
    const user = userEvent.setup();
    let view = mount(original);
    await ready();
    reveal(screen.getByLabelText("কার সঙ্গে হিসাব"));
    if (person)
      fireEvent.change(
        screen.getByRole("combobox", { name: "কার সঙ্গে হিসাব" }),
        { target: { value: person } },
      );
    if (work !== "general")
      fireEvent.change(
        screen.getByRole("combobox", { name: "কোন খাতার হিসাব" }),
        { target: { value: work } },
      );
    await user.click(screen.getByRole("button", { name: "সংরক্ষণ করুন" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledOnce();
    view.unmount();
    database.close();
    await database.open();
    const saved = (await repository.read())!.ledger;
    expect(saved.entries).toHaveLength(2);
    expect(saved.entries[0]).toMatchObject({
      id: "bill",
      personId: person || null,
      date: "2026-11-01",
      lines: [{ workId: work, amount: 123456 }],
      receipts: original.entries[0].receipts,
    });
    expect(saved.entries[1]).toMatchObject({
      id: "paid",
      relatedEntryId: "bill",
      personId: person || null,
      date: "2026-11-02",
      allocations: [{ workId: work, amount: 123456 }],
      paymentParts: original.entries[1].paymentParts,
    });
    for (const entry of saved.entries)
      expect(entry.revisions.at(-1)?.before).toMatchObject({ personId: null });
    expect(summarize(saved)).toMatchObject({
      cost: 123456,
      netPaid: 123456,
      payable: 0,
      advance: 0,
    });
    const backup = await repository.exportBackup();
    const targetDatabase = new LedgerDatabase(
      `linked-restore-${crypto.randomUUID()}`,
    );
    databases.push(targetDatabase);
    const target = new LedgerRepository(targetDatabase);
    await target.ensure("real", LedgerSchema.parse({}));
    await target.importBackup(backup, { replace: true });
    expect((await target.read())!.ledger).toEqual(
      migrateArchitecture(saved).ledger,
    );
    expect(await (await target.getReceipt("receipt"))!.blob.text()).toBe(
      "bill",
    );
    view = mount(saved);
    await ready();
    reveal(screen.getByLabelText("কার সঙ্গে হিসাব"));
    expect(
      (
        screen.getByRole("combobox", {
          name: "কার সঙ্গে হিসাব",
        }) as HTMLSelectElement
      ).value,
    ).toBe(person);
    expect(
      (
        screen.getByRole("combobox", {
          name: "কোন খাতার হিসাব",
        }) as HTMLSelectElement
      ).value,
    ).toBe(work);
    await user.click(
      screen.getByRole("button", { name: "অসমাপ্ত লেখা বাদ দিন" }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
    view.unmount();
  },
);
