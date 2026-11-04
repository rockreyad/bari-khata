// @vitest-environment jsdom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../context/LanguageProvider";
import {
  getAccountDatabase,
  getActiveOwner,
  getWorkspaceDatabase,
  setActiveOwner,
  type WorkspaceMode,
} from "../../data/database";
import * as repository from "../../data/repository";
import { LedgerSchema } from "../../domain/model";
import { savePreferences } from "../../lib/preferences";
import { roleKey } from "./peopleRoles";
import { usePeopleRoleTabs } from "./usePeopleRoleTabs";

const key = "view:people-role-tabs:v1";
const createStorage = repository.createWorkspaceStorage;
const owners: string[] = [];
function account() {
  const owner = crypto.randomUUID();
  owners.push(owner);
  setActiveOwner(owner);
  return owner;
}
function wrapper({ children }: { children: ReactNode }) {
  return <LanguageProvider>{children}</LanguageProvider>;
}
function mount(mode: WorkspaceMode = "real") {
  return renderHook(({ mode }) => usePeopleRoleTabs(mode), {
    initialProps: { mode },
    wrapper,
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
beforeEach(() => {
  savePreferences({ language: "bn" });
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  for (const owner of owners.splice(0))
    await getAccountDatabase(owner).delete();
  await getWorkspaceDatabase("demo").drafts.delete(`demo:${key}`);
  setActiveOwner(null);
  localStorage.clear();
});

it("keeps absence distinct from [] across IndexedDB reopening without changing a ledger", async () => {
  account();
  const repo = repository.getScopedRepository();
  await repo.ensure(
    "real",
    LedgerSchema.parse({
      people: [{ id: "person", name: "নমুনা", role: "ডিলার" }],
    }),
  );
  const before = await repo.read();
  let hook = mount();
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.keys).toBeNull();
  expect(await createStorage().readDraft(key)).toBeNull();
  await act(async () => {
    expect(
      await hook.result.current.saveKeys(["  ইঞ্জিনিয়ার  ", "ডিলার"]),
    ).toBe(true);
  });
  hook.unmount();
  repo.database.close();
  await repo.database.open();
  hook = mount();
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.keys).toEqual([
    roleKey("ইঞ্জিনিয়ার"),
    roleKey("ডিলার"),
  ]);
  await act(async () => {
    expect(await hook.result.current.saveKeys([])).toBe(true);
  });
  hook.unmount();
  repo.database.close();
  await repo.database.open();
  hook = mount();
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.keys).toEqual([]);
  expect(await createStorage().readDraft(key)).toEqual({
    version: 1,
    keys: [],
  });
  expect(await repo.read()).toEqual(before);
});

it("isolates each account and demo choices when the current scope changes", async () => {
  const first = account();
  const hook = mount();
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(async () => {
    await hook.result.current.saveKeys(["ডিলার"]);
  });
  const second = account();
  hook.rerender({ mode: "real" });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.keys).toBeNull();
  await act(async () => {
    await hook.result.current.saveKeys([]);
  });
  hook.rerender({ mode: "demo" });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.keys).toBeNull();
  await act(async () => {
    await hook.result.current.saveKeys(["প্লাম্বার"]);
  });
  setActiveOwner(first);
  hook.rerender({ mode: "real" });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.keys).toEqual([roleKey("ডিলার")]);
  setActiveOwner(second);
  hook.rerender({ mode: "real" });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.keys).toEqual([]);
  hook.rerender({ mode: "demo" });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.keys).toEqual([roleKey("প্লাম্বার")]);
});

it("preserves full canonical keys when a valid 200-character Bengali role expands during normalization", async () => {
  account();
  const label = "য়".repeat(200);
  const normalized = roleKey(label);
  expect(normalized.length).toBeGreaterThan(200);
  const hook = mount();
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(async () => {
    expect(await hook.result.current.saveKeys([normalized])).toBe(true);
  });
  expect(hook.result.current.keys).toEqual([normalized]);
  hook.unmount();
  const reopened = mount();
  await waitFor(() => expect(reopened.result.current.ready).toBe(true));
  expect(reopened.result.current.keys).toEqual([normalized]);
});

