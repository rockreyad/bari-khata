import { z } from "zod";
import { setActiveOwner } from "./database";

export const AUTH_STORAGE_KEY = "bari-khata-auth-v2";
const CACHE_KEY = "bari-khata-account-v2";
export const ACCOUNT_LOCK_STORAGE_KEY = "bari-khata-account-locked-v2";
export function isAccountLocked() {
  try {
    return localStorage.getItem(ACCOUNT_LOCK_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
export const ACCOUNT_LOCK_EVENT = "bari-khata-account-locked";
export const AccountUserSchema = z.object({
  id: z.uuid(),
  email: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
});
export type AccountUser = z.infer<typeof AccountUserSchema>;

export function readRememberedAccount(): AccountUser | null {
  try {
    if (isAccountLocked()) return null;
    const parsed = AccountUserSchema.safeParse(
      JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null"),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function rememberAccount(user: AccountUser) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify(AccountUserSchema.parse(user)),
    );
    localStorage.removeItem(ACCOUNT_LOCK_STORAGE_KEY);
  } catch {
    /* Private browsing can deny storage. */
  }
}

export function lockAccount() {
  setActiveOwner(null);
  try {
    localStorage.setItem(ACCOUNT_LOCK_STORAGE_KEY, "1");
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(`${AUTH_STORAGE_KEY}-code-verifier`);
  } catch {
    /* The in-memory lock still takes effect. */
  }
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(ACCOUNT_LOCK_EVENT));
}
