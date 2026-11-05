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
import { getScopedRepository } from "../../data/repository";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { savePreferences } from "../../lib/preferences";
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
