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
import { usePeopleRoleTabs } from "./usePeopleRoleTabs";

const key = "view:people-type-tabs:v1";
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
      people: [{ id: "person", name: "নমুনা", role: "supplier" }],
    }),
  );
  const before = await repo.read();
  let hook = mount();
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.keys).toBeNull();
  expect(await createStorage().readDraft(key)).toBeNull();
  await act(async () => {
    expect(
      await hook.result.current.saveKeys(["professional", "supplier"]),
    ).toBe(true);
  });
  hook.unmount();
  repo.database.close();
  await repo.database.open();
  hook = mount();
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.keys).toEqual(["professional", "supplier"]);
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
    await hook.result.current.saveKeys(["supplier"]);
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
    await hook.result.current.saveKeys(["craftsperson"]);
  });
  setActiveOwner(first);
  hook.rerender({ mode: "real" });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.keys).toEqual(["supplier"]);
  setActiveOwner(second);
  hook.rerender({ mode: "real" });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.keys).toEqual([]);
  hook.rerender({ mode: "demo" });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.keys).toEqual(["craftsperson"]);
});

it("starts type preferences independently without reading or overwriting old role tabs", async () => {
  account();
  const legacyKey = "view:people-role-tabs:v1";
  const legacyValue = { version: 1, keys: ["ইঞ্জিনিয়ার", "ডিলার"] };
  await createStorage().saveDraft(legacyKey, legacyValue);
  const hook = mount();
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.keys).toBeNull();
  expect(hook.result.current.error).toBe("");
  expect(await createStorage().readDraft(key)).toBeNull();
  await act(async () => {
    expect(await hook.result.current.saveKeys(["professional"])).toBe(true);
  });
  expect(await createStorage().readDraft(key)).toEqual({
    version: 1,
    keys: ["professional"],
  });
  expect(await createStorage().readDraft(legacyKey)).toEqual(legacyValue);
});

it.each([
  { version: 2, keys: ["supplier"] },
  { version: 1, keys: [" "] },
  { version: 1, keys: ["supplier", "supplier"] },
  { version: 1, keys: ["ইঞ্জিনিয়ার"] },
  { version: 1, keys: Array(9).fill("supplier") },
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
    expect(await hook.result.current.saveKeys(["supplier"])).toBe(true);
  });
  expect(hook.result.current.error).toBe("");
  expect(await createStorage().readDraft(key)).toEqual({
    version: 1,
    keys: ["supplier"],
  });
});

it("retries a failed read without writing defaults", async () => {
  account();
  await createStorage().saveDraft(key, { version: 1, keys: ["supplier"] });
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
    keys: ["supplier"],
  });
  fail = false;
  act(() => hook.result.current.retry());
  await waitFor(() =>
    expect(hook.result.current.ready && !hook.result.current.error).toBe(true),
  );
  expect(hook.result.current.keys).toEqual(["supplier"]);
});

it("keeps the old selection on write failure and rejects invalid explicit choices without a write", async () => {
  account();
  await createStorage().saveDraft(key, { version: 1, keys: ["supplier"] });
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
    expect(await hook.result.current.saveKeys(["professional"])).toBe(false);
  });
  expect(hook.result.current.keys).toEqual(["supplier"]);
  expect(hook.result.current.error).not.toBe("");
  expect(await createStorage().readDraft(key)).toEqual({
    version: 1,
    keys: ["supplier"],
  });
  await act(async () => {
    expect(await hook.result.current.saveKeys(["supplier", "supplier"])).toBe(
      false,
    );
  });
  expect(writes).toHaveBeenCalledOnce();
  expect(hook.result.current.keys).toEqual(["supplier"]);
  fail = false;
  await act(async () => {
    expect(await hook.result.current.saveKeys([])).toBe(true);
  });
  expect(hook.result.current.keys).toEqual([]);
  expect(hook.result.current.error).toBe("");
});

it("hides old account choices immediately and ignores late reads and callbacks from the old scope", async () => {
  const first = account();
  await createStorage().saveDraft(key, { version: 1, keys: ["supplier"] });
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
  await createStorage().saveDraft(key, { version: 1, keys: ["supplier"] });
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
    pending = oldSave(["professional"]);
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
    keys: ["professional"],
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
    pending = apply(["supplier"]);
  });
  hook.unmount();
  await act(async () => {
    gate.resolve();
    expect(await pending).toBe(false);
  });
  expect(await apply([])).toBe(false);
  expect(await createStorage().readDraft(key)).toEqual({
    version: 1,
    keys: ["supplier"],
  });
});
