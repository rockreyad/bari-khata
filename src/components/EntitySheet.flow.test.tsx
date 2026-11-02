// @vitest-environment jsdom
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageProvider } from "../context/LanguageProvider";
import { LedgerSchema, type Ledger } from "../domain/model";
import { saveContractChange } from "../domain/contracts";
import { contractSummary } from "../domain/ledger";
import { savePreferences } from "../lib/preferences";
import { EntitySheet } from "./EntitySheet";
import { EntrySheet, type EntryAttachments } from "./EntrySheet";
const storage = vi.hoisted(() => ({
  drafts: new Map<string, unknown>(),
  writes: vi.fn(),
  beforeRemove: null as null | ((key: string) => Promise<void>),
}));
vi.mock("../data/repository", () => ({
  createWorkspaceStorage: () => ({
    readDraft: async (key: string) => storage.drafts.get(key) ?? null,
    saveDraft: async (key: string, value: unknown) => {
      storage.writes(key, value);
      storage.drafts.set(key, value);
    },
    removeDraft: async (key: string) => {
      await storage.beforeRemove?.(key);
      storage.drafts.delete(key);
    },
  }),
}));
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
vi.mock("./ui/AppCombobox", () => ({
  AppCombobox: ({
    suggestions: _suggestions,
    ...props
  }: InputHTMLAttributes<HTMLInputElement> & { suggestions: unknown[] }) => (
    <input {...props} />
  ),
}));
beforeEach(() => {
  storage.drafts.clear();
  storage.writes.mockClear();
  storage.beforeRemove = null;
  localStorage.clear();
  savePreferences({ language: "bn" });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});
function mount(children: ReactNode) {
  return render(<LanguageProvider>{children}</LanguageProvider>);
}
async function ready(name = "রাখুন") {
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
}
function usedHouse() {
  return LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
    people: [{ id: "worker", name: "শাহ আলম", kind: "worker" }],
    contracts: [
      {
        id: "house",
        personId: "worker",
        scope: "house",
        workId: null,
        total: 60000000,
        agreedOn: "2026-11-01",
      },
    ],
    entries: [
      {
        id: "weekly",
        kind: "payment",
        account: "labour",
        personId: "worker",
        contractId: "house",
        allocations: [{ workId: "door", amount: 10000000 }],
        paymentParts: [{ amount: 10000000 }],
      },
    ],
  });
}
it("creates a full-page 600000-taka whole-house agreement before any work notebook exists", async () => {
  const ledger = LedgerSchema.parse({
    people: [{ id: "worker", name: "শাহ আলম", kind: "worker" }],
  });
  let view: ReturnType<typeof mount>;
  const onSave = vi.fn(async (_next: Ledger) => {
    view.unmount();
  });
  view = mount(
    <EntitySheet
      presentation="page"
      kind="contract"
      ledger={ledger}
      defaultPersonId="worker"
      mode="demo"
      onSave={onSave}
      onClose={vi.fn()}
    />,
  );
  await ready();
  expect(
    screen.getByRole("heading", { name: "নতুন কাজ", level: 1 }),
  ).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: "পুরো বাড়ি" })).toBeNull();
  expect(screen.queryByRole("button", { name: "একটি কাজ" })).toBeNull();
  expect((screen.getByLabelText("কাজের খাতা") as HTMLSelectElement).value).toBe(
    "",
  );
  expect(screen.getByRole("option", { name: "পরে বেছে নেব" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("কাজের নাম"), {
    target: { value: "রাজমিস্ত্রির কাজ" },
  });
  fireEvent.change(screen.getByLabelText("কাজের টাকা"), {
    target: { value: "600000" },
  });
  expect((screen.getByLabelText("কাজের টাকা") as HTMLInputElement).value).toBe(
    "৬০০০০০",
  );
  await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  const next = onSave.mock.calls[0][0];
  expect(next.works).toEqual([]);
  expect(next.contracts[0]).toMatchObject({
    scope: "house",
    workId: null,
    personId: "worker",
    title: "রাজমিস্ত্রির কাজ",
    total: 60000000,
  });
  expect(next.contracts[0].activity[0]).toMatchObject({
    before: null,
    after: { scope: "house", total: 60000000 },
  });
  await waitFor(() => expect(storage.drafts.size).toBe(0));
  view.unmount();
  await act(async () => {
    await Promise.resolve();
  });
  expect(storage.drafts.size).toBe(0);
});

