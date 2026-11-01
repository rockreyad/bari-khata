import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { normalizeBangladeshPhone } from "../src/features/auth/phone.ts";

export type PhoneAuthMode = "mock" | "sms" | "off";
export type PhoneGatewayConfig = {
  mode: PhoneAuthMode;
  url: string;
  anonKey: string;
  serviceKey: string;
  secret: string;
  otp: string;
};
export type PhoneSession = { access_token: string; refresh_token: string };
export class PhoneGatewayError extends Error {
  constructor(
    public status: number,
    public code: string,
    public retryAfter?: number,
  ) {
    super(code);
  }
}
export function phoneAuthMode(
  env: Record<string, string | undefined>,
): PhoneAuthMode {
  const mode = env.BARI_PHONE_AUTH_MODE ?? "off";
  if (mode !== "off" && mode !== "mock" && mode !== "sms")
    throw new Error("BARI_PHONE_AUTH_MODE must be off, mock or sms.");
  return mode;
}
export function phoneGatewayConfig(
  env: Record<string, string | undefined>,
): PhoneGatewayConfig {
  return {
    mode: phoneAuthMode(env),
    url: env.VITE_SUPABASE_URL ?? "",
    anonKey: env.VITE_SUPABASE_ANON_KEY ?? "",
    serviceKey: env.BARI_DEV_SUPABASE_SERVICE_ROLE_KEY ?? "",
    secret: env.BARI_DEV_PHONE_AUTH_SECRET ?? "",
    otp: env.BARI_DEV_PHONE_OTP ?? "",
  };
}
export function mockPhoneConfigured(config: PhoneGatewayConfig) {
  try {
    const url = new URL(config.url);
    return (
      config.mode === "mock" &&
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      url.port === "55431" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      /^[0-9]{4,8}$/.test(config.otp) &&
      config.secret.length >= 32 &&
      !!config.anonKey &&
      !!config.serviceKey
    );
  } catch {
    return false;
  }
}
const authOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};
export function createPhoneIdentityBroker(config: PhoneGatewayConfig) {
  const admin = createClient(config.url, config.serviceKey, authOptions);
  return async (phone: string): Promise<PhoneSession> => {
    const password =
      createHmac("sha256", config.secret)
        .update(`bari-dev-phone-v1:${phone}`)
        .digest("base64url") + "Aa9!";
    const auth = createClient(config.url, config.anonKey, authOptions);
    let result = await auth.auth.signInWithPassword({ phone, password });
    if (result.error) {
      if (result.error.code !== "invalid_credentials")
        throw new PhoneGatewayError(503, "phone_auth_unavailable");
      const created = await admin.auth.admin.createUser({
        phone,
        password,
        phone_confirm: true,
        app_metadata: { bari_dev_phone_auth: true },
      });
      if (created.error) {
        if (
          ["phone_exists", "user_already_exists"].includes(
            created.error.code ?? "",
          )
        )
          throw new PhoneGatewayError(409, "phone_requires_sms");
        throw new PhoneGatewayError(503, "phone_auth_unavailable");
      }
      result = await auth.auth.signInWithPassword({ phone, password });
    }
    if (
      result.error ||
      !result.data.session ||
      result.data.user?.app_metadata.bari_dev_phone_auth !== true
    ) {
      if (result.data.session) await auth.auth.signOut({ scope: "local" });
      throw new PhoneGatewayError(503, "phone_auth_unavailable");
    }
    return {
      access_token: result.data.session.access_token,
      refresh_token: result.data.session.refresh_token,
    };
  };
}
function loopback(value: string) {
  return (
    value === "::1" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value) ||
    /^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)
  );
}
export function sameLocalOrigin(request: IncomingMessage) {
  if (!loopback(request.socket.remoteAddress ?? "")) return false;
  const host = request.headers.host ?? "";
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host))
    return false;
  const protocol =
    "encrypted" in request.socket && request.socket.encrypted
      ? "https:"
      : "http:";
  return (
    request.headers.origin === `${protocol}//${host}` &&
    !["cross-site", "same-site"].includes(
      String(request.headers["sec-fetch-site"] ?? ""),
    )
  );
}
function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (
    !/^application\/json(?:;|$)/i.test(
      String(request.headers["content-type"] ?? ""),
    )
  )
    throw new PhoneGatewayError(415, "invalid_request");
  if (Number(request.headers["content-length"] ?? "0") > 4096)
    throw new PhoneGatewayError(413, "invalid_request");
  return new Promise((resolve, reject) => {
    let text = "",
      size = 0,
      rejected = false;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4096) {
        if (!rejected) reject(new PhoneGatewayError(413, "invalid_request"));
        rejected = true;
        return;
      }
      text += chunk.toString("utf8");
    });
    request.on("end", () => {
      if (rejected) return;
      try {
        const parsed: unknown = JSON.parse(text);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
          throw new Error("invalid");
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new PhoneGatewayError(400, "invalid_request"));
      }
    });
    request.on("error", () =>
      reject(new PhoneGatewayError(400, "invalid_request")),
    );
  });
}
function send(
  response: ServerResponse,
  status: number,
  value: unknown,
  retryAfter?: number,
) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Vary", "Origin");
  if (retryAfter) response.setHeader("Retry-After", String(retryAfter));
  response.end(JSON.stringify(value));
}
export function createPhoneOtpMiddleware(
  config: PhoneGatewayConfig,
  dependencies: {
    now?: () => number;
    authenticate?: (phone: string) => Promise<PhoneSession>;
  } = {},
) {
  const now = dependencies.now ?? Date.now;
  const enabled = mockPhoneConfigured(config);
  const authenticate = enabled
    ? (dependencies.authenticate ?? createPhoneIdentityBroker(config))
    : null;
  const challenges = new Map<
    string,
    { phone: string; expires: number; attempts: number }
  >();
  const cooldowns = new Map<string, number>();
  const rates = new Map<string, number[]>();
  const prune = (time: number) => {
    for (const [id, value] of challenges)
      if (value.expires <= time) challenges.delete(id);
    for (const [phone, expiry] of cooldowns)
      if (expiry <= time) cooldowns.delete(phone);
    for (const [key, values] of rates) {
      const live = values.filter((at) => at > time - 300000);
      if (live.length) rates.set(key, live);
      else rates.delete(key);
    }
  };
  const rate = (key: string, limit: number, time: number) => {
    const values = rates.get(key) ?? [];
    if (values.length >= limit || (rates.size >= 1000 && !rates.has(key)))
      throw new PhoneGatewayError(429, "phone_rate_limited", 60);
    rates.set(key, [...values, time]);
  };
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    const path = (request.url ?? "").split("?")[0];
    if (!path.startsWith("/api/dev-phone-otp")) {
      next();
      return;
    }
    try {
      if (!enabled || !authenticate)
        throw new PhoneGatewayError(404, "phone_auth_unavailable");
      if (!sameLocalOrigin(request))
        throw new PhoneGatewayError(403, "phone_auth_unavailable");
      if (request.method !== "POST")
        throw new PhoneGatewayError(405, "invalid_request");
      if (
        path !== "/api/dev-phone-otp/request" &&
        path !== "/api/dev-phone-otp/verify"
      )
        throw new PhoneGatewayError(404, "invalid_request");
      const time = now();
      prune(time);
      const requestStep = path.endsWith("/request");
      rate(
        `${requestStep ? "request" : "verify"}:${request.socket.remoteAddress}`,
        requestStep ? 30 : 60,
        time,
      );
      const fields = await body(request);
      let phone: string;
      try {
        phone = normalizeBangladeshPhone(
          typeof fields.phone === "string" ? fields.phone : "",
        );
      } catch {
        throw new PhoneGatewayError(400, "invalid_phone");
      }
      if (requestStep) {
        const remaining = Math.ceil(
          ((cooldowns.get(phone) ?? 0) - time) / 1000,
        );
        if (remaining > 0)
          throw new PhoneGatewayError(429, "phone_rate_limited", remaining);
        if (challenges.size >= 1000 || cooldowns.size >= 1000)
          throw new PhoneGatewayError(429, "phone_rate_limited", 60);
        // A resend invalidates the earlier challenge for this number.
        for (const [id, value] of challenges)
          if (value.phone === phone) challenges.delete(id);
        const challengeId = randomBytes(32).toString("hex");
        challenges.set(challengeId, {
          phone,
          expires: time + 300000,
          attempts: 5,
        });
        cooldowns.set(phone, time + 60000);
        send(response, 200, { challengeId, retryAfter: 60 });
        return;
      }
      const challengeId =
        typeof fields.challengeId === "string" ? fields.challengeId : "";
      const challenge = challenges.get(challengeId);
      if (!challenge || challenge.expires <= time)
        throw new PhoneGatewayError(410, "otp_expired");
      if (challenge.phone !== phone)
        throw new PhoneGatewayError(400, "invalid_otp");
      const code =
        typeof fields.code === "string"
          ? fields.code.replace(/[০-৯]/g, (digit) =>
              String("০১২৩৪৫৬৭৮৯".indexOf(digit)),
            )
          : "";
      const matches = timingSafeEqual(
        createHash("sha256").update(code).digest(),
        createHash("sha256").update(config.otp).digest(),
      );
      challenge.attempts--;
      if (!matches) {
        if (challenge.attempts <= 0) {
          challenges.delete(challengeId);
          throw new PhoneGatewayError(400, "otp_attempts_exceeded");
        }
        throw new PhoneGatewayError(400, "invalid_otp");
      }
      challenges.delete(challengeId);
      const session = await authenticate(phone);
      send(response, 200, session);
    } catch (error) {
      const failure =
        error instanceof PhoneGatewayError
          ? error
          : new PhoneGatewayError(503, "phone_auth_unavailable");
      send(
        response,
        failure.status,
        {
          error: failure.code,
          ...(failure.retryAfter ? { retryAfter: failure.retryAfter } : {}),
        },
        failure.retryAfter,
      );
    }
  };
}
