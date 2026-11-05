// @vitest-environment jsdom
import { migrateArchitecture } from "../domain/architectureMigration";
import "fake-indexeddb/auto";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import type { SelectHTMLAttributes } from "react";
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
  EntrySchema,
  LedgerSchema,
  type Ledger,
} from "../domain/model";
import {
  entryTotal,
  personSummary,
  replaceEntry,
  replaceExpenseAndSettlements,
} from "../domain/ledger";
import {
  QuickDraftSchema,
  buildQuickEntry,
} from "../features/entries/quickEntry";
import { formatMoney } from "../lib/formatMoney";
import { latinDigits } from "../lib/numerals";
import { savePreferences } from "../lib/preferences";
import {
  EntrySheet,
  type EntryAttachments,
  type EntrySheetProps,
} from "./EntrySheet";

await vi.hoisted(async () => {
  const binary = await import("node:buffer");
  vi.stubGlobal("Blob", binary.Blob);
  vi.stubGlobal("File", binary.File);
});

vi.mock("./ui/AppSelect", () => ({
  AppSelect: (props: SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props} />
  ),
}));
const databases: LedgerDatabase[] = [];
const billId = "sample-purchase-bill";
const paymentId = "sample-purchase-cash";
const receiptId = "sample-purchase-receipt";
const receipt = () => new Blob(["sample voucher"], { type: "application/pdf" });
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

