import { describe, expect, it, vi } from "vitest";
import {
  createManualPhoneBackend,
  createManualPhoneHandler,
  manualPhoneConfig,
  manualPhoneConfigured,
  type ManualPhoneConfig,
} from "./manualPhone";

const phone = "+8801712345678";
const otherPhone = "+8801812345678";
const origin = "https://bari.example";
const id = "00000000-0000-4000-8000-000000000001";
const tokens = {
  access_token: `access-token-for-${id}`,
  refresh_token: "opaque-refresh-token",
};
const config = (
  change: Partial<ManualPhoneConfig> = {},
): ManualPhoneConfig => ({
  mode: "manual",
  url: "https://project.supabase.co",
  anonKey: "public-test-key",
  serviceKey: "private-server-test-key",
  secret: "stable-secret-with-at-least-32-characters",
  code: "1318",
  origin,
  vercel: true,
  ...change,
});
function request(
  input: unknown = { phone, code: "1318" },
  options: {
    method?: string;
    raw?: string | Uint8Array;
    headers?: Record<string, string | undefined>;
    url?: string;
  } = {},
) {
  const headers = new Headers({
    Origin: origin,
    "Content-Type": "application/json",
    "Sec-Fetch-Site": "same-origin",
    "X-Vercel-Forwarded-For": "203.0.113.9",
  });
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    if (value === undefined) headers.delete(key);
    else headers.set(key, value);
  }
  const method = options.method ?? "POST";
  return new Request(options.url ?? `${origin}/api/phone-login`, {
    method,
    headers,
    ...(method === "GET" || method === "HEAD"
      ? {}
      : { body: options.raw ?? JSON.stringify(input) }),
  });
}
function setup(change: Partial<ManualPhoneConfig> = {}) {
  const consumeAttempt = vi.fn(async () => ({ allowed: true, retryAfter: 0 }));
  const authenticate = vi.fn(async () => tokens);
  const handler = createManualPhoneHandler(config(change), {
    consumeAttempt,
    authenticate,
  });
  return { handler, consumeAttempt, authenticate };
}
function cloud() {
  const accounts = new Map<
    string,
    {
      id: string;
      phone: string;
      password: string;
      app_metadata: { bari_manual_phone_auth?: boolean };
    }
  >();
  const signOut = vi.fn(async () => undefined);
  const signInWithPassword = vi.fn(
    async ({
      phone: target,
      password,
    }: {
      phone: string;
      password: string;
    }) => {
      const user = accounts.get(target);
      if (!user || user.password !== password)
        return {
          data: { session: null, user: null },
          error: { code: "invalid_credentials" },
        };
      return { data: { session: tokens, user }, error: null };
    },
  );
  const createUser = vi.fn(
    async (attributes: {
      phone: string;
      password: string;
      phone_confirm: true;
      app_metadata: { bari_manual_phone_auth: true };
    }) => {
      if (accounts.has(attributes.phone))
        return { error: { code: "phone_exists" } };
      accounts.set(attributes.phone, {
        id,
        ...attributes,
        phone: attributes.phone.slice(1),
      });
      return { error: null };
    },
  );
  const rpc = vi.fn(
    async (
      _name: string,
      _args: { p_phone_key: string; p_ip_key: string },
    ): Promise<{ data: unknown; error: unknown }> => ({
      data: { allowed: true, retryAfter: 0 },
      error: null as unknown,
    }),
  );
  const clients = {
    admin: { auth: { admin: { createUser } }, rpc },
    createAuth: () => ({ auth: { signInWithPassword, signOut } }),
  };
  return { accounts, clients, createUser, signInWithPassword, signOut, rpc };
}

describe("manual phone configuration", () => {
  it("uses server-only env names and requires explicit production configuration", () => {
    expect(manualPhoneConfigured(config())).toBe(true);
    for (const change of [
      { mode: "mock" },
      { mode: "off" },
      { code: "" },
      { code: "123" },
      { secret: "short" },
      { serviceKey: "" },
      { anonKey: "sb_secret_private" },
      { origin: `${origin}/` },
      { origin: "http://bari.example" },
      { url: "http://127.0.0.1:55431" },
      { url: "https://user:pass@project.supabase.co" },
      { vercel: false },
    ])
      expect(manualPhoneConfigured(config(change))).toBe(false);
    expect(
      manualPhoneConfig({
        BARI_PHONE_AUTH_MODE: "manual",
        BARI_MANUAL_PHONE_CODE: "2468",
        BARI_PHONE_AUTH_SECRET: "stable",
        BARI_SUPABASE_SERVICE_ROLE_KEY: "server",
        BARI_PUBLIC_APP_ORIGIN: origin,
        VERCEL: "1",
        VITE_SUPABASE_URL: "https://project.supabase.co",
        VITE_SUPABASE_ANON_KEY: "public",
        VITE_MANUAL_PHONE_CODE: "9999",
      }),
    ).toEqual({
      ...config(),
      code: "2468",
      secret: "stable",
      serviceKey: "server",
      anonKey: "public",
    });
  });
});

