// @vitest-environment jsdom
import "fake-indexeddb/auto";
import {
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
  type InputHTMLAttributes,
} from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  type LedgerRepository,
} from "../../data/repository";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { summarize } from "../../domain/ledger";
import { savePreferences } from "../../lib/preferences";
import { QuickDraftSchema } from "../entries/quickEntry";
import { HouseCostForm } from "./HouseCostForm";

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
const close = vi.fn();
let owner: string | undefined;
let repository: LedgerRepository;
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  if (owner) await getAccountDatabase(owner).delete();
  owner = undefined;
  setActiveOwner(null);
  localStorage.clear();
  vi.clearAllMocks();
});
const fixture = () =>
  LedgerSchema.parse({
    architectureVersion: 2,
    paymentAllocations: [],
    milestones: [],
    works: [{ id: "roof", name: "নমুনা ছাদ" }],
    people: [
      {
        id: "shop",
        name: "নমুনা দোকান",
        kind: "shop",
        contactType: "supplier",
        roles: ["supplier"],
        quickActions: ["purchase"],
        workIds: ["roof"],
      },
      {
        id: "worker",
        name: "নমুনা মিস্ত্রি",
        kind: "worker",
        contactType: "craftsperson",
        roles: ["craftsperson"],
        workIds: ["roof"],
      },
    ],
  });