function fixture(
  kind: "full" | "partial" | "later" | "multiple" | "independent" = "full",
) {
  const ledger = buildQuickEntry(
    LedgerSchema.parse({
      works: [
        { id: "sample-work", name: "নমুনা দরজা" },
        { id: "sample-other-work", name: "নমুনা ছাদ" },
      ],
      people: [
        { id: "sample-shop", name: "নমুনা দোকান", kind: "shop" },
        { id: "sample-other-shop", name: "নমুনা অন্য দোকান", kind: "shop" },
        { id: "sample-worker", name: "নমুনা মিস্ত্রি", kind: "worker" },
      ],
      materialGroups: [{ id: "sample-group", name: "নমুনা মাল" }],
      contracts: [
        {
          id: "sample-job",
          personId: "sample-worker",
          workId: "sample-other-work",
          total: 50000,
        },
      ],
      entries: [
        {
          id: "sample-other-bill",
          kind: "expense",
          personId: "sample-other-shop",
          lines: [
            {
              id: "sample-other-line",
              workId: "sample-other-work",
              amount: 5000,
            },
          ],
        },
        {
          id: "sample-other-cash",
          kind: "payment",
          personId: "sample-other-shop",
          relatedEntryId: "sample-other-bill",
          allocations: [{ workId: "sample-other-work", amount: 5000 }],
          paymentParts: [{ method: "bank", amount: 5000 }],
        },
      ],
    }),
    QuickDraftSchema.parse({
      id: billId,
      paymentId,
      refundId: "sample-refund",
      workId: "sample-work",
      personId: "sample-shop",
      date: "2026-11-01",
      payment: kind === "partial" || kind === "multiple" ? "partial" : "full",
      paid: kind === "multiple" ? "600" : "400",
      method: "cash",
      note: "নমুনা কেনাকাটা",
      rows: [
        {
          id: "sample-line",
          label: "নমুনা মাল",
          groupId: "sample-group",
          amount: "1000",
        },
      ],
    }),
    [
      {
        id: receiptId,
        name: "sample.pdf",
        mime: "application/pdf",
        size: receipt().size,
      },
    ],
  );
  if (kind === "later")
    return LedgerSchema.parse({
      ...ledger,
      entries: ledger.entries.map((entry) =>
        entry.id === paymentId
          ? {
              ...entry,
              date: "2026-11-02",
              createdAt: "2026-11-02T08:00:00.000Z",
              updatedAt: "2026-11-02T08:00:00.000Z",
            }
          : entry,
      ),
    });
  if (kind === "multiple")
    return LedgerSchema.parse({
      ...ledger,
      entries: [
        ...ledger.entries,
        EntrySchema.parse({
          id: "sample-second-payment",
          kind: "payment",
          personId: "sample-shop",
          relatedEntryId: billId,
          date: "2026-11-02",
          createdAt: "2026-11-02T09:00:00.000Z",
          updatedAt: "2026-11-02T09:00:00.000Z",
          allocations: [{ workId: "sample-work", amount: 40000 }],
          paymentParts: [{ method: "bank", amount: 40000 }],
        }),
      ],
    });
  if (kind === "independent")
    return replaceEntry(ledger, {
      ...ledger.entries.find((entry) => entry.id === paymentId)!,
      note: "নমুনা আলাদা পরিশোধের নোট",
    });
  return ledger;
}
async function repository(ledger: Ledger) {
  const owner = crypto.randomUUID();
  setActiveOwner(owner);
  const database = getAccountDatabase(owner);
  databases.push(database);
  const repo = new LedgerRepository(database);
  await repo.ensure("real", LedgerSchema.parse({}));
  await repo.save(ledger, "real", [
    { id: receiptId, entryId: billId, file: receipt(), name: "sample.pdf" },
  ]);
  return repo;
}
function mount(
  ledger: Ledger,
  onSave: EntrySheetProps["onSave"],
  onClose: () => void,
  onCorrectLinkedPayment?: (id: string) => void,
) {
  return render(
    <LanguageProvider>
      <EntrySheet
        presentation="page"
        ledger={ledger}
        editEntryId={billId}
        onSave={onSave}
        onClose={onClose}
        onCorrectLinkedPayment={onCorrectLinkedPayment}
      />
    </LanguageProvider>,
  );
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
function amount(value: string) {
  fireEvent.change(screen.getByLabelText(/^মোট দাম/), { target: { value } });
}
const row = (ledger: Ledger, id: string) =>
  ledger.entries.find((entry) => entry.id === id)!;

it.each(["100", "1200"])(
  "corrects a fully paid quick purchase to %s in one save, preserving both audits through reopen and backup",
  async (value) => {
    const original = fixture();
    const repo = await repository(original);
    const before = await repo.read();
    const onClose = vi.fn();
    const onSave = vi.fn(async (next: Ledger) => {
      await repo.save(next);
    });
    const page = mount(original, onSave, onClose);
    await ready();
    expect(
      screen.queryByRole("checkbox", { name: "পুরো টাকা দেওয়া ছিল" }),
    ).toBeNull();
    amount(value);
    const region = screen.getByRole("region", { name: "এই কেনাকাটার পরিশোধ" });
    expect(
      within(region).getByText(formatMoney(Number(value) * 100, "bn"), {
        normalizer: (text) => text,
      }).textContent,
    ).toBe(formatMoney(Number(value) * 100, "bn"));
    expect(await repo.read()).toEqual(before);
    expect(await repo.database.outbox.count()).toBe(0);
    expect(onSave).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "সংরক্ষণ করুন" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledOnce();
    page.unmount();
    repo.database.close();
    await repo.database.open();
    const saved = (await repo.read())!.ledger;
    for (const id of [billId, paymentId]) {
      expect(entryTotal(row(saved, id))).toBe(Number(value) * 100);
      expect(row(saved, id).revisions).toHaveLength(1);
      expect(row(saved, id).revisions[0].before).toEqual(
        EntryCoreSchema.parse(row(original, id)),
      );
      expect(row(saved, id).date).toBe(row(original, id).date);
      expect(row(saved, id).createdAt).toBe(row(original, id).createdAt);
    }
    expect(row(saved, paymentId).relatedEntryId).toBe(billId);
    expect(row(saved, paymentId).paymentParts[0].method).toBe("cash");
    expect(row(saved, billId).receipts).toEqual(row(original, billId).receipts);
    expect(
      saved.entries.filter((entry) => ![billId, paymentId].includes(entry.id)),
    ).toEqual(
      original.entries.filter(
        (entry) => ![billId, paymentId].includes(entry.id),
      ),
    );
    expect(saved.entries.map((entry) => entry.id)).toEqual(
      original.entries.map((entry) => entry.id),
    );
    expect(saved.contracts).toEqual(original.contracts);
    expect(personSummary(saved, "sample-shop")).toMatchObject({
      cost: Number(value) * 100,
      netPaid: Number(value) * 100,
      payable: 0,
      advance: 0,
    });
    const restoredDatabase = new LedgerDatabase(
      `sample-paid-purchase-${crypto.randomUUID()}`,
    );
    databases.push(restoredDatabase);
    const restored = new LedgerRepository(restoredDatabase);
    await restored.ensure("real", LedgerSchema.parse({}));
    await restored.importBackup(await repo.exportBackup(), { replace: true });
    expect((await restored.read())!.ledger).toEqual(
      migrateArchitecture(saved).ledger,
    );
    expect(await (await restored.getReceipt(receiptId))!.blob.text()).toBe(
      "sample voucher",
    );
  },
);

it("opens the exact cash record after flushing the typed bill draft without saving either amount", async () => {
  const original = fixture();
  const repo = await repository(original);
  const before = await repo.read();
  const onClose = vi.fn();
  const navigate = vi.fn();
  const onSave = vi.fn(async (next: Ledger) => {
    await repo.save(next);
  });
  const page = mount(original, onSave, onClose, navigate);
  await ready();
  amount("100");
  const region = screen.getByRole("region", { name: "এই কেনাকাটার পরিশোধ" });
  await userEvent.click(
    within(region).getByRole("button", { name: "দেওয়া টাকা বদলাই" }),
  );
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledExactlyOnceWith(paymentId),
  );
  expect(onSave).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(await repo.read()).toEqual(before);
  expect(
    await createWorkspaceStorage().readDraft(`entry:${billId}`),
  ).toMatchObject({
    draft: { rows: [{ id: "sample-line", amount: "100" }] },
  });
  page.unmount();
});