it("adds a new worker with a whole-house contract before there are work notebooks", async () => {
  const onSave = vi.fn(async (_next: Ledger) => {});
  mount(
    <EntitySheet
      presentation="page"
      kind="person"
      ledger={LedgerSchema.parse({})}
      mode="demo"
      onSave={onSave}
      onClose={vi.fn()}
    />,
  );
  await ready();
  await userEvent.click(
    screen.getByRole("button", { name: "মিস্ত্রি", pressed: false }),
  );
  fireEvent.change(screen.getByLabelText("নাম"), {
    target: { value: "শাহ আলম" },
  });
  await userEvent.click(
    screen.getByText("কাজের টাকা", { selector: "summary" }),
  );
  fireEvent.change(screen.getByLabelText("কাজের টাকা"), {
    target: { value: "600000" },
  });
  expect(screen.queryByRole("button", { name: "পুরো বাড়ি" })).toBeNull();
  expect(screen.queryByRole("button", { name: "একটি কাজ" })).toBeNull();
  expect((screen.getByLabelText("কাজের খাতা") as HTMLSelectElement).value).toBe(
    "",
  );
  await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  const next = onSave.mock.calls[0][0];
  expect(next.works).toEqual([]);
  expect(next.people[0]).toMatchObject({ name: "শাহ আলম", kind: "worker" });
  expect(next.contracts[0]).toMatchObject({
    scope: "house",
    workId: null,
    personId: next.people[0].id,
    total: 60000000,
  });
});

it("updates a used whole-house amount with a reason and records before/after while preserving paid cash", async () => {
  const ledger = usedHouse();
  const before = JSON.stringify(ledger);
  const onSave = vi.fn(async (_next: Ledger) => {});
  mount(
    <EntitySheet
      presentation="page"
      kind="contract"
      editId="house"
      ledger={ledger}
      mode="demo"
      onSave={onSave}
      onClose={vi.fn()}
    />,
  );
  await ready();
  fireEvent.change(screen.getByLabelText("কাজের টাকা"), {
    target: { value: "650000" },
  });
  fireEvent.change(screen.getByLabelText("কেন বদলালেন"), {
    target: { value: "সিঁড়ির কাজ যোগ হয়েছে" },
  });
  expect(
    screen.getByRole("progressbar").getAttribute("aria-valuetext"),
  ).toContain("৳\u202f১,০০,০০০");
  await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  const next = onSave.mock.calls[0][0];
  expect(next.entries).toEqual(ledger.entries);
  expect(contractSummary(next, "house")).toMatchObject({
    agreed: 65000000,
    netPaid: 10000000,
    remaining: 55000000,
  });
  expect(next.contracts[0].activity[0]).toMatchObject({
    reason: "সিঁড়ির কাজ যোগ হয়েছে",
    before: { total: 60000000, scope: "house" },
    after: { total: 65000000, scope: "house" },
  });
  expect(JSON.stringify(ledger)).toBe(before);
});

