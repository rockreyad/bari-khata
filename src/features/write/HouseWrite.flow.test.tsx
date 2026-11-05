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
import { HouseCostForm } from "./HouseCostForm";
import { HousePaymentForm } from "./HousePaymentForm";

const nativeFiles = await vi.hoisted(async () => {
  const { Blob, File } = await import("node:buffer");
  vi.stubGlobal("Blob", Blob);
  vi.stubGlobal("File", File);
  return { Blob, File };
});
beforeEach(() => {
  vi.stubGlobal("Blob", nativeFiles.Blob);
  vi.stubGlobal("File", nativeFiles.File);
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
  await user.type(screen.getByLabelText(/^টাকা [০-৯0-9]+$/), amount);
}
const payPath = "/write/payment?person=party&work=roof&account=materials";

it("keeps a purchase draft and attachment on reopening, then stores one cost and one cash event exactly once", async () => {
  const initial = base(),
    repo = await setup(initial),
    user = userEvent.setup();
  const first = mount(initial, <HouseCostForm action="purchase" />);
  await ready();
  await cost(user);
  await user.click(screen.getByText("তারিখ, ভাউচার ও বাড়তি কথা"));
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
  await user.selectOptions(screen.getByLabelText("টাকা মিটিয়েছেন?"), "partial");
  await user.type(screen.getByLabelText("এখন কত দিয়েছি"), "20");
  const preview = screen.getByRole("region", { name: "রাখলে যা হবে" });
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
  await user.selectOptions(screen.getByLabelText("টাকা মিটিয়েছেন?"), "worker");
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
  const preview = screen.getByRole("region", { name: "রাখলে যা হবে" });
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
  await user.selectOptions(
    screen.getByLabelText("টাকা দেওয়ার কারণ"),
    "advance",
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
          action === "payment" ? "কত দিয়েছেন" : /^টাকা [০-৯0-9]+$/,
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
