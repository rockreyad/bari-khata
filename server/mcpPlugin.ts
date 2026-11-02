import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mcpConfig } from "./mcp/common.js";
import { createMcpApp } from "./mcp/handler.js";

export function mcpPlugin(env: Record<string, string | undefined>): Plugin {
  const middleware = async (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    const pathname = (request.url ?? "").split("?")[0];
    if (
      !/^\/api\/mcp(?:$|[-/])/.test(pathname) &&
      !/^\/\.well-known\/oauth-(?:authorization-server|protected-resource)(?:\/|$)/.test(
        pathname,
      )
    ) {
      next();
      return;
    }
    try {
      const host = request.headers.host ?? "localhost:5180";
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) {
        response.writeHead(403);
        response.end();
        return;
      }
      const origin = `http://${host}`,
        chunks: Buffer[] = [];
      let size = 0;
      for await (const part of request) {
        const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part);
        size += bytes.length;
        if (size > 768 * 1024) {
          response.writeHead(413);
          response.end();
          return;
        }
        chunks.push(bytes);
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers))
        if (typeof value === "string") headers.set(key, value);
      const result = await createMcpApp({ ...mcpConfig(env), origin })(
        new Request(new URL(request.url ?? "/", origin), {
          method: request.method,
          headers,
          ...(request.method !== "GET" && request.method !== "HEAD"
            ? { body: Buffer.concat(chunks) }
            : {}),
        }),
      );
      response.writeHead(result.status, Object.fromEntries(result.headers));
      if (result.body) {
        const reader = result.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          response.write(value);
        }
      }
      response.end();
    } catch {
      if (!response.headersSent)
        response.writeHead(503, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
      response.end(JSON.stringify({ error: "mcp_unavailable" }));
    }
  };
  return {
    name: "bari-mcp",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
