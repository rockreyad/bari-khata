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
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { LanguageProvider } from "../../context/LanguageProvider";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { entryTotal, summarize } from "../../domain/ledger";
import { entryAudit, snapshotTotal } from "../history/audit";
import {
  getAccountDatabase,
  setActiveOwner,
  LedgerDatabase,
} from "../../data/database";
import { LedgerRepository } from "../../data/repository";
import { savePreferences } from "../../lib/preferences";
import { EntrySheet } from "../../components/EntrySheet";
import { EntitySheet } from "../../components/EntitySheet";
import { EntryList } from "../../components/ui/EntryList";
import { ReconciliationPage } from "./ReconciliationPage";

const state = vi.hoisted(() => ({
  ledger: {} as Ledger,
  base: "",
  go: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({ useNotebook: () => state }));
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
const databases: LedgerDatabase[] = [];
afterEach(async () => {
  cleanup();
  setActiveOwner(null);
  for (const database of databases.splice(0)) await database.delete();
  localStorage.clear();
});
function fixture() {
  return LedgerSchema.parse({
    works: [{ id: "work", name: "দরজা" }],
    people: [
      { id: "shop", name: "দোকান", kind: "shop" },
      { id: "worker", name: "মিস্ত্রি", kind: "worker" },
    ],
    contracts: [
      { id: "agreement", workId: "work", personId: "worker", total: 500000 },
    ],
    entries: [
      {
        id: "bill",
        kind: "expense",
        personId: "shop",
        date: "2026-11-01",
        note: "মূল ভাউচার",
        createdAt: "2026-11-01T08:00:00Z",
        updatedAt: "2026-11-01T08:00:00Z",
        lines: [{ id: "line", workId: "work", label: "দরজা", amount: 150000 }],
      },
      {
        id: "payment",
        kind: "payment",
        personId: "shop",
        relatedEntryId: "bill",
        date: "2026-11-02",
        createdAt: "2026-11-02T08:00:00Z",
        updatedAt: "2026-11-02T08:00:00Z",
        allocations: [{ workId: "work", amount: 150000 }],
        paymentParts: [{ method: "cash", amount: 150000 }],
      },
    ],
  });
}
function Location() {
  const location = useLocation();
  return (
    <output data-testid="route">
      {location.pathname}
      {location.search}
    </output>
  );
}
async function ready(name = "সংরক্ষণ করুন") {
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
}
async function repository(ledger: Ledger) {
  const owner = crypto.randomUUID();
  setActiveOwner(owner);
  const database = getAccountDatabase(owner);
  databases.push(database);
  const repo = new LedgerRepository(database);
  await repo.ensure("real", ledger);
  return repo;
}

it("keeps adjustment separate from transaction editing even on an older reconciliation URL", () => {
  savePreferences({ language: "bn" });
  state.ledger = fixture();
  state.base = "/sample";
  render(
    <MemoryRouter initialEntries={["/sample/reconcile?type=bill"]}>
      <LanguageProvider>
        <ReconciliationPage />
        <Location />
      </LanguageProvider>
    </MemoryRouter>,
  );
  expect(screen.getByLabelText("কার হিসাব")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "এই হিসাব ঠিক করি" })).toBeNull();
  expect(screen.queryByText("আগের কোনো লেনদেন ঠিক করি")).toBeNull();
  expect(screen.queryByLabelText("যে হিসাবটি বদলাবেন")).toBeNull();
});

