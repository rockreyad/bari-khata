// @vitest-environment jsdom
import "fake-indexeddb/auto";
import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageProvider } from "../context/LanguageProvider";
import {
  getAccountDatabase,
  setActiveOwner,
  LedgerDatabase,
} from "../data/database";
import { LedgerRepository } from "../data/repository";
import { LedgerSchema, type Ledger } from "../domain/model";
import { parseAmount } from "../domain/ledger";
import { savePreferences } from "../lib/preferences";
import { ContractCard } from "../features/works/ContractCard";
import { EntitySheet } from "./EntitySheet";

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
const databases: LedgerDatabase[] = [];
afterEach(async () => {
  cleanup();
  setActiveOwner(null);
  for (const database of databases.splice(0)) await database.delete();
  localStorage.clear();
});

it("keeps an edited professional description and its preset draft through IndexedDB reopen and backup without creating money events", async () => {
  savePreferences({ language: "bn" });
  const owner = crypto.randomUUID();
  setActiveOwner(owner);
  const database = getAccountDatabase(owner);
  databases.push(database);
  const repository = new LedgerRepository(database);
  const original = LedgerSchema.parse({
    works: [{ id: "work", name: "নমুনা কাজ" }],
    people: [{ id: "existing", name: "নমুনা সরবরাহকারী", kind: "shop" }],
    entries: [
      {
        id: "old-bill",
        kind: "expense",
        account: "materials",
        personId: "existing",
        lines: [{ id: "old-line", workId: "work", amount: 12000 }],
      },
    ],
  });
  await repository.ensure("real", original);
  const onSave = vi.fn(async (next: Ledger) => {
    await repository.save(next);
  });
  const onClose = vi.fn();
  const props = {
    presentation: "page",
    kind: "person",
    ledger: original,
    mode: "real",
    onSave,
    onClose,
  } as const;
  const mount = () =>
    render(
      <LanguageProvider>
        <EntitySheet {...props} />
      </LanguageProvider>,
    );
  const ready = () =>
    waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "রাখুন" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
  const user = userEvent.setup();
  let view = mount();
  await ready();
  await user.selectOptions(
    screen.getByLabelText("কীভাবে যুক্ত"),
    "professional",
  );
  fireEvent.change(screen.getByLabelText("নাম"), {
    target: { value: "নমুনা পরামর্শক" },
  });
  fireEvent.change(screen.getByLabelText("পরিচয় / কী কাজ করেন"), {
    target: { value: "নমুনা বিশেষ নকশা পরামর্শ" },
  });
  await user.click(screen.getByRole("button", { name: "ফিরুন" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  view.unmount();
  database.close();
  await database.open();
  expect((await repository.read())!.ledger).toEqual(original);
  expect(onSave).not.toHaveBeenCalled();
  view = mount();
  await ready();
  expect(
    (screen.getByLabelText("কীভাবে যুক্ত") as HTMLSelectElement).value,
  ).toBe("professional");
  expect((screen.getByLabelText("নাম") as HTMLInputElement).value).toBe(
    "নমুনা পরামর্শক",
  );
  expect(
    (screen.getByLabelText("পরিচয় / কী কাজ করেন") as HTMLInputElement).value,
  ).toBe("নমুনা বিশেষ নকশা পরামর্শ");
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  view.unmount();
  database.close();
  await database.open();
  const saved = (await repository.read())!.ledger;
  expect(saved.people.find((person) => person.id !== "existing")).toMatchObject(
    {
      name: "নমুনা পরামর্শক",
      role: "নমুনা বিশেষ নকশা পরামর্শ",
      kind: "worker",
      contactType: "professional",
      quickActions: ["payment"],
    },
  );
  expect(saved.entries).toEqual(original.entries);
  expect(saved.contracts).toEqual(original.contracts);
  const professional = saved.people.find((person) => person.id !== "existing")!;
  view = render(
    <LanguageProvider>
      <EntitySheet {...props} ledger={saved} editId={professional.id} />
    </LanguageProvider>,
  );
  await ready();
  expect(
    (screen.getByLabelText("কীভাবে যুক্ত") as HTMLSelectElement).value,
  ).toBe("professional");
  expect(
    (screen.getByLabelText("পরিচয় / কী কাজ করেন") as HTMLInputElement).value,
  ).toBe("নমুনা বিশেষ নকশা পরামর্শ");
  view.unmount();
  const restoredDatabase = new LedgerDatabase(
    `preset-backup-${crypto.randomUUID()}`,
  );
  databases.push(restoredDatabase);
  const restored = new LedgerRepository(restoredDatabase);
  await restored.ensure("real", LedgerSchema.parse({}));
  await restored.importBackup(await repository.exportBackup(), {
    replace: true,
  });
  expect((await restored.read())!.ledger).toEqual(saved);
});

it.each(["87000", "85000"])(
  "saves a %s-taka negotiated agreement without rewriting quantity, rate or computed total",
  async (agreed) => {
    savePreferences({ language: "bn" });
    const owner = crypto.randomUUID();
    setActiveOwner(owner);
    const database = getAccountDatabase(owner);
    databases.push(database);
    const repository = new LedgerRepository(database);
    const ledger = LedgerSchema.parse({
      works: [{ id: "work", name: "নির্মাণের কাজ" }],
      people: [{ id: "worker", name: "মিস্ত্রি", kind: "worker" }],
    });
    await repository.ensure("real", ledger);
    const onClose = vi.fn();
    const onSave = vi.fn(async (next: Ledger) => {
      await repository.save(next);
    });
    const view = render(
      <LanguageProvider>
        <EntitySheet
          presentation="page"
          kind="contract"
          ledger={ledger}
          defaultWorkId="work"
          defaultPersonId="worker"
          onSave={onSave}
          onClose={onClose}
        />
      </LanguageProvider>,
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "রাখুন" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.change(screen.getByLabelText("দর ঠিক হয়েছে"), {
      target: { value: "sqft" },
    });
    fireEvent.change(screen.getByLabelText("কত বর্গফুট"), {
      target: { value: "3796" },
    });
    fireEvent.change(screen.getByLabelText("প্রতি এককের দর"), {
      target: { value: "23" },
    });
    expect(
      parseAmount(
        (screen.getByLabelText("শেষে ঠিক করা টাকা") as HTMLInputElement).value,
      ),
    ).toBe(8730800);
    fireEvent.change(screen.getByLabelText("শেষে ঠিক করা টাকা"), {
      target: { value: agreed },
    });
    expect(view.container.querySelector("s")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "রাখুন" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledOnce();
    view.unmount();
    database.close();
    await database.open();
    const saved = (await repository.read())!.ledger;
    expect(saved.contracts[0]).toMatchObject({
      quantity: "3796",
      rate: 2300,
      calculatedTotal: 8730800,
      total: Number(agreed) * 100,
    });
    const card = render(
      <LanguageProvider>
        <ContractCard ledger={saved} contract={saved.contracts[0]} />
      </LanguageProvider>,
    );
    const calculated = card.container.querySelector(
      's[aria-label="পরিমাণ ও দর অনুযায়ী"]',
    );
    expect(calculated?.textContent).toContain("৮৭,৩০৮");
    card.unmount();
    const edit = render(
      <LanguageProvider>
        <EntitySheet
          presentation="page"
          kind="contract"
          ledger={saved}
          editId={saved.contracts[0].id}
          onSave={onSave}
          onClose={onClose}
        />
      </LanguageProvider>,
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "রাখুন" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(
      parseAmount(
        (screen.getByLabelText("শেষে ঠিক করা টাকা") as HTMLInputElement).value,
      ),
    ).toBe(Number(agreed) * 100);
    await userEvent.click(screen.getByRole("button", { name: "ফিরুন" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
    edit.unmount();
  },
);
