// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { LanguageProvider } from "../../context/LanguageProvider";
import { LedgerDatabase } from "../../data/database";
import { LedgerRepository } from "../../data/repository";
import { appendBalanceAdjustment } from "../../domain/balanceAdjustments";
import { createEmptyLedger } from "../../domain/demo";
import { setEntityRemoved } from "../../domain/entityDeletion";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { savePreferences } from "../../lib/preferences";
import { WorkPayables } from "./WorkPayables";

const notebook = vi.hoisted(() => ({
  ledger: null as unknown,
  go: vi.fn(),
  detail: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({ ...notebook, ledger: notebook.ledger as Ledger }),
}));

const databases: LedgerDatabase[] = [];
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  for (const database of databases.splice(0)) await database.delete();
});

function fixture() {
  return LedgerSchema.parse({
    ...createEmptyLedger(),
    works: [
      { id: "masonry", name: "নমুনা রাজমিস্ত্রির কাজ" },
      { id: "roof", name: "নমুনা ছাদ" },
    ],
    people: [
      { id: "shop", name: "নমুনা দোকান", kind: "shop" },
      { id: "worker", name: "নমুনা মিস্ত্রি", kind: "worker" },
    ],
    contracts: [
      {
        id: "unfinished",
        personId: "worker",
        workId: "masonry",
        total: 10000000,
      },
    ],
    entries: [
      {
        id: "shop-bill",
        kind: "expense",
        personId: "shop",
        lines: [
          {
            id: "cement",
            workId: "masonry",
            label: "নমুনা সিমেন্ট",
            amount: 500000,
          },
        ],
      },
      {
        id: "shop-paid",
        kind: "payment",
        personId: "shop",
        allocations: [{ workId: "masonry", amount: 200000 }],
        paymentParts: [{ amount: 200000 }],
      },
      {
        id: "other-work-paid",
        kind: "payment",
        personId: "shop",
        allocations: [{ workId: "roof", amount: 900000 }],
        paymentParts: [{ amount: 900000 }],
      },
      {
        id: "worker-bill",
        kind: "expense",
        account: "labour",
        personId: "worker",
        lines: [
          {
            id: "wages",
            workId: "masonry",
            label: "নমুনা মজুরি",
            costType: "labour",
            amount: 100000,
          },
        ],
      },
      {
        id: "anonymous-bill",
        kind: "expense",
        lines: [
          { id: "sand", workId: "masonry", label: "নমুনা বালু", amount: 60000 },
        ],
      },
      {
        id: "anonymous-paid",
        kind: "payment",
        relatedEntryId: "anonymous-bill",
        allocations: [{ workId: "masonry", amount: 20000 }],
        paymentParts: [{ amount: 20000 }],
      },
    ],
  });
}

function mount(ledger: Ledger, language: "bn" | "en" = "bn") {
  notebook.ledger = ledger;
  savePreferences({ language });
  return render(
    <MemoryRouter initialEntries={["/sectors/masonry"]}>
      <LanguageProvider>
        <WorkPayables workId="masonry" />
      </LanguageProvider>
    </MemoryRouter>,
  );
}

it("identifies the creditors behind 4400 taka and opens the selected notebook's records", async () => {
  const user = userEvent.setup();
  const ledger = fixture();
  const before = JSON.stringify(ledger);
  mount(ledger);
  const region = screen.getByRole("region", { name: "কার কাছে কত বাকি" });
  const shop = within(region).getByRole("button", { name: /নমুনা দোকান/ });
  const worker = within(region).getByRole("button", { name: /নমুনা মিস্ত্রি/ });
  const anonymous = within(region).getByRole("button", {
    name: /নাম দেওয়া নেই/,
  });
  expect(shop.textContent).toContain("৩,০০০");
  expect(worker.textContent).toContain("১,০০০");
  expect(anonymous.textContent).toContain("৪০০");
  expect(anonymous.textContent).toContain("নমুনা বালু");
  expect(within(region).getAllByRole("button")).toHaveLength(3);

  await user.click(shop);
  expect(notebook.go).toHaveBeenLastCalledWith(
    "/ledger?person=shop&work=masonry&order=oldest",
  );
  await user.click(worker);
  expect(notebook.go).toHaveBeenLastCalledWith(
    "/ledger?person=worker&work=masonry&order=oldest",
  );
  await user.click(anonymous);
  expect(notebook.detail).toHaveBeenCalledExactlyOnceWith("anonymous-bill");
  expect(JSON.stringify(ledger)).toBe(before);
});

it("retains a creditor's due after the name is archived", () => {
  const ledger = setEntityRemoved(fixture(), "person", "shop", true);
  mount(ledger);
  const row = screen.getByRole("button", { name: /নমুনা দোকান/ });
  expect(row.textContent).toContain("৩,০০০");
});

