import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const MCP_SCOPES = [
  "ledger:read",
  "entries:create",
  "entries:update",
  "entries:void_restore",
  "entities:write",
  "contracts:write",
  "catalog:write",
  "receipts:read",
  "receipts:write",
] as const;
export const MCP_DAILY_SCOPES = [
  "ledger:read",
  "entries:create",
  "entities:write",
  "catalog:write",
  "receipts:read",
  "receipts:write",
] as const;
export const Scopes = z
  .array(z.enum(MCP_SCOPES))
  .min(1)
  .max(MCP_SCOPES.length)
  .transform((value) => [...new Set(["ledger:read", ...value])]);
export const Policy = z
  .object({
    confirmationRequired: z.boolean().default(false),
    maxAmountPaisa: z
      .number()
      .int()
      .min(1)
      .max(Number.MAX_SAFE_INTEGER)
      .nullable()
      .optional(),
    maxDailyAmountPaisa: z
      .number()
      .int()
      .min(1)
      .max(Number.MAX_SAFE_INTEGER)
      .nullable()
      .optional(),
    maxDailyOperations: z
      .number()
      .int()
      .min(1)
      .max(10000)
      .nullable()
      .optional(),
  })
  .strict();
export const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export const secret = (prefix = "bkm_") =>
  prefix + randomBytes(32).toString("base64url");
export const challenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export class McpError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(code);
  }
}
export type McpConfig = {
  url: string;
  serviceKey: string;
  anonKey: string;
  origin: string;
  allowedOrigins: string[];
  enabled: boolean;
};
export function mcpConfig(env: Record<string, string | undefined>): McpConfig {
  const origin =
    env.BARI_PUBLIC_APP_ORIGIN ||
    (env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
      : env.VERCEL_URL
        ? `https://${env.VERCEL_URL}`
        : "");
  return {
    url: env.VITE_SUPABASE_URL ?? "",
    anonKey: env.VITE_SUPABASE_ANON_KEY ?? "",
    serviceKey:
      env.BARI_SUPABASE_SERVICE_ROLE_KEY ||
      env.BARI_DEV_SUPABASE_SERVICE_ROLE_KEY ||
      "",
    origin,
    allowedOrigins: (
      env.BARI_MCP_ALLOWED_ORIGINS ||
      "https://claude.ai,https://chatgpt.com,https://www.chatgpt.com"
    )
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    enabled: env.BARI_MCP_ENABLED !== "false",
  };
}
export function validConfig(config: McpConfig) {
  try {
    const url = new URL(config.origin);
    return (
      config.enabled &&
      Boolean(config.url && config.serviceKey && config.anonKey) &&
      url.origin === config.origin &&
      !url.username &&
      !url.password &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}
export const json = (value: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
export function bearer(request: Request) {
  const value = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9._~-]{20,16384})$/i.exec(value);
  if (!match) throw new McpError("unauthorized", 401);
  return match[1];
}
export async function readJson(
  request: Request,
  limit = 256 * 1024,
): Promise<unknown> {
  return JSON.parse(await readBody(request, limit));
}
export async function readBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit)
    throw new McpError("request_too_large", 413);
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new McpError("request_too_large", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export function requestGuard(
  request: Request,
  config: McpConfig,
  admin = false,
) {
  if (new URL(request.url).origin !== config.origin)
    throw new McpError("invalid_host", 403);
  const origin = request.headers.get("origin");
  if (
    origin &&
    origin !== config.origin &&
    (admin || !config.allowedOrigins.includes(origin))
  )
    throw new McpError("invalid_origin", 403);
}
export function errorResponse(error: unknown) {
  if (error instanceof McpError)
    return json(
      {
        error: error.code,
        ...(error.details ? { details: error.details } : {}),
      },
      error.status,
    );
  if (error instanceof z.ZodError)
    return json(
      {
        error: "validation_error",
        details: error.issues.map((issue) => ({
          path: issue.path,
          code: issue.code,
        })),
      },
      400,
    );
  if (error instanceof SyntaxError)
    return json({ error: "invalid_request" }, 400);
  return json({ error: "service_unavailable" }, 503);
}