async function setup(initial = fixture()) {
  owner = crypto.randomUUID();
  setActiveOwner(owner);
  savePreferences({ language: "bn" });
  repository = getScopedRepository("real");
  await repository.ensure("real", initial);
  return initial;
}
function Harness({
  initial,
  children,
}: {
  initial: Ledger;
  children: ReactNode;
}) {
  const [ledger, setLedger] = useState(initial);
  const value = {
    ledger,
    mode: "real",
    close,
    notify: vi.fn(),
    save: async (change: Ledger | ((ledger: Ledger) => Ledger)) => {
      await repository.save(change, "real");
      setLedger((await repository.read())!.ledger);
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
  action: "purchase" | "charge" = "purchase",
  person = "shop",
) {
  return render(
    <MemoryRouter
      initialEntries={[`/write/${action}?person=${person}&work=roof`]}
    >
      <Harness initial={initial}>
        <HouseCostForm action={action} />
      </Harness>
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
async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^মালের দাম/), "100");
  await user.type(screen.getByLabelText(/^মালের নাম/), "নমুনা সিমেন্ট");
}

it("requires an explicit payer, remembers both picks and records only materials owed to that payer", async () => {
  const initial = await setup(),
    user = userEvent.setup();
  mount(initial);
  await ready();
  await fill(user);
  expect(
    (screen.getByLabelText("কর্মী বা দোকান") as HTMLSelectElement).value,
  ).toBe("shop");
  await user.click(screen.getByRole("button", { name: "অন্যজন দিয়েছেন" }));
  expect(screen.queryByLabelText("কর্মী বা দোকান")).toBeNull();
  expect((screen.getByLabelText("কে দিয়েছেন") as HTMLSelectElement).value).toBe(
    "",
  );
  expect(screen.queryByRole("group", { name: "কীভাবে দিয়েছেন" })).toBeNull();
  expect(
    screen.queryByText("যিনি নিজের টাকায় কিনেছেন, তাঁর নাম দিন।"),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "কে দিয়েছেন, তাঁর নাম বেছে নিন।",
  );
  expect((await repository.read())!.ledger.entries).toEqual([]);
  await user.selectOptions(screen.getByLabelText("কে দিয়েছেন"), "worker");
  await user.click(screen.getByRole("button", { name: "পুরোটা দিয়েছি" }));
  expect(
    (screen.getByLabelText("কর্মী বা দোকান") as HTMLSelectElement).value,
  ).toBe("shop");
  expect(screen.getByRole("group", { name: "কীভাবে দিয়েছেন" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "অন্যজন দিয়েছেন" }));
  expect((screen.getByLabelText("কে দিয়েছেন") as HTMLSelectElement).value).toBe(
    "worker",
  );
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  const saved = (await repository.read())!.ledger;
  expect(saved.entries).toMatchObject([
    {
      kind: "expense",
      personId: "worker",
      account: "materials",
      lines: [{ costType: "material", amount: 10000 }],
    },
  ]);
  expect(saved.entries).toHaveLength(1);
  expect(summarize(saved)).toMatchObject({
    cost: 10000,
    paid: 0,
    payable: 10000,
    byType: { labour: 0 },
  });
  expect(saved.people).toEqual(initial.people);
});

it("keeps supplier and payer drafts through reopening and creates a new payer without inventing a supplier role", async () => {
  const initial = await setup(),
    user = userEvent.setup();
  const view = mount(initial);
  await ready();
  await fill(user);
  await user.click(screen.getByRole("button", { name: "অন্যজন দিয়েছেন" }));
  await user.selectOptions(screen.getByLabelText("কে দিয়েছেন"), "__new__");
  await user.type(screen.getByLabelText("নতুন নাম"), "নমুনা যিনি দিয়েছেন");
  await user.click(screen.getByRole("button", { name: "পুরোটা দিয়েছি" }));
  await user.click(screen.getByRole("button", { name: "অন্যজন দিয়েছেন" }));
  await waitFor(async () =>
    expect(
      await createWorkspaceStorage().readDraft(
        "house-cost:purchase:shop:roof:none:none",
      ),
    ).toMatchObject({
      draft: {
        payment: "worker",
        personId: "__new__",
        personName: "নমুনা যিনি দিয়েছেন",
      },
      purchaseContact: { id: "shop" },
    }),
  );
  view.unmount();
  mount((await repository.read())!.ledger);
  await ready();
  expect((screen.getByLabelText("কে দিয়েছেন") as HTMLSelectElement).value).toBe(
    "__new__",
  );
  expect((screen.getByLabelText("নতুন নাম") as HTMLInputElement).value).toBe(
    "নমুনা যিনি দিয়েছেন",
  );
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  const saved = (await repository.read())!.ledger;
  const payer = saved.people.find(
    (person) => person.name === "নমুনা যিনি দিয়েছেন",
  )!;
  expect(payer).toMatchObject({
    kind: "other",
    contactType: "custom",
    roles: [],
  });
  expect(saved.entries).toMatchObject([
    { personId: payer.id, account: "materials", kind: "expense" },
  ]);
  expect(summarize(saved)).toMatchObject({
    paid: 0,
    cost: 10000,
    payable: 10000,
  });
});

it("hides charge quantity controls while retaining old draft line metadata, and saves the visible method choice", async () => {
  const initial = await setup(),
    user = userEvent.setup();
  const draft = QuickDraftSchema.parse({
    id: "old-cost",
    paymentId: "old-paid",
    refundId: "old-refund",
    personNewId: "old-person",
    date: "2026-11-05",
    personId: "worker",
    workId: "roof",
    account: "labour",
    costType: "labour",
    payment: "due",
    rows: [
      {
        id: "old-line",
        label: "নমুনা কাজ",
        amount: "100",
        quantity: "2.5",
        unit: "দিন",
      },
    ],
  });
  await createWorkspaceStorage().saveDraft(
    "house-cost:charge:worker:roof:none:none",
    { draft, files: [] },
  );
  mount(initial, "charge", "worker");
  await ready();
  expect(screen.queryByText("ব্র্যান্ড ও পরিমাণ")).toBeNull();
  expect(screen.queryByLabelText(/^পরিমাণ/)).toBeNull();
  expect(screen.queryByLabelText(/^একক/)).toBeNull();
  expect(screen.queryByRole("group", { name: "কীভাবে দিয়েছেন" })).toBeNull();
  const receipt = screen.getByLabelText("ভাউচার বা ছবি");
  expect(
    receipt.closest("details")?.querySelector("summary")?.textContent,
  ).toContain("ভাউচার, নোট ও তারিখ");
  expect(screen.getByLabelText("তারিখ").closest("details")).toBe(
    receipt.closest("details"),
  );
  await user.click(screen.getByRole("button", { name: "পুরোটা দিয়েছি" }));
  await user.click(screen.getByRole("button", { name: "ব্যাংক" }));
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  const saved = (await repository.read())!.ledger;
  expect(
    saved.entries.find((entry) => entry.kind === "expense")!.lines[0],
  ).toMatchObject({ quantity: "2.5", unit: "দিন", amount: 10000 });
  expect(
    saved.entries.find((entry) => entry.kind === "payment")!.paymentParts,
  ).toEqual([{ amount: 10000, method: "bank" }]);
});

it("restores a legacy worker-mode draft's selected payer without treating that payer as the supplier", async () => {
  const initial = await setup(),
    user = userEvent.setup();
  const draft = QuickDraftSchema.parse({
    id: "legacy-cost",
    paymentId: "legacy-paid",
    refundId: "legacy-refund",
    personNewId: "legacy-person",
    date: "2026-11-05",
    personId: "worker",
    workId: "roof",
    payment: "worker",
    rows: [
      { id: "legacy-line", label: "নমুনা নিজের টাকায় কেনা মাল", amount: "100" },
    ],
  });
  await createWorkspaceStorage().saveDraft(
    "house-cost:purchase:shop:roof:none:none",
    { draft, files: [] },
  );
  mount(initial);
  await ready();
  expect((screen.getByLabelText("কে দিয়েছেন") as HTMLSelectElement).value).toBe(
    "worker",
  );
  await user.click(screen.getByRole("button", { name: "পুরোটা দিয়েছি" }));
  expect(
    (screen.getByLabelText("কর্মী বা দোকান") as HTMLSelectElement).value,
  ).toBe("");
  await user.click(screen.getByRole("button", { name: "অন্যজন দিয়েছেন" }));
  expect((screen.getByLabelText("কে দিয়েছেন") as HTMLSelectElement).value).toBe(
    "worker",
  );
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect((await repository.read())!.ledger.entries).toMatchObject([
    { personId: "worker", account: "materials", kind: "expense" },
  ]);
  expect((await repository.read())!.ledger.entries).toHaveLength(1);
});
