// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageProvider } from "../context/LanguageProvider";
import { getAccountDatabase, setActiveOwner } from "../data/database";
import {
  createWorkspaceStorage,
  getScopedRepository,
} from "../data/repository";
import { LedgerSchema, type Ledger } from "../domain/model";
import { EntitySheet } from "./EntitySheet";

let owner: string | undefined;
afterEach(async () => {
  cleanup();
  if (owner) await getAccountDatabase(owner).delete();
  setActiveOwner(null);
  localStorage.clear();
});

it("creates and edits one worker in multiple notebooks, retaining draft choices and saved fields through reopening", async () => {
  owner = crypto.randomUUID();
  setActiveOwner(owner);
  const repo = getScopedRepository("real");
  const initial = LedgerSchema.parse({
    works: [
      { id: "bathroom", name: "বাথরুম" },
      { id: "electric", name: "ইলেকট্রিক" },
    ],
  });
  await repo.ensure("real", initial);
  const user = userEvent.setup();
  const onClose = vi.fn();
  const onSave = vi.fn(async (ledger: Ledger) => {
    await repo.save(ledger);
  });
  const mount = (ledger: Ledger, editId?: string) =>
    render(
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
  const ready = () =>
    waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "রাখুন" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
  const first = mount(initial);
  await ready();
  await user.click(screen.getByRole("button", { name: "মিস্ত্রি" }));
  await user.type(screen.getByLabelText("নাম", { exact: true }), "মোরশেদ");
  await user.type(
    screen.getByRole("combobox", { name: "পরিচয় / কী কাজ করেন" }),
    "ইঞ্জিনিয়ার",
  );
  await user.click(screen.getByRole("checkbox", { name: "বাথরুম" }));
  await user.click(screen.getByRole("checkbox", { name: "ইলেকট্রিক" }));
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  first.unmount();
  repo.database.close();
  await repo.database.open();
  const saved = (await repo.read())!.ledger;
  expect(saved.people[0]).toMatchObject({
    name: "মোরশেদ",
    kind: "worker",
    role: "ইঞ্জিনিয়ার",
    workIds: ["bathroom", "electric"],
  });
  expect(saved.entries).toEqual([]);
  expect(saved.contracts).toEqual([]);

  const editing = mount(saved, saved.people[0].id);
  await ready();
  expect(
    (screen.getByRole("checkbox", { name: "ইলেকট্রিক" }) as HTMLInputElement)
      .checked,
  ).toBe(true);
  await user.click(screen.getByRole("checkbox", { name: "ইলেকট্রিক" }));
  const role = screen.getByRole("combobox", { name: "পরিচয় / কী কাজ করেন" });
  await user.clear(role);
  await user.type(role, "ডিলার");
  await user.click(screen.getByRole("button", { name: "ফিরুন" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  editing.unmount();
  const storage = createWorkspaceStorage("real");
  expect(
    await storage.readDraft(`entity:person:${saved.people[0].id}:any`),
  ).toMatchObject({
    personWorkIds: ["bathroom"],
    role: "ডিলার",
  });
  const restored = mount(saved, saved.people[0].id);
  await ready();
  expect(
    (screen.getByRole("checkbox", { name: "ইলেকট্রিক" }) as HTMLInputElement)
      .checked,
  ).toBe(false);
  expect(
    (
      screen.getByRole("combobox", {
        name: "পরিচয় / কী কাজ করেন",
      }) as HTMLInputElement
    ).value,
  ).toBe("ডিলার");
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(3));
  restored.unmount();
  repo.database.close();
  await repo.database.open();
  expect((await repo.read())!.ledger.people[0]).toMatchObject({
    kind: "worker",
    role: "ডিলার",
    workIds: ["bathroom"],
  });
  expect(
    await storage.readDraft(`entity:person:${saved.people[0].id}:any`),
  ).toBeNull();
});
