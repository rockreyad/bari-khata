// @vitest-environment jsdom
import "fake-indexeddb/auto";
import {
  useState,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import {
  NotebookContext,
  type NotebookContextValue,
} from "../../app/NotebookContext";
import { LanguageProvider } from "../../context/LanguageProvider";
import { getAccountDatabase, setActiveOwner } from "../../data/database";
import {
  createWorkspaceStorage,
  getScopedRepository,
  type ReceiptInput,
  type LedgerRepository,
} from "../../data/repository";
import { EntrySchema, LedgerSchema, type Ledger } from "../../domain/model";
import { partyLedger } from "../../domain/partyLedger";
import { summarize } from "../../domain/ledger";
import { appendBalanceAdjustment } from "../../domain/balanceAdjustments";
import { planHousePayment } from "../../domain/housePayments";
import { partyDueItems, partyDuePaymentUrl } from "../home/partyDueItems";
import { savePreferences } from "../../lib/preferences";
import { latinDigits } from "../../lib/numerals";
import { HouseCostForm } from "./HouseCostForm";
import { HousePaymentForm } from "./HousePaymentForm";

const nativeFiles = await vi.hoisted(async () => {
  const { Blob, File } = await import("node:buffer");
  vi.stubGlobal("Blob", Blob);
  vi.stubGlobal("File", File);
  return { Blob, File };
});
const NativeURL = URL;
beforeEach(() => {
  vi.stubGlobal("Blob", nativeFiles.Blob);
  vi.stubGlobal("File", nativeFiles.File);
  vi.stubGlobal(
    "URL",
    class extends NativeURL {
      static createObjectURL = vi.fn(() => "blob:sample-receipt");
      static revokeObjectURL = vi.fn();
    },
  );
});
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
const api = {
  close: vi.fn(),
  notify: vi.fn(),
  detail: vi.fn(),
  go: vi.fn(),
  add: vi.fn(),
  save: vi.fn(),
  beforeSave: null as null | ((repo: LedgerRepository) => Promise<void>),
  publish: null as null | ((ledger: Ledger) => void),
};
let owner: string | undefined;
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  if (owner) await getAccountDatabase(owner).delete();
  owner = undefined;
  setActiveOwner(null);
  localStorage.clear();
  vi.clearAllMocks();
  api.beforeSave = null;
  api.publish = null;
  vi.unstubAllGlobals();
});
function base(): Ledger {
  return LedgerSchema.parse({
    architectureVersion: 2,
    paymentAllocations: [],
    milestones: [],
    works: [
      { id: "roof", name: "নমুনা ছাদ" },
      { id: "wall", name: "নমুনা দেয়াল" },
    ],
    people: [
      {
        id: "party",
        name: "নমুনা করিম",
        kind: "other",
        contactType: "custom",
        roles: [],
      },
    ],
  });
}
function withBills(): Ledger {
  return LedgerSchema.parse({
    ...base(),
    entries: [
      {
        id: "old",
        kind: "expense",
        personId: "party",
        date: "2026-11-01",
        note: "নমুনা পুরোনো বিল",
        lines: [
          { id: "one", workId: "roof", label: "নমুনা সিমেন্ট", amount: 10000 },
        ],
      },
      {
        id: "later",
        kind: "expense",
        personId: "party",
        date: "2026-11-02",
        note: "নমুনা পরের বিল",
        lines: [
          { id: "two", workId: "roof", label: "নমুনা রড", amount: 20000 },
        ],
      },
    ],
  });
}
function advance(id = "advance", value = 5000) {
  return EntrySchema.parse({
    id,
    kind: "payment",
    personId: "party",
    paymentContext: "advance",
    date: "2026-11-01",
    allocations: [{ workId: "roof", amount: value }],
    paymentParts: [{ amount: value }],
  });
}
async function setup(initial = base()) {
  owner = crypto.randomUUID();
  setActiveOwner(owner);
  savePreferences({ language: "bn" });
  const repo = getScopedRepository("real");
  await repo.ensure("real", initial);
  return repo;
}
function Harness({
  initial,
  children,
}: {
  initial: Ledger;
  children: ReactNode;
}) {
  const [ledger, setLedger] = useState(initial);
  api.publish = setLedger;
  const value = {
    ledger,
    mode: "real",
    base: "",
    close: api.close,
    notify: api.notify,
    detail: api.detail,
    go: api.go,
    add: api.add,
    entity: vi.fn(),
    save: async (
      change: Ledger | ((ledger: Ledger) => Ledger),
      files: ReceiptInput[] = [],
    ) => {
      const repo = getScopedRepository("real");
      api.save();
      const pending = api.beforeSave;
      api.beforeSave = null;
      if (pending) await pending(repo);
      try {
        await repo.save(change, "real", files);
      } finally {
        setLedger((await repo.read())!.ledger);
      }
    },
  } as unknown as NotebookContextValue;
  return (
    <LanguageProvider>
      <NotebookContext.Provider value={value}>
        {children}
      </NotebookContext.Provider>
    </LanguageProvider>
  );
}
function mount(
  initial: Ledger,
  element: ReactNode,
  path = "/write/purchase?person=party&work=roof",
) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Harness initial={initial}>{element}</Harness>
    </MemoryRouter>,
  );
}
async function ready() {
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "হিসাব রাখুন" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
}
async function cost(
  user: ReturnType<typeof userEvent.setup>,
  amount = "100",
  label = "নমুনা কেনা মাল",
) {
  await user.type(screen.getByLabelText(/^মালের নাম/), label);
  await user.type(screen.getByLabelText(/^মালের দাম [০-৯0-9]+$/), amount);
}
const payPath = "/write/payment?person=party&work=roof&account=materials";

it("pays a finished job with no separate bill and retains its remaining due after IndexedDB reopens", async () => {
  const initial = LedgerSchema.parse({
    ...base(),
    contracts: [
      {
        id: "finished",
        personId: "party",
        workId: "roof",
        total: 3500000,
        status: "done",
      },
    ],
  });
  const repo = await setup(initial);
  const user = userEvent.setup();
  const due = partyDueItems(initial, "party")[0];
  expect(due).toMatchObject({ contractId: "finished", amount: 3500000 });
  const page = mount(
    initial,
    <HousePaymentForm />,
    partyDuePaymentUrl(due, "/works/finished"),
  );
  await ready();
  const amount = screen.getByLabelText("কত দিয়েছেন") as HTMLInputElement;
  expect(latinDigits(amount.value)).toBe("35000");
  await user.clear(amount);
  await user.type(amount, "10000");
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  page.unmount();
  repo.database.close();
  await repo.database.open();
  const saved = (await repo.read())!.ledger;
  expect(saved.entries).toHaveLength(1);
  expect(saved.entries[0]).toMatchObject({
    kind: "payment",
    contractId: "finished",
    personId: "party",
    account: "labour",
    paymentParts: [{ amount: 1000000 }],
  });
  expect(saved.paymentAllocations).toHaveLength(0);
  expect(saved.contracts).toEqual(initial.contracts);
  expect(partyDueItems(saved, "party")).toMatchObject([
    { contractId: "finished", amount: 2500000 },
  ]);
});

