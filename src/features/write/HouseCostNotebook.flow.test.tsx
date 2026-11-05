// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { useState, type ReactNode } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
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
import { partyLedger } from "../../domain/partyLedger";
import { savePreferences } from "../../lib/preferences";
import { latinDigits } from "../../lib/numerals";
import { HouseCostForm } from "./HouseCostForm";
import { QuickDraftSchema } from "../entries/quickEntry";

beforeAll(() => {
  if (!window.PointerEvent)
    window.PointerEvent = MouseEvent as typeof PointerEvent;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
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
    works: [
      { id: "roof", name: "নমুনা ছাদ" },
      { id: "paint", name: "নমুনা রং" },
    ],
    people: [
      {
        id: "shop",
        name: "নমুনা দোকান",
        kind: "shop",
        contactType: "supplier",
        roles: ["supplier"],
        workIds: ["roof"],
      },
      {
        id: "worker",
        name: "নমুনা শাহ আলম",
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
  path = "/write/purchase",
  action: "purchase" | "charge" = "purchase",
) {
  return render(
    <MemoryRouter initialEntries={[path]}>
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
async function choose(
  user: ReturnType<typeof userEvent.setup>,
  field: string,
  option: string,
) {
  await user.click(screen.getByRole("combobox", { name: field }));
  await user.click(screen.getByRole("option", { name: option }));
}

it("selects a notebook through the real picker, retains it after other choices and reopening, and saves every line there", async () => {
  const initial = await setup(),
    user = userEvent.setup();
  const view = mount(initial);
  await ready();
  const notebook = screen.getByRole("combobox", { name: "খাতা" });
  expect(notebook.tagName).toBe("BUTTON");
  expect(notebook.textContent).toContain("খাতা বেছে নিন");
  await user.type(screen.getByLabelText(/^মালের দাম/), "100");
  await user.type(screen.getByLabelText(/^মালের নাম/), "নমুনা রং কেনা");
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "খাতা বেছে নিন",
  );
  expect(notebook.getAttribute("aria-invalid")).toBe("true");
  expect((await repository.read())!.ledger.entries).toEqual([]);
  await choose(user, "খাতা", "নমুনা রং");
  await choose(user, "কর্মী বা দোকান", "নমুনা দোকান");
  expect(screen.getByRole("combobox", { name: "খাতা" }).textContent).toContain(
    "নমুনা রং",
  );
  await user.click(screen.getByRole("button", { name: "কিছু দিয়েছি" }));
  await user.type(screen.getByLabelText("এখন কত দিয়েছি"), "40");
  await user.click(screen.getByRole("button", { name: "ব্যাংক" }));
  await waitFor(async () =>
    expect(
      await createWorkspaceStorage().readDraft(
        "house-cost:purchase:all:all:none:none",
      ),
    ).toMatchObject({
      draft: {
        workId: "paint",
        personId: "shop",
        method: "bank",
        payment: "partial",
      },
    }),
  );
  view.unmount();
  repository.database.close();
  await repository.database.open();
  mount((await repository.read())!.ledger);
  await ready();
  expect(screen.getByRole("combobox", { name: "খাতা" }).textContent).toContain(
    "নমুনা রং",
  );
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  const saved = (await repository.read())!.ledger;
  expect(
    saved.entries.find((entry) => entry.kind === "expense")!.lines,
  ).toMatchObject([{ workId: "paint", amount: 10000 }]);
  expect(
    saved.entries.find((entry) => entry.kind === "payment")!.allocations,
  ).toEqual([{ workId: "paint", amount: 4000 }]);
  expect(saved.works).toEqual(initial.works);
});

it("creates and selects a notebook inline without losing the unfinished purchase or creating a financial record early", async () => {
  const initial = await setup(),
    user = userEvent.setup();
  mount(initial);
  await ready();
  await user.type(screen.getByLabelText(/^মালের দাম/), "125");
  await user.type(screen.getByLabelText(/^মালের নাম/), "নমুনা টাইলস");
  await choose(user, "খাতা", "+ নতুন খাতা বানান");
  await user.type(
    await screen.findByLabelText("খাতার নাম"),
    "নমুনা নতুন টাইলসের খাতা",
  );
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await ready();
  const created = (await repository.read())!.ledger.works.find(
    (work) => work.name === "নমুনা নতুন টাইলসের খাতা",
  )!;
  expect(created).toBeTruthy();
  expect((await repository.read())!.ledger.entries).toEqual([]);
  expect(screen.getByRole("combobox", { name: "খাতা" }).textContent).toContain(
    created.name,
  );
  expect(
    latinDigits(
      (screen.getByLabelText(/^মালের দাম/) as HTMLInputElement).value,
    ),
  ).toBe("125");
  expect((screen.getByLabelText(/^মালের নাম/) as HTMLInputElement).value).toBe(
    "নমুনা টাইলস",
  );
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  const saved = (await repository.read())!.ledger;
  expect(
    saved.entries.find((entry) => entry.kind === "expense")!.lines[0],
  ).toMatchObject({ workId: created.id, amount: 12500 });
  expect(saved.works.some((work) => work.name === "সাধারণ খরচ")).toBe(false);
});

it("initializes a worker paid route as one reviewed new bill and full cash payment without paying or duplicating an old bill", async () => {
  const initial = await setup(
    LedgerSchema.parse({
      ...fixture(),
      entries: [
        {
          id: "old-earned",
          kind: "expense",
          personId: "worker",
          account: "labour",
          lines: [
            {
              id: "old-line",
              workId: "roof",
              costType: "labour",
              label: "নমুনা আগের কাজ",
              amount: 10000,
            },
          ],
        },
      ],
    }),
  );
  const unpaid = QuickDraftSchema.parse({
    id: "unfinished-bill",
    personId: "worker",
    workId: "roof",
    payment: "due",
    account: "labour",
    costType: "labour",
    rows: [
      {
        id: "unfinished-line",
        label: "নমুনা আগের অসমাপ্ত লেখা",
        amount: "500",
      },
    ],
  });
  const unpaidKey = "house-cost:charge:worker:roof:none:none";
  await createWorkspaceStorage().saveDraft(unpaidKey, {
    draft: unpaid,
    files: [],
  });
  const user = userEvent.setup();
  mount(
    initial,
    "/write/charge?person=worker&work=roof&account=labour&paid=yes",
    "charge",
  );
  await ready();
  expect(
    screen.getByRole("button", { name: "পুরোটা দিয়েছি", pressed: true }),
  ).toBeTruthy();
  expect((screen.getByLabelText(/^বিলের টাকা/) as HTMLInputElement).value).toBe(
    "",
  );
  expect(screen.getByRole("combobox", { name: "খাতা" }).textContent).toContain(
    "নমুনা ছাদ",
  );
  await user.type(screen.getByLabelText(/^বিলের টাকা/), "200");
  await user.type(screen.getByLabelText(/^কাজের বিবরণ/), "নমুনা আজকের কাজ");
  await user.click(screen.getByRole("button", { name: "বিকাশ" }));
  await user.click(screen.getByRole("button", { name: "হিসাব রাখুন" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  const saved = (await repository.read())!.ledger;
  expect(saved.entries[0]).toEqual(initial.entries[0]);
  const added = saved.entries.filter((entry) => entry.id !== "old-earned");
  expect(added).toHaveLength(2);
  const bill = added.find((entry) => entry.kind === "expense")!;
  expect(bill).toMatchObject({
    personId: "worker",
    reviewStatus: "confirmed",
    lines: [{ workId: "roof", costType: "labour", amount: 20000 }],
  });
  expect(added.find((entry) => entry.kind === "payment")).toMatchObject({
    relatedEntryId: bill.id,
    paymentParts: [{ amount: 20000, method: "bkash" }],
  });
  expect(saved.paymentAllocations).toMatchObject([
    { billId: bill.id, amount: 20000 },
  ]);
  expect(partyLedger(saved, "worker").payable).toBe(10000);
  expect(summarize(saved)).toMatchObject({ cost: 30000, paid: 20000 });
  expect(await createWorkspaceStorage().readDraft(unpaidKey)).toMatchObject({
    draft: { id: "unfinished-bill", rows: [{ amount: "500" }] },
  });
});

it("does not silently reuse a general notebook inferred only from old cash history", async () => {
  const initial = fixture();
  initial.people[1].workIds = [];
  const ledger = await setup(
    LedgerSchema.parse({
      ...initial,
      works: [...initial.works, { id: "general", name: "সাধারণ খরচ" }],
      entries: [
        {
          id: "old-cash",
          kind: "payment",
          personId: "worker",
          account: "labour",
          allocations: [{ workId: "general", amount: 1000 }],
          paymentParts: [{ amount: 1000 }],
        },
      ],
    }),
  );
  mount(ledger, "/write/charge?person=worker", "charge");
  await ready();
  expect(screen.getByRole("combobox", { name: "খাতা" }).textContent).toContain(
    "খাতা বেছে নিন",
  );
  await choose(userEvent.setup(), "খাতা", "নমুনা রং");
  expect(screen.getByRole("combobox", { name: "খাতা" }).textContent).toContain(
    "নমুনা রং",
  );
});