describe("manual phone request boundary", () => {
  it("normalizes Bengali input, checks the durable counter, then returns only tokens", async () => {
    const s = setup();
    const response = await s.handler(
      request({ phone: "০১৭১২ ৩৪৫৬৭৮", code: "১৩১৮" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(tokens);
    expect(s.authenticate).toHaveBeenCalledWith(phone);
    expect(s.consumeAttempt).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(s.consumeAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      s.authenticate.mock.invocationCallOrder[0],
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("vary")).toBe("Origin");
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
  });
  it("counts malformed and wrong codes before comparing them, with generic safe errors", async () => {
    const s = setup();
    for (const code of ["0000", "short", 1318, undefined]) {
      const response = await s.handler(request({ phone, code }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_otp" });
    }
    expect(s.consumeAttempt).toHaveBeenCalledTimes(4);
    expect(s.authenticate).not.toHaveBeenCalled();
  });
  it("rejects disabled config, GET, OPTIONS, missing/cross origin and wrong request origin", async () => {
    expect((await setup({ mode: "off" }).handler(request())).status).toBe(404);
    const s = setup();
    for (const method of ["GET", "OPTIONS", "PUT"]) {
      const response = await s.handler(request({}, { method }));
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    for (const options of [
      { headers: { origin: undefined } },
      { headers: { origin: "https://evil.example" } },
      { headers: { "sec-fetch-site": "same-site" } },
      { url: "https://preview.example/api/phone-login" },
    ])
      expect((await s.handler(request({}, options))).status).toBe(403);
    expect(s.consumeAttempt).not.toHaveBeenCalled();
  });
  it("requires a valid Vercel-provided IP and safely accepts Vercel's fallback header", async () => {
    const s = setup();
    for (const value of [undefined, "invalid", "203.0.113.9, 203.0.113.10"]) {
      expect(
        (
          await s.handler(
            request({}, { headers: { "x-vercel-forwarded-for": value } }),
          )
        ).status,
      ).toBe(503);
    }
    const response = await s.handler(
      request(undefined, {
        headers: {
          "x-vercel-forwarded-for": undefined,
          "x-forwarded-for": "2001:db8::1",
        },
      }),
    );
    expect(response.status).toBe(200);
  });
  it("rejects malformed JSON, types, UTF-8, content types and bodies above 4 KiB", async () => {
    const s = setup();
    for (const raw of ["{", "null", "[]", '"text"', new Uint8Array([0xff])]) {
      expect((await s.handler(request({}, { raw }))).status).toBe(400);
    }
    expect(
      (
        await s.handler(
          request({}, { headers: { "content-type": "text/plain" } }),
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await s.handler(
          request({}, { headers: { "content-encoding": "gzip" } }),
        )
      ).status,
    ).toBe(415);
    expect(
      (await s.handler(request({}, { headers: { "content-length": "bad" } })))
        .status,
    ).toBe(400);
    expect(
      (await s.handler(request({}, { headers: { "content-length": "4097" } })))
        .status,
    ).toBe(413);
    expect(
      (await s.handler(request({}, { raw: " ".repeat(4097) }))).status,
    ).toBe(413);
    expect(
      (await s.handler(request({ phone: "invalid", code: "1318" }))).status,
    ).toBe(400);
    expect(s.consumeAttempt).not.toHaveBeenCalled();
  });
  it("fails closed for a failed or malformed durable limiter", async () => {
    for (const result of [
      { allowed: "yes" },
      { allowed: false, retryAfter: 0 },
      { allowed: true, retryAfter: 901 },
    ]) {
      const authenticate = vi.fn(async () => tokens);
      const handler = createManualPhoneHandler(config(), {
        consumeAttempt: async () => result,
        authenticate,
      });
      const response = await handler(request());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "phone_auth_unavailable",
      });
      expect(authenticate).not.toHaveBeenCalled();
    }
    const s = setup();
    s.consumeAttempt.mockRejectedValue(new Error(config().secret));
    const response = await s.handler(request());
    expect(await response.text()).toBe('{"error":"phone_auth_unavailable"}');
    expect(s.authenticate).not.toHaveBeenCalled();
  });
  it("preserves shared rate denials across independent handlers and concurrent calls", async () => {
    let count = 0;
    const consumeAttempt = vi.fn(async () => ({
      allowed: ++count <= 5,
      retryAfter: count <= 5 ? 0 : 900,
    }));
    const authenticate = vi.fn(async () => tokens);
    const handlers = Array.from({ length: 12 }, () =>
      createManualPhoneHandler(config(), { consumeAttempt, authenticate }),
    );
    const responses = await Promise.all(
      handlers.map((handler) => handler(request())),
    );
    expect(
      responses.filter((response) => response.status === 200),
    ).toHaveLength(5);
    expect(
      responses.filter((response) => response.status === 429),
    ).toHaveLength(7);
    expect(authenticate).toHaveBeenCalledTimes(5);
    const denied = responses.find((response) => response.status === 429)!;
    expect(denied.headers.get("retry-after")).toBe("900");
    expect(await denied.json()).toEqual({
      error: "phone_rate_limited",
      retryAfter: 900,
    });
  });
});

describe("manual phone Supabase identity broker", () => {
  it("uses password auth and confirmed phone creation while changing the shared code preserves identity", async () => {
    const c = cloud();
    const first = createManualPhoneHandler(
      config(),
      createManualPhoneBackend(config(), c.clients),
    );
    const next = createManualPhoneHandler(
      config({ code: "2468" }),
      createManualPhoneBackend(config({ code: "2468" }), c.clients),
    );
    expect((await first(request())).status).toBe(200);
    expect((await next(request())).status).toBe(400);
    expect((await next(request({ phone, code: "2468" }))).status).toBe(200);
    expect(c.accounts.size).toBe(1);
    expect(c.accounts.get(phone)?.id).toBe(id);
    expect(c.createUser).toHaveBeenCalledTimes(1);
    const created = c.createUser.mock.calls[0][0];
    expect(created).toEqual({
      phone,
      password: expect.any(String),
      phone_confirm: true,
      app_metadata: { bari_manual_phone_auth: true },
    });
    expect(created.password.length).toBeGreaterThan(32);
    expect(created.password).not.toBe("1318");
    expect(
      c.signInWithPassword.mock.calls.every(
        ([credentials]) => credentials.password === created.password,
      ),
    ).toBe(true);
    expect(c.rpc).toHaveBeenCalledWith("consume_manual_phone_login_attempt", {
      p_phone_key: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_ip_key: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });
  it("handles a concurrent first-create collision by signing in again without resetting either identity", async () => {
    const c = cloud();
    const one = createManualPhoneBackend(config(), c.clients);
    const two = createManualPhoneBackend(config(), c.clients);
    expect(
      await Promise.all([one.authenticate(phone), two.authenticate(phone)]),
    ).toEqual([tokens, tokens]);
    expect(c.accounts.size).toBe(1);
    expect(c.createUser).toHaveBeenCalledTimes(2);
    expect(c.signInWithPassword).toHaveBeenCalledTimes(4);
  });
  it("refuses an existing account with another password and leaves its attributes intact", async () => {
    const c = cloud();
    const existing = {
      id,
      phone: phone.slice(1),
      password: "existing-private-password",
      app_metadata: {},
    };
    c.accounts.set(phone, existing);
    await expect(
      createManualPhoneBackend(config(), c.clients).authenticate(phone),
    ).rejects.toMatchObject({ status: 503, code: "phone_auth_unavailable" });
    expect(c.accounts.get(phone)).toEqual(existing);
  });
  it("refuses an unmarked or different-phone session and signs out that isolated client", async () => {
    for (const user of [
      { id, phone: phone.slice(1), app_metadata: {} },
      {
        id,
        phone: otherPhone.slice(1),
        app_metadata: { bari_manual_phone_auth: true },
      },
    ]) {
      const c = cloud();
      c.signInWithPassword.mockResolvedValue({
        data: { session: tokens, user: { password: "unused", ...user } },
        error: null,
      });
      await expect(
        createManualPhoneBackend(config(), c.clients).authenticate(phone),
      ).rejects.toMatchObject({ status: 503 });
      expect(c.signOut).toHaveBeenCalledWith({ scope: "local" });
      expect(c.createUser).not.toHaveBeenCalled();
    }
  });
  it("does not create users for provider/network errors or accept a failed limiter RPC", async () => {
    const c = cloud();
    c.signInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: { code: "phone_provider_disabled" },
    });
    const backend = createManualPhoneBackend(config(), c.clients);
    await expect(backend.authenticate(phone)).rejects.toMatchObject({
      status: 503,
    });
    expect(c.createUser).not.toHaveBeenCalled();
    c.rpc.mockResolvedValue({
      data: null,
      error: { message: "private details" },
    });
    await expect(
      backend.consumeAttempt("a".repeat(64), "b".repeat(64)),
    ).rejects.toMatchObject({ status: 503, code: "phone_auth_unavailable" });
  });
});