it("shows the selected recipient's due before amount entry without injecting their preferred work into a general payment", async () => {
  const source = withBills();
  const initial = LedgerSchema.parse({
    ...source,
    people: source.people.map((person) => ({ ...person, workIds: ["wall"] })),
  });
  const repo = await setup(initial);
  const user = userEvent.setup();
  mount(
    initial,
    <HousePaymentForm />,
    "/write/payment?back=%2F&purpose=settle",
  );
  await ready();
  const recipient = screen.getByLabelText("কাকে দিয়েছেন");
  const amount = screen.getByLabelText("কত দিয়েছেন") as HTMLInputElement;
  expect(
    recipient.compareDocumentPosition(amount) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(amount.value).toBe("");
  await user.selectOptions(recipient, "party");
  expect(screen.getByText(/^মোট বাকি /).textContent).toContain("৩০০");
  expect(amount.value).toBe("");
  expect(screen.queryByRole("region", { name: "হিসাবের সারাংশ" })).toBeNull();
  expect(screen.queryByText("এখন টাকা গেছে")).toBeNull();
  await user.type(amount, "50");
  expect(screen.queryByText("বেছে নেওয়া খাতায় বাকি নেই।")).toBeNull();
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  expect(partyLedger((await repo.read())!.ledger, "party").payable).toBe(25000);
  expect((await repo.read())!.ledger.entries.at(-1)?.allocations).toEqual([
    { workId: "roof", amount: 5000 },
  ]);
});

it("reopens an old settlement cash draft on the ordinary route and saves its receipt without inventing a bill or advance", async () => {
  const initial = base();
  const repo = await setup(initial);
  const user = userEvent.setup();
  const key = "house-payment:party:roof:all";
  let page = mount(initial, <HousePaymentForm />, payPath);
  await ready();
  expect(screen.queryByText(/^মোট বাকি /)).toBeNull();
  await user.type(screen.getByLabelText("কত দিয়েছেন"), "50");
  expect(screen.queryByText("এই নামে কোনো বাকি বিল নেই।")).toBeNull();
  expect(screen.queryByRole("button", { name: "বিল লিখি" })).toBeNull();
  expect(screen.queryByText("আগাম দিয়েছি")).toBeNull();
  expect(screen.queryByText(/^বাকি থাকবে /)).toBeNull();
  await user.click(
    within(screen.getByRole("group", { name: "কীভাবে দিয়েছেন" })).getByRole(
      "button",
      { name: "ব্যাংক" },
    ),
  );
  await user.click(screen.getByText("ভাউচার, নোট ও তারিখ"));
  await user.type(
    screen.getByLabelText("বাড়তি কথা"),
    "নমুনা বিল ছাড়া দেওয়া টাকা",
  );
  await user.upload(
    screen.getByLabelText("ভাউচার বা ছবি"),
    new File(["sample no-bill receipt"], "sample-no-bill.pdf", {
      type: "application/pdf",
    }),
  );
  let draftId = "";
  await waitFor(async () => {
    const saved = await createWorkspaceStorage().readDraft<{
      id: string;
      amount: string;
    }>(key);
    expect(saved).toMatchObject({
      personId: "party",
      amount: "50",
      intent: "payment",
      method: "bank",
      note: "নমুনা বিল ছাড়া দেওয়া টাকা",
      files: [expect.objectContaining({ name: "sample-no-bill.pdf" })],
    });
    draftId = saved!.id;
  });
  page.unmount();
  const oldDraft =
    await createWorkspaceStorage().readDraft<Record<string, unknown>>(key);
  await createWorkspaceStorage().saveDraft(key, {
    ...oldDraft,
    intent: "settlement",
  });
  expect(await createWorkspaceStorage().readDraft(key)).toMatchObject({
    id: draftId,
    intent: "settlement",
    amount: "50",
    files: [expect.objectContaining({ name: "sample-no-bill.pdf" })],
  });
  repo.database.close();
  await repo.database.open();
  page = mount((await repo.read())!.ledger, <HousePaymentForm />, payPath);
  await ready();
  expect(
    latinDigits(
      (screen.getByLabelText("কত দিয়েছেন") as HTMLInputElement).value,
    ),
  ).toBe("50");
  expect(
    screen.getByRole("button", { name: "ব্যাংক", pressed: true }),
  ).toBeTruthy();
  expect(screen.getByText("ভাউচার, নোট ও তারিখ").closest("details")!.open).toBe(
    false,
  );
  expect(screen.queryByText(/^মোট বাকি /)).toBeNull();
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  page.unmount();
  repo.database.close();
  await repo.database.open();
  const saved = (await repo.read())!.ledger;
  expect(saved.entries).toHaveLength(1);
  expect(saved.entries[0]).toMatchObject({
    id: draftId,
    kind: "payment",
    personId: "party",
    account: "materials",
    note: "নমুনা বিল ছাড়া দেওয়া টাকা",
    paymentParts: [{ method: "bank", amount: 5000 }],
    receipts: [expect.objectContaining({ name: "sample-no-bill.pdf" })],
  });
  expect(saved.entries[0].paymentContext).toBe("settlement");
  expect(summarize(saved)).toMatchObject({ cost: 0, cashPaid: 5000 });
  expect(partyLedger(saved, "party")).toMatchObject({
    explicitAdvance: 0,
    receivable: 0,
  });
  expect(saved.paymentAllocations).toHaveLength(0);
  expect(saved.entries[0].allocations).toEqual([
    { workId: "roof", amount: 5000 },
  ]);
  expect(
    await (await repo.getReceipt(saved.entries[0].receipts[0].id))!.blob.text(),
  ).toBe("sample no-bill receipt");
  expect(await createWorkspaceStorage().readDraft(key)).toBeNull();
  expect(api.save).toHaveBeenCalledOnce();
  expect(api.go).not.toHaveBeenCalled();
});

it("saves an ordinary worker payment from the party page without requiring a prior bill or associated work", async () => {
  const initial = LedgerSchema.parse({
    ...base(),
    people: [
      {
        id: "worker",
        name: "নমুনা কর্মী",
        kind: "worker",
        contactType: "craftsperson",
        roles: ["craftsperson"],
        quickActions: ["payment"],
        workIds: [],
      },
    ],
  });
  const repo = await setup(initial);
  const user = userEvent.setup();
  mount(
    initial,
    <HousePaymentForm />,
    "/write/payment?person=worker&account=labour&back=%2Fparties%2Fworker",
  );
  await ready();
  expect(
    (screen.getByLabelText("কাকে দিয়েছেন") as HTMLSelectElement).value,
  ).toBe("worker");
  expect(screen.queryByText(/^মোট বাকি /)).toBeNull();
  await user.type(screen.getByLabelText("কত দিয়েছেন"), "200");
  expect(screen.queryByText("এই নামে কোনো বাকি বিল নেই।")).toBeNull();
  expect(screen.queryByRole("button", { name: "বিল লিখি" })).toBeNull();
  expect(screen.queryByText("আগাম দিয়েছি")).toBeNull();
  expect(screen.queryByText(/^বাকি থাকবে /)).toBeNull();
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  repo.database.close();
  await repo.database.open();
  const saved = (await repo.read())!.ledger;
  expect(saved.entries).toHaveLength(1);
  expect(saved.entries[0]).toMatchObject({
    kind: "payment",
    personId: "worker",
    account: "labour",
    paymentParts: [{ amount: 20000 }],
  });
  expect(saved.entries[0].paymentContext).toBe("settlement");
  expect(summarize(saved)).toMatchObject({ cost: 0, cashPaid: 20000 });
  expect(partyLedger(saved, "worker")).toMatchObject({
    explicitAdvance: 0,
    receivable: 0,
  });
  expect(saved.people[0].workIds).toEqual([]);
  expect(saved.paymentAllocations).toHaveLength(0);
  expect(saved.entries[0].allocations).toHaveLength(1);
  expect(
    saved.works.find(
      (work) => work.id === saved.entries[0].allocations[0].workId,
    )?.name,
  ).toBe("সাধারণ খরচ");
  expect(saved.entries[0].allocations[0].amount).toBe(20000);
});

it("keeps an archived-contract payment draft editable so its contract can be explicitly cleared before cash is saved", async () => {
  const initial = LedgerSchema.parse({
    ...base(),
    people: [
      {
        id: "worker",
        name: "নমুনা কর্মী",
        kind: "worker",
        roles: ["craftsperson"],
        quickActions: ["payment"],
      },
    ],
    contracts: [
      {
        id: "archived-job",
        personId: "worker",
        workId: "roof",
        total: 10000,
        title: "নমুনা পুরোনো কাজ",
        archivedAt: "2026-11-04T08:00:00.000Z",
        removalHistory: [
          {
            id: "sample-remove-contract",
            at: "2026-11-04T08:00:00.000Z",
            archived: true,
          },
        ],
      },
    ],
  });
  const repo = await setup(initial);
  const user = userEvent.setup();
  mount(
    initial,
    <HousePaymentForm />,
    "/write/payment?person=worker&work=roof&account=labour&contract=archived-job",
  );
  await ready();
  await user.type(screen.getByLabelText("কত দিয়েছেন"), "50");
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  expect(screen.getByRole("alert").textContent).toContain("চুক্তি");
  expect(api.save).not.toHaveBeenCalled();
  const contract = screen.getByLabelText("কোন কাজের জন্য");
  expect(contract.closest("details")!.open).toBe(true);
  await waitFor(async () =>
    expect(
      await createWorkspaceStorage().readDraft(
        "house-payment:worker:roof:archived-job",
      ),
    ).toMatchObject({ contractId: "archived-job", amount: "50" }),
  );
  await user.selectOptions(contract, "");
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  const saved = (await repo.read())!.ledger;
  expect(saved.contracts).toEqual(initial.contracts);
  expect(saved.entries).toHaveLength(1);
  expect(saved.entries[0]).toMatchObject({
    kind: "payment",
    contractId: null,
    paymentContext: "settlement",
    account: "labour",
    personId: "worker",
    paymentParts: [{ amount: 5000 }],
  });
  expect(summarize(saved).cost).toBe(0);
});

it("keeps an ordinary cash work assignment and original bill links while showing the actual total balance", async () => {
  const initial = withBills();
  const repo = await setup(initial);
  const user = userEvent.setup();
  mount(
    initial,
    <HousePaymentForm />,
    "/write/payment?person=party&work=wall&account=materials",
  );
  await ready();
  await user.type(screen.getByLabelText("কত দিয়েছেন"), "50");
  expect(screen.queryByText("বেছে নেওয়া খাতায় বাকি নেই।")).toBeNull();
  expect(screen.queryByRole("button", { name: "বিল লিখি" })).toBeNull();
  expect(screen.queryByText("আগাম দিয়েছি")).toBeNull();
  expect(
    latinDigits(
      screen.getByRole("status", { name: "টাকা দেওয়ার পরে" }).textContent ?? "",
    ),
  ).toMatch(/বাকি থাকবে\s+৳\s*250/);
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  const saved = (await repo.read())!.ledger;
  expect(saved.entries.at(-1)).toMatchObject({
    kind: "payment",
    paymentContext: "settlement",
    account: "materials",
    personId: "party",
    allocations: [{ workId: "wall", amount: 5000 }],
  });
  expect(saved.entries.filter((entry) => entry.kind === "expense")).toEqual(
    initial.entries,
  );
  expect(saved.paymentAllocations).toHaveLength(0);
  expect(summarize(saved)).toMatchObject({
    cost: 30000,
    cashPaid: 5000,
    reconciledPayable: 25000,
  });
  expect(partyLedger(saved, "party")).toMatchObject({
    explicitAdvance: 0,
    billOutstanding: 30000,
  });
});

it("restores brand, quantity, unit, receipt and partial payment after reopening, then saves the calculator amount once", async () => {
  const initial = base(),
    repo = await setup(initial),
    user = userEvent.setup();
  const view = mount(initial, <HouseCostForm action="purchase" />);
  await ready();
  await user.click(
    screen.getByRole("button", { name: "হিসাব করার ক্যালকুলেটর" }),
  );
  fireEvent.change(screen.getByLabelText("ক্যালকুলেটরের হিসাব"), {
    target: { value: "150 + 50" },
  });
  await user.click(screen.getByRole("button", { name: "এই টাকা লিখি" }));
  expect(
    latinDigits(
      (screen.getByLabelText(/^মালের দাম [০-৯0-9]+$/) as HTMLInputElement)
        .value,
    ),
  ).toBe("200");
  await user.type(screen.getByLabelText(/^মালের নাম/), "নমুনা সিমেন্ট");
  await user.click(screen.getByText("ব্র্যান্ড ও পরিমাণ"));
  const brandInput = screen.getByLabelText(/^ব্র্যান্ড [০-৯0-9]+$/);
  await user.type(brandInput, "প্রথম নমুনা");
  await user.clear(brandInput);
  expect((brandInput.closest("details") as HTMLDetailsElement).open).toBe(true);
  await user.type(brandInput, "নমুনা ব্র্যান্ড");
  await user.type(screen.getByLabelText(/^পরিমাণ [০-৯0-9]+$/), "2.5");
  await user.type(screen.getByLabelText(/^একক [০-৯0-9]+$/), "বস্তা");
  await user.click(screen.getByRole("button", { name: "কিছু দিয়েছি" }));
  await user.type(screen.getByLabelText("এখন কত দিয়েছি"), "40");
  await user.click(screen.getByText("ভাউচার, নোট ও তারিখ"));
  await user.upload(
    screen.getByLabelText("ভাউচার বা ছবি"),
    new File(["sample image"], "sample.png", { type: "image/png" }),
  );
  await waitFor(async () =>
    expect(
      await createWorkspaceStorage().readDraft(
        "house-cost:purchase:party:roof:none:none",
      ),
    ).toMatchObject({
      draft: {
        rows: [
          expect.objectContaining({
            brand: "নমুনা ব্র্যান্ড",
            quantity: "2.5",
            unit: "বস্তা",
          }),
        ],
        payment: "partial",
        paid: "40",
      },
      files: [expect.objectContaining({ name: "sample.png" })],
    }),
  );
  view.unmount();
  repo.database.close();
  await repo.database.open();
  mount((await repo.read())!.ledger, <HouseCostForm action="purchase" />);
  await ready();
  expect(
    (screen.getByLabelText(/^ব্র্যান্ড [০-৯0-9]+$/) as HTMLInputElement).value,
  ).toBe("নমুনা ব্র্যান্ড");
  expect(
    latinDigits(
      (screen.getByLabelText(/^পরিমাণ [০-৯0-9]+$/) as HTMLInputElement).value,
    ),
  ).toBe("2.5");
  expect(
    (screen.getByLabelText(/^একক [০-৯0-9]+$/) as HTMLInputElement).value,
  ).toBe("বস্তা");
  expect(
    screen.getByRole("button", { name: "কিছু দিয়েছি", pressed: true }),
  ).toBeTruthy();
  expect(screen.getByText("sample.png")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  const saved = (await repo.read())!.ledger;
  const bill = saved.entries.find((entry) => entry.kind === "expense")!;
  expect(bill.lines[0]).toMatchObject({
    amount: 20000,
    quantity: "2.5",
    unit: "বস্তা",
    materialGroupId: null,
  });
  expect(
    saved.items.find((item) => item.id === bill.lines[0].itemId),
  ).toMatchObject({ brand: "নমুনা ব্র্যান্ড", materialGroupId: null });
  expect(summarize(saved)).toMatchObject({
    cost: 20000,
    netPaid: 4000,
    reconciledPayable: 16000,
  });
  expect((await repo.getReceipt(bill.receipts[0].id))!.blob.size).toBe(12);
});

it("focuses Bengali validation on each failed attempt and marks the offending cost field without saving money", async () => {
  const initial = base(),
    repo = await setup(initial),
    user = userEvent.setup();
  mount(initial, <HouseCostForm action="purchase" />);
  await ready();
  const amountInput = screen.getByLabelText(/^মালের দাম [০-৯0-9]+$/);
  const labelInput = screen.getByLabelText(/^মালের নাম/);
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  let error = await screen.findByRole("alert");
  expect(document.activeElement).toBe(error);
  expect(amountInput.getAttribute("aria-invalid")).toBe("true");
  expect(
    document.getElementById(amountInput.getAttribute("aria-describedby")!)
      ?.textContent,
  ).toBe(error.textContent);
  await user.click(labelInput);
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  error = await screen.findByRole("alert");
  expect(document.activeElement).toBe(error);
  await user.type(amountInput, "20");
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "কী মাল বা কাজের বিল",
  );
  expect(labelInput.getAttribute("aria-invalid")).toBe("true");
  expect(labelInput.getAttribute("aria-describedby")).toBe("house-cost-error");
  expect(api.save).not.toHaveBeenCalled();
  expect((await repo.read())!.ledger.entries).toEqual([]);
});

it("uses a transport contact's configured sector and bill type without offering wages or unrelated contacts", async () => {
  const initial = LedgerSchema.parse({
    ...base(),
    people: [
      {
        id: "driver",
        name: "নমুনা গাড়ি",
        kind: "driver",
        contactType: "transport",
        roles: ["transport"],
        workIds: ["wall"],
        quickActions: ["payment", "transport"],
      },
      {
        id: "shop",
        name: "নমুনা দোকান",
        kind: "shop",
        contactType: "supplier",
        roles: ["supplier"],
      },
    ],
  });
  const repo = await setup(initial),
    user = userEvent.setup();
  mount(
    initial,
    <HouseCostForm action="charge" />,
    "/write/charge?person=driver",
  );
  await ready();
  expect((screen.getByLabelText("কীসের বিল") as HTMLSelectElement).value).toBe(
    "transport",
  );
  expect(
    within(screen.getByLabelText("কীসের বিল")).queryByRole("option", {
      name: "মজুরি",
    }),
  ).toBeNull();
  expect((screen.getByLabelText("খাতা") as HTMLSelectElement).value).toBe(
    "wall",
  );
  expect(
    within(screen.getByLabelText("কর্মী")).queryByRole("option", {
      name: "নমুনা দোকান",
    }),
  ).toBeNull();
  expect(screen.queryByLabelText("কোন কাজের জন্য")).toBeNull();
  await user.type(screen.getByLabelText(/^কাজের বিবরণ/), "নমুনা মাল আনা");
  await user.type(screen.getByLabelText(/^বিলের টাকা [০-৯0-9]+$/), "100");
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  expect((await repo.read())!.ledger.entries).toMatchObject([
    {
      account: "other",
      personId: "driver",
      contractId: null,
      lines: [{ workId: "wall", costType: "transport", amount: 10000 }],
    },
  ]);
});

it("offers a worker's name for an explicit own-money reimbursement and records materials only", async () => {
  const initial = LedgerSchema.parse({
    ...base(),
    people: [
      {
        id: "worker",
        name: "নমুনা মিস্ত্রি",
        kind: "worker",
        contactType: "craftsperson",
        roles: ["craftsperson"],
        quickActions: ["payment"],
        workIds: ["roof"],
      },
    ],
  });
  const repo = await setup(initial),
    user = userEvent.setup();
  mount(initial, <HouseCostForm action="purchase" />, "/write/purchase");
  await ready();
  expect(
    within(screen.getByLabelText("কর্মী বা দোকান")).queryByRole("option", {
      name: "নমুনা মিস্ত্রি",
    }),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "অন্যজন দিয়েছেন" }));
  await user.selectOptions(screen.getByLabelText("কে দিয়েছেন"), "worker");
  expect((screen.getByLabelText("খাতা") as HTMLSelectElement).value).toBe(
    "roof",
  );
  await cost(user);
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  expect((await repo.read())!.ledger.entries).toMatchObject([
    {
      kind: "expense",
      account: "materials",
      personId: "worker",
      lines: [{ costType: "material" }],
    },
  ]);
  expect((await repo.read())!.ledger.entries).toHaveLength(1);
});