it("shows and focuses a missing agreement-change reason at the top without losing the edited draft", async () => {
  const ledger = usedHouse();
  const onSave = vi.fn(async (_next: Ledger) => {});
  const onClose = vi.fn();
  const view = mount(
    <EntitySheet
      presentation="page"
      kind="contract"
      editId="house"
      ledger={ledger}
      mode="demo"
      onSave={onSave}
      onClose={onClose}
    />,
  );
  await ready();
  fireEvent.change(screen.getByLabelText("কাজের টাকা"), {
    target: { value: "650000" },
  });
  await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "কেন বদলালেন, তা লিখুন।",
  );
  const alert = screen.getByRole("alert");
  expect(view.container.querySelector("form")!.firstElementChild).toBe(alert);
  await waitFor(() => expect(document.activeElement).toBe(alert));
  await userEvent.click(screen.getByLabelText("কাজের টাকা"));
  await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("alert")),
  );
  expect(onSave).not.toHaveBeenCalled();
  expect(ledger.contracts[0].total).toBe(60000000);
  expect((screen.getByLabelText("কাজের টাকা") as HTMLInputElement).value).toBe(
    "৬৫০০০০",
  );
  await userEvent.click(screen.getByRole("button", { name: "ফিরুন" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(storage.drafts.get("entity:contract:house:any")).toMatchObject({
    total: "650000",
    contractReason: "",
  });
});

it("shows invalid entry money before all fields and preserves the unsaved amount and note after closing", async () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
    people: [{ id: "shop", name: "দরজার দোকান", kind: "shop" }],
    entries: [
      {
        id: "bill",
        kind: "expense",
        account: "materials",
        personId: "shop",
        lines: [{ id: "line", workId: "door", label: "দরজা", amount: 9300000 }],
      },
    ],
  });
  const onSave = vi.fn(async (_next: Ledger) => {}),
    onClose = vi.fn();
  const props = {
    presentation: "page",
    ledger,
    editEntryId: "bill",
    mode: "demo",
    onSave,
    onClose,
  } as const;
  const view = mount(<EntrySheet {...props} />);
  await ready("সংরক্ষণ করুন");
  fireEvent.change(screen.getByRole("textbox", { name: /^মোট দাম/ }), {
    target: { value: "0" },
  });
  fireEvent.change(screen.getByLabelText("মনে রাখার কথা"), {
    target: { value: "আমার অসমাপ্ত নোট" },
  });
  await userEvent.click(screen.getByRole("button", { name: "সংরক্ষণ করুন" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("প্রতিটি খরচের জন্য সঠিক টাকার পরিমাণ দিন।");
  expect(view.container.querySelector("form")!.firstElementChild).toBe(alert);
  await waitFor(() => expect(document.activeElement).toBe(alert));
  expect(onSave).not.toHaveBeenCalled();
  expect(ledger.entries[0].lines[0].amount).toBe(9300000);
  await userEvent.click(screen.getByRole("button", { name: "ফিরুন" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  view.unmount();
  expect(storage.drafts.get("entry:bill")).toMatchObject({
    draft: { rows: [{ amount: "0" }], note: "আমার অসমাপ্ত নোট" },
  });
  mount(<EntrySheet {...props} />);
  await ready("সংরক্ষণ করুন");
  expect(
    (screen.getByRole("textbox", { name: /^মোট দাম/ }) as HTMLInputElement)
      .value,
  ).toBe("০");
  expect(
    (screen.getByLabelText("মনে রাখার কথা") as HTMLTextAreaElement).value,
  ).toBe("আমার অসমাপ্ত নোট");
});

it("flushes changed agreement amount and reason on immediate unmount before debounce and restores both", async () => {
  const ledger = usedHouse();
  const onSave = vi.fn(async (_next: Ledger) => {});
  const props = {
    presentation: "page",
    kind: "contract",
    editId: "house",
    ledger,
    mode: "demo",
    onSave,
    onClose: vi.fn(),
  } as const;
  const view = mount(<EntitySheet {...props} />);
  await ready();
  storage.writes.mockClear();
  vi.useFakeTimers();
  fireEvent.change(screen.getByLabelText("কাজের টাকা"), {
    target: { value: "650000" },
  });
  fireEvent.change(screen.getByLabelText("কেন বদলালেন"), {
    target: { value: "সিঁড়ির কাজ যোগ হয়েছে" },
  });
  expect(storage.writes).not.toHaveBeenCalled();
  view.unmount();
  await act(async () => {
    await Promise.resolve();
  });
  expect(storage.drafts.get("entity:contract:house:any")).toMatchObject({
    total: "650000",
    contractReason: "সিঁড়ির কাজ যোগ হয়েছে",
  });
  vi.useRealTimers();
  mount(<EntitySheet {...props} />);
  await ready();
  expect((screen.getByLabelText("কাজের টাকা") as HTMLInputElement).value).toBe(
    "৬৫০০০০",
  );
  expect(
    (screen.getByLabelText("কেন বদলালেন") as HTMLTextAreaElement).value,
  ).toBe("সিঁড়ির কাজ যোগ হয়েছে");
  expect(onSave).not.toHaveBeenCalled();
});

it("flushes an edited entry's amount, note and voucher on immediate unmount and does not revive its draft after saving", async () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
    people: [{ id: "shop", name: "দরজার দোকান", kind: "shop" }],
    entries: [
      {
        id: "bill",
        kind: "expense",
        account: "materials",
        personId: "shop",
        note: "আগের কথা",
        lines: [
          { id: "door-line", workId: "door", label: "দরজা", amount: 9300000 },
        ],
      },
    ],
  });
  const onSave = vi.fn(async (_next: Ledger, _files?: EntryAttachments) => {});
  const props = {
    presentation: "page",
    ledger,
    editEntryId: "bill",
    mode: "demo",
    onSave,
    onClose: vi.fn(),
  } as const;
  const view = mount(<EntrySheet {...props} />);
  await ready("সংরক্ষণ করুন");
  const file = new File(["voucher"], "door.pdf", { type: "application/pdf" });
  fireEvent.change(view.container.querySelector('input[type="file"]')!, {
    target: { files: [file] },
  });
  await screen.findByText("door.pdf");
  storage.writes.mockClear();
  vi.useFakeTimers();
  fireEvent.change(screen.getByRole("textbox", { name: /^মোট দাম/ }), {
    target: { value: "94000" },
  });
  fireEvent.change(screen.getByLabelText("মনে রাখার কথা"), {
    target: { value: "ডেলিভারিসহ দাম" },
  });
  expect(storage.writes).not.toHaveBeenCalled();
  view.unmount();
  await act(async () => {
    await Promise.resolve();
  });
  expect(storage.drafts.get("entry:bill")).toMatchObject({
    draft: { rows: [{ amount: "94000" }], note: "ডেলিভারিসহ দাম" },
    files: [{ file }],
  });
  vi.useRealTimers();
  const restored = mount(<EntrySheet {...props} />);
  await ready("সংরক্ষণ করুন");
  expect(
    (screen.getByRole("textbox", { name: /^মোট দাম/ }) as HTMLInputElement)
      .value,
  ).toBe("৯৪০০০");
  expect(
    (screen.getByLabelText("মনে রাখার কথা") as HTMLTextAreaElement).value,
  ).toBe("ডেলিভারিসহ দাম");
  expect(screen.getByText("door.pdf")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "সংরক্ষণ করুন" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0][0].entries[0]).toMatchObject({
    note: "ডেলিভারিসহ দাম",
    lines: [{ amount: 9400000 }],
  });
  expect(onSave.mock.calls[0][1]?.files[0].file.name).toBe("door.pdf");
  await waitFor(() => expect(storage.drafts.has("entry:bill")).toBe(false));
  restored.unmount();
  await act(async () => {
    await Promise.resolve();
  });
  expect(storage.drafts.has("entry:bill")).toBe(false);
});

