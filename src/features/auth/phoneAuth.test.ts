import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizePhoneCode,
  readPhoneAuthMode,
  requestMockPhoneOtp,
  verifyMockPhoneOtp,
  verifyManualPhoneCode,
} from "./phoneAuth";

const phone = "+8801712345678";
const challengeId = "a".repeat(64);
const token = (claim = "8801712345678") =>
  [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(
      JSON.stringify({
        sub: "c867fe3b-d190-416e-9134-a055f84ae626",
        phone: claim,
        aud: "authenticated",
        role: "authenticated",
        iss: "http://127.0.0.1:55431/auth/v1",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url"),
    "b".repeat(43),
  ].join(".");
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("VITE_PHONE_AUTH_MODE", "mock");
  vi.stubEnv("VITE_ENABLE_PHONE_OTP", "false");
  fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("phone sign-in mode and code input", () => {
  it("honours the explicit mode and fails closed for unknown modes", () => {
    expect(readPhoneAuthMode()).toBe("mock");
    vi.stubEnv("VITE_PHONE_AUTH_MODE", "sms");
    expect(readPhoneAuthMode()).toBe("sms");
    vi.stubEnv("VITE_PHONE_AUTH_MODE", "off");
    vi.stubEnv("VITE_ENABLE_PHONE_OTP", "true");
    expect(readPhoneAuthMode()).toBe("off");
    vi.stubEnv("VITE_PHONE_AUTH_MODE", "unexpected");
    expect(readPhoneAuthMode()).toBe("off");
  });
  it("uses the legacy SMS flag only when no explicit mode is configured", () => {
    vi.stubEnv("VITE_PHONE_AUTH_MODE", undefined);
    vi.stubEnv("VITE_ENABLE_PHONE_OTP", "true");
    expect(readPhoneAuthMode()).toBe("sms");
    vi.stubEnv("VITE_ENABLE_PHONE_OTP", "false");
    expect(readPhoneAuthMode()).toBe("off");
  });
  it("normalizes Bengali code digits without knowing the configured server code", () => {
    expect(normalizePhoneCode(" ৯৮৭৬ ", "mock")).toBe("9876");
    expect(normalizePhoneCode("০১২৩৪৫", "sms")).toBe("012345");
    expect(normalizePhoneCode("12345678", "mock")).toBe("12345678");
    expect(() => normalizePhoneCode("123", "mock")).toThrow("invalid_otp");
    expect(() => normalizePhoneCode("123456789", "mock")).toThrow(
      "invalid_otp",
    );
    expect(() => normalizePhoneCode("12a456", "sms")).toThrow("invalid_otp");
    expect(() => normalizePhoneCode("9876", "sms")).toThrow("invalid_otp");
  });
});

describe("mock phone challenge transport", () => {
  it("normalizes a Bangladesh number and requests a challenge without a code or auth credentials", async () => {
    fetcher.mockResolvedValue(response({ challengeId, retryAfter: 60 }));
    await expect(requestMockPhoneOtp("০১৭১২৩৪৫৬৭৮")).resolves.toEqual({
      challengeId,
      retryAfter: 60,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/dev-phone-otp/request");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ phone });
    expect(init.cache).toBe("no-store");
    expect(new Headers(init.headers).get("Content-Type")).toContain(
      "application/json",
    );
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
  });
  it.each(["sms", "off"])(
    "never calls the mock endpoint in %s mode",
    async (mode) => {
      vi.stubEnv("VITE_PHONE_AUTH_MODE", mode);
      await expect(requestMockPhoneOtp(phone)).rejects.toThrow(
        "phone_otp_unavailable",
      );
      await expect(
        verifyMockPhoneOtp(phone, "987654", challengeId),
      ).rejects.toThrow("phone_otp_unavailable");
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("rejects invalid phones and an absent challenge before sending a verification request", async () => {
    await expect(requestMockPhoneOtp("01112345678")).rejects.toThrow(
      "invalid_phone",
    );
    await expect(verifyMockPhoneOtp(phone, "9876", "")).rejects.toThrow(
      "invalid_otp",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { challengeId: "", retryAfter: 60 },
    { challengeId, retryAfter: -1 },
    { challengeId, retryAfter: "60" },
  ])("rejects an unusable challenge response %#", async (payload) => {
    fetcher.mockResolvedValue(response(payload));
    await expect(requestMockPhoneOtp(phone)).rejects.toThrow();
  });
  it("fails safely when the server returns a non-JSON page or the network is unavailable", async () => {
    fetcher.mockResolvedValueOnce(
      new Response("<html>Not available</html>", { status: 200 }),
    );
    await expect(requestMockPhoneOtp(phone)).rejects.toThrow(
      "phone_auth_unavailable",
    );
    fetcher.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(requestMockPhoneOtp(phone)).rejects.toThrow(
      "phone_network_error",
    );
  });
  it.each([
    "invalid_phone",
    "invalid_otp",
    "phone_rate_limited",
    "phone_requires_sms",
    "phone_auth_unavailable",
    "otp_expired",
    "otp_attempts_exceeded",
  ])(
    "keeps known error %s while hiding arbitrary server details",
    async (code) => {
      fetcher.mockResolvedValueOnce(response({ error: code }, 400));
      await expect(requestMockPhoneOtp(phone)).rejects.toThrow(code);
    },
  );
  it("does not expose an unexpected server error string", async () => {
    fetcher.mockResolvedValue(
      response({ error: "internal-secret-value" }, 500),
    );
    await expect(requestMockPhoneOtp(phone)).rejects.toThrow(
      "phone_auth_unavailable",
    );
  });
});

describe("mock phone session response", () => {
  it("accepts opaque twelve-character refresh tokens returned by local Auth", async () => {
    const session = { access_token: token(), refresh_token: "r".repeat(12) };
    fetcher.mockResolvedValue(response(session));
    await expect(
      verifyMockPhoneOtp(phone, "9876", challengeId),
    ).resolves.toEqual(session);
  });

  it("returns tokens only when the response belongs to the requested normalized phone", async () => {
    const session = { access_token: token(), refresh_token: "r".repeat(48) };
    fetcher.mockResolvedValue(response(session));
    await expect(
      verifyMockPhoneOtp("০১৭১২৩৪৫৬৭৮", "৯৮৭৬", challengeId),
    ).resolves.toEqual(session);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/dev-phone-otp/verify");
    expect(JSON.parse(init.body)).toEqual({ phone, code: "9876", challengeId });
    expect(init.cache).toBe("no-store");
  });
  it.each([
    { access_token: token("8801812345678"), refresh_token: "r".repeat(48) },
    { access_token: "not-a-jwt", refresh_token: "r".repeat(48) },
    { access_token: token(), refresh_token: "" },
    { refresh_token: "r".repeat(48) },
  ])(
    "rejects a wrong-account or malformed session %# before installation",
    async (session) => {
      fetcher.mockResolvedValue(response(session));
      await expect(
        verifyMockPhoneOtp(phone, "9876", challengeId),
      ).rejects.toThrow("phone_auth_unavailable");
    },
  );
});

describe("production manual phone transport", () => {
  beforeEach(() => vi.stubEnv("VITE_PHONE_AUTH_MODE", "manual"));
  it("accepts a supplied Bengali four-digit code without knowing its server value", () => {
    expect(readPhoneAuthMode()).toBe("manual");
    expect(normalizePhoneCode(" ১৩১৮ ", "manual")).toBe("1318");
  });
  it("posts only the phone and supplied code to its same-origin server", async () => {
    const session = { access_token: token(), refresh_token: "r".repeat(48) };
    fetcher.mockResolvedValue(response(session));
    await expect(verifyManualPhoneCode("০১৭১২৩৪৫৬৭৮", "১৩১৮")).resolves.toEqual(
      session,
    );
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "/api/phone-login",
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        mode: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ phone, code: "1318" }),
      }),
    );
    expect(
      new Headers(fetcher.mock.calls[0][1].headers).get("Authorization"),
    ).toBeNull();
  });
  it("retains a durable fifteen-minute retry delay without revealing arbitrary server output", async () => {
    fetcher.mockResolvedValue(
      response({ error: "phone_rate_limited", retryAfter: 900 }, 429),
    );
    await expect(verifyManualPhoneCode(phone, "1318")).rejects.toMatchObject({
      message: "phone_rate_limited",
      retryAfter: 900,
    });
    fetcher.mockResolvedValue(
      response({ error: "private backend details" }, 500),
    );
    await expect(verifyManualPhoneCode(phone, "1318")).rejects.toThrow(
      "phone_auth_unavailable",
    );
  });
  it("rejects wrong-account tokens and does not call any broker outside manual mode", async () => {
    fetcher.mockResolvedValue(
      response({
        access_token: token("8801812345678"),
        refresh_token: "token",
      }),
    );
    await expect(verifyManualPhoneCode(phone, "1318")).rejects.toThrow(
      "phone_auth_unavailable",
    );
    fetcher.mockClear();
    vi.stubEnv("VITE_PHONE_AUTH_MODE", "sms");
    await expect(verifyManualPhoneCode(phone, "1318")).rejects.toThrow(
      "phone_otp_unavailable",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects invalid phone and code before sending a request", async () => {
    await expect(verifyManualPhoneCode("invalid", "1318")).rejects.toThrow(
      "invalid_phone",
    );
    await expect(verifyManualPhoneCode(phone, "bad")).rejects.toThrow(
      "invalid_otp",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
