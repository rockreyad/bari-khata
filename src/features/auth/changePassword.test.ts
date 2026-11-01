import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canChangeEmailPassword,
  changeEmailPassword,
  type PasswordClient,
} from "./changePassword";
const sdk = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: sdk.createClient }));
const account = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "owner@example.com",
  phone: null,
};
const fields = {
  currentPassword: "old-password",
  password: "new-password",
  confirmation: "new-password",
};
function fixture() {
  const user = { id: account.id, email: account.email, app_metadata: {} };
  const cloud = {
    auth: {
      signInWithPassword: vi
        .fn()
        .mockResolvedValue({
          data: { user, session: { access_token: "test-only" } },
          error: null,
        }),
      updateUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  };
  let owner: string | null = account.id;
  const create = vi.fn(() => cloud as unknown as PasswordClient);
  return {
    cloud,
    user,
    create,
    changeOwner: (value: string | null) => {
      owner = value;
    },
    options: { createClient: create, readOwner: () => owner },
  };
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());
describe("email password change", () => {
  it("verifies the current password in an isolated session before changing the exact owner", async () => {
    const test = fixture();
    await changeEmailPassword(account, fields, test.options);
    expect(test.cloud.auth.signInWithPassword).toHaveBeenCalledWith({
      email: account.email,
      password: fields.currentPassword,
    });
    expect(test.cloud.auth.updateUser).toHaveBeenCalledWith({
      password: fields.password,
      current_password: fields.currentPassword,
    });
    expect(test.cloud.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("rejects phone-only and manual alias accounts before creating a client", async () => {
    const test = fixture();
    const phone = { ...account, email: null, phone: "+8801700000091" };
    const alias = { ...account, email: `${"a".repeat(64)}@phone.bari.invalid` };
    expect(canChangeEmailPassword(phone)).toBe(false);
    expect(canChangeEmailPassword(alias)).toBe(false);
    await expect(
      changeEmailPassword(phone, fields, test.options),
    ).rejects.toThrow("password_change_unavailable");
    await expect(
      changeEmailPassword(alias, fields, test.options),
    ).rejects.toThrow("password_change_unavailable");
    expect(test.create).not.toHaveBeenCalled();
  });
  it.each([
    [{ ...fields, currentPassword: "" }, "current_password_required"],
    [{ ...fields, password: "short", confirmation: "short" }, "password_weak"],
    [{ ...fields, confirmation: "different" }, "password_mismatch"],
    [
      {
        ...fields,
        password: fields.currentPassword,
        confirmation: fields.currentPassword,
      },
      "password_same",
    ],
  ])("rejects invalid input before network work", async (input, error) => {
    const test = fixture();
    await expect(
      changeEmailPassword(account, input, test.options),
    ).rejects.toThrow(error);
    expect(test.create).not.toHaveBeenCalled();
  });
  it("does not update after an incorrect current password", async () => {
    const test = fixture();
    test.cloud.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "invalid_credentials" },
    } as never);
    await expect(
      changeEmailPassword(account, fields, test.options),
    ).rejects.toThrow("current_password_invalid");
    expect(test.cloud.auth.updateUser).not.toHaveBeenCalled();
    expect(test.cloud.auth.signOut).toHaveBeenCalledOnce();
  });
  it.each(["id", "email", "manual"])(
    "rejects an identity mismatch in %s",
    async (field) => {
      const test = fixture();
      test.user.id =
        field === "id" ? "00000000-0000-4000-8000-000000000002" : account.id;
      test.user.email = field === "email" ? "other@example.com" : account.email;
      if (field === "manual")
        test.user.app_metadata = { bari_manual_phone_auth: true };
      await expect(
        changeEmailPassword(account, fields, test.options),
      ).rejects.toThrow("account_changed");
      expect(test.cloud.auth.updateUser).not.toHaveBeenCalled();
    },
  );
  it("blocks an account switch during current-password verification", async () => {
    const test = fixture();
    test.cloud.auth.signInWithPassword.mockImplementation(async () => {
      test.changeOwner(null);
      return {
        data: { user: test.user, session: { access_token: "test-only" } },
        error: null,
      };
    });
    await expect(
      changeEmailPassword(account, fields, test.options),
    ).rejects.toThrow("account_changed");
    expect(test.cloud.auth.updateUser).not.toHaveBeenCalled();
    expect(test.cloud.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("uses nonpersistent storage and never installs the verification session into the main client", async () => {
    const test = fixture();
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-publishable-key");
    sdk.createClient.mockReturnValue(test.cloud);
    await changeEmailPassword(account, fields, { readOwner: () => account.id });
    expect(sdk.createClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "test-publishable-key",
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storageKey: expect.stringMatching(/^bari-password-change-/),
        },
      },
    );
    expect(test.cloud.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("maps server password-policy errors and closes the temporary session", async () => {
    const test = fixture();
    test.cloud.auth.updateUser.mockResolvedValue({
      data: { user: null },
      error: { code: "weak_password" },
    } as never);
    await expect(
      changeEmailPassword(account, fields, test.options),
    ).rejects.toThrow("password_weak");
    expect(test.cloud.auth.signOut).toHaveBeenCalledOnce();
  });
});
