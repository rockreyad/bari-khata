import { createMcpHandler } from "@modelcontextprotocol/server";
import { adminHandler } from "./admin.js";
import {
  bearer,
  errorResponse,
  json,
  McpError,
  MCP_DAILY_SCOPES,
  requestGuard,
  sha256,
  validConfig,
  type McpConfig,
} from "./common.js";
import { limited, oauthHandler, resourceMetadata } from "./oauth.js";
import { createMcpStore, type McpStore, type Principal } from "./store.js";
import { createLedgerMcpServer } from "./tools.js";
import { readableAsset } from "./assets.js";

export function createMcpApp(config: McpConfig, suppliedStore?: McpStore) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url),
      oauth =
        url.pathname.startsWith("/.well-known/") ||
        url.pathname.startsWith("/api/mcp-auth");
    try {
      if (!validConfig(config))
        return json({ error: "mcp_unavailable", available: false }, 404);
      if (url.origin !== config.origin) throw new McpError("invalid_host", 403);
      const store = suppliedStore ?? createMcpStore(config);
      if (oauth) return await oauthHandler(request, config, store);
      requestGuard(request, config, url.pathname === "/api/mcp-admin");
      if (url.pathname === "/api/mcp-admin")
        return await adminHandler(request, config, store);
      if (request.method === "OPTIONS")
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin":
              request.headers.get("origin") ?? config.origin,
            "Access-Control-Allow-Headers":
              "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id",
            "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
            "Access-Control-Expose-Headers":
              "WWW-Authenticate, MCP-Protocol-Version, Mcp-Session-Id",
            "Cache-Control": "no-store",
          },
        });
      let tokenHash: string, principal: Principal;
      try {
        const token = bearer(request);
        if (!/^bkm_(?:a|p)_[A-Za-z0-9_-]{43}$/.test(token))
          throw new McpError("unauthorized", 401);
        tokenHash = sha256(token);
        principal = await store.call<Principal>("authenticate", {
          tokenHash,
          resource: `${config.origin}/api/mcp`,
        });
      } catch (error) {
        if (
          error instanceof McpError &&
          error.status !== 401 &&
          error.status !== 403
        )
          throw error;
        const origin = request.headers.get("origin");
        return json({ error: "invalid_token" }, 401, {
          "WWW-Authenticate": `Bearer resource_metadata="${config.origin}/.well-known/oauth-protected-resource/api/mcp", scope="${MCP_DAILY_SCOPES.join(" ")}"`,
          ...(origin
            ? {
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Expose-Headers": "WWW-Authenticate",
                Vary: "Origin",
              }
            : {}),
        });
      }
      if (url.pathname === "/api/mcp-file") {
        if (request.method !== "GET")
          throw new McpError("method_not_allowed", 405);
        if (!principal.connection.scopes.includes("receipts:read"))
          throw new McpError("permission_denied", 403);
        await limited(
          store,
          `file:${principal.connection.ownerId}:${principal.connection.id}`,
          60,
        );
        const id = url.searchParams.get("receipt");
        if (!id || id.length > 160) throw new McpError("invalid_request");
        const asset = await readableAsset(
          store,
          principal,
          tokenHash,
          `${config.origin}/api/mcp`,
          id,
        );
        if (
          !["uploaded", "ready", "finalized", "attached"].includes(asset.status)
        )
          throw new McpError("receipt_not_ready", 409);
        const bytes = await store.download(asset.path);
        if (sha256(bytes) !== asset.sha256)
          throw new McpError("file_integrity_error", 409);
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            for (let offset = 0; offset < bytes.length; offset += 65536)
              controller.enqueue(bytes.slice(offset, offset + 65536));
            controller.close();
          },
        });
        const origin = request.headers.get("origin");
        return new Response(body, {
          headers: {
            "Content-Type": asset.mime,
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            ...(origin
              ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
              : {}),
          },
        });
      }
      if (url.pathname !== "/api/mcp") throw new McpError("not_found", 404);
      const handler = createMcpHandler(
        () => createLedgerMcpServer(store, config, tokenHash),
        {
          legacy: "stateless",
          responseMode: "json",
          maxRequestBodySize: 768 * 1024,
          maxSubscriptions: 0,
        },
      );
      const response = await handler.fetch(request, {
        authInfo: {
          token: "",
          clientId: principal.connection.id,
          scopes: principal.connection.scopes,
          expiresAt: Math.floor(Date.now() / 1000) + 60,
          resource: new URL(resourceMetadata(config).resource),
          resourceMetadataUrl: `${config.origin}/.well-known/oauth-protected-resource/api/mcp`,
        },
      });
      response.headers.set("Cache-Control", "no-store");
      const origin = request.headers.get("origin");
      if (origin) {
        response.headers.set("Access-Control-Allow-Origin", origin);
        response.headers.set("Vary", "Origin");
        response.headers.set(
          "Access-Control-Expose-Headers",
          "WWW-Authenticate, MCP-Protocol-Version",
        );
      }
      return response;
    } catch (error) {
      const response = errorResponse(error);
      if (oauth) {
        response.headers.set("Access-Control-Allow-Origin", "*");
        if (
          error instanceof McpError &&
          /mcp_invalid_grant|mcp_not_found|mcp_unauthorized/.test(error.code)
        )
          return json({ error: "invalid_grant" }, 400, {
            "Access-Control-Allow-Origin": "*",
          });
      }
      return response;
    }
  };
}