it.each([
  { version: 2, keys: ["ডিলার"] },
  { version: 1, keys: [" "] },
  { version: 1, keys: ["Dealer", "dealer"] },
  { version: 1, keys: ["1", "2", "3", "4", "5", "6", "7"] },
  { version: 1, keys: ["x".repeat(4001)] },
  { version: 1, keys: [3] },
])(
  "shows malformed saved choices without overwriting them: %j",
  async (value) => {
    const owner = account();
    await createStorage().saveDraft(key, value);
    const database = getAccountDatabase(owner);
    const before = await database.drafts.get(`real:${key}`);
    const hook = mount();
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(hook.result.current.keys).toBeNull();
    expect(hook.result.current.error).not.toBe("");
    expect(await database.drafts.get(`real:${key}`)).toEqual(before);
  },
);

it("recovers an unreadable preference only after explicitly applying a valid replacement", async () => {
  account();
  await createStorage().saveDraft(key, { version: 99, keys: ["old"] });
  const hook = mount();
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.error).not.toBe("");
  await act(async () => {
    expect(await hook.result.current.saveKeys(["ডিলার"])).toBe(true);
  });
  expect(hook.result.current.error).toBe("");
  expect(await createStorage().readDraft(key)).toEqual({
    version: 1,
    keys: [roleKey("ডিলার")],
  });
});

it("retries a failed read without writing defaults", async () => {
  account();
  await createStorage().saveDraft(key, { version: 1, keys: ["ডিলার"] });
  let fail = true;
  vi.spyOn(repository, "createWorkspaceStorage").mockImplementation((mode) => {
    const storage = createStorage(mode);
    return {
      ...storage,
      readDraft: async <T,>(draftKey: string) => {
        if (fail) throw new Error("synthetic read failure");
        return storage.readDraft<T>(draftKey);
      },
    };
  });
  const hook = mount();
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.error).not.toBe("");
  expect(await createStorage().readDraft(key)).toEqual({
    version: 1,
    keys: ["ডিলার"],
  });
  fail = false;
  act(() => hook.result.current.retry());
  await waitFor(() =>
    expect(hook.result.current.ready && !hook.result.current.error).toBe(true),
  );
  expect(hook.result.current.keys).toEqual(["ডিলার"]);
});

it("keeps the old selection on write failure and rejects invalid explicit choices without a write", async () => {
  account();
  await createStorage().saveDraft(key, { version: 1, keys: ["ডিলার"] });
  let fail = true;
  const writes = vi.fn();
  vi.spyOn(repository, "createWorkspaceStorage").mockImplementation((mode) => {
    const storage = createStorage(mode);
    return {
      ...storage,
      saveDraft: (draftKey, value) => {
        writes(value);
        if (fail)
          return Dexie.Promise.reject(new Error("synthetic write failure"));
        return storage.saveDraft(draftKey, value);
      },
    };
  });
  const hook = mount();
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(async () => {
    expect(await hook.result.current.saveKeys(["ইঞ্জিনিয়ার"])).toBe(false);
  });
  expect(hook.result.current.keys).toEqual(["ডিলার"]);
  expect(hook.result.current.error).not.toBe("");
  expect(await createStorage().readDraft(key)).toEqual({
    version: 1,
    keys: ["ডিলার"],
  });
  await act(async () => {
    expect(await hook.result.current.saveKeys(["Dealer", "dealer"])).toBe(
      false,
    );
  });
  expect(writes).toHaveBeenCalledOnce();
  expect(hook.result.current.keys).toEqual(["ডিলার"]);
  fail = false;
  await act(async () => {
    expect(await hook.result.current.saveKeys([])).toBe(true);
  });
  expect(hook.result.current.keys).toEqual([]);
  expect(hook.result.current.error).toBe("");
});

