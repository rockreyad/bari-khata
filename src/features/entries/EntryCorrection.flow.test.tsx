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
import { LanguageProvider } from "../../context/LanguageProvider";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { entryTotal, summarize } from "../../domain/ledger";
import { entryAudit, snapshotTotal } from "../history/audit";
import {
  getAccountDatabase,
  setActiveOwner,
  LedgerDatabase,
} from "../../data/database";
import {
  LedgerRepository,
  createWorkspaceStorage,
} from "../../data/repository";
import { savePreferences } from "../../lib/preferences";
import { EntrySheet } from "../../components/EntrySheet";
import { EntitySheet } from "../../components/EntitySheet";
import { EntryList } from "../../components/ui/EntryList";

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

it.each([
  { id: "bill", field: /^মোট দাম/, next: "1600" },
  { id: "payment", field: /^টাকার পরিমাণ/, next: "1400" },
])(
  "restores an unfinished ordinary $id edit and preserves a legacy draft reason in its visible note",
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
            onSave={onSave}
            onClose={onClose}
          />
        </LanguageProvider>,
      );
    let view = mount();
    await ready();
    fireEvent.change(screen.getByLabelText(field), { target: { value: next } });
    expect(
      screen.queryByRole("region", { name: "অঙ্কের পরিবর্তন" }),
    ).toBeNull();
    expect(screen.queryByLabelText("হিসাব মেলানোর কারণ")).toBeNull();
    if (id === "bill")
      expect(
        reveal(
          screen.getByText(
            "দামের সঙ্গে দেওয়া টাকা বদলাবে না। প্রয়োজন হলে পরিশোধটি খুলে বদলান।",
          ),
        ),
      ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "ফিরুন" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    view.unmount();
    const storage = createWorkspaceStorage("real");
    const pending = (await storage.readDraft<{
      draft: Record<string, unknown>;
      files: unknown[];
    }>(`entry:${id}`))!;
    pending.draft.reconciliationReason = "আগের অঙ্কটি ভুল ছিল";
    if (id === "payment")
      pending.draft.note = "হিসাব মেলানোর কারণ: আগের অঙ্কটি ভুল ছিল";
    await storage.saveDraft(`entry:${id}`, pending);
    view = mount();
    await ready();
    const note = reveal(
      screen.getByLabelText("মনে রাখার কথা"),
    ) as HTMLTextAreaElement;
    expect(note.value).toContain("হিসাব মেলানোর কারণ: আগের অঙ্কটি ভুল ছিল");
    expect(note.value).toContain(
      original.entries.find((entry) => entry.id === id)!.note,
    );
    fireEvent.change(note, { target: { value: `${note.value}\nআমার নোট` } });
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
    expect(
      corrected.note.match(/হিসাব মেলানোর কারণ: আগের অঙ্কটি ভুল ছিল/g),
    ).toHaveLength(1);
    expect(corrected.note).toContain("আমার নোট");
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
  reveal(screen.getByText(/^দেওয়া টাকার হিসাব ঠিক করি/));
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
it.each([
  { impact: "normal" as const, source: null, status: "confirmed" },
  {
    impact: "normal" as const,
    source: { file: "source.html", cell: "A1", checksum: "example" },
    status: "confirmed",
  },
  {
    impact: "historical" as const,
    source: { file: "source.html", cell: "A1", checksum: "example" },
    status: "needs_review",
  },
])(
  "confirms only an explicitly saved normal incomplete record ($impact, $source)",
  async ({ impact, source, status }) => {
    savePreferences({ language: "bn" });
    const base = fixture();
    const original = LedgerSchema.parse({
      ...base,
      entries: [
        {
          ...base.entries[0],
          balanceImpact: impact,
          source,
          reviewStatus: "needs_review",
          reviewReason: "নাম বা খাতার তথ্য মিলিয়ে নিন",
        },
      ],
    });
    const repo = await repository(original);
    const saved = vi.fn(async (next: Ledger) => {
      await repo.save(next);
    });
    const view = render(
      <LanguageProvider>
        <EntrySheet
          ledger={original}
          presentation="page"
          editEntryId="bill"
          onSave={saved}
          onClose={vi.fn()}
        />
      </LanguageProvider>,
    );
    await ready();
    expect((await repo.read())!.ledger.entries[0].reviewStatus).toBe(
      "needs_review",
    );
    await userEvent.click(screen.getByRole("button", { name: "সংরক্ষণ করুন" }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    view.unmount();
    const entry = (await repo.read())!.ledger.entries[0];
    expect(entry.reviewStatus).toBe(status);
    expect(entry.reviewReason).toBe(
      status === "confirmed" ? "" : "নাম বা খাতার তথ্য মিলিয়ে নিন",
    );
    expect(entry.source).toEqual(original.entries[0].source);
    expect(entry.provenance).toEqual(original.entries[0].provenance);
    expect(entry.balanceImpact).toBe(impact);
    expect(entry.lines[0]).toMatchObject({
      workId: "work",
      label: "দরজা",
      amount: 150000,
      costType: "material",
    });
    expect((await repo.read())!.ledger.entries.map((row) => row.id)).toEqual([
      "bill",
    ]);
  },
);

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
        onSave={onSave}
        onClose={close}
      />
    </LanguageProvider>,
  );
  await ready("রাখুন");
  fireEvent.change(screen.getByLabelText("কাজের টাকা"), {
    target: { value: "4500" },
  });
  expect(screen.queryByRole("region", { name: "অঙ্কের পরিবর্তন" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "কেন বদলালেন, তা লিখুন।",
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