it("rejects saving a purchase if its contact rules changed after the form was filled", async () => {
  const initial = LedgerSchema.parse({
    ...base(),
    people: [
      {
        id: "party",
        name: "নমুনা দোকান",
        kind: "shop",
        contactType: "supplier",
        roles: ["supplier"],
        quickActions: ["purchase", "payment"],
      },
    ],
  });
  const repo = await setup(initial),
    user = userEvent.setup();
  mount(initial, <HouseCostForm action="purchase" />);
  await ready();
  await cost(user);
  api.beforeSave = (current) =>
    current
      .save(
        (ledger) => ({
          ...ledger,
          people: ledger.people.map((person) => ({
            ...person,
            quickActions: ["payment"],
          })),
        }),
        "real",
      )
      .then(() => {});
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "এই নামের নিয়মে",
  );
  expect((await repo.read())!.ledger.entries).toEqual([]);
  expect(api.close).not.toHaveBeenCalled();
  expect((screen.getByLabelText(/^মালের নাম/) as HTMLInputElement).value).toBe(
    "নমুনা কেনা মাল",
  );
});

it("honors advance intent and configured supplier account and sector when opened from a shortcut", async () => {
  const initial = LedgerSchema.parse({
    ...base(),
    people: [
      {
        id: "party",
        name: "নমুনা দোকান",
        kind: "shop",
        contactType: "supplier",
        roles: ["supplier"],
        workIds: ["wall"],
      },
    ],
  });
  const repo = await setup(initial),
    user = userEvent.setup();
  mount(
    initial,
    <HousePaymentForm />,
    "/write/payment?person=party&intent=advance",
  );
  await ready();
  expect(screen.getByRole("heading", { name: "অগ্রিম দিলাম" })).toBeTruthy();
  expect(screen.queryByLabelText("কী বাবদ")).toBeNull();
  expect((screen.getByLabelText("কোন খাতায়") as HTMLSelectElement).value).toBe(
    "wall",
  );
  await user.type(screen.getByLabelText("কত দিয়েছেন"), "100");
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  expect((await repo.read())!.ledger.entries).toMatchObject([
    {
      kind: "payment",
      account: "materials",
      paymentContext: "advance",
      allocations: [{ workId: "wall", amount: 10000 }],
    },
  ]);
});

