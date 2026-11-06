// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { getAccountDatabase, setActiveOwner } from "../../data/database";
import {
  createWorkspaceStorage,
  getScopedRepository,
} from "../../data/repository";
import { QuickDraftSchema } from "../entries/quickEntry";
import { LegacyEntryDrafts } from "./LegacyEntryDrafts";
const state = vi.hoisted(() => ({
  ledger: null as unknown,
  base: "",
  mode: "real" as "real" | "demo",
  go: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({ ...state, ledger: state.ledger as Ledger }),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({ t: String, formatDigits: String }),
}));
let owner: string | undefined;
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  if (owner) await getAccountDatabase(owner).delete();
  owner = undefined;
  setActiveOwner(null);
  state.base = "";
  state.mode = "real";
  vi.clearAllMocks();
});
function ledger() {
  return LedgerSchema.parse({
    works: [{ id: "roof", name: "নমুনা সেক্টর" }],
    people: [{ id: "party", name: "নমুনা পক্ষ" }],
  });
}
function savedDraft(change: Record<string, unknown> = {}) {
  return {
    draft: QuickDraftSchema.parse({
      id: "legacy-entry",
      paymentId: "legacy-paid",
      refundId: "legacy-refund",
      personNewId: "new-party",
      kind: "payment",
      purpose: "advance",
      account: "labour",
      costType: "labour",
      personId: "party",
      workId: "roof",
      contractId: "contract",
      amount: "125",
      note: "নমুনা অসমাপ্ত লেখা",
      date: "2026-11-05",
      ...change,
    }),
    files: [],
  };
}
async function setup(initial = ledger()) {
  owner = crypto.randomUUID();
  setActiveOwner(owner);
  state.ledger = initial;
  await getScopedRepository().ensure("real", initial);
  return createWorkspaceStorage();
}
function mount(back = "/") {
  return render(
    <MemoryRouter
      initialEntries={[`${state.base}/write?${new URLSearchParams({ back })}`]}
    >
      <LegacyEntryDrafts />
    </MemoryRouter>,
  );
}
it.each(["", "/sample"])(
  "resumes the exact old draft key and preserves its context with one safe canonical %s return path",
  async (base) => {
    const storage = await setup();
    state.base = base;
    const key =
      "quick-v2:payment:roof:party:advance:account=labour:job=contract";
    const source = savedDraft();
    await storage.saveDraft(key, source);
    await storage.saveDraft("house-payment:other", { note: "নমুনা অন্য ফর্ম" });
    mount(`${base}/people/party?work=roof&_quick=1`);
    fireEvent.click(
      await screen.findByRole("button", { name: "নমুনা অসমাপ্ত লেখা" }),
    );
    const path = state.go.mock.calls[0][0] as string;
    const url = new URL(path, "https://bari.invalid");
    expect(url.pathname).toBe("/entries/new");
    expect(url.searchParams.get("draftKey")).toBe(key);
    expect(url.searchParams.get("back")).toBe(
      `${base}/parties/party?work=roof`,
    );
    expect(
      Object.fromEntries(
        ["kind", "purpose", "person", "work", "contract"].map((key) => [
          key,
          url.searchParams.get(key),
        ]),
      ),
    ).toEqual({
      kind: "payment",
      purpose: "advance",
      person: "party",
      work: "roof",
      contract: "contract",
    });
    expect(await storage.readDraft(key)).toEqual(source);
  },
);
it.each(["id", "paymentId", "refundId"] as const)(
  "omits an already saved draft when its %s has been recorded without deleting its stored copy",
  async (field) => {
    const source = savedDraft();
    const current = LedgerSchema.parse({
      ...ledger(),
      entries: [
        {
          id: source.draft[field],
          kind: "expense",
          personId: "party",
          lines: [{ id: "line", workId: "roof", amount: 100 }],
        },
      ],
    });
    const storage = await setup(current);
    await storage.saveDraft("quick-v2:saved", source);
    await storage.saveDraft(
      "quick-v2:blank",
      savedDraft({
        id: "blank",
        paymentId: "blank-paid",
        refundId: "blank-refund",
        amount: "",
        note: "",
      }),
    );
    await storage.saveDraft(
      "quick-v2:unsaved",
      savedDraft({
        id: "still-writing",
        paymentId: "still-paid",
        refundId: "still-refund",
        note: "নমুনা এখনও অসমাপ্ত",
      }),
    );
    mount();
    expect(
      await screen.findByRole("button", { name: "নমুনা এখনও অসমাপ্ত" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "নমুনা অসমাপ্ত লেখা" }),
    ).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(await storage.readDraft("quick-v2:saved")).toEqual(source);
  },
);
it("rejects an unsafe return path and keeps an invalid stored draft intact", async () => {
  const storage = await setup();
  await storage.saveDraft("quick-v2:valid", savedDraft());
  const view = mount("https://outside.invalid/account");
  fireEvent.click(
    await screen.findByRole("button", { name: "নমুনা অসমাপ্ত লেখা" }),
  );
  expect(
    new URL(state.go.mock.calls[0][0], "https://bari.invalid").searchParams.get(
      "back",
    ),
  ).toBe("/");
  view.unmount();
  await storage.saveDraft("quick-v2:broken", { draft: { id: 99 } });
  mount();
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain(
      "লেখাগুলো রাখা আছে",
    ),
  );
  expect(await storage.readDraft("quick-v2:broken")).toEqual({
    draft: { id: 99 },
  });
});

