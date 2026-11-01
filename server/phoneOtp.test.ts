import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  createPhoneOtpMiddleware,
  mockPhoneConfigured,
  phoneAuthMode,
  type PhoneGatewayConfig,
} from "./phoneOtp";
const config = (): PhoneGatewayConfig => ({
  mode: "mock",
  url: "http://127.0.0.1:55431",
  anonKey: "public-test-key",
  serviceKey: "private-test-key",
  secret: "a-private-test-key-at-least-32-characters",
  otp: "1318",
});
function setup(change: Partial<PhoneGatewayConfig> = {}) {
  let time = 1000000;
  const authenticate = vi.fn(async () => ({
    access_token: "valid-token",
    refresh_token: "refresh-token",
  }));
  const middleware = createPhoneOtpMiddleware(
    { ...config(), ...change },
    { now: () => time, authenticate },
  );
  async function call(
    path: string,
    input: unknown,
    options: {
      host?: string;
      origin?: string;
      remote?: string;
      method?: string;
      contentType?: string;
      raw?: string;
    } = {},
  ) {
    const raw = options.raw ?? JSON.stringify(input);
    const request = Readable.from([
      Buffer.from(raw),
    ]) as unknown as IncomingMessage;
    Object.assign(request, {
      url: `/api/dev-phone-otp/${path}`,
      method: options.method ?? "POST",
      headers: {
        host: options.host ?? "localhost:5188",
        origin: options.origin ?? "http://localhost:5188",
        "content-type": options.contentType ?? "application/json",
        "content-length": String(Buffer.byteLength(raw)),
      },
      socket: { remoteAddress: options.remote ?? "127.0.0.1" },
    });
    const headers: Record<string, string> = {};
    let status = 0;
    const result = new Promise<{
      status: number;
      value: Record<string, unknown>;
      headers: Record<string, string>;
    }>((resolve) => {
      const response = {
        set statusCode(value: number) {
          status = value;
        },
        setHeader(key: string, value: string) {
          headers[key] = value;
        },
        end(value: string) {
          resolve({ status, value: JSON.parse(value), headers });
        },
      } as unknown as ServerResponse;
      void middleware(request, response, () =>
        resolve({ status: 404, value: {}, headers }),
      );
    });
    return result;
  }
  return {
    call,
    authenticate,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
const a = "01712345678",
  b = "01812345678";
describe("local phone OTP gateway", () => {
  it("requires a bound request and returns real-session tokens only for the configured code", async () => {
    const s = setup();
    expect(
      (
        await s.call("verify", {
          phone: a,
          code: "1318",
          challengeId: "missing",
        })
      ).status,
    ).toBe(410);
    const request = await s.call("request", { phone: a });
    expect(request.status).toBe(200);
    expect(request.value).toMatchObject({ retryAfter: 60 });
    expect(JSON.stringify(request.value)).not.toContain("1318");
    const id = request.value.challengeId;
    expect(
      (await s.call("verify", { phone: b, code: "1318", challengeId: id }))
        .status,
    ).toBe(400);
    expect(
      (await s.call("verify", { phone: a, code: "0000", challengeId: id }))
        .status,
    ).toBe(400);
    expect(s.authenticate).not.toHaveBeenCalled();
    const verified = await s.call("verify", {
      phone: a,
      code: "১৩১৮",
      challengeId: id,
    });
    expect(verified.status).toBe(200);
    expect(verified.value).toEqual({
      access_token: "valid-token",
      refresh_token: "refresh-token",
    });
    expect(s.authenticate).toHaveBeenCalledExactlyOnceWith("+8801712345678");
    expect(verified.headers["Cache-Control"]).toBe("no-store");
    expect(
      (await s.call("verify", { phone: a, code: "1318", challengeId: id }))
        .status,
    ).toBe(410);
  });
  it("limits guesses, expires challenges, invalidates earlier codes after resend and enforces cooldown", async () => {
    const s = setup();
    const first = await s.call("request", { phone: a });
    expect((await s.call("request", { phone: a })).status).toBe(429);
    for (let i = 0; i < 5; i++)
      await s.call("verify", {
        phone: a,
        code: "0000",
        challengeId: first.value.challengeId,
      });
    expect(
      (
        await s.call("verify", {
          phone: a,
          code: "1318",
          challengeId: first.value.challengeId,
        })
      ).status,
    ).toBe(410);
    s.advance(60000);
    const second = await s.call("request", { phone: a });
    s.advance(60000);
    const third = await s.call("request", { phone: a });
    expect(
      (
        await s.call("verify", {
          phone: a,
          code: "1318",
          challengeId: second.value.challengeId,
        })
      ).status,
    ).toBe(410);
    s.advance(300000);
    expect(
      (
        await s.call("verify", {
          phone: a,
          code: "1318",
          challengeId: third.value.challengeId,
        })
      ).status,
    ).toBe(410);
    expect(s.authenticate).not.toHaveBeenCalled();
  });
  it("disables the shared code outside explicit local mock configuration", async () => {
    expect(phoneAuthMode({})).toBe("off");
    expect(() =>
      phoneAuthMode({ BARI_PHONE_AUTH_MODE: "unexpected" }),
    ).toThrow();
    for (const change of [
      { mode: "off" as const },
      { mode: "sms" as const },
      { url: "https://project.supabase.co" },
      { secret: "short" },
      { otp: "" },
      { serviceKey: "" },
    ]) {
      const s = setup(change);
      expect((await s.call("request", { phone: a })).status).toBe(404);
      expect(s.authenticate).not.toHaveBeenCalled();
    }
    expect(mockPhoneConfigured(config())).toBe(true);
  });
  it("rejects cross-origin/LAN/unsafe requests and malformed bodies without authenticating", async () => {
    const s = setup();
    for (const options of [
      { origin: "https://other.example" },
      { remote: "192.168.0.5" },
      { host: "other.example", origin: "http://other.example" },
    ])
      expect((await s.call("request", { phone: a }, options)).status).toBe(403);
    expect(
      (await s.call("request", { phone: a }, { method: "GET" })).status,
    ).toBe(405);
    expect(
      (await s.call("request", { phone: a }, { contentType: "text/plain" }))
        .status,
    ).toBe(415);
    expect((await s.call("request", {}, { raw: "{" })).status).toBe(400);
    expect(
      (await s.call("request", { phone: "not-a-phone" })).value.error,
    ).toBe("invalid_phone");
    expect(
      (await s.call("request", {}, { raw: "x".repeat(5000) })).status,
    ).toBe(413);
    expect(s.authenticate).not.toHaveBeenCalled();
  });
  it("takes the configured code from the server environment rather than accepting the old value", async () => {
    const s = setup({ otp: "2468" });
    const requested = await s.call("request", { phone: a });
    expect(
      (
        await s.call("verify", {
          phone: a,
          code: "1318",
          challengeId: requested.value.challengeId,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await s.call("verify", {
          phone: a,
          code: "2468",
          challengeId: requested.value.challengeId,
        })
      ).status,
    ).toBe(200);
  });
});
