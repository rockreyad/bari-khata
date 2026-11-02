import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  accountDeleteConfig,
  createAccountDeleteHandler,
} from "./accountDelete.js";

export function accountPlugin(env: Record<string, string | undefined>): Plugin {
  const middleware = async (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    if ((request.url ?? "").split("?")[0] !== "/api/account-delete") {
      next();
      return;
    }
    try {
      const url = `http://${request.headers.host ?? "invalid"}/api/account-delete`;
      const handler = createAccountDeleteHandler({
        ...accountDeleteConfig(env),
        origin: new URL(url).origin,
        vercel: false,
        local: true,
      });
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const part of request) {
        const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
        size += chunk.length;
        if (size > 1024) {
          response.writeHead(413, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          response.end(JSON.stringify({ error: "invalid_request" }));
          return;
        }
        chunks.push(chunk);
      }
      const result = await handler(
        new Request(url, {
          method: request.method,
          headers: Object.fromEntries(
            Object.entries(request.headers).filter(
              (item): item is [string, string] => typeof item[1] === "string",
            ),
          ),
          ...(request.method !== "GET" && request.method !== "HEAD"
            ? { body: Buffer.concat(chunks) }
            : {}),
        }),
      );
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(await result.text());
    } catch {
      if (!response.headersSent)
        response.writeHead(503, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
      response.end(JSON.stringify({ error: "account_delete_failed" }));
    }
  };
  return {
    name: "bari-account-settings",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