it("does not restore a discarded entry if its page unmounts while draft deletion is pending", async () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
    entries: [
      {
        id: "bill",
        kind: "expense",
        lines: [{ id: "line", workId: "door", label: "দরজা", amount: 9300000 }],
      },
    ],
  });
  const props = {
    presentation: "page",
    ledger,
    editEntryId: "bill",
    mode: "demo",
    onSave: vi.fn(async (_next: Ledger) => {}),
    onClose: vi.fn(),
  } as const;
  const view = mount(<EntrySheet {...props} />);
  await ready("সংরক্ষণ করুন");
  fireEvent.change(screen.getByRole("textbox", { name: /^মোট দাম/ }), {
    target: { value: "94000" },
  });
  await userEvent.click(screen.getByRole("button", { name: "ফিরুন" }));
  await waitFor(() => expect(storage.drafts.has("entry:bill")).toBe(true));
  view.unmount();
  const restored = mount(<EntrySheet {...props} />);
  await ready("সংরক্ষণ করুন");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  storage.beforeRemove = () => gate;
  await userEvent.click(
    screen.getByRole("button", { name: "অসমাপ্ত লেখা বাদ দিন" }),
  );
  restored.unmount();
  await act(async () => {
    release();
    await gate;
  });
  expect(storage.drafts.has("entry:bill")).toBe(false);
  storage.beforeRemove = null;
  mount(<EntrySheet {...props} />);
  await ready("সংরক্ষণ করুন");
  expect(
    (screen.getByRole("textbox", { name: /^মোট দাম/ }) as HTMLInputElement)
      .value,
  ).toBe("৯৩০০০");
  expect(props.onSave).not.toHaveBeenCalled();
});

async function savedEntryChanges() {
  const ledger = LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
    people: [{ id: "shop", name: "দরজার দোকান", kind: "shop" }],
    entries: [
      {
        id: "bill",
        kind: "expense",
        account: "materials",
        personId: "shop",
        date: "2026-11-01",
        createdAt: "2026-11-01T10:00:00Z",
        updatedAt: "2026-11-01T10:00:00Z",
        note: "আগের কথা",
        lines: [{ id: "line", workId: "door", label: "দরজা", amount: 9300000 }],
      },
    ],
  });
  const view = mount(
    <EntrySheet
      presentation="page"
      ledger={ledger}
      editEntryId="bill"
      mode="demo"
      onSave={vi.fn(async (_next: Ledger) => {})}
      onClose={vi.fn()}
    />,
  );
  await ready("সংরক্ষণ করুন");
  const file = new File(["my voucher"], "my-changes.pdf", {
    type: "application/pdf",
  });
  fireEvent.change(view.container.querySelector('input[type="file"]')!, {
    target: { files: [file] },
  });
  await screen.findByText("my-changes.pdf");
  fireEvent.change(screen.getByRole("textbox", { name: /^মোট দাম/ }), {
    target: { value: "94000" },
  });
  fireEvent.change(screen.getByLabelText("মনে রাখার কথা"), {
    target: { value: "আমার অসমাপ্ত কথা" },
  });
  view.unmount();
  await act(async () => {
    await Promise.resolve();
  });
  const saved = storage.drafts.get("entry:bill") as {
    draft: Record<string, unknown>;
    files: Array<{ id: string; file: File }>;
  };
  expect(saved).toMatchObject({
    draft: { rows: [{ amount: "94000" }], note: "আমার অসমাপ্ত কথা" },
    files: [{ file }],
  });
  const latest = LedgerSchema.parse({
    ...ledger,
    entries: [
      {
        ...ledger.entries[0],
        updatedAt: "2026-11-02T10:00:00Z",
        note: "অন্য জায়গায় বদলানো কথা",
        lines: [{ ...ledger.entries[0].lines[0], amount: 9500000 }],
      },
    ],
  });
  storage.writes.mockClear();
  return { latest, saved };
}

