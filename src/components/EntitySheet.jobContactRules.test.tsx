// @vitest-environment jsdom
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EntitySheet } from "./EntitySheet";
import { LedgerSchema, type Ledger } from "../domain/model";

const storage = vi.hoisted(() => ({ drafts: new Map<string, unknown>() }));
vi.mock("../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    formatDigits: String,
    number: String,
    t: (text: string) => text,
    money: (value: number) => String(value / 100),
    language: "bn",
  }),
}));
vi.mock("./Sheet", () => ({
  Sheet: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}));
vi.mock("../data/repository", () => ({
  createWorkspaceStorage: () => ({
    readDraft: async (key: string) => storage.drafts.get(key) ?? null,
    saveDraft: async (key: string, value: unknown) =>
      storage.drafts.set(key, value),
    removeDraft: async (key: string) => storage.drafts.delete(key),
  }),
}));
vi.mock("./ui/AppSelect", () => ({
  AppSelect: (props: SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props} />
  ),
}));
vi.mock("./ui/AppDatePicker", () => ({
  AppDatePicker: (props: InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));
beforeEach(() => storage.drafts.clear());
afterEach(cleanup);

function fixture() {
  return LedgerSchema.parse({
    works: [{ id: "work", name: "নমুনা সেক্টর" }],
    people: [
      {
        id: "worker",
        name: "নমুনা কারিগর",
        kind: "worker",
        contactType: "craftsperson",
      },
      {
        id: "engineer",
        name: "নমুনা পরামর্শক",
        kind: "other",
        contactType: "professional",
      },
      {
        id: "other",
        name: "নমুনা নিজের নাম",
        kind: "other",
        contactType: "custom",
      },
      {
        id: "shop",
        name: "নমুনা দোকান",
        kind: "shop",
        contactType: "supplier",
      },
      {
        id: "driver",
        name: "নমুনা গাড়ি",
        kind: "driver",
        contactType: "transport",
      },
      {
        id: "custom-shop",
        name: "নমুনা পুরোনো দোকান",
        kind: "shop",
        contactType: "custom",
      },
      {
        id: "archived",
        name: "সরানো নমুনা নাম",
        kind: "worker",
        archivedAt: "2026-11-05T00:00:00.000Z",
        removalHistory: [
          { id: "remove", at: "2026-11-05T00:00:00.000Z", archived: true },
        ],
      },
    ],
  });
}
async function open(
  ledger: Ledger,
  options: { defaultPersonId?: string; editId?: string } = {},
) {
  const onSave = vi.fn(async (_next: Ledger) => {});
  const view = render(
    <EntitySheet
      kind="contract"
      mode="demo"
      ledger={ledger}
      onSave={onSave}
      onClose={vi.fn()}
      {...options}
    />,
  );
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "রাখুন" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  return { ...view, onSave };
}
function fillJob() {
  fireEvent.change(screen.getByLabelText("কাজের নাম"), {
    target: { value: "নমুনা কাজ" },
  });
  fireEvent.change(screen.getByLabelText("কাজের টাকা"), {
    target: { value: "1000" },
  });
}

it("offers eligible people with a generic job-owner label and saves a professional without changing identity or money", async () => {
  const ledger = fixture();
  const initial = structuredClone(ledger);
  const { onSave } = await open(ledger);
  const select = screen.getByLabelText("কার কাজ");
  expect(screen.queryByLabelText("মিস্ত্রি")).toBeNull();
  expect(
    within(select)
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value),
  ).toEqual(["", "worker", "engineer", "other", "__new__"]);
  await userEvent.selectOptions(select, "engineer");
  fillJob();
  await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  const next = onSave.mock.calls[0][0];
  expect(next.contracts[0]).toMatchObject({
    personId: "engineer",
    total: 100000,
  });
  expect(next.people).toEqual(initial.people);
  expect(next.entries).toEqual(initial.entries);
  expect(ledger).toEqual(initial);
});

it.each(["shop", "driver", "custom-shop"])(
  "preserves an ineligible restored %s agreement draft and rejects a new agreement",
  async (personId) => {
    const ledger = fixture();
    const original = structuredClone(ledger);
    storage.drafts.set(`entity:contract:new:${personId}`, {
      id: "draft-job",
      personId,
      total: "2500",
      notes: "নমুনা অসমাপ্ত লেখা",
    });
    const { container, onSave } = await open(ledger, {
      defaultPersonId: personId,
    });
    const select = screen.getByLabelText("কার কাজ");
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(
      within(select).queryByRole("option", {
        name: ledger.people.find((person) => person.id === personId)!.name,
      }),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("কাজের টাকা") as HTMLInputElement).value,
    ).toBe("2500");
    fireEvent.submit(container.querySelector("form")!);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "এই ধরনের নামে",
    );
    expect(onSave).not.toHaveBeenCalled();
    expect(storage.drafts.get(`entity:contract:new:${personId}`)).toMatchObject(
      { personId, total: "2500" },
    );
    expect(ledger).toEqual(original);
  },
);