it("hides old account choices immediately and ignores late reads and callbacks from the old scope", async () => {
  const first = account();
  await createStorage().saveDraft(key, { version: 1, keys: ["ডিলার"] });
  const second = account();
  await createStorage().saveDraft(key, { version: 1, keys: [] });
  setActiveOwner(first);
  const stale = deferred<unknown>();
  const next = deferred<unknown>();
  let deferFirst = false;
  const writes = vi.fn();
  vi.spyOn(repository, "createWorkspaceStorage").mockImplementation((mode) => {
    const owner = getActiveOwner();
    const storage = createStorage(mode);
    return {
      ...storage,
      readDraft: async <T,>(draftKey: string): Promise<T | null> => {
        if (owner === first && deferFirst) return (await stale.promise) as T;
        if (owner === second) return (await next.promise) as T;
        return storage.readDraft<T>(draftKey);
      },
      saveDraft: (draftKey, value) => {
        writes();
        return storage.saveDraft(draftKey, value);
      },
    };
  });
  const hook = mount();
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  const oldSave = hook.result.current.saveKeys;
  deferFirst = true;
  act(() => hook.result.current.retry());
  setActiveOwner(second);
  hook.rerender({ mode: "real" });
  expect(hook.result.current.keys).toBeNull();
  expect(hook.result.current.ready).toBe(false);
  await act(async () => {
    stale.resolve({ version: 1, keys: ["old"] });
    await stale.promise;
  });
  expect(hook.result.current.keys).toBeNull();
  await act(async () => {
    expect(await oldSave(["wrong-account"])).toBe(false);
  });
  expect(writes).not.toHaveBeenCalled();
  await act(async () => {
    next.resolve({ version: 1, keys: [] });
    await next.promise;
  });
  expect(hook.result.current.keys).toEqual([]);
  expect(hook.result.current.ready).toBe(true);
});

it("keeps an in-flight write in its captured account and never publishes it after a scope change or unmount", async () => {
  const first = account();
  await createStorage().saveDraft(key, { version: 1, keys: ["ডিলার"] });
  const second = account();
  await createStorage().saveDraft(key, { version: 1, keys: [] });
  setActiveOwner(first);
  const gate = deferred<void>();
  const writes = vi.fn();
  vi.spyOn(repository, "createWorkspaceStorage").mockImplementation((mode) => {
    const storage = createStorage(mode);
    return {
      ...storage,
      saveDraft: (draftKey, value) => {
        writes();
        return Dexie.Promise.resolve(gate.promise).then(() =>
          storage.saveDraft(draftKey, value),
        );
      },
    };
  });
  const hook = mount();
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  const oldSave = hook.result.current.saveKeys;
  let pending!: Promise<boolean>;
  act(() => {
    pending = oldSave(["ইঞ্জিনিয়ার"]);
  });
  expect(hook.result.current.saving).toBe(true);
  setActiveOwner(second);
  hook.rerender({ mode: "real" });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(async () => {
    gate.resolve();
    expect(await pending).toBe(false);
  });
  expect(hook.result.current.keys).toEqual([]);
  expect(hook.result.current.saving).toBe(false);
  expect(await createStorage().readDraft(key)).toEqual({
    version: 1,
    keys: [],
  });
  setActiveOwner(first);
  expect(await createStorage().readDraft(key)).toEqual({
    version: 1,
    keys: [roleKey("ইঞ্জিনিয়ার")],
  });
  hook.unmount();
  expect(await oldSave(["after-unmount"])).toBe(false);
  expect(writes).toHaveBeenCalledOnce();
});

it("returns no successful apply after unmount even when the captured write finishes", async () => {
  account();
  const gate = deferred<void>();
  vi.spyOn(repository, "createWorkspaceStorage").mockImplementation((mode) => {
    const storage = createStorage(mode);
    return {
      ...storage,
      saveDraft: (draftKey, value) =>
        Dexie.Promise.resolve(gate.promise).then(() =>
          storage.saveDraft(draftKey, value),
        ),
    };
  });
  const hook = mount();
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  const apply = hook.result.current.saveKeys;
  let pending!: Promise<boolean>;
  act(() => {
    pending = apply(["ডিলার"]);
  });
  hook.unmount();
  await act(async () => {
    gate.resolve();
    expect(await pending).toBe(false);
  });
  expect(await apply([])).toBe(false);
  expect(await createStorage().readDraft(key)).toEqual({
    version: 1,
    keys: ["ডিলার"],
  });
});
