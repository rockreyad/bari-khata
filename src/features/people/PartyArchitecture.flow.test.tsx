// @vitest-environment jsdom
import "fake-indexeddb/auto";
import {
  useState,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
} from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  NotebookContext,
  type NotebookContextValue,
} from "../../app/NotebookContext";
import { LanguageProvider } from "../../context/LanguageProvider";
import { getAccountDatabase, setActiveOwner } from "../../data/database";
import {
  createWorkspaceStorage,
  getScopedRepository,
} from "../../data/repository";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { summarize } from "../../domain/ledger";
import { savePreferences } from "../../lib/preferences";
import { PartyAllocationPanel } from "./PartyAllocationPanel";
import { partyLedger } from "../../domain/partyLedger";
import { QuickEntrySheet } from "../entries/QuickEntrySheet";
import { AgreementMilestones } from "../jobs/AgreementMilestones";

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
let owner: string | undefined;
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  if (owner) await getAccountDatabase(owner).delete();
  owner = undefined;
  setActiveOwner(null);
  localStorage.clear();
});
function fixture() {
  return LedgerSchema.parse({
    architectureVersion: 2,
    milestones: [],
    paymentAllocations: [],
    works: [
      { id: "roof", name: "নমুনা ছাদ" },
      { id: "wall", name: "নমুনা দেয়াল" },
    ],
    people: [
      {
        id: "party",
        name: "নমুনা একই ব্যক্তি",
        kind: "other",
        contactType: "custom",
        roles: ["supplier", "craftsperson"],
        identityType: "person",
      },
    ],
    contracts: [
      {
        id: "job",
        personId: "party",
        workId: "roof",
        total: 100000,
        title: "নমুনা চুক্তি",
      },
    ],
    entries: [
      {
        id: "first",
        kind: "expense",
        personId: "party",
        note: "নমুনা প্রথম বিল",
        lines: [
          { id: "line1", workId: "roof", amount: 10000 },
          { id: "line2", workId: "wall", amount: 15000 },
        ],
      },
      {
        id: "second",
        kind: "expense",
        personId: "party",
        note: "নমুনা দ্বিতীয় বিল",
        lines: [{ id: "line3", workId: "roof", amount: 20000 }],
      },
      {
        id: "other",
        kind: "expense",
        personId: "party",
        note: "নমুনা মজুরির বিল",
        account: "labour",
        lines: [
          { id: "line4", workId: "roof", amount: 7000, costType: "labour" },
        ],
      },
      {
        id: "advance",
        kind: "payment",
        personId: "party",
        paymentContext: "advance",
        date: "2026-11-05",
        note: "নমুনা আগাম",
        allocations: [
          { workId: "roof", amount: 25000 },
          { workId: "wall", amount: 15000 },
        ],
        paymentParts: [{ amount: 40000 }],
      },
    ],
  });
}
async function setup(initial = fixture()) {
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
  children: React.ReactNode;
}) {
  const [ledger, setLedger] = useState(initial);
  const value = {
    ledger,
    mode: "real",
    base: "",
    detail: vi.fn(),
    close: vi.fn(),
    notify: vi.fn(),
    add: vi.fn(),
    save: async (change: Ledger | ((current: Ledger) => Ledger)) => {
      const repo = getScopedRepository("real");
      await repo.save(change);
      setLedger((await repo.read())!.ledger);
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
function mount(initial: Ledger, element: React.ReactNode) {
  return render(<Harness initial={initial}>{element}</Harness>);
}

it("allocates one existing advance across multiple bills and notebooks, reopens it, then cancels a link without changing cash or costs", async () => {
  const initial = fixture();
  const repo = await setup(initial);
  const before = summarize(initial);
  const user = userEvent.setup();
  const first = mount(initial, <PartyAllocationPanel personId="party" />);
  await user.click(screen.getByText("দেওয়া টাকা বিলে লাগাই"));
  const payment = screen.getByLabelText("কোন দেওয়া টাকা");
  await waitFor(() =>
    expect((payment as HTMLSelectElement).disabled).toBe(false),
  );
  await user.selectOptions(payment, "advance");
  expect(screen.queryByLabelText(/বিলে লাগাব: নমুনা মজুরির বিল/)).toBeNull();
  await user.type(
    screen.getByLabelText("বিলে লাগাব: নমুনা প্রথম বিল · নমুনা ছাদ"),
    "100",
  );
  await user.type(
    screen.getByLabelText("বিলে লাগাব: নমুনা প্রথম বিল · নমুনা দেয়াল"),
    "150",
  );
  await user.type(
    screen.getByLabelText("বিলে লাগাব: নমুনা দ্বিতীয় বিল · নমুনা ছাদ"),
    "100",
  );
  await user.click(screen.getByRole("button", { name: "বিলে লাগাই" }));
  await waitFor(async () =>
    expect((await repo.read())!.ledger.paymentAllocations).toHaveLength(3),
  );
  expect(summarize((await repo.read())!.ledger)).toEqual(before);
  first.unmount();
  repo.database.close();
  await repo.database.open();
  const saved = (await repo.read())!.ledger;
  mount(saved, <PartyAllocationPanel personId="party" />);
  await user.click(screen.getByText("কোন বিলে কত মিটিয়েছি"));
  await waitFor(() =>
    expect(
      (
        screen.getAllByRole("button", {
          name: "বিলের সম্পর্ক বাতিল করি",
        })[0] as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  await user.click(
    screen.getAllByRole("button", { name: "বিলের সম্পর্ক বাতিল করি" })[0],
  );
  await user.type(
    screen.getByLabelText("কেন সম্পর্ক বাতিল করছেন"),
    "নমুনা ভুল বিল বেছেছিলাম",
  );
  await user.click(screen.getByRole("button", { name: "সম্পর্ক বাতিল রাখুন" }));
  await waitFor(async () =>
    expect(
      (await repo.read())!.ledger.paymentAllocations?.[0].cancelledAt,
    ).toBeTruthy(),
  );
  const after = (await repo.read())!.ledger;
  expect(after.entries).toEqual(initial.entries);
  expect(after.paymentAllocations?.[0].cancellationReason).toBe(
    "নমুনা ভুল বিল বেছেছিলাম",
  );
  expect(summarize(after)).toEqual(before);
});

it("keeps an unfinished allocation draft when reopened", async () => {
  const initial = fixture();
  await setup(initial);
  const user = userEvent.setup();
  const first = mount(initial, <PartyAllocationPanel personId="party" />);
  await user.click(screen.getByText("দেওয়া টাকা বিলে লাগাই"));
  await waitFor(() =>
    expect(
      (screen.getByLabelText("কোন দেওয়া টাকা") as HTMLSelectElement).disabled,
    ).toBe(false),
  );
  await user.selectOptions(screen.getByLabelText("কোন দেওয়া টাকা"), "advance");
  await user.type(
    screen.getByLabelText("বিলে লাগাব: নমুনা প্রথম বিল · নমুনা ছাদ"),
    "75",
  );
  await waitFor(async () =>
    expect(
      await createWorkspaceStorage().readDraft("payment-allocation:party"),
    ).toMatchObject({
      paymentId: "advance",
      amounts: { '["first","roof"]': "75" },
    }),
  );
  first.unmount();
  mount(initial, <PartyAllocationPanel personId="party" />);
  await user.click(screen.getByText("দেওয়া টাকা বিলে লাগাই"));
  await waitFor(() =>
    expect(
      (
        screen.getByLabelText(
          "বিলে লাগাব: নমুনা প্রথম বিল · নমুনা ছাদ",
        ) as HTMLInputElement
      ).value,
    ).toMatch(/[৭7][৫5]/),
  );
});

it("adds optional agreement milestones, saves status, and reopens without producing a financial entry", async () => {
  const initial = fixture();
  const repo = await setup(initial);
  const user = userEvent.setup();
  const first = mount(initial, <AgreementMilestones contractId="job" />);
  await user.click(screen.getByText("ধাপ যোগ করি"));
  await waitFor(() =>
    expect(
      (screen.getByLabelText("ধাপের নাম") as HTMLInputElement).disabled,
    ).toBe(false),
  );
  await user.type(screen.getByLabelText("ধাপের নাম"), "নমুনা প্রথম ধাপ");
  await user.type(screen.getByLabelText("এই ধাপের টাকা"), "400");
  await user.click(screen.getByRole("button", { name: "ধাপ রাখুন" }));
  await waitFor(async () =>
    expect((await repo.read())!.ledger.milestones).toHaveLength(1),
  );
  const status = await screen.findByLabelText("ধাপের অবস্থা: নমুনা প্রথম ধাপ");
  await waitFor(() =>
    expect((status as HTMLSelectElement).disabled).toBe(false),
  );
  await user.selectOptions(status, "done");
  await waitFor(async () =>
    expect((await repo.read())!.ledger.milestones?.[0].status).toBe("done"),
  );
  first.unmount();
  repo.database.close();
  await repo.database.open();
  const saved = (await repo.read())!.ledger;
  mount(saved, <AgreementMilestones contractId="job" />);
  expect(
    (
      screen.getByLabelText(
        "ধাপের অবস্থা: নমুনা প্রথম ধাপ",
      ) as HTMLSelectElement
    ).value,
  ).toBe("done");
  expect(saved.entries).toEqual(initial.entries);
  expect(saved.contracts).toEqual(initial.contracts);
  expect(
    screen.getByRole("button", { name: "এই ধাপের বিল লিখি" }),
  ).toBeTruthy();
});

it("records explicitly recoverable money from the payment form and returns it without offsetting the same party's unpaid bills", async () => {
  const initial = fixture();
  const repo = await setup(initial);
  const before = partyLedger(initial, "party");
  const user = userEvent.setup();
  const first = mount(
    initial,
    <QuickEntrySheet
      options={{
        kind: "payment",
        personId: "party",
        workId: "roof",
        account: "materials",
        purpose: "advance",
      }}
      presentation="page"
    />,
  );
  await waitFor(() =>
    expect(
      (
        screen
          .getByLabelText("কত টাকা")
          .closest("fieldset") as HTMLFieldSetElement
      ).disabled,
    ).toBe(false),
  );
  await user.selectOptions(
    screen.getByLabelText("টাকা কীভাবে মিটবে"),
    "receivable",
  );
  await user.type(screen.getByLabelText("কত টাকা"), "50");
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(async () =>
    expect((await repo.read())!.ledger.entries).toHaveLength(
      initial.entries.length + 1,
    ),
  );
  first.unmount();
  repo.database.close();
  await repo.database.open();
  const saved = (await repo.read())!.ledger;
  expect(saved.entries.at(-1)).toMatchObject({
    kind: "payment",
    paymentContext: "receivable",
  });
  expect(partyLedger(saved, "party")).toMatchObject({
    payable: before.payable,
    receivable: 5000,
  });
  const second = mount(
    saved,
    <QuickEntrySheet
      options={{
        kind: "refund",
        personId: "party",
        workId: "roof",
        account: "materials",
      }}
      presentation="page"
    />,
  );
  await waitFor(() =>
    expect(
      (
        screen
          .getByLabelText("কত টাকা")
          .closest("fieldset") as HTMLFieldSetElement
      ).disabled,
    ).toBe(false),
  );
  await user.selectOptions(
    screen.getByLabelText("কোন টাকার ফেরত"),
    "receivable",
  );
  await user.type(screen.getByLabelText("কত টাকা"), "20");
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(async () =>
    expect((await repo.read())!.ledger.entries).toHaveLength(
      initial.entries.length + 2,
    ),
  );
  second.unmount();
  const refunded = (await repo.read())!.ledger;
  expect(refunded.entries.at(-1)).toMatchObject({
    kind: "refund",
    paymentContext: "receivable",
  });
  expect(partyLedger(refunded, "party")).toMatchObject({
    payable: before.payable,
    receivable: 3000,
  });
});