it("shows a stale edit and its voucher for read-only review without overwriting its saved copy on time or Back", async () => {
  const { latest, saved } = await savedEntryChanges();
  const before = JSON.stringify(latest);
  const onSave = vi.fn(async (_next: Ledger) => {});
  const onClose = vi.fn();
  const view = mount(
    <EntrySheet
      presentation="page"
      ledger={latest}
      editEntryId="bill"
      mode="demo"
      onSave={onSave}
      onClose={onClose}
    />,
  );
  await screen.findByRole("button", { name: "আমার লেখা ব্যবহার করি" });
  expect(screen.getByRole("alert").textContent).toContain(
    "এই হিসাব অন্য জায়গায় বদলেছে। আপনার অসমাপ্ত লেখা রাখা আছে।",
  );
  expect(
    (screen.getByRole("textbox", { name: /^মোট দাম/ }) as HTMLInputElement)
      .value,
  ).toBe("৯৪০০০");
  expect(
    (screen.getByLabelText("মনে রাখার কথা") as HTMLTextAreaElement).value,
  ).toBe("আমার অসমাপ্ত কথা");
  expect(screen.getByText("my-changes.pdf")).toBeTruthy();
  expect(view.container.querySelector("fieldset")?.disabled).toBe(true);
  expect(
    (screen.getByRole("button", { name: "সংরক্ষণ করুন" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  vi.useFakeTimers();
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  expect(storage.writes).not.toHaveBeenCalled();
  expect(storage.drafts.get("entry:bill")).toBe(saved);
  vi.useRealTimers();
  await userEvent.click(screen.getByRole("button", { name: "ফিরুন" }));
  expect(onClose).toHaveBeenCalledOnce();
  view.unmount();
  await act(async () => {
    await Promise.resolve();
  });
  expect(storage.drafts.get("entry:bill")).toBe(saved);
  expect(onSave).not.toHaveBeenCalled();
  expect(JSON.stringify(latest)).toBe(before);
});

it("rebases a stale draft only after explicit choice and audits the current entry as before when saving", async () => {
  const { latest, saved } = await savedEntryChanges();
  const before = JSON.stringify(latest);
  const onSave = vi.fn(async (_next: Ledger, _files?: EntryAttachments) => {});
  const view = mount(
    <EntrySheet
      presentation="page"
      ledger={latest}
      editEntryId="bill"
      mode="demo"
      onSave={onSave}
      onClose={vi.fn()}
    />,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "আমার লেখা ব্যবহার করি" }),
  );
  await ready("সংরক্ষণ করুন");
  expect(view.container.querySelector("fieldset")?.disabled).toBe(false);
  expect(
    (screen.getByRole("textbox", { name: /^মোট দাম/ }) as HTMLInputElement)
      .value,
  ).toBe("৯৪০০০");
  expect(
    (screen.getByLabelText("মনে রাখার কথা") as HTMLTextAreaElement).value,
  ).toBe("আমার অসমাপ্ত কথা");
  expect(screen.getByText("my-changes.pdf")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "সংরক্ষণ করুন" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  const entry = onSave.mock.calls[0][0].entries[0];
  expect(entry).toMatchObject({
    id: "bill",
    note: "আমার অসমাপ্ত কথা",
    lines: [{ amount: 9400000 }],
  });
  expect(entry.revisions.at(-1)?.before).toMatchObject({
    note: "অন্য জায়গায় বদলানো কথা",
    lines: [{ amount: 9500000 }],
    updatedAt: "2026-11-02T10:00:00Z",
  });
  expect(onSave.mock.calls[0][1]?.files[0].file).toBe(saved.files[0].file);
  expect(JSON.stringify(latest)).toBe(before);
  await waitFor(() => expect(storage.drafts.has("entry:bill")).toBe(false));
  view.unmount();
  await act(async () => {
    await Promise.resolve();
  });
  expect(storage.drafts.has("entry:bill")).toBe(false);
});

it.each(["id", "kind"] as const)(
  "blocks a draft with the wrong %s without allowing rebase or overwriting it",
  async (field) => {
    const { latest, saved } = await savedEntryChanges();
    const mismatched = {
      ...saved,
      draft: {
        ...saved.draft,
        [field]: field === "id" ? "another-entry" : "labour",
      },
    };
    storage.drafts.set("entry:bill", mismatched);
    const onClose = vi.fn();
    const onSave = vi.fn(async (_next: Ledger) => {});
    const view = mount(
      <EntrySheet
        presentation="page"
        ledger={latest}
        editEntryId="bill"
        mode="demo"
        onSave={onSave}
        onClose={onClose}
      />,
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "অসমাপ্ত লেখাটি এই হিসাবের সঙ্গে মিলছে না। আগের লেখা রাখা আছে।",
    );
    expect(
      screen.queryByRole("button", { name: "আমার লেখা ব্যবহার করি" }),
    ).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "সংরক্ষণ করুন",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    vi.useFakeTimers();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(storage.writes).not.toHaveBeenCalled();
    expect(storage.drafts.get("entry:bill")).toBe(mismatched);
    vi.useRealTimers();
    await userEvent.click(screen.getByRole("button", { name: "ফিরুন" }));
    view.unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(storage.drafts.get("entry:bill")).toBe(mismatched);
    expect(onSave).not.toHaveBeenCalled();
  },
);

it.each(["door", ""] as const)(
  "saves a new job with optional notebook %s without showing scope controls",
  async (workId) => {
    const ledger = LedgerSchema.parse({
      works: [{ id: "door", name: "দরজা" }],
      people: [{ id: "worker", name: "শাহ আলম", kind: "worker" }],
    });
    const onSave = vi.fn(async (_next: Ledger) => {});
    mount(
      <EntitySheet
        presentation="page"
        kind="contract"
        ledger={ledger}
        defaultWorkId="door"
        defaultPersonId="worker"
        mode="demo"
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    await ready();
    expect(
      screen.queryByRole("group", { name: "কোন কাজের চুক্তি" }),
    ).toBeNull();
    expect(
      (screen.getByLabelText("কাজের খাতা") as HTMLSelectElement).value,
    ).toBe("door");
    fireEvent.change(screen.getByLabelText("কাজের খাতা"), {
      target: { value: workId },
    });
    fireEvent.change(screen.getByLabelText("কাজের নাম"), {
      target: { value: "দরজা লাগানো" },
    });
    fireEvent.change(screen.getByLabelText("কাজের টাকা"), {
      target: { value: "93000" },
    });
    await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const next = onSave.mock.calls[0][0];
    expect(next.contracts[0]).toMatchObject({
      scope: workId ? "work" : "house",
      workId: workId || null,
      title: "দরজা লাগানো",
      total: 9300000,
    });
    expect(next.entries).toEqual([]);
  },
);

it("adds an optional job to a new worker using only its chosen notebook and amount", async () => {
  const onSave = vi.fn(async (_next: Ledger) => {});
  mount(
    <EntitySheet
      presentation="page"
      kind="person"
      ledger={LedgerSchema.parse({ works: [{ id: "door", name: "দরজা" }] })}
      mode="demo"
      onSave={onSave}
      onClose={vi.fn()}
    />,
  );
  await ready();
  await userEvent.click(
    screen.getByRole("button", { name: "মিস্ত্রি", pressed: false }),
  );
  fireEvent.change(screen.getByLabelText("নাম"), { target: { value: "করিম" } });
  await userEvent.click(
    screen.getByText("কাজের টাকা", { selector: "summary" }),
  );
  expect(screen.queryByRole("group", { name: "কোন কাজের চুক্তি" })).toBeNull();
  fireEvent.change(screen.getByLabelText("কাজের খাতা"), {
    target: { value: "door" },
  });
  fireEvent.change(screen.getByLabelText("কাজের টাকা"), {
    target: { value: "10000" },
  });
  await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  const next = onSave.mock.calls[0][0];
  expect(next.contracts[0]).toMatchObject({
    scope: "work",
    workId: "door",
    personId: next.people[0].id,
    total: 1000000,
    title: "মোট মজুরির চুক্তি",
  });
  expect(next.entries).toEqual([]);
});

it.each(["house", "work"] as const)(
  "preserves a used legacy %s job when an old draft omits scope and title",
  async (scope) => {
    const ledger = usedHouse();
    ledger.contracts[0] = {
      ...ledger.contracts[0],
      scope,
      workId: scope === "work" ? "door" : null,
      title: "আগের কাজের নাম",
      notes: "আগের নোট",
      history: [{ at: "2026-10-01", total: 55000000, note: "পুরোনো দর" }],
    };
    const before = JSON.stringify(ledger);
    storage.drafts.set("entity:contract:house:any", {
      id: "house",
      workId: scope === "work" ? "door" : "",
      personId: "worker",
      total: "650000",
      contractReason: "দর বদলেছে",
    });
    const onSave = vi.fn(async (_next: Ledger) => {});
    mount(
      <EntitySheet
        presentation="page"
        kind="contract"
        ledger={ledger}
        editId="house"
        mode="demo"
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    await ready();
    expect((screen.getByLabelText("কাজের নাম") as HTMLInputElement).value).toBe(
      "আগের কাজের নাম",
    );
    expect(
      (screen.getByLabelText("কাজের খাতা") as HTMLSelectElement).value,
    ).toBe(scope === "work" ? "door" : "");
    expect(
      (screen.getByLabelText("কাজের খাতা") as HTMLSelectElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("মিস্ত্রি") as HTMLSelectElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("কাজের টাকা") as HTMLInputElement).value,
    ).toBe("৬৫০০০০");
    expect(screen.getByRole("heading", { name: "কাজ বদলাই" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const next = onSave.mock.calls[0][0];
    expect(next.contracts[0]).toMatchObject({
      scope,
      workId: scope === "work" ? "door" : null,
      total: 65000000,
      title: "আগের কাজের নাম",
      notes: "আগের নোট",
      history: ledger.contracts[0].history,
    });
    expect(next.entries).toEqual(ledger.entries);
    expect(next.contracts[0].activity.at(-1)).toMatchObject({
      reason: "দর বদলেছে",
      before: { scope, total: 60000000 },
      after: { scope, total: 65000000 },
    });
    expect(JSON.stringify(ledger)).toBe(before);
  },
);

it("keeps an existing used house job's legacy notebook metadata unchanged instead of silently converting it", async () => {
  const ledger = usedHouse();
  ledger.contracts[0].workId = "door";
  const onSave = vi.fn(async (_next: Ledger) => {});
  mount(
    <EntitySheet
      presentation="page"
      kind="contract"
      editId="house"
      ledger={ledger}
      mode="demo"
      onSave={onSave}
      onClose={vi.fn()}
    />,
  );
  await ready();
  expect((screen.getByLabelText("কাজের খাতা") as HTMLSelectElement).value).toBe(
    "",
  );
  expect(
    (screen.getByLabelText("কাজের খাতা") as HTMLSelectElement).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("কাজের টাকা"), {
    target: { value: "650000" },
  });
  fireEvent.change(screen.getByLabelText("কেন বদলালেন"), {
    target: { value: "কাজ বেড়েছে" },
  });
  await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0][0].contracts[0]).toMatchObject({
    scope: "house",
    workId: "door",
    total: 65000000,
  });
  expect(onSave.mock.calls[0][0].entries).toEqual(ledger.entries);
});

it("blocks a stale used-job identity and recovers it explicitly without losing pending amount or reason", async () => {
  const ledger = LedgerSchema.parse({
    ...usedHouse(),
    works: [
      { id: "door", name: "দরজা" },
      { id: "roof", name: "ছাদ" },
    ],
    people: [
      { id: "worker", name: "শাহ আলম", kind: "worker" },
      { id: "other", name: "করিম", kind: "worker" },
    ],
  });
  const before = JSON.stringify(ledger);
  storage.drafts.set("entity:contract:house:any", {
    id: "house",
    scope: "work",
    workId: "roof",
    personId: "other",
    total: "650000",
    contractReason: "সিঁড়ির কাজ যোগ হয়েছে",
    title: "অসমাপ্ত কাজের নাম",
  });
  const onSave = vi.fn(async (_next: Ledger) => {});
  mount(
    <EntitySheet
      presentation="page"
      kind="contract"
      editId="house"
      ledger={ledger}
      mode="demo"
      onSave={onSave}
      onClose={vi.fn()}
    />,
  );
  await screen.findByRole("button", { name: "আগের মিস্ত্রি ও খাতা রাখি" });
  expect(
    (screen.getByRole("button", { name: "রাখুন" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (screen.getByLabelText("কাজের খাতা") as HTMLSelectElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByLabelText("মিস্ত্রি") as HTMLSelectElement).disabled,
  ).toBe(true);
  expect((screen.getByLabelText("কাজের টাকা") as HTMLInputElement).value).toBe(
    "৬৫০০০০",
  );
  expect(onSave).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "আগের মিস্ত্রি ও খাতা রাখি" }),
  );
  await ready();
  expect((screen.getByLabelText("কাজের টাকা") as HTMLInputElement).value).toBe(
    "৬৫০০০০",
  );
  expect(
    (screen.getByLabelText("কেন বদলালেন") as HTMLTextAreaElement).value,
  ).toBe("সিঁড়ির কাজ যোগ হয়েছে");
  expect((screen.getByLabelText("কাজের নাম") as HTMLInputElement).value).toBe(
    "অসমাপ্ত কাজের নাম",
  );
  expect((screen.getByLabelText("কাজের খাতা") as HTMLSelectElement).value).toBe(
    "",
  );
  expect((screen.getByLabelText("মিস্ত্রি") as HTMLSelectElement).value).toBe(
    "worker",
  );
  await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0][0].contracts[0]).toMatchObject({
    scope: "house",
    workId: null,
    personId: "worker",
    total: 65000000,
    title: "অসমাপ্ত কাজের নাম",
  });
  expect(onSave.mock.calls[0][0].entries).toEqual(ledger.entries);
  expect(JSON.stringify(ledger)).toBe(before);
});

it("shows an explicit ongoing status for a new job and saves it without touching money twice", async () => {
  const ledger = usedHouse();
  const onSave = vi.fn(async (_next: Ledger) => {});
  mount(
    <EntitySheet
      presentation="page"
      kind="contract"
      ledger={ledger}
      defaultPersonId="worker"
      mode="demo"
      onSave={onSave}
      onClose={vi.fn()}
    />,
  );
  await ready();
  expect(
    (screen.getByLabelText("কাজের অবস্থা") as HTMLSelectElement).value,
  ).toBe("ongoing");
  fireEvent.change(screen.getByLabelText("কাজের টাকা"), {
    target: { value: "20000" },
  });
  await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  const next = onSave.mock.calls[0][0];
  expect(next.contracts.at(-1)?.status).toBe("ongoing");
  expect(next.entries).toEqual(ledger.entries);
});
it("keeps an old job unknown until explicitly marked done and records that change without changing paid money", async () => {
  const ledger = usedHouse();
  expect(ledger.contracts[0].status).toBeNull();
  const onSave = vi.fn(async (_next: Ledger) => {});
  mount(
    <EntitySheet
      presentation="page"
      kind="contract"
      editId="house"
      ledger={ledger}
      mode="demo"
      onSave={onSave}
      onClose={vi.fn()}
    />,
  );
  await ready();
  expect(
    (screen.getByLabelText("কাজের অবস্থা") as HTMLSelectElement).value,
  ).toBe("");
  fireEvent.change(screen.getByLabelText("কাজের অবস্থা"), {
    target: { value: "done" },
  });
  fireEvent.change(screen.getByLabelText("কেন বদলালেন"), {
    target: { value: "কাজ শেষ হয়েছে" },
  });
  await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  const next = onSave.mock.calls[0][0];
  expect(next.contracts[0].status).toBe("done");
  expect(next.contracts[0].activity.at(-1)).toMatchObject({
    before: { status: null },
    after: { status: "done" },
    reason: "কাজ শেষ হয়েছে",
  });
  expect(next.entries).toEqual(ledger.entries);
  expect(contractSummary(next, "house").netPaid).toBe(
    contractSummary(ledger, "house").netPaid,
  );
});
it("does not overwrite a newer status while editing another job field without touching status", async () => {
  const old = usedHouse();
  const onSave = vi.fn(async (_next: Ledger) => {});
  const props = {
    presentation: "page",
    kind: "contract",
    editId: "house",
    mode: "demo",
    onSave,
    onClose: vi.fn(),
  } as const;
  const view = mount(<EntitySheet {...props} ledger={old} />);
  await ready();
  const next = saveContractChange(
    old,
    { ...old.contracts[0], status: "done" },
    "কাজ শেষ",
    new Date(Date.now() - 1000).toISOString(),
  );
  view.rerender(
    <LanguageProvider>
      <EntitySheet {...props} ledger={next} />
    </LanguageProvider>,
  );
  fireEvent.change(screen.getByLabelText("নোট"), {
    target: { value: "সব ভাউচার পাওয়া গেছে" },
  });
  fireEvent.change(screen.getByLabelText("কেন বদলালেন"), {
    target: { value: "নোট যোগ করেছি" },
  });
  await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0][0].contracts[0]).toMatchObject({
    status: "done",
    notes: "সব ভাউচার পাওয়া গেছে",
  });
  expect(onSave.mock.calls[0][0].contracts[0].activity[0]).toEqual(
    next.contracts[0].activity[0],
  );
});