it.each(["partial", "later", "multiple", "independent"] as const)(
  "does not couple a %s payment",
  async (kind) => {
    const original = fixture(kind);
    const repo = await repository(original);
    const onClose = vi.fn();
    const onSave = vi.fn(async (next: Ledger) => {
      await repo.save(next);
    });
    mount(original, onSave, onClose);
    await ready();
    expect(
      screen.queryByRole("checkbox", { name: "পুরো টাকা দেওয়া ছিল" }),
    ).toBeNull();
    amount("100");
    await userEvent.click(screen.getByRole("button", { name: "সংরক্ষণ করুন" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    const saved = (await repo.read())!.ledger;
    expect(entryTotal(row(saved, billId))).toBe(10000);
    expect(saved.entries.filter((entry) => entry.id !== billId)).toEqual(
      original.entries.filter((entry) => entry.id !== billId),
    );
    expect(onSave).toHaveBeenCalledOnce();
  },
);

it("keeps originally partial cash separate even when an earlier bill correction made the current amounts equal", async () => {
  const partial = fixture("partial");
  const original = replaceExpenseAndSettlements(partial, {
    ...row(partial, billId),
    lines: row(partial, billId).lines.map((line) => ({
      ...line,
      amount: 40000,
    })),
  });
  const repo = await repository(original);
  const onClose = vi.fn();
  const onSave = vi.fn(async (next: Ledger) => {
    await repo.save(next);
  });
  mount(original, onSave, onClose);
  await ready();
  expect(entryTotal(row(original, billId))).toBe(40000);
  expect(entryTotal(row(original, paymentId))).toBe(40000);
  amount("300");
  await userEvent.click(screen.getByRole("button", { name: "সংরক্ষণ করুন" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  const saved = (await repo.read())!.ledger;
  expect(row(saved, paymentId)).toEqual(row(original, paymentId));
  expect(personSummary(saved, "sample-shop")).toMatchObject({
    cost: 30000,
    netPaid: 40000,
    payable: 0,
    advance: 10000,
  });
  expect(onSave).toHaveBeenCalledOnce();
});

it.each(["false", "missing"] as const)(
  "restores a legacy %s bill draft without opting it into a cash correction",
  async (legacy) => {
    const original = fixture();
    const repo = await repository(original);
    const onClose = vi.fn();
    const onSave = vi.fn(async (next: Ledger) => {
      await repo.save(next);
    });
    let page = mount(original, onSave, onClose);
    await ready();
    amount("100");
    await userEvent.click(screen.getByRole("button", { name: "ফিরুন" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    page.unmount();
    const storage = createWorkspaceStorage();
    const savedDraft = (await storage.readDraft<{
      draft: Record<string, unknown>;
      files: unknown[];
    }>(`entry:${billId}`))!;
    if (legacy === "false") savedDraft.draft.updatePurchasePayment = false;
    else {
      delete savedDraft.draft.updatePurchasePayment;
      delete savedDraft.draft.purchasePaymentId;
      delete savedDraft.draft.purchasePaymentUpdatedAt;
    }
    await storage.saveDraft(`entry:${billId}`, savedDraft);
    page = mount(original, onSave, onClose);
    await ready();
    expect(
      screen.queryByRole("checkbox", { name: "পুরো টাকা দেওয়া ছিল" }),
    ).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "সংরক্ষণ করুন" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
    expect(row((await repo.read())!.ledger, paymentId)).toEqual(
      row(original, paymentId),
    );
    expect(onSave).toHaveBeenCalledOnce();
    page.unmount();
  },
);

it("keeps a stale automatic draft blocked until latest cash is reviewed and then preserves that cash", async () => {
  const original = fixture();
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
      })) ?? [],
    );
  });
  let page = mount(original, onSave, onClose);
  await ready();
  amount("100");
  const note = screen.getByLabelText("মনে রাখার কথা");
  await userEvent.click(note.closest("details")!.querySelector("summary")!);
  fireEvent.change(note, { target: { value: "নমুনা অসমাপ্ত বিবরণ" } });
  await userEvent.upload(
    page.container.querySelector<HTMLInputElement>('input[type="file"]')!,
    new File(["sample pending voucher"], "sample-queued.pdf", {
      type: "application/pdf",
    }),
  );
  await ready();
  await userEvent.click(screen.getByRole("button", { name: "ফিরুন" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  page.unmount();
  const latest = replaceEntry(original, {
    ...row(original, paymentId),
    note: "নমুনা পরিশোধের নোট বদলেছে",
  });
  await repo.save(latest);
  page = mount(latest, onSave, onClose);
  expect(
    await screen.findByText(
      "সঙ্গে রাখা দেওয়া টাকার হিসাব বদলেছে। আবার খুলে মিলিয়ে নিন।",
    ),
  ).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "সংরক্ষণ করুন" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(onSave).not.toHaveBeenCalled();
  expect((await repo.read())!.ledger).toEqual(latest);
  expect(
    screen.queryByRole("checkbox", { name: "পুরো টাকা দেওয়া ছিল" }),
  ).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "সর্বশেষ তথ্য দেখি" }),
  );
  await ready();
  expect(
    latinDigits((screen.getByLabelText(/^মোট দাম/) as HTMLInputElement).value),
  ).toBe("100");
  expect(
    (screen.getByLabelText("মনে রাখার কথা") as HTMLTextAreaElement).value,
  ).toBe("নমুনা অসমাপ্ত বিবরণ");
  await userEvent.click(screen.getByRole("button", { name: "সংরক্ষণ করুন" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(row((await repo.read())!.ledger, paymentId)).toEqual(
    row(latest, paymentId),
  );
  expect(entryTotal(row((await repo.read())!.ledger, billId))).toBe(10000);
  const savedBill = row((await repo.read())!.ledger, billId);
  const addedReceipt = savedBill.receipts.find(
    (item) => item.id !== receiptId,
  )!;
  expect(savedBill.receipts).toHaveLength(2);
  expect(addedReceipt.mime).toBe("application/pdf");
  expect(await (await repo.getReceipt(addedReceipt.id))!.blob.text()).toBe(
    "sample pending voucher",
  );
  page.unmount();
});

it("leaves the payment audit untouched when only the bill note changes", async () => {
  const original = fixture();
  const repo = await repository(original);
  const onClose = vi.fn();
  const onSave = vi.fn(async (next: Ledger) => {
    await repo.save(next);
  });
  mount(original, onSave, onClose);
  await ready();
  fireEvent.change(screen.getByLabelText("মনে রাখার কথা"), {
    target: { value: "নমুনা নতুন বিবরণ" },
  });
  await userEvent.click(screen.getByRole("button", { name: "সংরক্ষণ করুন" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  const saved = (await repo.read())!.ledger;
  expect(row(saved, billId).note).toBe("নমুনা নতুন বিবরণ");
  expect(row(saved, paymentId)).toEqual(row(original, paymentId));
});