it("requires an explicit notebook for an advance when no single associated notebook exists", async () => {
  const initial = base();
  const repo = await setup(initial);
  const user = userEvent.setup();
  mount(
    initial,
    <HousePaymentForm />,
    "/write/payment?person=party&intent=advance",
  );
  await ready();
  const notebook = screen.getByLabelText("কোন খাতায়") as HTMLSelectElement;
  expect(notebook.closest("details")).toBeNull();
  expect(notebook.value).toBe("");
  await user.type(screen.getByLabelText("কত দিয়েছেন"), "50");
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  expect(screen.getByRole("alert").textContent).toBe(
    "টাকা কোন কাজে দেওয়া হয়েছে, বেছে নিন।",
  );
  expect(notebook.getAttribute("aria-invalid")).toBe("true");
  expect(api.save).not.toHaveBeenCalled();
  expect((await repo.read())!.ledger.entries).toHaveLength(0);
  expect((await repo.read())!.ledger.works).toEqual(initial.works);
  await user.selectOptions(notebook, "roof");
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  expect((await repo.read())!.ledger.entries).toMatchObject([
    {
      kind: "payment",
      paymentContext: "advance",
      allocations: [{ workId: "roof", amount: 5000 }],
    },
  ]);
  expect((await repo.read())!.ledger.works).toEqual(initial.works);
});

it("keeps a disabled-payment deep link from saving cash", async () => {
  const initial = LedgerSchema.parse({
    ...base(),
    people: [
      {
        id: "party",
        name: "নমুনা দোকান",
        kind: "shop",
        contactType: "supplier",
        roles: ["supplier"],
        quickActions: ["purchase"],
      },
    ],
  });
  const repo = await setup(initial),
    user = userEvent.setup();
  mount(initial, <HousePaymentForm />, `${payPath}&purpose=advance`);
  await ready();
  await user.type(screen.getByLabelText("কত দিয়েছেন"), "100");
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "এই নামের নিয়মে",
  );
  expect((await repo.read())!.ledger.entries).toEqual([]);
});

