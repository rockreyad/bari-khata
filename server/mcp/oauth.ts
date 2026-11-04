import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  MCP_SCOPES,
  McpError,
  Scopes,
  bearer,
  challenge,
  json,
  readBody,
  readJson,
  secret,
  sha256,
  type McpConfig,
} from "./common.js";
import type { McpStore } from "./store.js";

const ClientRegistration = z.object({
  client_name: z.string().trim().min(1).max(120).default("Personal assistant"),
  redirect_uris: z.array(z.string().url().max(2048)).min(1).max(10),
  token_endpoint_auth_method: z
    .enum(["none", "client_secret_post", "client_secret_basic"])
    .default("none"),
  grant_types: z
    .array(z.enum(["authorization_code", "refresh_token"]))
    .optional(),
  response_types: z.array(z.literal("code")).optional(),
  scope: z.string().max(500).optional(),
});
export type OAuthClient = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: string;
  clientSecretHash?: string | null;
  scope?: string;
};
export function oauthMetadata(config: McpConfig) {
  const base = `${config.origin}/api/mcp-auth`;
  return {
    issuer: config.origin,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    revocation_endpoint: `${base}/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: [
      "none",
      "client_secret_post",
      "client_secret_basic",
    ],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [...MCP_SCOPES],
  };
}
export function resourceMetadata(config: McpConfig) {
  return {
    resource: `${config.origin}/api/mcp`,
    authorization_servers: [config.origin],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Bari Khata",
  };
}
export function parseScopes(scope: string | undefined) {
  try {
    return Scopes.parse(
      scope ? scope.split(/\s+/).filter(Boolean) : ["ledger:read"],
    );
  } catch {
    throw new McpError("invalid_scope");
  }
}
function validRedirect(value: string) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw new McpError("invalid_redirect_uri");
}
async function clientAuth(
  request: Request,
  body: URLSearchParams,
  store: McpStore,
) {
  let id = body.get("client_id") ?? "",
    password = body.get("client_secret") ?? "";
  const authorization = request.headers.get("authorization");
  let method = password ? "client_secret_post" : "none";
  if (authorization) {
    if (!authorization.startsWith("Basic "))
      throw new McpError("invalid_client", 401);
    const decoded = Buffer.from(authorization.slice(6), "base64").toString(
      "utf8",
    );
    const split = decoded.indexOf(":");
    if (split < 1) throw new McpError("invalid_client", 401);
    const basicId = decodeURIComponent(decoded.slice(0, split));
    if (id && id !== basicId) throw new McpError("invalid_client", 401);
    id = basicId;
    password = decodeURIComponent(decoded.slice(split + 1));
    method = "client_secret_basic";
  }
  if (!/^[A-Za-z0-9_-]{10,160}$/.test(id))
    throw new McpError("invalid_client", 401);
  const client = await store.call<OAuthClient>("get_client", { clientId: id });
  if (!client || client.tokenEndpointAuthMethod !== method)
    throw new McpError("invalid_client", 401);
  if (method !== "none") {
    const expected = client.clientSecretHash ?? "",
      actual = sha256(password);
    if (
      !password ||
      expected.length !== actual.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
    )
      throw new McpError("invalid_client", 401);
  }
  return client;
}
export async function limited(
  store: McpStore,
  key: string,
  limit: number,
  windowSeconds = 60,
) {
  const result = await store.call<{ allowed: boolean; retryAfter: number }>(
    "rate_limit",
    { key: sha256(key), limit, windowSeconds },
  );
  if (!result.allowed)
    throw new McpError("rate_limited", 429, { retryAfter: result.retryAfter });
}
export async function oauthHandler(
  request: Request,
  config: McpConfig,
  store: McpStore,
): Promise<Response> {
  const url = new URL(request.url),
    action = url.searchParams.get("action") ?? url.pathname.split("/").at(-1);
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (
    url.pathname.startsWith("/.well-known/oauth-protected-resource") ||
    url.searchParams.get("document") === "resource"
  )
    return json(resourceMetadata(config), 200, cors);
  if (
    url.pathname.startsWith("/.well-known/oauth-authorization-server") ||
    url.searchParams.get("document") === "authorization"
  )
    return json(oauthMetadata(config), 200, cors);
  const ip =
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  await limited(
    store,
    `oauth:${action}:${ip}`,
    action === "register" ? 15 : 90,
  );
  if (action === "register" && request.method === "POST") {
    const input = ClientRegistration.parse(await readJson(request, 16 * 1024));
    input.redirect_uris.forEach(validRedirect);
    const clientId = secret("bkc_"),
      password =
        input.token_endpoint_auth_method === "none" ? null : secret("bks_");
    const scopes =
      input.scope === undefined ? [...MCP_SCOPES] : parseScopes(input.scope);
    await store.call("register_client", {
      clientId,
      clientName: input.client_name,
      redirectUris: input.redirect_uris,
      tokenEndpointAuthMethod: input.token_endpoint_auth_method,
      clientSecretHash: password ? sha256(password) : null,
      scope: scopes.join(" "),
    });
    return json(
      {
        client_id: clientId,
        client_name: input.client_name,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        redirect_uris: input.redirect_uris,
        token_endpoint_auth_method: input.token_endpoint_auth_method,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: scopes.join(" "),
        ...(password
          ? { client_secret: password, client_secret_expires_at: 0 }
          : {}),
      },
      201,
      cors,
    );
  }
  if (action === "authorize" && request.method === "GET") {
    const clientId = z
      .string()
      .min(10)
      .max(160)
      .parse(url.searchParams.get("client_id"));
    const client = await store.call<OAuthClient | null>("get_client", {
      clientId,
    });
    if (!client) throw new McpError("invalid_client");
    const redirectUri = z
      .string()
      .url()
      .max(2048)
      .parse(url.searchParams.get("redirect_uri"));
    validRedirect(redirectUri);
    if (!client.redirectUris.includes(redirectUri))
      throw new McpError("invalid_redirect_uri");
    if (
      url.searchParams.get("response_type") !== "code" ||
      url.searchParams.get("code_challenge_method") !== "S256"
    )
      throw new McpError("invalid_request");
    const codeChallenge = z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .parse(url.searchParams.get("code_challenge"));
    const resource =
      url.searchParams.get("resource") ?? `${config.origin}/api/mcp`;
    if (resource !== `${config.origin}/api/mcp`)
      throw new McpError("invalid_target");
    const scopes = parseScopes(url.searchParams.get("scope") ?? undefined);
    if (scopes.some((scope) => !parseScopes(client.scope).includes(scope)))
      throw new McpError("invalid_scope");
    const state = z
      .string()
      .max(2048)
      .parse(url.searchParams.get("state") ?? "");
    const requestId = randomUUID();
    const authorization = await store
      .call<{ requestId: string }>("begin_authorization", {
        requestId,
        clientId,
        redirectUri,
        scopes,
        codeChallenge,
        resource,
        state,
      })
      .catch((error: unknown) => {
        if (error instanceof McpError && error.code === "mcp_invalid_scope")
          throw new McpError("invalid_scope");
        throw error;
      });
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${config.origin}/mcp/consent?request=${authorization.requestId}`,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
  if (
    (action === "token" || action === "revoke") &&
    request.method === "POST"
  ) {
    if (
      !request.headers
        .get("content-type")
        ?.startsWith("application/x-www-form-urlencoded")
    )
      throw new McpError("invalid_request");
    const body = new URLSearchParams(await readBody(request, 16 * 1024));
    const client = await clientAuth(request, body, store);
    if (action === "revoke") {
      const token = z.string().min(20).max(200).parse(body.get("token"));
      await store.call("revoke_token", {
        tokenHash: sha256(token),
        clientId: client.clientId,
      });
      return json({}, 200, cors);
    }
    const resource = body.get("resource") ?? `${config.origin}/api/mcp`;
    if (resource !== `${config.origin}/api/mcp`)
      throw new McpError("invalid_target");
    const access = secret("bkm_a_"),
      refresh = secret("bkm_r_");
    let result: { scopes?: string[]; scope?: string; error?: string };
    if (body.get("grant_type") === "authorization_code") {
      const code = z.string().min(20).max(200).parse(body.get("code"));
      const verifier = z
        .string()
        .regex(/^[A-Za-z0-9._~-]{43,128}$/)
        .parse(body.get("code_verifier"));
      result = await store.call("exchange_code", {
        codeHash: sha256(code),
        clientId: client.clientId,
        redirectUri: body.get("redirect_uri"),
        codeChallenge: challenge(verifier),
        resource,
        accessHash: sha256(access),
        refreshHash: sha256(refresh),
      });
    } else if (body.get("grant_type") === "refresh_token") {
      const token = z
        .string()
        .min(20)
        .max(200)
        .parse(body.get("refresh_token"));
      result = await store.call("refresh", {
        refreshHash: sha256(token),
        clientId: client.clientId,
        resource,
        accessHash: sha256(access),
        newRefreshHash: sha256(refresh),
      });
    } else throw new McpError("unsupported_grant_type");
    if (result.error) throw new McpError(result.error);
    return json(
      {
        access_token: access,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: refresh,
        scope: result.scopes?.join(" ") ?? result.scope ?? "ledger:read",
      },
      200,
      cors,
    );
  }
  // Revocation with a personal MCP bearer is also useful to clients without OAuth.
  if (action === "revoke-personal" && request.method === "POST") {
    await store.call("revoke_token", { tokenHash: sha256(bearer(request)) });
    return json({}, 200, cors);
  }
  throw new McpError("not_found", 404);
}