it("masks the previous account's drafts immediately when the mounted drawer changes owner", async () => {
  const firstStorage = await setup();
  const firstOwner = owner!;
  const firstLedger = state.ledger as Ledger;
  const firstDraft = savedDraft({ note: "নমুনা প্রথম মালিকের লেখা" });
  await firstStorage.saveDraft("quick-v2:owner-one", firstDraft);
  const view = mount();
  expect(
    await screen.findByRole("button", { name: "নমুনা প্রথম মালিকের লেখা" }),
  ).toBeTruthy();
  const secondOwner = crypto.randomUUID();
  try {
    setActiveOwner(secondOwner);
    const secondLedger = ledger();
    await getScopedRepository().ensure("real", secondLedger);
    const secondStorage = createWorkspaceStorage();
    const secondDraft = savedDraft({ note: "নমুনা দ্বিতীয় মালিকের লেখা" });
    await secondStorage.saveDraft("quick-v2:owner-two", secondDraft);
    state.ledger = secondLedger;
    view.rerender(
      <MemoryRouter>
        <LegacyEntryDrafts />
      </MemoryRouter>,
    );
    expect(
      screen.queryByRole("button", { name: "নমুনা প্রথম মালিকের লেখা" }),
    ).toBeNull();
    expect(
      await screen.findByRole("button", { name: "নমুনা দ্বিতীয় মালিকের লেখা" }),
    ).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    setActiveOwner(firstOwner);
    state.ledger = firstLedger;
    view.rerender(
      <MemoryRouter>
        <LegacyEntryDrafts />
      </MemoryRouter>,
    );
    expect(
      screen.queryByRole("button", { name: "নমুনা দ্বিতীয় মালিকের লেখা" }),
    ).toBeNull();
    expect(
      await screen.findByRole("button", { name: "নমুনা প্রথম মালিকের লেখা" }),
    ).toBeTruthy();
    expect(await firstStorage.readDraft("quick-v2:owner-one")).toEqual(
      firstDraft,
    );
    expect(await secondStorage.readDraft("quick-v2:owner-two")).toEqual(
      secondDraft,
    );
  } finally {
    view.unmount();
    setActiveOwner(firstOwner);
    await getAccountDatabase(secondOwner).delete();
  }
});

it("resumes an old work-step cost draft by its exact key without changing other drafts", async () => {
  const storage = await setup();
  const key = "house-cost:charge:party:roof:contract:phase";
  const source = savedDraft({
    kind: "expense",
    note: "নমুনা পুরোনো কাজের বিল",
    rows: [{ id: "line", label: "নমুনা কাজ", amount: "125" }],
  });
  const legacy = {
    ...source,
    draft: { ...source.draft, milestoneId: "phase" },
    useAdvance: true,
    advanceSignature: "saved-choice",
  };
  await storage.saveDraft(key, legacy);
  const otherKey = "house-cost:charge:party:roof:contract:another-phase";
  const other = savedDraft({ note: "নমুনা অন্য অসমাপ্ত বিল" });
  await storage.saveDraft(otherKey, other);
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "নমুনা পুরোনো কাজের বিল" }),
  );
  const url = new URL(state.go.mock.calls[0][0], "https://bari.invalid");
  expect(url.pathname).toBe("/write/charge");
  expect(url.searchParams.get("draftKey")).toBe(key);
  expect(url.searchParams.get("contract")).toBe("contract");
  expect(url.searchParams.has("milestone")).toBe(false);
  expect(await storage.readDraft(key)).toEqual(legacy);
  expect(await storage.readDraft(otherKey)).toEqual(other);
});
