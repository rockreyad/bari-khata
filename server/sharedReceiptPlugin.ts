import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import {
  createSharedReceiptHandler,
  sharedReceiptConfig,
} from "./sharedReceipt.js";

export function sharedReceiptPlugin(
  env: Record<string, string | undefined>,
): Plugin {
  const middleware = async (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    if ((request.url ?? "").split("?")[0] !== "/api/shared-receipt") {
      next();
      return;
    }
    const abort = new AbortController();
    request.once("aborted", () => abort.abort());
    response.once("close", () => {
      if (!response.writableEnded) abort.abort();
    });
    try {
      const url = `http://${request.headers.host ?? "invalid"}${request.url}`;
      const handler = createSharedReceiptHandler({
        ...sharedReceiptConfig(env),
        serviceKey:
          env.BARI_DEV_SUPABASE_SERVICE_ROLE_KEY ||
          env.BARI_SUPABASE_SERVICE_ROLE_KEY ||
          "",
        origin: new URL(url).origin,
        local: true,
        vercel: false,
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
          response.end(JSON.stringify({ error: "share_invalid_request" }));
          return;
        }
        chunks.push(chunk);
      }
      const result = await handler(
        new Request(url, {
          method: request.method,
          signal: abort.signal,
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
      if (!result.body) response.end();
      else
        Readable.fromWeb(
          result.body as import("node:stream/web").ReadableStream,
        ).pipe(response);
    } catch {
      if (!response.headersSent)
        response.writeHead(503, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
      response.end(JSON.stringify({ error: "share_receipt_failed" }));
    }
  };
  return {
    name: "bari-shared-receipts",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
