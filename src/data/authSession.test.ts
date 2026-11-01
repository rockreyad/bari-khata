import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_LOCK_EVENT,
  isAccountLocked,
  AUTH_STORAGE_KEY,
  lockAccount,
  readRememberedAccount,
  rememberAccount,
} from "./authSession";
import { getActiveOwner, setActiveOwner } from "./database";

const values = new Map<string, string>();
afterEach(() => {
  values.clear();
  setActiveOwner(null);
  vi.unstubAllGlobals();
});
function storage() {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
}
describe("remembered account access", () => {
  it("validates the remembered user and rejects corrupt persisted data", () => {
    storage();
    const account = {
      id: crypto.randomUUID(),
      email: "owner@example.com",
      phone: null,
    };
    rememberAccount(account);
    expect(readRememberedAccount()).toEqual(account);
    values.set("bari-khata-account-v2", '{"id":"another-account"}');
    expect(readRememberedAccount()).toBeNull();
    values.set("bari-khata-account-v2", "{broken-json");
    expect(readRememberedAccount()).toBeNull();
  });
  it("locks local access synchronously on explicit logout even without the network", () => {
    storage();
    const events = new EventTarget();
    vi.stubGlobal("window", events);
    const listener = vi.fn();
    events.addEventListener(ACCOUNT_LOCK_EVENT, listener);
    const user = { id: crypto.randomUUID(), email: null, phone: null };
    setActiveOwner(user.id);
    rememberAccount(user);
    values.set(AUTH_STORAGE_KEY, "sdk-session");
    lockAccount();
    expect(getActiveOwner()).toBeNull();
    expect(readRememberedAccount()).toBeNull();
    expect(values.has(AUTH_STORAGE_KEY)).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    expect(isAccountLocked()).toBe(true);
    values.set(AUTH_STORAGE_KEY, "a late token refresh rewrote the session");
    expect(readRememberedAccount()).toBeNull();
    expect(isAccountLocked()).toBe(true);
    rememberAccount(user);
    expect(isAccountLocked()).toBe(false);
    expect(readRememberedAccount()).toEqual(user);
  });
});
