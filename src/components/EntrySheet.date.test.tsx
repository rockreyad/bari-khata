// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageProvider } from "../context/LanguageProvider";
import {
  getAccountDatabase,
  setActiveOwner,
  type LedgerDatabase,
} from "../data/database";
import { LedgerRepository } from "../data/repository";
import { LedgerSchema, type Ledger } from "../domain/model";
import { savePreferences } from "../lib/preferences";
import { EntrySheet } from "./EntrySheet";

const databases: LedgerDatabase[] = [];
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
afterEach(async () => {
  cleanup();
  setActiveOwner(null);
  for (const database of databases.splice(0)) await database.delete();
  localStorage.clear();
});

it.each([
  { layout: "desktop", compact: false },
  { layout: "mobile", compact: true },
])(
  "persists the first calendar selection on immediate Save and reopening in $layout layout",
  async ({ compact }) => {
    window.matchMedia = vi.fn((query: string) => ({
      matches: compact,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    savePreferences({ language: "bn" });
    const owner = crypto.randomUUID();
    setActiveOwner(owner);
    const database = getAccountDatabase(owner);
    databases.push(database);
    const repository = new LedgerRepository(database);
    const original = LedgerSchema.parse({
      works: [{ id: "materials", name: "মালের খাতা" }],
      people: [{ id: "shop", name: "মালের দোকান", kind: "shop" }],
      entries: [
        {
          id: "bill",
          kind: "expense",
          account: "materials",
          personId: "shop",
          date: "2026-11-01",
          createdAt: "2026-11-01T10:00:00Z",
          updatedAt: "2026-11-01T10:00:00Z",
          lines: [
            {
              id: "line",
              workId: "materials",
              label: "সিমেন্ট",
              amount: 150000,
            },
          ],
        },
        {
          id: "payment",
          kind: "payment",
          account: "materials",
          personId: "shop",
          relatedEntryId: "bill",
          date: "2026-11-02",
          createdAt: "2026-11-02T11:00:00Z",
          updatedAt: "2026-11-02T11:00:00Z",
          allocations: [{ workId: "materials", amount: 150000 }],
          paymentParts: [{ method: "cash", amount: 150000 }],
        },
      ],
    });
    await repository.ensure("real", original);
    const onSave = vi.fn(async (next: Ledger) => {
      await repository.save(next);
    });
    const onClose = vi.fn();
    const mount = (ledger: Ledger) =>
      render(
        <LanguageProvider>
          <EntrySheet
            presentation="page"
            ledger={ledger}
            editEntryId="bill"
            onSave={onSave}
            onClose={onClose}
          />
        </LanguageProvider>,
      );
    const user = userEvent.setup();
    let view = mount(original);
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "সংরক্ষণ করুন",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(
      '[data-control="date"]',
    )!;
    const before = trigger.textContent;
    await user.click(trigger);
    await user.click(
      screen.getByRole("button", {
        name: "বৃহস্পতিবার, ৫ নভেম্বর, ২০২৬",
      }),
    );
    const selected = trigger.textContent;
    expect(selected).not.toBe(before);
    await user.click(screen.getByRole("button", { name: "সংরক্ষণ করুন" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledOnce();
    view.unmount();
    database.close();
    await database.open();
    const saved = (await repository.read())!.ledger;
    expect(saved.entries).toHaveLength(2);
    expect(saved.entries[0].date).toBe("2026-11-05");
    expect(saved.entries[0].revisions.at(-1)?.before.date).toBe("2026-11-01");
    expect(saved.entries[1]).toEqual(original.entries[1]);
    expect(await database.drafts.count()).toBe(0);
    view = mount(saved);
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "সংরক্ষণ করুন",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(
      view.container.querySelector('[data-control="date"]')!.textContent,
    ).toBe(selected);
    await user.click(
      screen.getByRole("button", { name: "অসমাপ্ত লেখা বাদ দিন" }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
    expect(onSave).toHaveBeenCalledOnce();
    view.unmount();
  },
);