it("uses English labels and numbers through the language provider", () => {
  mount(fixture(), "en");
  const region = screen.getByRole("region", { name: "Who is owed how much" });
  expect(
    within(region).getByRole("heading", { name: "Who is owed how much" }),
  ).toBeTruthy();
  const anonymous = within(region).getByRole("button", {
    name: /Name unknown/,
  });
  expect(anonymous.textContent).toContain("400");
  expect(
    within(region).getByRole("button", { name: /নমুনা দোকান/ }).textContent,
  ).toContain("3,000");
  expect(region.textContent).not.toContain("নাম দেওয়া নেই");
});

it.each([50000, -50000])(
  "keeps a %i paise notebook adjustment separate from named creditors",
  (delta) => {
    const ledger = appendBalanceAdjustment(fixture(), {
      target: "work",
      basis: "balance",
      account: null,
      workId: "masonry",
      expectedBefore: 440000,
      after: 440000 + delta,
      reason: "নমুনা খাতার বাকি মিলিয়ে দেখা",
    });
    mount(ledger);
    const region = screen.getByRole("region", { name: "কার কাছে কত বাকি" });
    expect(within(region).getByText("কারও নামে না থাকা সমন্বয়")).toBeTruthy();
    expect(
      within(region).getByRole("button", { name: /নমুনা দোকান/ }).textContent,
    ).toContain("৩,০০০");
    expect(region.textContent).toContain("৫০০");
    if (delta < 0) expect(region.textContent).toMatch(/[-−]/);
  },
);

it("hides the breakdown when only an unfinished job commitment remains", () => {
  const ledger = LedgerSchema.parse({ ...fixture(), entries: [] });
  mount(ledger);
  expect(screen.queryByRole("region", { name: "কার কাছে কত বাকি" })).toBeNull();
});

it("opens the worker's profile for completed work with no bill entry", async () => {
  const user = userEvent.setup();
  const original = fixture();
  const ledger = LedgerSchema.parse({
    ...original,
    entries: [],
    contracts: [{ ...original.contracts[0], status: "done", total: 440000 }],
  });
  mount(ledger);
  const row = screen.getByRole("button", { name: /নমুনা মিস্ত্রি/ });
  expect(row.textContent).toContain("৪,৪০০");
  await user.click(row);
  expect(notebook.go).toHaveBeenCalledExactlyOnceWith(
    "/parties/worker?work=masonry&account=labour",
  );
  expect(notebook.detail).not.toHaveBeenCalled();
});

it("opens the earned work balance after partial payment even when other records exist", async () => {
  const user = userEvent.setup();
  const original = fixture();
  const ledger = LedgerSchema.parse({
    ...original,
    contracts: [{ ...original.contracts[0], status: "done", total: 600000 }],
    entries: [
      {
        id: "completed-work-paid",
        kind: "payment",
        personId: "worker",
        account: "labour",
        contractId: "unfinished",
        allocations: [{ workId: "masonry", amount: 160000 }],
        paymentParts: [{ amount: 160000 }],
      },
      {
        id: "worker-material-bill",
        kind: "expense",
        personId: "worker",
        account: "materials",
        lines: [
          {
            id: "worker-material",
            workId: "masonry",
            label: "নমুনা মিস্ত্রির কেনা মাল",
            costType: "material",
            amount: 50000,
          },
        ],
      },
      {
        id: "worker-material-paid",
        kind: "payment",
        personId: "worker",
        account: "materials",
        allocations: [{ workId: "masonry", amount: 50000 }],
        paymentParts: [{ amount: 50000 }],
      },
    ],
  });
  const before = JSON.stringify(ledger);
  mount(ledger);
  const row = screen.getByRole("button", { name: /নমুনা মিস্ত্রি/ });
  expect(row.textContent).toContain("৪,৪০০");
  await user.click(row);
  expect(notebook.go).toHaveBeenCalledExactlyOnceWith(
    "/parties/worker?work=masonry&account=labour",
  );
  expect(notebook.detail).not.toHaveBeenCalled();
  expect(JSON.stringify(ledger)).toBe(before);
});

it("reopens the same creditor breakdown from IndexedDB and a restored backup", async () => {
  const makeRepository = () => {
    const database = new LedgerDatabase(
      `test-work-dues-${crypto.randomUUID()}`,
    );
    databases.push(database);
    return new LedgerRepository(database);
  };
  const repo = makeRepository();
  const ledger = fixture();
  await repo.ensure("real", createEmptyLedger());
  await repo.save(ledger, "real");
  repo.database.close();
  await repo.database.open();
  const reopened = (await repo.read("real"))!.ledger;
  const first = mount(reopened);
  const originalText = screen.getByRole("region", {
    name: "কার কাছে কত বাকি",
  }).textContent;
  expect(originalText).toContain("৩,০০০");
  expect(originalText).toContain("১,০০০");
  expect(originalText).toContain("৪০০");
  first.unmount();

  const backup = await repo.exportBackup();
  const target = makeRepository();
  await target.ensure("real", createEmptyLedger());
  await target.importBackup(backup, { replace: true });
  target.database.close();
  await target.database.open();
  mount((await target.read("real"))!.ledger);
  expect(
    screen.getByRole("region", { name: "কার কাছে কত বাকি" }).textContent,
  ).toBe(originalText);
});