it("keeps a purchase draft and attachment on reopening, then stores one cost and one cash event exactly once", async () => {
  const initial = base(),
    repo = await setup(initial),
    user = userEvent.setup();
  const first = mount(initial, <HouseCostForm action="purchase" />);
  await ready();
  await cost(user);
  await user.click(screen.getByText("ভাউচার, নোট ও তারিখ"));
  await user.upload(
    screen.getByLabelText("ভাউচার বা ছবি"),
    new File(["sample receipt"], "sample.pdf", { type: "application/pdf" }),
  );
  await waitFor(async () =>
    expect(
      await createWorkspaceStorage().readDraft(
        "house-cost:purchase:party:roof:none:none",
      ),
    ).toMatchObject({
      draft: { rows: [expect.objectContaining({ amount: "100" })] },
      files: [expect.objectContaining({ name: "sample.pdf" })],
    }),
  );
  expect((await repo.read())!.ledger.entries).toHaveLength(0);
  first.unmount();
  repo.database.close();
  await repo.database.open();
  mount((await repo.read())!.ledger, <HouseCostForm action="purchase" />);
  await ready();
  expect((screen.getByLabelText(/^মালের নাম/) as HTMLInputElement).value).toBe(
    "নমুনা কেনা মাল",
  );
  expect(screen.getByText("sample.pdf")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  const saved = (await repo.read())!.ledger;
  expect(saved.entries).toHaveLength(2);
  expect(summarize(saved)).toMatchObject({
    cost: 10000,
    netPaid: 10000,
    reconciledPayable: 0,
  });
  expect(partyLedger(saved, "party").billOutstanding).toBe(0);
  expect(
    saved.entries.find((entry) => entry.kind === "expense")?.receipts,
  ).toHaveLength(1);
  expect(
    (await repo.getReceipt(saved.entries[0].receipts[0].id))!.blob.size,
  ).toBe(14);
});

it("combines an existing advance and new partial cash on a purchase without counting either as another expense", async () => {
  const initial = LedgerSchema.parse({ ...base(), entries: [advance()] }),
    repo = await setup(initial),
    user = userEvent.setup();
  mount(initial, <HouseCostForm action="purchase" />);
  await ready();
  await cost(user, "100");
  await user.click(screen.getByRole("checkbox", { name: /আগে দেওয়া অগ্রিম/ }));
  await user.click(screen.getByRole("button", { name: "কিছু দিয়েছি" }));
  await user.type(screen.getByLabelText("এখন কত দিয়েছি"), "20");
  const preview = screen.getByRole("region", { name: "হিসাবের সারাংশ" });
  expect(preview.textContent).toContain("৩০");
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  const saved = (await repo.read())!.ledger;
  expect(saved.entries).toHaveLength(3);
  expect(summarize(saved)).toMatchObject({
    cost: 10000,
    netPaid: 7000,
    reconciledPayable: 3000,
  });
  expect(partyLedger(saved, "party")).toMatchObject({
    billOutstanding: 3000,
    advance: 0,
  });
});

it("records another person's materials as reimbursement owed without inventing wages or owner cash", async () => {
  const initial = base(),
    repo = await setup(initial),
    user = userEvent.setup();
  mount(initial, <HouseCostForm action="purchase" />);
  await ready();
  await cost(user, "100");
  await user.click(screen.getByRole("button", { name: "অন্যজন দিয়েছেন" }));
  await user.selectOptions(screen.getByLabelText("কে দিয়েছেন"), "party");
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  const saved = (await repo.read())!.ledger;
  expect(saved.entries).toHaveLength(1);
  expect(saved.entries[0]).toMatchObject({
    kind: "expense",
    account: "materials",
    personId: "party",
  });
  expect(summarize(saved)).toMatchObject({
    cost: 10000,
    netPaid: 0,
    reconciledPayable: 10000,
  });
});

it("shows a combined payment proposal and saves the selected bills without creating a second cost", async () => {
  const initial = withBills(),
    repo = await setup(initial),
    user = userEvent.setup();
  mount(initial, <HousePaymentForm />, payPath);
  await ready();
  await user.type(screen.getByLabelText("কত দিয়েছেন"), "150");
  expect(screen.queryByRole("region", { name: "হিসাবের সারাংশ" })).toBeNull();
  expect(screen.queryByText("এখন টাকা গেছে")).toBeNull();
  expect(
    screen.getByRole("status", { name: "টাকা দেওয়ার পরে" }).textContent,
  ).toContain("বাকি থাকবে");
  await user.click(screen.getByText("কোন বিলে কত যাবে"));
  expect(screen.getByText("নমুনা পুরোনো বিল")).toBeTruthy();
  expect(screen.getByText("নমুনা পরের বিল")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  repo.database.close();
  await repo.database.open();
  const saved = (await repo.read())!.ledger;
  expect(saved.entries).toHaveLength(3);
  expect(saved.paymentAllocations).toHaveLength(2);
  expect(summarize(saved)).toMatchObject({
    cost: 30000,
    netPaid: 15000,
    reconciledPayable: 15000,
  });
});

it("restores a modified bill settlement draft independently of ordinary cash drafts and reopens its remaining due", async () => {
  const initial = withBills();
  const repo = await setup(initial);
  const user = userEvent.setup();
  const storage = createWorkspaceStorage();
  const ordinaryKey = "house-payment:party:roof:none";
  let page = mount(initial, <HousePaymentForm />, `${payPath}&contract=none`);
  await ready();
  await user.type(screen.getByLabelText("কত দিয়েছেন"), "33");
  let ordinaryDraft: unknown;
  await waitFor(async () => {
    ordinaryDraft = await storage.readDraft(ordinaryKey);
    expect(ordinaryDraft).toMatchObject({ amount: "33", billId: "" });
  });
  page.unmount();
  const due = partyDueItems(initial, "party").find(
    (row) => row.billId === "later",
  )!;
  expect(due.amount).toBe(20000);
  const back = "/parties/party?work=roof";
  const path = partyDuePaymentUrl(due, back);
  const query = new URL(path, "https://bari.invalid").searchParams;
  expect(Object.fromEntries(query)).toMatchObject({
    person: "party",
    work: "roof",
    account: "materials",
    contract: "none",
    amount: "20000",
    bill: "later",
    purpose: "settle",
    back,
  });
  page = mount(initial, <HousePaymentForm />, path);
  await ready();
  const amount = screen.getByLabelText("কত দিয়েছেন") as HTMLInputElement;
  expect(latinDigits(amount.value)).toBe("200");
  expect(
    (screen.getByLabelText("কাকে দিয়েছেন") as HTMLSelectElement).value,
  ).toBe("party");
  expect((screen.getByLabelText("কোন খাতায়") as HTMLSelectElement).value).toBe(
    "roof",
  );
  fireEvent.change(amount, { target: { value: "75" } });
  await user.click(
    within(screen.getByRole("group", { name: "কীভাবে দিয়েছেন" })).getByRole(
      "button",
      { name: "ব্যাংক" },
    ),
  );
  const key = "house-payment:party:roof:none:due:materials:later";
  await waitFor(async () =>
    expect(await storage.readDraft(key)).toMatchObject({
      amount: "75",
      billId: "later",
      contractId: "",
      method: "bank",
    }),
  );
  page.unmount();
  repo.database.close();
  await repo.database.open();
  page = mount((await repo.read())!.ledger, <HousePaymentForm />, path);
  await ready();
  expect(
    latinDigits(
      (screen.getByLabelText("কত দিয়েছেন") as HTMLInputElement).value,
    ),
  ).toBe("75");
  expect(
    screen.getByRole("button", { name: "ব্যাংক", pressed: true }),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  page.unmount();
  repo.database.close();
  await repo.database.open();
  const saved = (await repo.read())!.ledger;
  expect(saved.entries.filter((entry) => entry.kind === "expense")).toEqual(
    initial.entries,
  );
  expect(
    saved.entries.filter((entry) => entry.kind === "payment"),
  ).toMatchObject([
    {
      personId: "party",
      contractId: null,
      account: "materials",
      paymentParts: [{ method: "bank", amount: 7500 }],
    },
  ]);
  expect(saved.paymentAllocations).toMatchObject([
    { billId: "later", workId: "roof", amount: 7500 },
  ]);
  expect(summarize(saved)).toMatchObject({
    cost: 30000,
    cashPaid: 7500,
    reconciledPayable: 22500,
  });
  expect(await storage.readDraft(key)).toBeNull();
  expect(await storage.readDraft(ordinaryKey)).toEqual(ordinaryDraft);
  const remaining = partyDueItems(saved, "party").find(
    (row) => row.billId === "later",
  )!;
  expect(remaining.amount).toBe(12500);
  mount(saved, <HousePaymentForm />, partyDuePaymentUrl(remaining, back));
  await ready();
  expect(
    latinDigits(
      (screen.getByLabelText("কত দিয়েছেন") as HTMLInputElement).value,
    ),
  ).toBe("125");
  expect(api.save).toHaveBeenCalledOnce();
  expect((await repo.read())!.ledger.entries).toHaveLength(3);
});

it("rejects paying more than the selected bill's due even when the same person has other unpaid bills", async () => {
  const initial = withBills();
  const repo = await setup(initial);
  const user = userEvent.setup();
  const due = partyDueItems(initial, "party").find(
    (row) => row.billId === "old",
  )!;
  mount(initial, <HousePaymentForm />, partyDuePaymentUrl(due, "/dues"));
  await ready();
  const amount = screen.getByLabelText("কত দিয়েছেন") as HTMLInputElement;
  expect(latinDigits(amount.value)).toBe("100");
  fireEvent.change(amount, { target: { value: "150" } });
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  expect(screen.getByRole("alert").textContent).toBe(
    "এই বাকির চেয়ে বেশি টাকা লিখেছেন। অঙ্কটি কমিয়ে দিন।",
  );
  expect(amount.getAttribute("aria-invalid")).toBe("true");
  expect(api.save).not.toHaveBeenCalled();
  expect((await repo.read())!.ledger.entries).toEqual(initial.entries);
  expect((await repo.read())!.ledger.paymentAllocations).toHaveLength(0);
  expect(latinDigits(amount.value)).toBe("150");
  fireEvent.change(amount, { target: { value: "100" } });
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  const saved = (await repo.read())!.ledger;
  expect(saved.entries.filter((entry) => entry.kind === "expense")).toEqual(
    initial.entries,
  );
  expect(saved.paymentAllocations).toMatchObject([
    { billId: "old", amount: 10000 },
  ]);
  expect(summarize(saved)).toMatchObject({
    cost: 30000,
    cashPaid: 10000,
    reconciledPayable: 20000,
  });
});

it("rechecks a selected due inside the save when concurrent work corrections leave the payment signature unchanged", async () => {
  const bills = LedgerSchema.parse({
    ...base(),
    entries: [
      {
        id: "roof-bill",
        kind: "expense",
        personId: "party",
        account: "materials",
        lines: [
          {
            id: "roof-line",
            workId: "roof",
            label: "নমুনা ছাদের বিল",
            amount: 10000,
          },
        ],
      },
      {
        id: "wall-bill",
        kind: "expense",
        personId: "party",
        account: "materials",
        lines: [
          {
            id: "wall-line",
            workId: "wall",
            label: "নমুনা দেয়ালের বিল",
            amount: 10000,
          },
        ],
      },
    ],
  });
  const correct = (
    ledger: Ledger,
    workId: string,
    before: number,
    after: number,
  ) =>
    appendBalanceAdjustment(ledger, {
      target: "person",
      personId: "party",
      account: "materials",
      workId,
      basis: "balance",
      expectedBefore: before,
      after,
      reason: "নমুনা খাতার বাকি ঠিক করা",
      date: "2026-11-05",
    });
  const initial = correct(
    correct(bills, "roof", 10000, 5000),
    "wall",
    10000,
    15000,
  );
  const scope = { workId: "roof", account: "materials" as const };
  const due = partyDueItems(initial, "party", scope)[0];
  expect(due.amount).toBe(5000);
  const request = {
    personId: "party",
    amount: 5000,
    intent: "payment" as const,
    workId: "roof",
    account: "materials" as const,
    contractId: null,
    allocations: due.billId
      ? [{ billId: due.billId, workId: "roof", amount: 5000 }]
      : [],
  };
  const beforePlan = planHousePayment(initial, request);
  expect(beforePlan.issues).toEqual([]);
  const repo = await setup(initial);
  const user = userEvent.setup();
  mount(
    initial,
    <HousePaymentForm />,
    partyDuePaymentUrl(due, "/dues?person=party&work=roof", scope),
  );
  await ready();
  const amount = screen.getByLabelText("কত দিয়েছেন") as HTMLInputElement;
  expect(latinDigits(amount.value)).toBe("50");
  let concurrent: Ledger | undefined;
  api.beforeSave = async (current) => {
    await current.save((ledger) => {
      concurrent = correct(
        correct(ledger, "roof", 5000, 3000),
        "wall",
        15000,
        17000,
      );
      return concurrent;
    });
  };
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "এই বাকির চেয়ে বেশি টাকা লিখেছেন। অঙ্কটি কমিয়ে দিন।",
  );
  const afterPlan = planHousePayment(concurrent!, request);
  expect(afterPlan.issues).toEqual([]);
  expect(afterPlan.signature).toBe(beforePlan.signature);
  expect(partyLedger(concurrent!, "party").payable).toBe(
    partyLedger(initial, "party").payable,
  );
  expect(
    partyDueItems(concurrent!, "party", scope).reduce(
      (sum, row) => sum + row.amount,
      0,
    ),
  ).toBe(3000);
  expect((await repo.read())!.ledger.entries).toEqual(concurrent!.entries);
  expect(
    (await repo.read())!.ledger.entries.some(
      (entry) => entry.kind === "payment",
    ),
  ).toBe(false);
  expect((await repo.read())!.ledger.paymentAllocations).toHaveLength(0);
  expect(latinDigits(amount.value)).toBe("50");
  expect(api.close).not.toHaveBeenCalled();
  fireEvent.change(amount, { target: { value: "30" } });
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  repo.database.close();
  await repo.database.open();
  const saved = (await repo.read())!.ledger;
  expect(saved.entries.filter((entry) => entry.kind === "expense")).toEqual(
    bills.entries,
  );
  expect(
    saved.entries.filter((entry) => entry.kind === "payment"),
  ).toMatchObject([
    {
      paymentParts: [{ amount: 3000 }],
      allocations: [{ workId: "roof", amount: 3000 }],
    },
  ]);
  expect(summarize(saved)).toMatchObject({
    cost: 20000,
    cashPaid: 3000,
    reconciledPayable: 17000,
  });
  expect(partyDueItems(saved, "party", scope)).toHaveLength(0);
  expect(
    partyDueItems(saved, "party", {
      workId: "wall",
      account: "materials",
    }).reduce((sum, row) => sum + row.amount, 0),
  ).toBe(17000);
});

it("saves ordinary cash above the known bills without relabeling the extra amount as an explicit advance", async () => {
  const initial = withBills();
  const repo = await setup(initial);
  const user = userEvent.setup();
  mount(initial, <HousePaymentForm />, payPath);
  await ready();
  await user.type(screen.getByLabelText("কত দিয়েছেন"), "350");
  expect(
    screen.queryByRole("button", { name: /বাড়তি .*অগ্রিম রাখি/ }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: /বিলের বাইরে .*টাকাও রাখি/ }),
  ).toBeNull();
  expect(
    screen.getByRole("status", { name: "টাকা দেওয়ার পরে" }).textContent,
  ).not.toContain("অগ্রিম");
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  const saved = (await repo.read())!.ledger;
  expect(saved.entries.filter((entry) => entry.kind === "expense")).toEqual(
    initial.entries,
  );
  expect(
    saved.entries.filter((entry) => entry.kind === "payment"),
  ).toMatchObject([
    { paymentContext: "settlement", paymentParts: [{ amount: 35000 }] },
  ]);
  expect(
    saved.paymentAllocations?.reduce(
      (sum, allocation) => sum + allocation.amount,
      0,
    ),
  ).toBe(30000);
  expect(summarize(saved)).toMatchObject({
    cost: 30000,
    cashPaid: 35000,
    reconciledPayable: 0,
  });
  expect(partyLedger(saved, "party")).toMatchObject({
    explicitAdvance: 0,
    legacyUnclassifiedCredit: 0,
    ordinaryUnallocatedCash: 5000,
  });
});

it("requires explicit acknowledgment before keeping excess cash as advance", async () => {
  const initial = withBills(),
    repo = await setup(initial),
    user = userEvent.setup();
  mount(initial, <HousePaymentForm />, `${payPath}&intent=settlement`);
  await ready();
  await user.type(screen.getByLabelText("কত দিয়েছেন"), "350");
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "নিশ্চিত করুন",
  );
  expect((await repo.read())!.ledger.entries).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: /বাড়তি .*অগ্রিম রাখি/ }));
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  expect(partyLedger((await repo.read())!.ledger, "party")).toMatchObject({
    payable: 0,
    advance: 5000,
  });
});

