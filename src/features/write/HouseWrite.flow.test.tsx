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
    go: vi.fn(),
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
  await user.selectOptions(screen.getByLabelText("কর্মী বা দোকান"), "worker");
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
  expect(
    screen
      .getByRole("button", { name: "অগ্রিম — আগে টাকা দিলাম" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
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
  const preview = screen.getByRole("region", { name: "হিসাবের সারাংশ" });
  await user.click(within(preview).getByText("বিলের বিস্তারিত"));
  expect(within(preview).getByText("নমুনা পুরোনো বিল")).toBeTruthy();
  expect(within(preview).getByText("নমুনা পরের বিল")).toBeTruthy();
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

it("requires explicit acknowledgment before keeping excess cash as advance", async () => {
  const initial = withBills(),
    repo = await setup(initial),
    user = userEvent.setup();
  mount(initial, <HousePaymentForm />, payPath);
  await ready();
  await user.type(screen.getByLabelText("কত দিয়েছেন"), "350");
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "নিশ্চিত করুন",
  );
  expect((await repo.read())!.ledger.entries).toHaveLength(2);
  await user.click(
    screen.getByRole("checkbox", { name: /বাড়তি .*অগ্রিম হিসেবে রাখি/ }),
  );
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  expect(partyLedger((await repo.read())!.ledger, "party")).toMatchObject({
    payable: 0,
    advance: 5000,
  });
});

it("rejects a stale proposal atomically and requires a fresh acknowledgment of its new remainder", async () => {
  const initial = withBills(),
    repo = await setup(initial),
    user = userEvent.setup();
  mount(initial, <HousePaymentForm />, payPath);
  await ready();
  await user.type(screen.getByLabelText("কত দিয়েছেন"), "350");
  await user.click(
    screen.getByRole("checkbox", { name: /বাড়তি .*অগ্রিম হিসেবে রাখি/ }),
  );
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
  const acknowledgment = screen.getByRole("checkbox", {
    name: /বাড়তি .*অগ্রিম হিসেবে রাখি/,
  }) as HTMLInputElement;
  expect(acknowledgment.checked).toBe(false);
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
  mount(initial, <HousePaymentForm />, payPath);
  await ready();
  await user.type(screen.getByLabelText("কত দিয়েছেন"), "350");
  await user.click(
    screen.getByRole("checkbox", { name: /বাড়তি .*অগ্রিম হিসেবে রাখি/ }),
  );
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
  expect(
    (
      screen.getByRole("checkbox", {
        name: /বাড়তি .*অগ্রিম হিসেবে রাখি/,
      }) as HTMLInputElement
    ).checked,
  ).toBe(false);
});

it("adds a new neutral recipient inline when other contacts already exist", async () => {
  const initial = base(),
    repo = await setup(initial),
    user = userEvent.setup();
  mount(initial, <HousePaymentForm />, payPath);
  await ready();
  await user.selectOptions(screen.getByLabelText("কাকে দিয়েছেন"), "__new__");
  await user.type(screen.getByLabelText("নতুন নাম"), "নমুনা নতুন মানুষ");
  await user.type(screen.getByLabelText("কত দিয়েছেন"), "50");
  await user.click(
    screen.getByRole("button", { name: "অগ্রিম — আগে টাকা দিলাম" }),
  );
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
  mount(initial, <HousePaymentForm />, payPath);
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
  await user.click(screen.getByText("তারিখ ও নোট"));
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