it.each(["shop", "driver"])(
  "retains the original historic %s job and its payments while preserving its locked identity",
  async (personId) => {
    const base = fixture();
    const ledger = LedgerSchema.parse({
      ...base,
      contracts: [
        {
          id: "old-job",
          personId,
          scope: "work",
          workId: "work",
          title: "আগের নমুনা কাজ",
          total: 100000,
          status: "done",
        },
      ],
      entries: [
        {
          id: "paid",
          kind: "payment",
          personId,
          contractId: "old-job",
          account: "labour",
          allocations: [{ workId: "work", amount: 20000 }],
          paymentParts: [{ amount: 20000 }],
        },
      ],
    });
    const original = structuredClone(ledger);
    const { onSave } = await open(ledger, { editId: "old-job" });
    const select = screen.getByLabelText("কার কাজ") as HTMLSelectElement;
    expect(select.value).toBe(personId);
    expect(select.disabled).toBe(true);
    expect(
      within(select).queryByRole("option", {
        name: personId === "shop" ? "নমুনা গাড়ি" : "নমুনা দোকান",
      }),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText("নোট"), {
      target: { value: "পরের বার দেখে রাখব" },
    });
    fireEvent.change(screen.getByLabelText("কেন বদলালেন"), {
      target: { value: "নোট রেখেছি" },
    });
    await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const next = onSave.mock.calls[0][0];
    expect(next.contracts[0]).toMatchObject({
      personId,
      total: 100000,
      status: "done",
      notes: "পরের বার দেখে রাখব",
    });
    expect(next.people).toEqual(original.people);
    expect(next.entries).toEqual(original.entries);
    expect(ledger).toEqual(original);
  },
);

it("rejects an ineligible restored reassignment and permits an eligible owner for an unused agreement", async () => {
  const ledger = LedgerSchema.parse({
    ...fixture(),
    contracts: [
      {
        id: "old-job",
        personId: "shop",
        scope: "house",
        workId: null,
        total: 100000,
      },
    ],
  });
  const original = structuredClone(ledger);
  storage.drafts.set("entity:contract:old-job:any", {
    id: "old-job",
    personId: "driver",
    notes: "নমুনা অসমাপ্ত নোট",
    contractReason: "নোট রেখেছি",
  });
  const { container, onSave } = await open(ledger, { editId: "old-job" });
  const select = screen.getByLabelText("কার কাজ") as HTMLSelectElement;
  expect(select.disabled).toBe(false);
  expect(
    within(select).getByRole("option", { name: "নমুনা দোকান" }),
  ).toBeTruthy();
  expect(
    within(select).getByRole("option", { name: "নমুনা গাড়ি" }),
  ).toBeTruthy();
  fireEvent.submit(container.querySelector("form")!);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "এই ধরনের নামে",
  );
  expect(onSave).not.toHaveBeenCalled();
  await userEvent.selectOptions(select, "engineer");
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0][0].contracts[0]).toMatchObject({
    personId: "engineer",
    notes: "নমুনা অসমাপ্ত নোট",
    total: 100000,
  });
  expect(onSave.mock.calls[0][0].entries).toEqual(original.entries);
});

it("creates a neutral inline contact without inventing a tradesperson identity", async () => {
  const ledger = fixture();
  const { onSave } = await open(ledger);
  await userEvent.selectOptions(screen.getByLabelText("কার কাজ"), "__new__");
  fireEvent.change(screen.getByLabelText("নাম"), {
    target: { value: "নমুনা স্থপতি" },
  });
  fillJob();
  await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  const next = onSave.mock.calls[0][0];
  const added = next.people.find((person) => person.name === "নমুনা স্থপতি")!;
  expect(added).toMatchObject({
    kind: "other",
    contactType: "custom",
    role: "",
  });
  expect(next.contracts[0].personId).toBe(added.id);
  expect(next.entries).toEqual([]);
});
