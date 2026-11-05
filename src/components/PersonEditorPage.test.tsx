// @vitest-environment jsdom
import "fake-indexeddb/auto";
import type { SelectHTMLAttributes } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageProvider } from "../context/LanguageProvider";
import { getAccountDatabase, setActiveOwner } from "../data/database";
import {
  createWorkspaceStorage,
  getScopedRepository,
} from "../data/repository";
import { LedgerSchema, type Ledger } from "../domain/model";
import { defaultContactAccount } from "../domain/contacts";
import { setEntityRemoved } from "../domain/entityDeletion";
import { latinDigits } from "../lib/numerals";
import { savePreferences } from "../lib/preferences";
import { EntitySheet } from "./EntitySheet";

vi.mock("./ui/AppSelect", () => ({
  AppSelect: (props: SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props} />
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

it("keeps a name typed while a device contact import is pending and saves only the imported phone", async () => {
  const initial = fixture();
  const repo = await repository(initial);
  const user = userEvent.setup();
  const originalPicker = Object.getOwnPropertyDescriptor(navigator, "contacts");
  const originalSecure = Object.getOwnPropertyDescriptor(
    window,
    "isSecureContext",
  );
  let complete!: (contacts: unknown[]) => void;
  const selected = new Promise<unknown[]>((resolve) => {
    complete = resolve;
  });
  const select = vi.fn(() => selected);
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(navigator, "contacts", {
    configurable: true,
    value: { select },
  });
  try {
    const onClose = vi.fn();
    const onSave = vi.fn(async (ledger: Ledger) => {
      await repo.save(ledger);
    });
    mount(initial, onSave, onClose);
    await ready();
    await user.selectOptions(screen.getByLabelText("কীভাবে যুক্ত"), "supplier");
    const name = screen.getByLabelText("দোকানের নাম") as HTMLInputElement;
    expect(name.value).toBe("");
    await user.click(screen.getByRole("button", { name: "কন্টাক্ট থেকে নিন" }));
    expect(select).toHaveBeenCalledWith(["name", "tel"], { multiple: false });
    await user.type(name, "নমুনা নিজের লেখা দোকান");
    await act(async () => {
      complete([{ name: ["নমুনা কন্টাক্টের নাম"], tel: ["01700000091"] }]);
      await selected;
    });
    await waitFor(() =>
      expect(
        latinDigits(
          (screen.getByLabelText("ফোন নম্বর") as HTMLInputElement).value,
        ),
      ).toBe("01700000091"),
    );
    expect(name.value).toBe("নমুনা নিজের লেখা দোকান");
    await user.click(screen.getByRole("button", { name: "রাখুন" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    const saved = (await repo.read())!.ledger;
    expect(
      saved.people.find(
        (person) => !initial.people.some((before) => before.id === person.id),
      ),
    ).toMatchObject({ name: "নমুনা নিজের লেখা দোকান", phone: "01700000091" });
    expect(saved.entries).toEqual(initial.entries);
    expect(saved.contracts).toEqual(initial.contracts);
  } finally {
    if (originalPicker)
      Object.defineProperty(navigator, "contacts", originalPicker);
    else Reflect.deleteProperty(navigator, "contacts");
    if (originalSecure)
      Object.defineProperty(window, "isSecureContext", originalSecure);
    else Reflect.deleteProperty(window, "isSecureContext");
  }
});

function fixture() {
  return LedgerSchema.parse({
    works: [{ id: "roof", name: "নমুনা ছাদ" }],
    people: [
      {
        id: "worker",
        name: "নমুনা মিস্ত্রি",
        kind: "worker",
        workIds: ["roof"],
      },
      {
        id: "shop",
        name: "নমুনা দোকান",
        kind: "shop",
        role: "ডিলার",
        phone: "01700000001",
        quickActions: ["purchase"],
        workIds: ["roof"],
      },
    ],
    contracts: [
      { id: "job", personId: "worker", workId: "roof", total: 100000 },
    ],
    entries: [
      {
        id: "bill",
        kind: "expense",
        personId: "worker",
        account: "labour",
        contractId: "job",
        lines: [
          { id: "line", workId: "roof", costType: "labour", amount: 50000 },
        ],
      },
      {
        id: "paid",
        kind: "payment",
        personId: "worker",
        account: "labour",
        contractId: "job",
        relatedEntryId: "bill",
        allocations: [{ workId: "roof", amount: 20000 }],
        paymentParts: [{ method: "cash", amount: 20000 }],
      },
    ],
  });
}

async function repository(ledger = fixture()) {
  owner = crypto.randomUUID();
  setActiveOwner(owner);
  savePreferences({ language: "bn" });
  const repo = getScopedRepository("real");
  await repo.ensure("real", ledger);
  return repo;
}
function mount(
  ledger: Ledger,
  onSave: (value: Ledger) => Promise<void>,
  onClose: () => void,
  editId?: string,
) {
  return render(
    <LanguageProvider>
      <EntitySheet
        presentation="page"
        kind="person"
        ledger={ledger}
        editId={editId}
        onSave={onSave}
        onClose={onClose}
      />
    </LanguageProvider>,
  );
}
async function ready() {
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "রাখুন" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.querySelector('[aria-modal="true"]')).toBeNull();
}
async function preferences(user: ReturnType<typeof userEvent.setup>) {
  const summary = screen
    .getByText("কোন হিসাব রাখবেন", { exact: true })
    .closest("summary")!;
  const details = summary.closest("details")!;
  if (!details.open) await user.click(summary);
  return within(details);
}

it("creates and reopens a shop with optional fields empty and an explicitly empty action selection", async () => {
  const initial = fixture();
  const repo = await repository(initial);
  const user = userEvent.setup();
  const onClose = vi.fn();
  const onSave = vi.fn(async (ledger: Ledger) => {
    await repo.save(ledger);
  });
  const first = mount(initial, onSave, onClose);
  await ready();
  expect(
    screen.getByRole("heading", { level: 1, name: "পক্ষ যোগ করি" }),
  ).toBeTruthy();
  expect(screen.getByText("মানুষ বা প্রতিষ্ঠান", { exact: true })).toBeTruthy();
  await user.selectOptions(screen.getByLabelText("কীভাবে যুক্ত"), "supplier");
  await user.type(screen.getByLabelText("দোকানের নাম"), "নমুনা নতুন দোকান");
  const actions = await preferences(user);
  for (const name of ["টাকা দিলাম", "মাল কেনা", "মাল ফেরত"])
    await user.click(actions.getByRole("button", { name, pressed: true }));
  await user.selectOptions(screen.getByLabelText("কীভাবে যুক্ত"), "supplier");
  for (const name of ["টাকা দিলাম", "মাল কেনা", "মাল ফেরত"])
    expect(
      actions.getByRole("button", { name }).getAttribute("aria-pressed"),
    ).toBe("false");
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  first.unmount();
  repo.database.close();
  await repo.database.open();
  const saved = (await repo.read())!.ledger;
  const shop = saved.people.find(
    (person) => person.name === "নমুনা নতুন দোকান",
  )!;
  expect(shop).toMatchObject({
    kind: "shop",
    contactType: "supplier",
    phone: "",
    role: "",
    quickActions: [],
    workIds: [],
  });
  expect(saved.entries).toEqual(initial.entries);
  expect(saved.contracts).toEqual(initial.contracts);

  const editing = mount(saved, onSave, onClose, shop.id);
  await ready();
  expect(
    screen.getByRole("heading", { level: 1, name: "পক্ষের তথ্য" }),
  ).toBeTruthy();
  expect((screen.getByLabelText("দোকানের নাম") as HTMLInputElement).value).toBe(
    shop.name,
  );
  expect((screen.getByLabelText("ফোন নম্বর") as HTMLInputElement).value).toBe(
    "",
  );
  const reopenedActions = await preferences(user);
  await user.selectOptions(screen.getByLabelText("কীভাবে যুক্ত"), "supplier");
  for (const name of ["টাকা দিলাম", "মাল কেনা", "মাল ফেরত"])
    expect(
      reopenedActions
        .getByRole("button", { name })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  await user.clear(screen.getByLabelText("দোকানের নাম"));
  await user.type(screen.getByLabelText("দোকানের নাম"), "নমুনা দোকান সংশোধিত");
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  editing.unmount();
  repo.database.close();
  await repo.database.open();
  const updated = (await repo.read())!.ledger;
  expect(updated.people.find((person) => person.id === shop.id)).toMatchObject({
    name: "নমুনা দোকান সংশোধিত",
    quickActions: [],
  });
  expect(updated.people).toHaveLength(initial.people.length + 1);
  expect(updated.entries).toEqual(initial.entries);
  expect(updated.contracts).toEqual(initial.contracts);
  expect(
    await createWorkspaceStorage().readDraft(`entity:person:${shop.id}:any`),
  ).toBeNull();
});

it("keeps the explicitly selected type after saving and reopening a freely edited description", async () => {
  const initial = fixture();
  const repo = await repository(initial);
  const user = userEvent.setup();
  const onClose = vi.fn();
  const onSave = vi.fn(async (ledger: Ledger) => {
    await repo.save(ledger);
  });
  const first = mount(initial, onSave, onClose, "worker");
  await ready();
  await user.selectOptions(
    screen.getByLabelText("কীভাবে যুক্ত"),
    "professional",
  );
  const description = screen.getByRole("combobox", {
    name: "পরিচয় / কী কাজ করেন",
  });
  await user.clear(description);
  await user.type(description, "বালু ভরাটের তদারকি");
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  first.unmount();
  repo.database.close();
  await repo.database.open();
  const saved = (await repo.read())!.ledger;
  expect(saved.people.find((person) => person.id === "worker")).toMatchObject({
    contactType: "professional",
    kind: "worker",
    role: "বালু ভরাটের তদারকি",
  });
  expect(saved.entries).toEqual(initial.entries);
  expect(saved.contracts).toEqual(initial.contracts);

  const second = mount(saved, onSave, onClose, "worker");
  await ready();
  expect(
    (screen.getByLabelText("কীভাবে যুক্ত") as HTMLSelectElement).value,
  ).toBe("professional");
  const reopenedDescription = screen.getByRole("combobox", {
    name: "পরিচয় / কী কাজ করেন",
  });
  expect((reopenedDescription as HTMLInputElement).value).toBe(
    "বালু ভরাটের তদারকি",
  );
  await user.clear(reopenedDescription);
  await user.type(reopenedDescription, "রড ও সিমেন্ট");
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  second.unmount();
  const updated = (await repo.read())!.ledger;
  expect(updated.people.find((person) => person.id === "worker")).toMatchObject(
    {
      contactType: "professional",
      kind: "worker",
      role: "রড ও সিমেন্ট",
    },
  );
  expect(updated.entries).toEqual(initial.entries);
  expect(updated.contracts).toEqual(initial.contracts);
});

it("lets an explicit custom type configure shortcuts without rewriting a legacy shop's financial kind or records", async () => {
  const base = fixture();
  const initial = LedgerSchema.parse({
    ...base,
    people: base.people.map((person) =>
      person.id === "shop"
        ? {
            ...person,
            contactType: "custom",
            quickActions: ["payment", "purchase", "return", "transport"],
          }
        : person,
    ),
    entries: [
      ...base.entries,
      {
        id: "shop-bill",
        kind: "expense",
        personId: "shop",
        account: "materials",
        lines: [
          {
            id: "shop-bill-line",
            workId: "roof",
            label: "সিমেন্ট",
            costType: "material",
            amount: 30000,
          },
        ],
      },
      {
        id: "shop-paid",
        kind: "payment",
        personId: "shop",
        account: "materials",
        relatedEntryId: "shop-bill",
        allocations: [{ workId: "roof", amount: 10000 }],
        paymentParts: [{ method: "cash", amount: 10000 }],
      },
    ],
  });
  const repo = await repository(initial);
  const user = userEvent.setup();
  const onClose = vi.fn();
  const onSave = vi.fn(async (ledger: Ledger) => {
    await repo.save(ledger);
  });
  mount(initial, onSave, onClose, "shop");
  await ready();
  expect(
    (screen.getByLabelText("কীভাবে যুক্ত") as HTMLSelectElement).value,
  ).toBe("");
  const actions = await preferences(user);
  for (const name of ["মাল কেনা", "মাল ফেরত", "আনার খরচ"]) {
    const button = actions.getByRole("button", { name }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await user.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("false");
  }
  expect(
    actions.getByRole("button", { name: "টাকা দিলাম", pressed: true }),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  const saved = (await repo.read())!.ledger;
  const person = saved.people.find((person) => person.id === "shop")!;
  expect(person).toMatchObject({
    contactType: "custom",
    kind: "shop",
    roles: ["custom"],
    quickActions: ["payment"],
  });
  expect(defaultContactAccount(person)).toBe("other");
  expect(saved.entries).toEqual(initial.entries);
  expect(saved.contracts).toEqual(initial.contracts);
});

it("keeps failed edit values and custom actions in a reopening draft, then saves without changing financial records", async () => {
  const initial = fixture();
  const repo = await repository(initial);
  const before = structuredClone(initial);
  const user = userEvent.setup();
  const onClose = vi.fn();
  let fail = true;
  const onSave = vi.fn(async (ledger: Ledger) => {
    if (fail) throw new Error("synthetic save failure");
    await repo.save(ledger);
  });
  const editing = mount(initial, onSave, onClose, "shop");
  await ready();
  await user.clear(screen.getByLabelText("দোকানের নাম"));
  await user.type(screen.getByLabelText("দোকানের নাম"), "নমুনা বদলানো দোকান");
  const role = screen.getByRole("combobox", { name: "কী বিক্রি করেন" });
  await user.clear(role);
  await user.type(role, "সরবরাহকারী");
  const phone = screen.getByLabelText("ফোন নম্বর");
  await user.clear(phone);
  await user.type(phone, "01700000002");
  const actions = await preferences(user);
  expect(
    actions
      .getByRole("button", { name: "মাল কেনা" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  await user.selectOptions(screen.getByLabelText("কীভাবে যুক্ত"), "supplier");
  expect(
    actions
      .getByRole("button", { name: "টাকা দিলাম" })
      .getAttribute("aria-pressed"),
  ).toBe("false");
  expect(
    actions
      .getByRole("button", { name: "মাল ফেরত" })
      .getAttribute("aria-pressed"),
  ).toBe("false");
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
  expect((screen.getByLabelText("দোকানের নাম") as HTMLInputElement).value).toBe(
    "নমুনা বদলানো দোকান",
  );
  expect((role as HTMLInputElement).value).toBe("সরবরাহকারী");
  expect(latinDigits((phone as HTMLInputElement).value)).toBe("01700000002");
  expect((await repo.read())!.ledger).toEqual(before);
  await user.click(screen.getByRole("button", { name: "ফিরুন" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  editing.unmount();
  expect(
    await createWorkspaceStorage().readDraft("entity:person:shop:any"),
  ).toMatchObject({
    name: "নমুনা বদলানো দোকান",
    role: "সরবরাহকারী",
    phone: "01700000002",
    quickActions: ["purchase"],
  });
  const reopened = mount(initial, onSave, onClose, "shop");
  await ready();
  expect((screen.getByLabelText("দোকানের নাম") as HTMLInputElement).value).toBe(
    "নমুনা বদলানো দোকান",
  );
  expect(
    (
      screen.getByRole("combobox", {
        name: "কী বিক্রি করেন",
      }) as HTMLInputElement
    ).value,
  ).toBe("সরবরাহকারী");
  const restoredActions = await preferences(user);
  expect(
    restoredActions
      .getByRole("button", { name: "মাল কেনা" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  fail = false;
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  reopened.unmount();
  const saved = (await repo.read())!.ledger;
  expect(saved.people.find((person) => person.id === "shop")).toMatchObject({
    name: "নমুনা বদলানো দোকান",
    role: "সরবরাহকারী",
    phone: "01700000002",
    workIds: ["roof"],
    quickActions: ["purchase"],
  });
  expect(saved.entries).toEqual(before.entries);
  expect(saved.contracts).toEqual(before.contracts);
  expect(initial).toEqual(before);
});

it.each([
  {
    kind: "মিস্ত্রি / কারিগর",
    presetId: "craftsperson",
    actions: ["টাকা দিলাম"],
  },
  {
    kind: "গাড়ি / পরিবহন",
    presetId: "transport",
    actions: ["টাকা দিলাম", "আনার খরচ"],
  },
  {
    kind: "নিজের মতো",
    presetId: "",
    actions: ["টাকা দিলাম", "মাল কেনা", "মাল ফেরত", "আনার খরচ"],
  },
])(
  "offers appropriate optional actions for $kind on the page",
  async ({ presetId, actions: allowed }) => {
    const initial = LedgerSchema.parse({});
    await repository(initial);
    const user = userEvent.setup();
    const onSave = vi.fn(async (_value: Ledger) => {});
    mount(initial, onSave, vi.fn());
    await ready();
    await user.selectOptions(screen.getByLabelText("কীভাবে যুক্ত"), presetId);
    expect(
      (screen.getByLabelText("নাম", { exact: true }) as HTMLInputElement)
        .required,
    ).toBe(true);
    expect(
      (screen.getByLabelText("ফোন নম্বর") as HTMLInputElement).required,
    ).toBe(false);
    const actions = await preferences(user);
    for (const name of ["টাকা দিলাম", "মাল কেনা", "মাল ফেরত", "আনার খরচ"]) {
      expect(
        (actions.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(!allowed.includes(name));
      expect(
        actions.getByRole("button", { name }).getAttribute("aria-pressed"),
      ).toBe(String(allowed.includes(name)));
    }
    expect(onSave).not.toHaveBeenCalled();
  },
);

it.each([
  { state: "missing", notice: "এই নামটি পাওয়া যাচ্ছে না।" },
  { state: "archived", notice: "নামটি মুছে রাখা আছে। আগে ফিরিয়ে আনুন।" },
])(
  "prevents editing or saving a $state person while keeping the back action available",
  async ({ state, notice }) => {
    const initial = fixture();
    const ledger =
      state === "archived"
        ? setEntityRemoved(initial, "person", "shop", true)
        : initial;
    const repo = await repository(ledger);
    const onSave = vi.fn(async (_value: Ledger) => {});
    const onClose = vi.fn();
    const user = userEvent.setup();
    const page = mount(
      ledger,
      onSave,
      onClose,
      state === "missing" ? "unknown-person" : "shop",
    );
    expect((await screen.findByRole("status")).textContent).toBe(notice);
    expect(page.container.querySelector("form")).toBeNull();
    expect(
      page.container.querySelectorAll("input,textarea,select"),
    ).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "রাখুন" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "ফিরুন" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSave).not.toHaveBeenCalled();
    expect((await repo.read())!.ledger).toEqual(ledger);
  },
);

it("keeps multiple independent roles and identity type after reopening, and removes a role without altering financial history", async () => {
  const initial = fixture();
  const repo = await repository(initial);
  const user = userEvent.setup();
  const onClose = vi.fn();
  const onSave = vi.fn(async (ledger: Ledger) => {
    await repo.save(ledger);
  });
  const first = mount(initial, onSave, onClose, "worker");
  await ready();
  await user.selectOptions(
    screen.getByLabelText("কীভাবে যুক্ত"),
    "craftsperson",
  );
  await user.selectOptions(
    screen.getByLabelText("ব্যক্তি না প্রতিষ্ঠান"),
    "person",
  );
  await user.click(screen.getByText("আরও কাজ বা সম্পর্ক", { exact: true }));
  await user.click(screen.getByRole("checkbox", { name: "দোকানদার" }));
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  first.unmount();
  repo.database.close();
  await repo.database.open();
  const saved = (await repo.read())!.ledger;
  expect(saved.people.find((person) => person.id === "worker")).toMatchObject({
    roles: ["craftsperson", "supplier"],
    identityType: "person",
  });
  const second = mount(saved, onSave, onClose, "worker");
  await ready();
  await user.click(screen.getByText("আরও কাজ বা সম্পর্ক", { exact: true }));
  expect(
    (screen.getByRole("checkbox", { name: "দোকানদার" }) as HTMLInputElement)
      .checked,
  ).toBe(true);
  await user.click(screen.getByRole("checkbox", { name: "মিস্ত্রি / কারিগর" }));
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  second.unmount();
  const updated = (await repo.read())!.ledger;
  expect(updated.people.find((person) => person.id === "worker")).toMatchObject(
    { roles: ["supplier"], identityType: "person" },
  );
  expect(updated.entries).toEqual(initial.entries);
  expect(updated.contracts).toEqual(initial.contracts);
});
