import { Readable, Writable } from "node:stream";
import { finished } from "node:stream/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  MinimalPluginContextWithoutEnvironment,
  PreviewServer,
  ViteDevServer,
} from "vite";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { sharedReceiptPlugin } from "./sharedReceiptPlugin";
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
type Middleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => Promise<void>;
const pdf = Buffer.from("%PDF-sample\u00ff", "utf8");
const rpc = vi.fn();
const fetcher = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockReturnValue({
    abortSignal: vi.fn().mockResolvedValue({
      data: {
        storagePath: "00000000-0000-4000-8000-000000000001/sample-receipt",
        id: "sample-receipt",
        name: "sample.pdf",
        mime: "application/pdf",
        size: pdf.length,
      },
      error: null,
    }),
  });
  vi.mocked(createClient).mockReturnValue({ rpc } as unknown as ReturnType<
    typeof createClient
  >);
  fetcher.mockImplementation(
    async () =>
      new Response(pdf, { headers: { "Content-Type": "application/pdf" } }),
  );
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => vi.unstubAllGlobals());
async function call(
  surface: "dev" | "preview" = "dev",
  options: { host?: string; backend?: string; path?: string } = {},
) {
  const plugin = sharedReceiptPlugin({
    VITE_SUPABASE_URL: options.backend ?? "http://127.0.0.1:55431",
    BARI_PUBLIC_APP_ORIGIN: "https://production.example",
    BARI_DEV_SUPABASE_SERVICE_ROLE_KEY: "sample-local-server-key",
    BARI_SUPABASE_SERVICE_ROLE_KEY: "sample-production-key",
  });
  let middleware!: Middleware;
  const server = {
    middlewares: {
      use(value: Middleware) {
        middleware = value;
      },
    },
  };
  const context = {} as MinimalPluginContextWithoutEnvironment;
  if (surface === "dev" && typeof plugin.configureServer === "function")
    plugin.configureServer.call(context, server as unknown as ViteDevServer);
  else if (typeof plugin.configurePreviewServer === "function")
    plugin.configurePreviewServer.call(
      context,
      server as unknown as PreviewServer,
    );
  const host = options.host ?? "localhost:5180";
  const request = Readable.from([
    Buffer.from(
      JSON.stringify({
        token: "a".repeat(64),
        entryId: "sample-entry",
        receiptId: "sample-receipt",
        revision: 7,
      }),
    ),
  ]);
  Object.assign(request, {
    method: "POST",
    url: options.path ?? "/api/shared-receipt",
    headers: {
      host,
      origin: `http://${host}`,
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
    },
  });
  const chunks: Buffer[] = [];
  const response = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  let status = 0;
  let headers: Record<string, string> = {};
  Object.assign(response, {
    writeHead(code: number, values: Record<string, string>) {
      status = code;
      headers = values;
      return response;
    },
  });
  const next = vi.fn();
  await middleware(
    request as unknown as IncomingMessage,
    response as unknown as ServerResponse,
    next,
  );
  if (!next.mock.calls.length) await finished(response);
  return { status, headers, body: Buffer.concat(chunks), next };
}
it.each(["dev", "preview"] as const)(
  "serves exact authorized binary bytes from the local backend in %s",
  async (surface) => {
    const response = await call(surface);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(pdf);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.next).not.toHaveBeenCalled();
    expect(createClient).toHaveBeenCalledWith(
      "http://127.0.0.1:55431",
      "sample-local-server-key",
      expect.any(Object),
    );
  },
);
it.each([
  { host: "remote.example:5180" },
  { backend: "https://hosted.example" },
])(
  "refuses nonlocal capabilities before using server credentials %#",
  async (options) => {
    const response = await call("dev", options);
    expect(response.status).toBe(503);
    expect(JSON.parse(response.body.toString())).toEqual({
      error: "share_unavailable",
    });
    expect(createClient).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  },
);
it("leaves unrelated routes for the next middleware", async () => {
  const response = await call("dev", { path: "/settings" });
  expect(response.next).toHaveBeenCalledOnce();
  expect(createClient).not.toHaveBeenCalled();
});
