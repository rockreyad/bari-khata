import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({
  createClient: vi.fn(),
  signUp: vi.fn(),
  resend: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: sdk.createClient }));
import {
  confirmRegistration,
  confirmationRedirect,
  readConfirmation,
  registerAccount,
  resendRegistration,
  validateRegistration,
  registrationErrorText,
} from "./registration";
beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:55431");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public-test-key");
  vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:4180" } });
  sdk.createClient.mockReturnValue({
    auth: {
      signUp: sdk.signUp,
      resend: sdk.resend,
      verifyOtp: sdk.verifyOtp,
      signOut: sdk.signOut,
    },
  });
  sdk.signUp.mockResolvedValue({
    data: { user: { id: "test" }, session: null },
    error: null,
  });
  sdk.resend.mockResolvedValue({ error: null });
  sdk.signOut.mockResolvedValue({ error: null });
  sdk.verifyOtp.mockResolvedValue({
    data: {
      user: { id: "test", email: "friend@example.com" },
      session: { access_token: "ephemeral-session" },
    },
    error: null,
  });
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("registration validation", () => {
  it("normalizes email while preserving password characters, rejects weak or mismatched passwords", () => {
    expect(
      validateRegistration(" Friend@Example.com ", " aBcdefg ", " aBcdefg "),
    ).toEqual({
      email: "friend@example.com",
      password: " aBcdefg ",
      confirmation: " aBcdefg ",
    });
    expect(() =>
      validateRegistration("broken", "12345678", "12345678"),
    ).toThrow("invalid_email");
    expect(() =>
      validateRegistration("friend@example.com", "1234567", "1234567"),
    ).toThrow("password_weak");
    expect(() =>
      validateRegistration("friend@example.com", "12345678", "different"),
    ).toThrow("password_mismatch");
  });
  it("pins the confirmation destination to the current origin and a fixed path", () => {
    expect(
      confirmationRedirect(
        "https://bari.example/other?next=https://evil.example",
      ),
    ).toBe("https://bari.example/auth/confirm");
    expect(() => confirmationRedirect("javascript:alert(1)")).toThrow(
      "invalid_origin",
    );
  });
  it("accepts only one email-confirmation token, including fragment links, and rejects recovery or duplicate tokens", () => {
    const hash = "a".repeat(64);
    expect(readConfirmation("", `#token_hash=${hash}&type=email`)).toEqual({
      tokenHash: hash,
      hasCredential: true,
    });
    expect(
      readConfirmation(`?token_hash=${hash}&type=email`, "").tokenHash,
    ).toBe(hash);
    expect(
      readConfirmation(
        `?token_hash=${hash}&type=email`,
        `#token_hash=${hash}&type=email`,
      ).tokenHash,
    ).toBeNull();
    expect(
      readConfirmation("", `#token_hash=${hash}&type=recovery`).tokenHash,
    ).toBeNull();
    expect(
      readConfirmation("", `#access_token=${hash}&refresh_token=other`)
        .tokenHash,
    ).toBeNull();
    expect(readConfirmation("", "")).toEqual({
      tokenHash: null,
      hasCredential: false,
    });
  });
});
describe("isolated email registration", () => {
  it("uses a nonpersisted auth client and never touches an existing owner's storage", async () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal("localStorage", storage);
    await registerAccount(" Friend@Example.com ", "12345678", "12345678");
    expect(sdk.createClient).toHaveBeenCalledWith(
      "http://127.0.0.1:55431",
      "public-test-key",
      {
        auth: expect.objectContaining({
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storageKey: expect.stringMatching(/^bari-registration-/),
        }),
      },
    );
    expect(sdk.signUp).toHaveBeenCalledExactlyOnceWith({
      email: "friend@example.com",
      password: "12345678",
      options: { emailRedirectTo: "http://127.0.0.1:4180/auth/confirm" },
    });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(sdk.signOut).not.toHaveBeenCalled();
  });
  it("requires server-side confirmation rather than silently accepting an auto-confirmed session", async () => {
    sdk.signUp.mockResolvedValue({
      data: { session: { access_token: "unexpected" } },
      error: null,
    });
    await expect(
      registerAccount("friend@example.com", "12345678", "12345678"),
    ).rejects.toThrow("registration_confirmation_required");
    expect(sdk.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
  });
  it("keeps existing-email outcomes generic and distinguishes weak-password and rate-limit errors", async () => {
    sdk.signUp.mockResolvedValue({
      data: { session: null },
      error: { code: "user_already_exists" },
    });
    await expect(
      registerAccount("friend@example.com", "12345678", "12345678"),
    ).resolves.toBeUndefined();
    sdk.signUp.mockResolvedValue({
      data: { session: null },
      error: { code: "weak_password" },
    });
    await expect(
      registerAccount("friend@example.com", "12345678", "12345678"),
    ).rejects.toThrow("password_weak");
    sdk.signUp.mockResolvedValue({
      data: { session: null },
      error: { code: "validation_failed" },
    });
    await expect(
      registerAccount("friend@example.com", "12345678", "12345678"),
    ).rejects.toThrow("registration_failed");
    sdk.signUp.mockResolvedValue({
      data: { session: null },
      error: { code: "over_email_send_rate_limit" },
    });
    await expect(
      registerAccount("friend@example.com", "12345678", "12345678"),
    ).rejects.toThrow("registration_rate_limited");
    expect(registrationErrorText("unexpected")).not.toContain(
      "user_already_exists",
    );
  });
  it("resends signup confirmation using the same fixed callback and validates email first", async () => {
    await resendRegistration("friend@example.com");
    expect(sdk.resend).toHaveBeenCalledExactlyOnceWith({
      type: "signup",
      email: "friend@example.com",
      options: { emailRedirectTo: "http://127.0.0.1:4180/auth/confirm" },
    });
    await expect(resendRegistration("broken")).rejects.toThrow("invalid_email");
    expect(sdk.resend).toHaveBeenCalledTimes(1);
  });
  it("verifies email only and ends the isolated confirmation session without accepting an owner session", async () => {
    expect(await confirmRegistration("b".repeat(64))).toBe(
      "friend@example.com",
    );
    expect(sdk.verifyOtp).toHaveBeenCalledExactlyOnceWith({
      token_hash: "b".repeat(64),
      type: "email",
    });
    expect(sdk.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
  });
  it("distinguishes offline confirmation retries from expired links and throttling", async () => {
    sdk.verifyOtp.mockRejectedValueOnce(new Error("Failed to fetch"));
    await expect(confirmRegistration("b".repeat(64))).rejects.toThrow(
      "confirmation_network",
    );
    sdk.verifyOtp.mockResolvedValueOnce({
      data: {},
      error: {
        name: "AuthRetryableFetchError",
        message: "Network failed",
        status: 0,
      },
    });
    await expect(confirmRegistration("b".repeat(64))).rejects.toThrow(
      "confirmation_network",
    );
    sdk.verifyOtp.mockResolvedValueOnce({
      data: {},
      error: {
        code: "over_request_rate_limit",
        message: "Too many",
        status: 429,
      },
    });
    await expect(confirmRegistration("b".repeat(64))).rejects.toThrow(
      "confirmation_rate_limited",
    );
    sdk.verifyOtp.mockResolvedValueOnce({
      data: {},
      error: { code: "otp_expired", message: "Expired", status: 403 },
    });
    await expect(confirmRegistration("b".repeat(64))).rejects.toThrow(
      "confirmation_invalid",
    );
    expect(sdk.signOut).not.toHaveBeenCalled();
  });
});