it("confirms only the canonical advance when a marked balance correction is also being paid", async () => {
  const source = withBills();
  const original = LedgerSchema.parse({
    ...source,
    entries: [source.entries[0]],
  });
  const initial = appendBalanceAdjustment(
    original,
    {
      target: "person",
      personId: "party",
      account: "materials",
      workId: "roof",
      basis: "balance",
      expectedBefore: 10000,
      after: 15000,
      reason: "নমুনা পুরোনো পাওনা ঠিক করা",
      date: "2026-11-04",
    },
    "2026-11-04T08:00:00.000Z",
  );
  expect(initial.entries.at(-1)?.adjustment?.calculationVersion).toBe(2);
  expect(
    planHousePayment(initial, {
      personId: "party",
      workId: "roof",
      account: "materials",
      amount: 20000,
      intent: "settlement",
    }).remainder,
  ).toBe(10000);
  const repo = await setup(initial);
  const user = userEvent.setup();
  mount(initial, <HousePaymentForm />, `${payPath}&intent=settlement`);
  await ready();
  expect(latinDigits(screen.getByText(/^মোট বাকি /).textContent ?? "")).toMatch(
    /৳\s*150/,
  );
  await user.type(screen.getByLabelText("কত দিয়েছেন"), "200");
  const confirmation = screen.getByRole("button", {
    name: /বাড়তি .*অগ্রিম রাখি/,
  });
  expect(latinDigits(confirmation.textContent ?? "")).toMatch(/৳\s*50/);
  expect(latinDigits(confirmation.textContent ?? "")).not.toMatch(/৳\s*100/);
  expect(screen.queryByRole("status", { name: "টাকা দেওয়ার পরে" })).toBeNull();
  await user.click(confirmation);
  const outcome = screen.getByRole("status", { name: "টাকা দেওয়ার পরে" });
  expect(latinDigits(outcome.textContent ?? "")).toMatch(/বাকি থাকবে\s+৳\s*0/);
  expect(latinDigits(outcome.textContent ?? "")).toMatch(/অগ্রিম\s+৳\s*50/);
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  repo.database.close();
  await repo.database.open();
  const saved = (await repo.read())!.ledger;
  expect(summarize(saved)).toMatchObject({
    cost: 10000,
    netPaid: 20000,
    reconciledPayable: 0,
    reconciledAdvance: 5000,
  });
  expect(saved.entries.filter((entry) => entry.kind === "expense")).toEqual(
    original.entries,
  );
  expect(saved.entries.find((entry) => entry.kind === "adjustment")).toEqual(
    initial.entries.at(-1),
  );
});

