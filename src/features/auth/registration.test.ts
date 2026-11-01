import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({
  createClient: vi.fn(),
  signUp: vi.fn(),
  resend: vi.fn(),
  verifyOtp: vi.fn(),
  getUser: vi.fn(),
  setSession: vi.fn(),
  exchangeCodeForSession: vi.fn(),
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
const accessToken = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl";
const tokenConfirmation = (tokenHash: string) => ({
  kind: "token_hash" as const,
  tokenHash,
});
const accessConfirmation = { kind: "access_token" as const, accessToken };
beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:55431");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public-test-key");
  vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:4180" } });
  sdk.createClient.mockReturnValue({
    auth: {
      signUp: sdk.signUp,
      resend: sdk.resend,
      verifyOtp: sdk.verifyOtp,
      getUser: sdk.getUser,
      setSession: sdk.setSession,
      exchangeCodeForSession: sdk.exchangeCodeForSession,
      signOut: sdk.signOut,
    },
  });
  sdk.signUp.mockResolvedValue({
    data: { user: { id: "test" }, session: null },
    error: null,
  });
  sdk.resend.mockResolvedValue({ error: null });
  sdk.signOut.mockResolvedValue({ error: null });
  sdk.getUser.mockResolvedValue({
    data: {
      user: {
        id: "test",
        email: "friend@example.com",
        email_confirmed_at: "2026-11-01T00:00:00.000Z",
      },
    },
    error: null,
  });
  sdk.verifyOtp.mockResolvedValue({
    data: {
      user: {
        id: "test",
        email: "friend@example.com",
        email_confirmed_at: "2026-11-01T00:00:00.000Z",
      },
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
      confirmation: tokenConfirmation(hash),
      hasCredential: true,
    });
    expect(
      readConfirmation(`?token_hash=${hash}&type=email`, "").confirmation,
    ).toEqual(tokenConfirmation(hash));
    expect(
      readConfirmation(
        `?token_hash=${hash}&type=email`,
        `#token_hash=${hash}&type=email`,
      ).confirmation,
    ).toBeNull();
    expect(
      readConfirmation("", `#token_hash=${hash}&type=recovery`).confirmation,
    ).toBeNull();
    expect(
      readConfirmation("", `#access_token=${hash}&refresh_token=other`)
        .confirmation,
    ).toBeNull();
    expect(readConfirmation("", "")).toEqual({
      confirmation: null,
      hasCredential: false,
    });
  });
  it.each(["signup", "email"])(
    "accepts a default implicit %s callback and discards its refresh token",
    (type) => {
      const input = readConfirmation(
        "",
        `#access_token=${accessToken}&refresh_token=do-not-retain&token_type=bearer&expires_in=3600&expires_at=1793577600&type=${type}`,
      );
      expect(input).toEqual({
        confirmation: accessConfirmation,
        hasCredential: true,
      });
      expect(JSON.stringify(input)).not.toContain("do-not-retain");
    },
  );
  it.each([
    [
      "duplicate access tokens",
      "",
      `#access_token=${accessToken}&access_token=${accessToken}&type=signup`,
    ],
    [
      "duplicate token hashes",
      "",
      `#token_hash=${"a".repeat(64)}&token_hash=${"b".repeat(64)}&type=email`,
    ],
    [
      "duplicate types",
      "",
      `#access_token=${accessToken}&type=signup&type=email`,
    ],
    [
      "duplicate refresh tokens",
      "",
      `#access_token=${accessToken}&refresh_token=first&refresh_token=second&type=signup`,
    ],
    [
      "mixed token families",
      "",
      `#token_hash=${"a".repeat(64)}&access_token=${accessToken}&type=email`,
    ],
    ["split credentials", "?type=signup", `#access_token=${accessToken}`],
    ["query access token", `?access_token=${accessToken}&type=signup`, ""],
    [
      "duplicate credentials across sources",
      `?access_token=${accessToken}&type=signup`,
      `#access_token=${accessToken}&type=signup`,
    ],
    ["PKCE code", "?code=test-code", ""],
    [
      "code with hash",
      "",
      `#token_hash=${"a".repeat(64)}&type=email&code=test-code`,
    ],
    [
      "code with access token",
      "",
      `#access_token=${accessToken}&type=signup&code=test-code`,
    ],
    [
      "error with hash",
      "",
      `#token_hash=${"a".repeat(64)}&type=email&error=denied`,
    ],
    [
      "error with access token",
      "",
      `#access_token=${accessToken}&type=signup&error_code=otp_expired`,
    ],
    ["recovery access token", "", `#access_token=${accessToken}&type=recovery`],
    ["invite access token", "", `#access_token=${accessToken}&type=invite`],
    [
      "magic link access token",
      "",
      `#access_token=${accessToken}&type=magiclink`,
    ],
    ["missing type", "", `#access_token=${accessToken}`],
    ["malformed access token", "", "#access_token=not-a-jwt&type=signup"],
    [
      "oversized access token",
      "",
      `#access_token=${"a".repeat(16384)}.b.c&type=signup`,
    ],
    [
      "wrong token type",
      "",
      `#access_token=${accessToken}&token_type=basic&type=signup`,
    ],
    [
      "provider callback",
      "",
      `#access_token=${accessToken}&provider_token=other&type=signup`,
    ],
  ])("rejects %s and still requests URL scrubbing", (_, search, hash) => {
    expect(readConfirmation(search, hash)).toEqual({
      confirmation: null,
      hasCredential: true,
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
    expect(await confirmRegistration(tokenConfirmation("b".repeat(64)))).toBe(
      "friend@example.com",
    );
    expect(sdk.verifyOtp).toHaveBeenCalledExactlyOnceWith({
      token_hash: "b".repeat(64),
      type: "email",
    });
    expect(sdk.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
  });
  it("verifies a default callback with Auth without accepting a session or touching owner storage", async () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal("localStorage", storage);
    await expect(confirmRegistration(accessConfirmation)).resolves.toBe(
      "friend@example.com",
    );
    expect(sdk.getUser).toHaveBeenCalledExactlyOnceWith(accessToken);
    expect(sdk.verifyOtp).not.toHaveBeenCalled();
    expect(sdk.setSession).not.toHaveBeenCalled();
    expect(sdk.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(sdk.signOut).not.toHaveBeenCalled();
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(sdk.createClient).toHaveBeenCalledWith(
      "http://127.0.0.1:55431",
      "public-test-key",
      {
        auth: expect.objectContaining({
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        }),
      },
    );
  });
  it.each([
    null,
    { email: "friend@example.com", email_confirmed_at: null },
    { email: "friend@example.com", confirmed_at: "2026-11-01T00:00:00.000Z" },
    { email: "invalid", email_confirmed_at: "2026-11-01T00:00:00.000Z" },
  ])(
    "rejects an unconfirmed or missing email returned by Auth: %j",
    async (user) => {
      sdk.getUser.mockResolvedValueOnce({ data: { user }, error: null });
      await expect(confirmRegistration(accessConfirmation)).rejects.toThrow(
        "confirmation_invalid",
      );
      expect(sdk.setSession).not.toHaveBeenCalled();
    },
  );
  it("rejects malformed confirmation input before creating an Auth client", async () => {
    await expect(
      confirmRegistration({ kind: "access_token", accessToken: "invalid" }),
    ).rejects.toThrow("confirmation_invalid");
    expect(sdk.createClient).not.toHaveBeenCalled();
  });
  it("rejects mixed confirmation input at the verification boundary", async () => {
    const input = { ...accessConfirmation, tokenHash: "a".repeat(64) };
    await expect(confirmRegistration(input)).rejects.toThrow(
      "confirmation_invalid",
    );
    expect(sdk.createClient).not.toHaveBeenCalled();
  });
  it.each([
    [
      { name: "AuthRetryableFetchError", message: "Network failed", status: 0 },
      "confirmation_network",
    ],
    [
      { code: "over_request_rate_limit", message: "Too many", status: 429 },
      "confirmation_rate_limited",
    ],
    [
      { code: "bad_jwt", message: "Expired or invalid", status: 401 },
      "confirmation_invalid",
    ],
  ])("classifies callback verification errors: %j", async (error, expected) => {
    sdk.getUser.mockResolvedValueOnce({ data: { user: null }, error });
    await expect(confirmRegistration(accessConfirmation)).rejects.toThrow(
      expected as string,
    );
  });
  it("keeps default callback verification retryable after a thrown network failure", async () => {
    sdk.getUser.mockRejectedValueOnce(new Error("Failed to fetch"));
    await expect(confirmRegistration(accessConfirmation)).rejects.toThrow(
      "confirmation_network",
    );
  });
  it("distinguishes offline confirmation retries from expired links and throttling", async () => {
    sdk.verifyOtp.mockRejectedValueOnce(new Error("Failed to fetch"));
    await expect(
      confirmRegistration(tokenConfirmation("b".repeat(64))),
    ).rejects.toThrow("confirmation_network");
    sdk.verifyOtp.mockResolvedValueOnce({
      data: {},
      error: {
        name: "AuthRetryableFetchError",
        message: "Network failed",
        status: 0,
      },
    });
    await expect(
      confirmRegistration(tokenConfirmation("b".repeat(64))),
    ).rejects.toThrow("confirmation_network");
    sdk.verifyOtp.mockResolvedValueOnce({
      data: {},
      error: {
        code: "over_request_rate_limit",
        message: "Too many",
        status: 429,
      },
    });
    await expect(
      confirmRegistration(tokenConfirmation("b".repeat(64))),
    ).rejects.toThrow("confirmation_rate_limited");
    sdk.verifyOtp.mockResolvedValueOnce({
      data: {},
      error: { code: "otp_expired", message: "Expired", status: 403 },
    });
    await expect(
      confirmRegistration(tokenConfirmation("b".repeat(64))),
    ).rejects.toThrow("confirmation_invalid");
    expect(sdk.signOut).not.toHaveBeenCalled();
  });
});

describe("manual access never sends registration email", () => {
  it("blocks signup and resend before invoking the Auth SDK", async () => {
    vi.stubEnv("VITE_PHONE_AUTH_MODE", "manual");
    await expect(
      registerAccount("friend@example.com", "Password8", "Password8"),
    ).rejects.toThrow("registration_unavailable");
    await expect(resendRegistration("friend@example.com")).rejects.toThrow(
      "registration_unavailable",
    );
    expect(sdk.createClient).not.toHaveBeenCalled();
    expect(sdk.signUp).not.toHaveBeenCalled();
    expect(sdk.resend).not.toHaveBeenCalled();
  });
});
