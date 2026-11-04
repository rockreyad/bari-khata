// @vitest-environment jsdom
import "fake-indexeddb/auto";
import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import type { AddOptions } from "../../app/NotebookProvider";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { contactSummary } from "../../domain/contacts";
import {
  getAccountDatabase,
  setActiveOwner,
  LedgerDatabase,
} from "../../data/database";
import {
  LedgerRepository,
  createWorkspaceStorage,
} from "../../data/repository";
import { PersonPage } from "../people/PersonPage";
import { QuickEntrySheet } from "./QuickEntrySheet";
import { entryContext } from "./entryContext";

const context = vi.hoisted(() => ({
  ledger: null as unknown,
  save: vi.fn(),
  close: vi.fn(),
  notify: vi.fn(),
  add: vi.fn(),
  entity: vi.fn(),
  go: vi.fn(),
  detail: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({ ...context, mode: "real", base: "" }),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    language: "bn",
    t: (text: string, values: Record<string, string | number> = {}) =>
      text.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
        String(values[key] ?? ""),
      ),
    money: (amount: number) => `৳${amount / 100}`,
    number: String,
    formatDigits: String,
    date: (value: string | null) => value ?? "—",
  }),
}));
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
vi.mock("../../components/ui/AppCombobox", () => ({
  AppCombobox: ({
    suggestions: _suggestions,
    ...props
  }: InputHTMLAttributes<HTMLInputElement> & { suggestions: unknown[] }) => (
    <input {...props} />
  ),
}));
vi.mock("../../components/ui/MoneyInput", () => ({
  MoneyInput: (props: InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

const databases: LedgerDatabase[] = [];
afterEach(async () => {
  cleanup();
  setActiveOwner(null);
  for (const database of databases.splice(0)) await database.delete();
  vi.clearAllMocks();
});

function fixture() {
  return LedgerSchema.parse({
    works: [{ id: "work", name: "নমুনা ঘর" }],
    people: [{ id: "helper", name: "নমুনা কর্মী", kind: "other" }],
    entries: [
      {
        id: "old-material-bill",
        personId: "helper",
        kind: "expense",
        account: "materials",
        date: "2026-10-01",
        lines: [
          { id: "old-line", workId: "work", label: "নমুনা মাল", amount: 10000 },
        ],
      },
      {
        id: "old-material-paid",
        personId: "helper",
        kind: "payment",
        account: "materials",
        relatedEntryId: "old-material-bill",
        date: "2026-10-01",
        note: "নমুনা মালের টাকা",
        allocations: [{ workId: "work", amount: 10000 }],
        paymentParts: [{ amount: 10000 }],
      },
    ],
  });
}

async function repository(ledger: Ledger) {
  const owner = crypto.randomUUID();
  setActiveOwner(owner);
  const database = getAccountDatabase(owner);
  databases.push(database);
  const repo = new LedgerRepository(database);
  await repo.ensure("real", ledger);
  context.ledger = ledger;
  context.save.mockImplementation(async (change) => {
    await repo.save(change);
    context.ledger = (await repo.read())!.ledger;
  });
  return repo;
}

const ready = () =>
  waitFor(() =>
    expect(
      screen.getByLabelText("কত টাকা").closest<HTMLFieldSetElement>("fieldset")!
        .disabled,
    ).toBe(false),
  );
const entry = (options: AddOptions) =>
  render(<QuickEntrySheet presentation="page" options={options} />);

it.each([
  { partial: false, paid: 80000, due: 0 },
  { partial: true, paid: 30000, due: 50000 },
])(
  "keeps a custom labour bill and its $paid payment visible for an other-kind contact through drafts, settlement and backup",
  async ({ partial, paid, due }) => {
    const original = fixture();
    const repo = await repository(original);
    const user = userEvent.setup();
    const options = {
      kind: "payment",
      workId: "work",
      personId: "helper",
      account: "materials",
    } as const;
    let view = entry(options);
    await ready();
    await user.selectOptions(screen.getByLabelText("কিসের টাকা"), "__new__");
    await user.type(
      screen.getByLabelText("কিসের টাকা লিখুন"),
      "নমুনা মাল নামানো",
    );
    await user.selectOptions(
      screen.getByLabelText("কোন হিসাবের অংশ"),
      "labour",
    );
    await user.click(screen.getByRole("button", { name: "নতুন বিল ও টাকা" }));
    await user.type(screen.getByLabelText("কত টাকা"), "800");
    if (partial) {
      await user.click(screen.getByRole("button", { name: "টাকা লিখি" }));
      await user.type(screen.getByLabelText("এখন কত দিলেন"), "300");
    }
    await user.click(screen.getByRole("button", { name: "ফিরুন" }));
    await waitFor(() => expect(context.close).toHaveBeenCalledOnce());
    view.unmount();
    repo.database.close();
    await repo.database.open();
    context.ledger = (await repo.read())!.ledger;
    view = entry(options);
    await ready();
    expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe(
      "800",
    );
    expect(
      (screen.getByLabelText("কিসের টাকা লিখুন") as HTMLInputElement).value,
    ).toBe("নমুনা মাল নামানো");
    expect(
      (screen.getByLabelText("কোন হিসাবের অংশ") as HTMLSelectElement).value,
    ).toBe("labour");
    if (partial)
      expect(
        (screen.getByLabelText("এখন কত দিলেন") as HTMLInputElement).value,
      ).toBe("300");
    await user.click(screen.getByRole("button", { name: "রাখুন" }));
    await waitFor(() => expect(context.save).toHaveBeenCalledOnce());
    await context.save.mock.results[0].value;
    await waitFor(() => expect(context.close).toHaveBeenCalledTimes(2));
    view.unmount();
    repo.database.close();
    await repo.database.open();
    let saved = (await repo.read())!.ledger;
    expect(saved.entries.slice(0, 2)).toEqual(original.entries);
    expect(saved.people).toEqual(original.people);
    expect(saved.paymentPurposes).toHaveLength(1);
    const reason = saved.paymentPurposes[0];
    expect(reason).toMatchObject({
      name: "নমুনা মাল নামানো",
      account: "labour",
    });
    const bill = saved.entries.find(
      (row) => row.kind === "expense" && row.account === "labour",
    )!;
    const payment = saved.entries.find(
      (row) => row.kind === "payment" && row.account === "labour",
    )!;
    expect(bill).toMatchObject({
      personId: "helper",
      paymentPurposeId: null,
      lines: [
        {
          label: reason.name,
          amount: 80000,
          workId: "work",
          costType: "labour",
        },
      ],
    });
    expect(payment).toMatchObject({
      personId: "helper",
      paymentPurposeId: reason.id,
      relatedEntryId: bill.id,
      allocations: [{ workId: "work", amount: paid }],
    });
    expect(contactSummary(saved, saved.people[0])).toMatchObject({
      actualCost: 90000,
      actualPaid: paid + 10000,
      reconciledPayable: due,
      reconciledAdvance: 0,
    });

    context.ledger = saved;
    const profile = render(
      <MemoryRouter initialEntries={["/people/helper"]}>
        <Routes>
          <Route path="/people/:personId" element={<PersonPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      profile.container.querySelector(".contact-summary-hero")?.textContent,
    ).toContain(`৳${(paid + 10000) / 100}`);
    expect(profile.container.textContent).toContain("নমুনা মাল নামানো");
    const history = profile.container.querySelector(".contact-history")!;
    expect(history.textContent).toContain("নমুনা মাল");
    expect(
      [...history.querySelectorAll(".history-row")].some(
        (row) =>
          row.textContent?.includes("টাকা দিয়েছি") &&
          row.textContent.includes("2026-10-01") &&
          row.textContent.includes("৳100"),
      ),
    ).toBe(true);
    if (partial) expect(history.textContent).toContain("দিয়েছি ৳300");
    profile.unmount();

    if (partial) {
      context.close.mockClear();
      view = entry({ ...options, account: "labour", purpose: "settle" });
      await ready();
      await user.type(screen.getByLabelText("কত টাকা"), "500");
      await user.click(screen.getByRole("button", { name: "রাখুন" }));
      await waitFor(() => expect(context.close).toHaveBeenCalledOnce());
      view.unmount();
      saved = (await repo.read())!.ledger;
      expect(
        saved.entries.filter((row) => row.kind === "expense"),
      ).toHaveLength(2);
      expect(
        saved.entries.filter((row) => row.kind === "payment"),
      ).toHaveLength(3);
      expect(contactSummary(saved, saved.people[0])).toMatchObject({
        actualCost: 90000,
        actualPaid: 90000,
        reconciledPayable: 0,
        reconciledAdvance: 0,
      });
    }

    const stale = entryContext(saved, options);
    await createWorkspaceStorage("real").saveDraft(
      "quick-v2:payment:work:helper",
      {
        draft: { ...stale, paymentId: payment.id, amount: "731" },
        files: [],
      },
    );
    context.ledger = saved;
    view = entry(options);
    await ready();
    expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe(
      "",
    );
    view.unmount();
    const restoredDatabase = new LedgerDatabase(
      `contact-payment-${crypto.randomUUID()}`,
    );
    databases.push(restoredDatabase);
    const restore = new LedgerRepository(restoredDatabase);
    await restore.ensure("real", LedgerSchema.parse({}));
    await restore.importBackup(await repo.exportBackup(), { replace: true });
    expect((await restore.read())!.ledger).toEqual(saved);
  },
);

it("pays an old supplier balance together with a new bill without turning the whole payment into new cost", async () => {
  const original = fixture();
  const ledger = LedgerSchema.parse({
    ...original,
    people: [{ ...original.people[0], kind: "shop" }],
    entries: [original.entries[0]],
  });
  const repo = await repository(ledger);
  const user = userEvent.setup();
  const view = entry({
    kind: "expense",
    workId: "work",
    personId: "helper",
    account: "materials",
  });
  await ready();
  await user.type(screen.getByLabelText("কত টাকা"), "200");
  await user.type(screen.getByLabelText("কী কিনলেন"), "নমুনা নতুন মাল");
  await user.click(screen.getByRole("button", { name: "টাকা লিখি" }));
  await user.type(screen.getByLabelText("এখন কত দিলেন"), "300");
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(context.close).toHaveBeenCalledOnce());
  view.unmount();
  const saved = (await repo.read())!.ledger;
  expect(saved.entries[0]).toEqual(ledger.entries[0]);
  expect(saved.entries.filter((row) => row.kind === "expense")).toHaveLength(2);
  expect(contactSummary(saved, saved.people[0])).toMatchObject({
    actualCost: 30000,
    actualPaid: 30000,
    reconciledPayable: 0,
    reconciledAdvance: 0,
  });
});

it("does not reopen a consumed legacy payment with empty financial IDs through either draft key", async () => {
  const ledger = LedgerSchema.parse({ ...fixture(), entries: [] });
  const repo = await repository(ledger);
  const user = userEvent.setup();
  const options = {
    kind: "payment",
    personId: "helper",
    workId: "work",
  } as const;
  const legacy = entryContext(ledger, { ...options, account: "materials" });
  await createWorkspaceStorage("real").saveDraft(
    "quick-v2:payment:work:helper",
    {
      draft: {
        ...legacy,
        purpose: "settle",
        id: "",
        paymentId: "",
        refundId: "",
        amount: "125",
      },
      files: [],
    },
  );
  let view = entry({ ...options, account: "materials" });
  await ready();
  expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe(
    "125",
  );
  expect(screen.queryByRole("button", { name: "বাকি মেটাই" })).toBeNull();
  expect(
    (screen.getByRole("button", { name: "রাখুন" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect((await repo.read())!.ledger.entries).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "অগ্রিম" }));
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(context.close).toHaveBeenCalledOnce());
  view.unmount();
  repo.database.close();
  await repo.database.open();
  const saved = (await repo.read())!.ledger;
  expect(saved.entries).toHaveLength(1);
  expect(saved.entries[0]).toMatchObject({
    kind: "payment",
    allocations: [{ workId: "work", amount: 12500 }],
  });
  context.ledger = saved;
  view = entry({ ...options, account: "materials" });
  await ready();
  expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe("");
  view.unmount();
  view = entry(options);
  await ready();
  expect((screen.getByLabelText("কত টাকা") as HTMLInputElement).value).toBe("");
  view.unmount();
  expect((await repo.read())!.ledger).toEqual(saved);
});