it("rejects a stale proposal atomically and requires a fresh acknowledgment of its new remainder", async () => {
  const initial = withBills(),
    repo = await setup(initial),
    user = userEvent.setup();
  mount(initial, <HousePaymentForm />, `${payPath}&intent=settlement`);
  await ready();
  await user.type(screen.getByLabelText("কত দিয়েছেন"), "350");
  await user.click(screen.getByRole("button", { name: /বাড়তি .*অগ্রিম রাখি/ }));
  api.beforeSave = async (current) => {
    const { recordHousePayment, planHousePayment } =
      await import("../../domain/housePayments");
    await current.save((ledger) =>
      recordHousePayment(
        ledger,
        {
          id: "external",
          personId: "party",
          amount: 10000,
          intent: "settlement",
          workId: "roof",
          account: "materials",
          date: "2026-11-05",
          method: "cash",
        },
        planHousePayment(ledger, {
          personId: "party",
          amount: 10000,
          intent: "settlement",
          workId: "roof",
          account: "materials",
        }),
      ),
    );
  };
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect((await repo.read())!.ledger.entries).toHaveLength(3);
  expect(api.close).not.toHaveBeenCalled();
  const acknowledgment = screen.getByRole("button", {
    name: /বাড়তি .*অগ্রিম রাখি/,
  });
  expect(acknowledgment.getAttribute("aria-pressed")).toBe("false");
  await user.click(acknowledgment);
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  expect(partyLedger((await repo.read())!.ledger, "party")).toMatchObject({
    payable: 0,
    advance: 15000,
  });
});

it("does not silently drop an invalid custom allocation or keep a stale advance acknowledgment after a split edit", async () => {
  const initial = withBills(),
    repo = await setup(initial),
    user = userEvent.setup();
  mount(initial, <HousePaymentForm />, `${payPath}&intent=settlement`);
  await ready();
  await user.type(screen.getByLabelText("কত দিয়েছেন"), "350");
  await user.click(screen.getByRole("button", { name: /বাড়তি .*অগ্রিম রাখি/ }));
  await user.click(screen.getByText("কোন বিলে কত যাবে"));
  await user.click(screen.getByRole("button", { name: "বদলাই" }));
  const input = screen.getByLabelText("এই বিলে দিচ্ছি: নমুনা পুরোনো বিল");
  fireEvent.change(input, {
    target: { value: "1000000000000000000000000000000000000000" },
  });
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "অঙ্ক লিখুন",
  );
  expect((await repo.read())!.ledger.entries).toHaveLength(2);
  const acknowledgment = screen.queryByRole("button", {
    name: /বাড়তি .*অগ্রিম রাখি/,
  });
  expect(acknowledgment?.getAttribute("aria-pressed") ?? "false").toBe("false");
  await waitFor(async () =>
    expect(
      await createWorkspaceStorage().readDraft("house-payment:party:roof:all"),
    ).toMatchObject({
      confirmRemainderAdvance: false,
      confirmRemainderSignature: "",
    }),
  );
});

it("adds a new neutral recipient inline when other contacts already exist", async () => {
  const initial = base(),
    repo = await setup(initial),
    user = userEvent.setup();
  mount(initial, <HousePaymentForm />, `${payPath}&intent=advance`);
  await ready();
  await user.selectOptions(screen.getByLabelText("কাকে দিয়েছেন"), "__new__");
  await user.type(screen.getByLabelText("নতুন নাম"), "নমুনা নতুন মানুষ");
  await user.type(screen.getByLabelText("কত দিয়েছেন"), "50");
  await user.selectOptions(screen.getByLabelText("কী বাবদ"), "materials");
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  const saved = (await repo.read())!.ledger;
  expect(saved.people).toHaveLength(2);
  expect(saved.people[1]).toMatchObject({
    name: "নমুনা নতুন মানুষ",
    roles: [],
    kind: "other",
  });
  expect(saved.entries[0]).toMatchObject({
    personId: saved.people[1].id,
    paymentContext: "advance",
  });
});

it.each(["purchase", "payment"] as const)(
  "recognizes an already saved %s draft and starts a new record with fresh IDs instead of replaying money",
  async (action) => {
    const initial = action === "payment" ? withBills() : base(),
      repo = await setup(initial),
      user = userEvent.setup();
    const first = mount(
      initial,
      action === "payment" ? (
        <HousePaymentForm />
      ) : (
        <HouseCostForm action="purchase" />
      ),
      action === "payment" ? payPath : undefined,
    );
    await ready();
    if (action === "payment")
      await user.type(screen.getByLabelText("কত দিয়েছেন"), "50");
    else await cost(user, "50");
    const key =
      action === "payment"
        ? "house-payment:party:roof:all"
        : "house-cost:purchase:party:roof:none:none";
    let stale: unknown;
    await waitFor(async () => {
      stale = await createWorkspaceStorage().readDraft(key);
      expect(stale).toBeTruthy();
    });
    await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
    await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
    const saved = (await repo.read())!.ledger;
    first.unmount();
    await createWorkspaceStorage().saveDraft(key, stale);
    api.save.mockClear();
    mount(
      saved,
      action === "payment" ? (
        <HousePaymentForm />
      ) : (
        <HouseCostForm action="purchase" />
      ),
      action === "payment" ? payPath : undefined,
    );
    expect(await screen.findByText("এই হিসাব আগেই রাখা হয়েছে।")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "হিসাব রাখুন" })).toBeNull();
    expect(api.save).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "নতুন হিসাব লিখি" }));
    await ready();
    expect(
      (
        screen.getByLabelText(
          action === "payment" ? "কত দিয়েছেন" : /^মালের দাম [০-৯0-9]+$/,
        ) as HTMLInputElement
      ).value,
    ).toBe("");
    expect((await repo.read())!.ledger.entries).toHaveLength(
      saved.entries.length,
    );
  },
);

it("requires a new choice when a checked advance proposal changes before a purchase is saved", async () => {
  const initial = LedgerSchema.parse({
      ...base(),
      entries: [advance("first", 5000)],
    }),
    repo = await setup(initial),
    user = userEvent.setup();
  mount(initial, <HouseCostForm action="purchase" />);
  await ready();
  await cost(user, "100");
  await user.click(screen.getByRole("checkbox", { name: /আগে দেওয়া অগ্রিম/ }));
  await repo.save((current) =>
    LedgerSchema.parse({
      ...current,
      entries: [...current.entries, advance("extra", 2000)],
    }),
  );
  await act(async () => api.publish?.((await repo.read())!.ledger));
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "অগ্রিম বদলেছে",
  );
  expect((await repo.read())!.ledger.entries).toHaveLength(2);
  await user.click(screen.getByRole("checkbox", { name: /আগে দেওয়া অগ্রিম/ }));
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  expect(summarize((await repo.read())!.ledger)).toMatchObject({
    cost: 10000,
    netPaid: 10000,
    reconciledPayable: 0,
  });
});

