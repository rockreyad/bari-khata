import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { createClient, type User } from "@supabase/supabase-js";
import { z } from "zod";
import { normalizeBangladeshPhone } from "../src/features/auth/phone.js";

export type ManualPhoneConfig = {
  mode: string;
  url: string;
  anonKey: string;
  serviceKey: string;
  secret: string;
  code: string;
  origin: string;
  vercel: boolean;
};
export type ManualPhoneSession = {
  access_token: string;
  refresh_token: string;
};
type AuthUser = Pick<User, "id" | "email" | "phone" | "app_metadata">;
type SignInResult = {
  data: { session: ManualPhoneSession | null; user: AuthUser | null };
  error: { code?: string } | null;
};
type AuthClient = {
  auth: {
    signInWithPassword: (credentials: {
      email: string;
      password: string;
    }) => Promise<SignInResult>;
    signOut: (options: { scope: "local" }) => Promise<unknown>;
  };
};
type AdminClient = {
  auth: {
    admin: {
      createUser: (attributes: {
        phone: string;
        email: string;
        password: string;
        phone_confirm: true;
        email_confirm: true;
        app_metadata: { bari_manual_phone_auth: true };
      }) => Promise<{ error: { code?: string } | null }>;
    };
  };
  rpc: (
    name: string,
    args: { p_phone_key: string; p_ip_key: string },
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};
type ManualPhoneDependencies = {
  consumeAttempt: (phoneKey: string, ipKey: string) => Promise<unknown>;
  authenticate: (phone: string) => Promise<ManualPhoneSession>;
};
export class ManualPhoneError extends Error {
  constructor(
    public status: number,
    public code: string,
    public retryAfter?: number,
  ) {
    super(code);
  }
}
export function manualPhoneConfig(
  env: Record<string, string | undefined>,
): ManualPhoneConfig {
  return {
    mode: env.BARI_PHONE_AUTH_MODE ?? "off",
    url: env.VITE_SUPABASE_URL ?? "",
    anonKey: env.VITE_SUPABASE_ANON_KEY ?? "",
    serviceKey: env.BARI_SUPABASE_SERVICE_ROLE_KEY ?? "",
    secret: env.BARI_PHONE_AUTH_SECRET ?? "",
    code: env.BARI_MANUAL_PHONE_CODE ?? "",
    origin: env.BARI_PUBLIC_APP_ORIGIN ?? "",
    vercel: env.VERCEL === "1",
  };
}
export function manualPhoneConfigured(config: ManualPhoneConfig) {
  try {
    const origin = new URL(config.origin);
    const backend = new URL(config.url);
    return (
      config.mode === "manual" &&
      config.vercel &&
      origin.protocol === "https:" &&
      origin.origin === config.origin &&
      backend.protocol === "https:" &&
      !backend.username &&
      !backend.password &&
      backend.pathname === "/" &&
      !backend.search &&
      !backend.hash &&
      /^[0-9]{4,8}$/.test(config.code) &&
      config.secret.length >= 32 &&
      Boolean(config.anonKey) &&
      !config.anonKey.startsWith("sb_secret_") &&
      Boolean(config.serviceKey)
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
const SessionSchema = z.object({
  access_token: z.string().min(20).max(16384),
  refresh_token: z.string().min(1).max(1024),
});
const LimitSchema = z.object({
  allowed: z.boolean(),
  retryAfter: z.number().int().min(0).max(900),
});
const unavailable = () => new ManualPhoneError(503, "phone_auth_unavailable");

export function createManualPhoneBackend(
  config: ManualPhoneConfig,
  clients?: { admin: AdminClient; createAuth: () => AuthClient },
): ManualPhoneDependencies {
  const admin: AdminClient =
    clients?.admin ?? createClient(config.url, config.serviceKey, authOptions);
  const createAuth =
    clients?.createAuth ??
    (() => createClient(config.url, config.anonKey, authOptions));
  return {
    async consumeAttempt(phoneKey, ipKey) {
      const result = await admin.rpc("consume_manual_phone_login_attempt", {
        p_phone_key: phoneKey,
        p_ip_key: ipKey,
      });
      if (result.error) throw unavailable();
      return result.data;
    },
    async authenticate(phone) {
      const email = `${createHmac("sha256", config.secret)
        .update(`bari-manual-email-v1:${phone}`)
        .digest("hex")}@phone.bari.invalid`;
      const password =
        createHmac("sha256", config.secret)
          .update(`bari-manual-phone-v1:${phone}`)
          .digest("base64url") + "Aa9!";
      const auth = createAuth();
      let result = await auth.auth.signInWithPassword({ email, password });
      if (result.error) {
        if (result.error.code !== "invalid_credentials") throw unavailable();
        const created = await admin.auth.admin.createUser({
          phone,
          email,
          password,
          phone_confirm: true,
          email_confirm: true,
          app_metadata: { bari_manual_phone_auth: true },
        });
        if (
          created.error &&
          !["phone_exists", "email_exists", "user_already_exists"].includes(
            created.error.code ?? "",
          )
        )
          throw unavailable();
        // A second request may have created this phone while we were signing in.
        result = await auth.auth.signInWithPassword({ email, password });
      }
      let matches = false;
      try {
        matches = Boolean(
          !result.error &&
          result.data.user?.app_metadata.bari_manual_phone_auth === true &&
          result.data.user.email === email &&
          normalizeBangladeshPhone(result.data.user.phone ?? "") === phone,
        );
      } catch {
        matches = false;
      }
      const session = SessionSchema.safeParse(result.data.session);
      if (!matches || !session.success) {
        if (result.data.session) await auth.auth.signOut({ scope: "local" });
        throw unavailable();
      }
      return session.data;
    },
  };
}
function reply(status: number, value: unknown, retryAfter?: number) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  if (status === 405) headers.set("Allow", "POST");
  if (retryAfter) headers.set("Retry-After", String(retryAfter));
  return new Response(JSON.stringify(value), { status, headers });
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new ManualPhoneError(415, "invalid_request");
  const length = request.headers.get("content-length");
  if (length !== null && !/^\d+$/.test(length))
    throw new ManualPhoneError(400, "invalid_request");
  if (Number(length) > 4096) throw new ManualPhoneError(413, "invalid_request");
  const encoding = request.headers.get("content-encoding");
  if (encoding && encoding !== "identity")
    throw new ManualPhoneError(415, "invalid_request");
  const reader = request.body?.getReader();
  if (!reader) throw new ManualPhoneError(400, "invalid_request");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4096) {
        void reader.cancel().catch(() => undefined);
        throw new ManualPhoneError(413, "invalid_request");
      }
      chunks.push(chunk.value);
    }
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
    if (!value || Array.isArray(value) || typeof value !== "object")
      throw new Error();
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ManualPhoneError) throw error;
    throw new ManualPhoneError(400, "invalid_request");
  } finally {
    reader.releaseLock();
  }
}
function trustedIp(request: Request) {
  const value = (
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for")
  )?.trim();
  if (!value || !isIP(value)) throw unavailable();
  return value;
}
export function createManualPhoneHandler(
  config: ManualPhoneConfig,
  dependencies?: ManualPhoneDependencies,
) {
  let backend = dependencies;
  return async (request: Request) => {
    try {
      if (!manualPhoneConfigured(config))
        throw new ManualPhoneError(404, "phone_auth_unavailable");
      if (
        request.headers.get("origin") !== config.origin ||
        new URL(request.url).origin !== config.origin ||
        (request.headers.has("sec-fetch-site") &&
          request.headers.get("sec-fetch-site") !== "same-origin")
      )
        throw new ManualPhoneError(403, "phone_auth_unavailable");
      if (request.method !== "POST")
        throw new ManualPhoneError(405, "invalid_request");
      const ip = trustedIp(request);
      const fields = await readBody(request);
      let phone: string;
      try {
        phone = normalizeBangladeshPhone(
          typeof fields.phone === "string" ? fields.phone : "",
        );
      } catch {
        throw new ManualPhoneError(400, "invalid_phone");
      }
      backend ??= createManualPhoneBackend(config);
      const hash = (kind: string, value: string) =>
        createHmac("sha256", config.secret)
          .update(`bari-manual-rate-v1:${kind}:${value}`)
          .digest("hex");
      const limit = LimitSchema.safeParse(
        await backend.consumeAttempt(hash("phone", phone), hash("ip", ip)),
      );
      if (!limit.success || (!limit.data.allowed && !limit.data.retryAfter))
        throw unavailable();
      if (!limit.data.allowed)
        throw new ManualPhoneError(
          429,
          "phone_rate_limited",
          limit.data.retryAfter,
        );
      const code =
        typeof fields.code === "string"
          ? fields.code
              .trim()
              .replace(/[০-৯]/g, (digit) => String("০১২৩৪৫৬৭৮৯".indexOf(digit)))
          : "";
      const matches = timingSafeEqual(
        createHash("sha256").update(code).digest(),
        createHash("sha256").update(config.code).digest(),
      );
      if (!/^[0-9]{4,8}$/.test(code) || !matches)
        throw new ManualPhoneError(400, "invalid_otp");
      const session = SessionSchema.safeParse(
        await backend.authenticate(phone),
      );
      if (!session.success) throw unavailable();
      return reply(200, session.data);
    } catch (error) {
      const failure = error instanceof ManualPhoneError ? error : unavailable();
      return reply(
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