it.each([
  { id: "bill", field: /^মোট দাম/, next: "1600" },
  { id: "payment", field: /^টাকার পরিমাণ/, next: "1400" },
])(
  "requires a reason, restores its unfinished text and saves an audited $id correction without creating money events",
  async ({ id, field, next }) => {
    savePreferences({ language: "bn" });
    const original = fixture();
    const repo = await repository(original);
    const onSave = vi.fn(async (ledger: Ledger) => {
      await repo.save(ledger);
    });
    const onClose = vi.fn();
    const mount = () =>
      render(
        <LanguageProvider>
          <EntrySheet
            presentation="page"
            ledger={original}
            editEntryId={id}
            reconciliation
            onSave={onSave}
            onClose={onClose}
          />
        </LanguageProvider>,
      );
    let view = mount();
    await ready();
    fireEvent.change(screen.getByLabelText(field), { target: { value: next } });
    const summary = screen.getByRole("region", { name: "অঙ্কের পরিবর্তন" });
    expect(within(summary).getByText("আগের অঙ্ক")).toBeTruthy();
    expect(summary.textContent).toContain("১০০");
    if (id === "bill")
      expect(
        screen.getByText(
          "বিলের দাম বদলালেও আগের দেওয়া টাকা বদলাবে না। দেওয়া টাকা ঠিক করতে সেই হিসাবটি খুলুন।",
        ),
      ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "সংরক্ষণ করুন" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "হিসাব মেলানোর কারণ লিখুন।",
    );
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("হিসাব মেলানোর কারণ"), {
      target: { value: "আগের অঙ্কটি ভুল ছিল" },
    });
    await userEvent.click(screen.getByRole("button", { name: "ফিরুন" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    view.unmount();
    view = mount();
    await ready();
    expect(
      (screen.getByLabelText("হিসাব মেলানোর কারণ") as HTMLTextAreaElement)
        .value,
    ).toBe("আগের অঙ্কটি ভুল ছিল");
    await userEvent.click(screen.getByRole("button", { name: "সংরক্ষণ করুন" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
    view.unmount();
    repo.database.close();
    await repo.database.open();
    const saved = (await repo.read())!.ledger;
    expect(saved.entries.map((entry) => entry.id)).toEqual(["bill", "payment"]);
    const corrected = saved.entries.find((entry) => entry.id === id)!;
    expect(entryTotal(corrected)).toBe(Number(next) * 100);
    expect(corrected.note).toContain("হিসাব মেলানোর কারণ: আগের অঙ্কটি ভুল ছিল");
    expect(corrected.revisions.at(-1)?.before).toEqual(
      expect.objectContaining({
        date: original.entries.find((entry) => entry.id === id)!.date,
      }),
    );
    expect(saved.entries.find((entry) => entry.id !== id)).toEqual(
      original.entries.find((entry) => entry.id !== id),
    );
    const audit = entryAudit(corrected).at(-1)!;
    expect(audit.kind).toBe("changed");
    expect(snapshotTotal(audit.before!)).toBe(150000);
    expect(snapshotTotal(audit.after)).toBe(Number(next) * 100);
    expect(audit.changes.some((change) => change.field === "note")).toBe(true);
    expect(summarize(saved).payable).toBe(10000);
    const restoredDatabase = new LedgerDatabase(
      `reconciled-backup-${crypto.randomUUID()}`,
    );
    databases.push(restoredDatabase);
    const restore = new LedgerRepository(restoredDatabase);
    await restore.ensure("real", LedgerSchema.parse({}));
    await restore.importBackup(await repo.exportBackup(), { replace: true });
    expect((await restore.read())!.ledger).toEqual(saved);
  },
);

it("flushes the unfinished bill before explicitly opening its recorded payment correction", async () => {
  savePreferences({ language: "bn" });
  const ledger = fixture();
  const repo = await repository(ledger);
  const openPayment = vi.fn();
  const view = render(
    <LanguageProvider>
      <EntrySheet
        presentation="page"
        ledger={ledger}
        editEntryId="bill"
        onSave={vi.fn()}
        onClose={vi.fn()}
        onCorrectLinkedPayment={openPayment}
      />
    </LanguageProvider>,
  );
  await ready();
  fireEvent.change(screen.getByLabelText(/^মোট দাম/), {
    target: { value: "1700" },
  });
  await userEvent.click(
    screen.getByRole("button", { name: /^দেওয়া টাকার হিসাব ঠিক করি/ }),
  );
  await waitFor(() =>
    expect(openPayment).toHaveBeenCalledExactlyOnceWith("payment"),
  );
  expect((await repo.read())!.ledger).toEqual(ledger);
  expect(await repo.database.drafts.get("real:entry:bill")).toBeTruthy();
  view.unmount();
});

it("uses the existing contract history for a reasoned agreed-amount correction", async () => {
  savePreferences({ language: "bn" });
  const ledger = fixture();
  const repo = await repository(ledger);
  const onSave = vi.fn(async (next: Ledger) => {
    await repo.save(next);
  });
  const close = vi.fn();
  const view = render(
    <LanguageProvider>
      <EntitySheet
        presentation="page"
        kind="contract"
        ledger={ledger}
        editId="agreement"
        reconciliation
        onSave={onSave}
        onClose={close}
      />
    </LanguageProvider>,
  );
  await ready("রাখুন");
  fireEvent.change(screen.getByLabelText("কাজের টাকা"), {
    target: { value: "4500" },
  });
  expect(
    screen.getByRole("region", { name: "অঙ্কের পরিবর্তন" }).textContent,
  ).toContain("৫০০");
  await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "হিসাব মেলানোর কারণ লিখুন।",
  );
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("কেন বদলালেন"), {
    target: { value: "চূড়ান্ত টাকা ঠিক করেছি" },
  });
  await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  view.unmount();
  const saved = (await repo.read())!.ledger;
  expect(saved.entries).toEqual(ledger.entries);
  expect(saved.contracts[0].total).toBe(450000);
  expect(saved.contracts[0].activity.at(-1)).toMatchObject({
    before: { total: 500000 },
    after: { total: 450000 },
    reason: "চূড়ান্ত টাকা ঠিক করেছি",
  });
});

it("gives bills, payments, material returns and cash refunds separate text badges in history", () => {
  savePreferences({ language: "bn" });
  const ledger = fixture();
  ledger.entries.push(
    LedgerSchema.parse({
      ...ledger,
      entries: [
        {
          id: "credit",
          kind: "expense_credit",
          personId: "shop",
          lines: [
            {
              id: "return-line",
              workId: "work",
              label: "দরজা ফেরত",
              amount: 10000,
            },
          ],
        },
      ],
    }).entries[0],
  );
  ledger.entries.push(
    LedgerSchema.parse({
      ...ledger,
      entries: [
        {
          id: "refund",
          kind: "refund",
          personId: "shop",
          allocations: [{ workId: "work", amount: 10000 }],
          paymentParts: [{ method: "cash", amount: 10000 }],
        },
      ],
    }).entries[0],
  );
  const view = render(
    <LanguageProvider>
      <EntryList
        ledger={ledger}
        entries={ledger.entries}
        onEntry={vi.fn()}
        showKind
      />
    </LanguageProvider>,
  );
  expect(
    view.container.querySelector(".history-kind-expense")?.textContent,
  ).toBe("খরচ");
  expect(
    view.container.querySelector(".history-kind-payment")?.textContent,
  ).toBe("টাকা দিয়েছি");
  expect(
    view.container.querySelector(".history-kind-expense_credit")?.textContent,
  ).toBe("মাল ফেরত");
  expect(
    view.container.querySelector(".history-kind-refund")?.textContent,
  ).toBe("টাকা ফেরত পেয়েছি");
});