it("accepts the review of earlier unassigned cash without recursively clearing its own acknowledgment", async () => {
  const initial = LedgerSchema.parse({
    ...withBills(),
    entries: [
      ...withBills().entries,
      {
        id: "legacy-cash",
        kind: "payment",
        personId: "party",
        allocations: [{ workId: "roof", amount: 2000 }],
        paymentParts: [{ amount: 2000 }],
      },
    ],
  });
  const repo = await setup(initial);
  const user = userEvent.setup();
  mount(initial, <HousePaymentForm />, `${payPath}&intent=settlement`);
  await ready();
  await user.type(screen.getByLabelText("কত দিয়েছেন"), "100");
  const acknowledgment = screen.getByRole("checkbox", {
    name: /এটি নতুন করে দেওয়া টাকা/,
  }) as HTMLInputElement;
  await user.click(acknowledgment);
  await waitFor(() => expect(acknowledgment.checked).toBe(true));
  await waitFor(async () =>
    expect(
      await createWorkspaceStorage().readDraft("house-payment:party:roof:all"),
    ).toMatchObject({
      confirmUnallocatedCash: true,
      confirmCashSignature: expect.any(String),
    }),
  );
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  const saved = (await repo.read())!.ledger;
  expect(saved.entries).toHaveLength(initial.entries.length + 1);
  expect(saved.entries.find((entry) => entry.id === "legacy-cash")).toEqual(
    initial.entries.at(-1),
  );
  expect(summarize(saved)).toMatchObject({
    cost: 30000,
    netPaid: 12000,
    reconciledPayable: 18000,
  });
});

it("keeps invalid payment drafts and focuses Bengali field errors on every attempt", async () => {
  const initial = withBills(),
    repo = await setup(initial),
    user = userEvent.setup();
  mount(initial, <HousePaymentForm />, payPath);
  await ready();
  const saveButton = screen.getByRole("button", { name: "হিসাব রাখুন" });
  await user.click(saveButton);
  let alert = screen.getByRole("alert");
  expect(alert.textContent).toBe("সঠিক টাকার অঙ্ক দিন।");
  expect(document.activeElement).toBe(alert);
  const amountField = screen.getByLabelText("কত দিয়েছেন");
  expect(amountField.getAttribute("aria-invalid")).toBe("true");
  await user.click(amountField);
  await user.click(saveButton);
  expect(document.activeElement).toBe(screen.getByRole("alert"));
  await user.type(amountField, "50");
  await user.click(screen.getByText("ভাউচার, নোট ও তারিখ"));
  await user.clear(screen.getByLabelText("তারিখ"));
  await user.click(saveButton);
  alert = screen.getByRole("alert");
  expect(alert.textContent).toBe("সঠিক তারিখ বেছে নিন।");
  expect(document.activeElement).toBe(alert);
  expect(screen.getByLabelText("তারিখ").getAttribute("aria-invalid")).toBe(
    "true",
  );
  expect(api.save).not.toHaveBeenCalled();
  expect((await repo.read())!.ledger.entries).toHaveLength(
    initial.entries.length,
  );
});

it("keeps a malformed inline worker draft recoverable instead of crashing the payment form", async () => {
  const initial = withBills(),
    repo = await setup(initial),
    user = userEvent.setup();
  const first = mount(initial, <HousePaymentForm />, payPath);
  await ready();
  await user.selectOptions(screen.getByLabelText("কাকে দিয়েছেন"), "__new__");
  await user.type(screen.getByLabelText("নতুন নাম"), "নমুনা কর্মী");
  await user.type(screen.getByLabelText("কত দিয়েছেন"), "50");
  const storage = createWorkspaceStorage();
  const key = "house-payment:party:roof:all";
  let saved: Record<string, unknown> | null = null;
  await waitFor(async () => {
    saved = (await storage.readDraft(key)) as Record<string, unknown>;
    expect(saved?.amount).toBe("50");
  });
  first.unmount();
  await storage.saveDraft(key, { ...saved!, newPersonId: " " });
  mount(initial, <HousePaymentForm />, payPath);
  await ready();
  expect((screen.getByLabelText("নতুন নাম") as HTMLInputElement).value).toBe(
    "নমুনা কর্মী",
  );
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  expect(screen.getByRole("alert").textContent).toBe(
    "যাঁকে টাকা দিয়েছেন, তাঁর নাম বেছে নিন।",
  );
  expect(api.save).not.toHaveBeenCalled();
  expect((await repo.read())!.ledger.entries).toHaveLength(
    initial.entries.length,
  );
  expect(await storage.readDraft(key)).toMatchObject({
    personName: "নমুনা কর্মী",
    amount: "50",
    newPersonId: " ",
  });
});

it("keeps the icon payment method and folded voucher, note and date across reopening", async () => {
  const initial = withBills(),
    repo = await setup(initial),
    user = userEvent.setup();
  const first = mount(initial, <HousePaymentForm />, payPath);
  await ready();
  const methods = screen.getByRole("group", { name: "কীভাবে দিয়েছেন" });
  await user.click(within(methods).getByRole("button", { name: "ব্যাংক" }));
  expect(
    within(methods)
      .getByRole("button", { name: "ব্যাংক" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    within(methods)
      .getByRole("button", { name: "ক্যাশ" })
      .getAttribute("aria-pressed"),
  ).toBe("false");
  const fold = screen.getByText("ভাউচার, নোট ও তারিখ").closest("details")!;
  expect(fold.open).toBe(false);
  expect(screen.getByLabelText("ভাউচার বা ছবি").closest("details")).toBe(fold);
  await user.type(screen.getByLabelText("কত দিয়েছেন"), "50");
  await user.click(screen.getByText("ভাউচার, নোট ও তারিখ"));
  await user.type(screen.getByLabelText("বাড়তি কথা"), "নমুনা ব্যাংক হিসাব");
  await user.upload(
    screen.getByLabelText("ভাউচার বা ছবি"),
    new File(["sample receipt"], "sample-bank.pdf", {
      type: "application/pdf",
    }),
  );
  await waitFor(async () =>
    expect(
      await createWorkspaceStorage().readDraft("house-payment:party:roof:all"),
    ).toMatchObject({
      method: "bank",
      amount: "50",
      note: "নমুনা ব্যাংক হিসাব",
      files: [expect.objectContaining({ name: "sample-bank.pdf" })],
    }),
  );
  first.unmount();
  mount(initial, <HousePaymentForm />, payPath);
  await ready();
  expect(
    screen.getByRole("button", { name: "ব্যাংক" }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.getByText("ভাউচার, নোট ও তারিখ").closest("details")!.open).toBe(
    false,
  );
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  const saved = (await repo.read())!.ledger;
  const payment = saved.entries.find((entry) => entry.kind === "payment")!;
  expect(payment).toMatchObject({
    note: "নমুনা ব্যাংক হিসাব",
    paymentParts: [{ method: "bank", amount: 5000 }],
    receipts: [expect.objectContaining({ name: "sample-bank.pdf" })],
  });
  expect(
    (await repo.getReceipt(payment.receipts[0].id))?.blob.size,
  ).toBeGreaterThan(0);
});

it("requires explicit ordinary payment intent before saving an old deposit draft", async () => {
  const initial = withBills(),
    repo = await setup(initial),
    user = userEvent.setup();
  mount(initial, <HousePaymentForm />, `${payPath}&intent=receivable`);
  await ready();
  expect(screen.queryByRole("button", { name: /জামানত/ })).toBeNull();
  await user.type(screen.getByLabelText("কত দিয়েছেন"), "50");
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  expect(screen.getByRole("alert").textContent).toBe(
    "টাকা দেওয়ার ধরন বেছে নিন।",
  );
  expect(api.save).not.toHaveBeenCalled();
  await waitFor(async () =>
    expect(
      await createWorkspaceStorage().readDraft(
        "house-payment:party:roof:all:receivable",
      ),
    ).toMatchObject({ intent: "receivable", amount: "50" }),
  );
  await user.click(screen.getByRole("button", { name: "টাকা দিলাম" }));
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  const saved = (await repo.read())!.ledger;
  expect(
    saved.entries.find((entry) => entry.kind === "payment")?.paymentContext,
  ).toBe("settlement");
  expect(summarize(saved)).toMatchObject({
    cost: 30000,
    netPaid: 5000,
    reconciledPayable: 25000,
  });
});
