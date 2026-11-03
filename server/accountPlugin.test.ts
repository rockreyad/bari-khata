import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  MinimalPluginContextWithoutEnvironment,
  PreviewServer,
  ViteDevServer,
} from "vite";
import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountDeleteConfig } from "./accountDelete";
import { accountPlugin } from "./accountPlugin";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

const owner = "00000000-0000-4000-8000-000000000001";
const token = "disposable-test-token-1234567890";
const getUser = vi.fn();
const deleteUser = vi.fn();
const list = vi.fn();
const remove = vi.fn();
type Middleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => void | Promise<void>;

function setup(
  env: Record<string, string | undefined> = {},
  surface: "dev" | "preview" = "dev",
) {
  const plugin = accountPlugin({
    VITE_SUPABASE_URL: "http://127.0.0.1:55431",
    BARI_PUBLIC_APP_ORIGIN: "https://production.example",
    ...env,
  });
  let middleware: Middleware | undefined;
  const server = {
    middlewares: {
      use(value: Middleware) {
        middleware = value;
      },
    },
  };
  const context = {} as MinimalPluginContextWithoutEnvironment;
  if (surface === "dev") {
    if (typeof plugin.configureServer !== "function")
      throw new Error("Expected a dev server hook.");
    plugin.configureServer.call(context, server as unknown as ViteDevServer);
  } else {
    if (typeof plugin.configurePreviewServer !== "function")
      throw new Error("Expected a preview server hook.");
    plugin.configurePreviewServer.call(
      context,
      server as unknown as PreviewServer,
    );
  }
  return async (options: { host?: string; origin?: string } = {}) => {
    if (!middleware) throw new Error("Account middleware was not installed.");
    const host = options.host ?? "localhost:5180";
    const request = Readable.from([
      Buffer.from(JSON.stringify({ confirmation: "DELETE" })),
    ]) as unknown as IncomingMessage;
    Object.assign(request, {
      url: "/api/account-delete",
      method: "POST",
      headers: {
        host,
        origin: options.origin ?? `http://${host}`,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
      },
    });
    let status = 0;
    let headers: Record<string, string> = {};
    let body = "";
    let sent = false;
    const next = vi.fn();
    const response = {
      get headersSent() {
        return sent;
      },
      writeHead(code: number, values: Record<string, string>) {
        status = code;
        headers = values;
        sent = true;
      },
      end(value: string) {
        body = value;
      },
    } as unknown as ServerResponse;
    await middleware(request, response, next);
    return {
      status,
      headers,
      body: JSON.parse(body) as Record<string, unknown>,
      next,
    };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: owner } }, error: null });
  deleteUser.mockResolvedValue({ error: null });
  list.mockResolvedValue({ data: [], error: null });
  remove.mockResolvedValue({ error: null });
  vi.mocked(createClient).mockReturnValue({
    auth: { getUser, admin: { deleteUser } },
    storage: { from: () => ({ list, remove }) },
  } as unknown as ReturnType<typeof createClient>);
});

describe("local account deletion middleware", () => {
  it.each(["dev", "preview"] as const)(
    "uses the local server key for authenticated deletion in %s",
    async (surface) => {
      const call = setup(
        { BARI_DEV_SUPABASE_SERVICE_ROLE_KEY: "local-server-only-key" },
        surface,
      );
      const result = await call({
        host: surface === "preview" ? "localhost:4180" : "localhost:5180",
      });
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ deleted: true });
      expect(result.headers["cache-control"]).toBe("no-store");
      expect(result.next).not.toHaveBeenCalled();
      expect(createClient).toHaveBeenCalledWith(
        "http://127.0.0.1:55431",
        "local-server-only-key",
        expect.any(Object),
      );
      expect(getUser).toHaveBeenCalledExactlyOnceWith(token);
      expect(deleteUser).toHaveBeenCalledExactlyOnceWith(owner);
    },
  );

  it("prefers the local key when both server keys are present", async () => {
    const call = setup({
      BARI_DEV_SUPABASE_SERVICE_ROLE_KEY: "local-server-only-key",
      BARI_SUPABASE_SERVICE_ROLE_KEY: "production-server-only-key",
    });
    expect((await call()).status).toBe(200);
    expect(vi.mocked(createClient).mock.calls[0][1]).toBe(
      "local-server-only-key",
    );
  });

  it("keeps the existing server key fallback for local configurations", async () => {
    const call = setup({
      BARI_DEV_SUPABASE_SERVICE_ROLE_KEY: "",
      BARI_SUPABASE_SERVICE_ROLE_KEY: "existing-server-only-key",
    });
    expect((await call()).status).toBe(200);
    expect(vi.mocked(createClient).mock.calls[0][1]).toBe(
      "existing-server-only-key",
    );
  });

  it.each([
    {
      name: "a hosted database",
      env: { VITE_SUPABASE_URL: "https://remote.example" },
      host: "localhost:5180",
    },
    {
      name: "a remote request host",
      env: {},
      host: "remote.example:5180",
    },
  ])("rejects $name before contacting the backend", async ({ env, host }) => {
    const call = setup({
      BARI_DEV_SUPABASE_SERVICE_ROLE_KEY: "local-server-only-key",
      ...env,
    });
    const result = await call({ host });
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: "account_delete_unavailable" });
    expect(createClient).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("rejects cross-origin deletion before contacting the backend", async () => {
    const call = setup({
      BARI_DEV_SUPABASE_SERVICE_ROLE_KEY: "local-server-only-key",
    });
    const result = await call({ origin: "https://remote.example" });
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: "invalid_request" });
    expect(createClient).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("does not enable production account deletion with the local key", () => {
    expect(
      accountDeleteConfig({
        VITE_SUPABASE_URL: "https://remote.example",
        BARI_PUBLIC_APP_ORIGIN: "https://production.example",
        VERCEL: "1",
        BARI_DEV_SUPABASE_SERVICE_ROLE_KEY: "local-server-only-key",
      }),
    ).toEqual({
      url: "https://remote.example",
      origin: "https://production.example",
      vercel: true,
      serviceKey: "",
    });
  });
});
