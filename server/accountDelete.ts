import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export type AccountDeleteConfig = {
  url: string;
  serviceKey: string;
  origin: string;
  vercel: boolean;
  local?: boolean;
};
type StorageItem = { name: string; id: string | null };
export type AccountDeleteBackend = {
  getUser: (token: string) => Promise<string | null>;
  listReceipts: (prefix: string, offset: number) => Promise<StorageItem[]>;
  removeReceipts: (paths: string[]) => Promise<void>;
  cleanupAssistantFiles?: (id: string) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
};
const Body = z.strictObject({ confirmation: z.literal("DELETE") });
const UserId = z.uuid();
const loopback = (host: string) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(host);
export function accountDeleteConfig(
  env: Record<string, string | undefined>,
): AccountDeleteConfig {
  return {
    url: env.VITE_SUPABASE_URL ?? "",
    serviceKey: env.BARI_SUPABASE_SERVICE_ROLE_KEY ?? "",
    origin: env.BARI_PUBLIC_APP_ORIGIN ?? "",
    vercel: env.VERCEL === "1",
  };
}
export function accountDeleteConfigured(config: AccountDeleteConfig) {
  try {
    const app = new URL(config.origin),
      backend = new URL(config.url);
    if (
      app.origin !== config.origin ||
      backend.pathname !== "/" ||
      backend.username ||
      backend.password ||
      backend.search ||
      backend.hash ||
      !config.serviceKey
    )
      return false;
    if (config.local)
      return (
        !config.vercel &&
        loopback(app.hostname) &&
        loopback(backend.hostname) &&
        app.protocol === "http:" &&
        backend.protocol === "http:"
      );
    return (
      config.vercel &&
      app.protocol === "https:" &&
      backend.protocol === "https:"
    );
  } catch {
    return false;
  }
}
function backend(config: AccountDeleteConfig): AccountDeleteBackend {
  const client = createClient(config.url, config.serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const receipts = client.storage.from("bari-receipts");
  const assistantFiles = client.storage.from("bari-mcp-staging");
  return {
    async getUser(token) {
      const result = await client.auth.getUser(token);
      return result.error ? null : (result.data.user?.id ?? null);
    },
    async listReceipts(prefix, offset) {
      const result = await receipts.list(prefix, {
        limit: 100,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (result.error) throw new Error("receipt_cleanup_failed");
      return result.data.map((item) => ({ name: item.name, id: item.id }));
    },
    async removeReceipts(paths) {
      const result = await receipts.remove(paths);
      if (result.error) throw new Error("receipt_cleanup_failed");
    },
    async cleanupAssistantFiles(id) {
      const paths = await receiptPaths(
        {
          async listReceipts(prefix, offset) {
            const result = await assistantFiles.list(prefix, {
              limit: 100,
              offset,
              sortBy: { column: "name", order: "asc" },
            });
            if (result.error) {
              if (
                /bucket (?:not found|does not exist)/i.test(
                  result.error.message,
                )
              )
                return [];
              throw new Error("assistant_cleanup_failed");
            }
            return result.data.map((item) => ({
              name: item.name,
              id: item.id,
            }));
          },
        },
        id,
      );
      for (let start = 0; start < paths.length; start += 100) {
        const result = await assistantFiles.remove(
          paths.slice(start, start + 100),
        );
        if (result.error) throw new Error("assistant_cleanup_failed");
      }
    },
    async deleteUser(id) {
      const result = await client.auth.admin.deleteUser(id);
      if (result.error) throw new Error("account_delete_failed");
    },
  };
}
class Failure extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
async function body(request: Request) {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  )
    throw new Failure(415, "invalid_request");
  if (Number(request.headers.get("content-length") ?? 0) > 1024)
    throw new Failure(413, "invalid_request");
  const reader = request.body?.getReader();
  if (!reader) throw new Failure(400, "invalid_request");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1024) {
        await reader.cancel();
        throw new Failure(413, "invalid_request");
      }
      chunks.push(part.value);
    }
    const parsed = Body.safeParse(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      ),
    );
    if (!parsed.success) throw new Error();
    return parsed.data;
  } catch (error) {
    if (error instanceof Failure) throw error;
    throw new Failure(400, "invalid_request");
  } finally {
    reader.releaseLock();
  }
}
async function receiptPaths(
  client: Pick<AccountDeleteBackend, "listReceipts">,
  id: string,
) {
  const folders = [id],
    files: string[] = [];
  for (let cursor = 0; cursor < folders.length; cursor++) {
    if (folders.length > 1000) throw new Failure(409, "account_too_large");
    const prefix = folders[cursor];
    for (let offset = 0; ; offset += 100) {
      const rows = await client.listReceipts(prefix, offset);
      for (const item of rows) {
        if (
          !item.name ||
          /[\/\\]/.test(item.name) ||
          item.name === "." ||
          item.name === ".."
        )
          throw new Error("receipt_cleanup_failed");
        const path = `${prefix}/${item.name}`;
        if (item.id === null) folders.push(path);
        else files.push(path);
        if (files.length > 10000) throw new Failure(409, "account_too_large");
      }
      if (rows.length < 100) break;
    }
  }
  return files;
}
export function createAccountDeleteHandler(
  config: AccountDeleteConfig,
  dependency?: AccountDeleteBackend,
) {
  let client = dependency;
  return async (request: Request) => {
    try {
      if (!accountDeleteConfigured(config))
        throw new Failure(404, "account_delete_unavailable");
      if (
        request.headers.get("origin") !== config.origin ||
        new URL(request.url).origin !== config.origin ||
        (request.headers.has("sec-fetch-site") &&
          request.headers.get("sec-fetch-site") !== "same-origin")
      )
        throw new Failure(403, "invalid_request");
      if (request.method !== "POST") throw new Failure(405, "invalid_request");
      const authorization = request.headers.get("authorization") ?? "";
      if (!/^Bearer [A-Za-z0-9._~-]{20,16384}$/.test(authorization))
        throw new Failure(401, "sign_in_required");
      await body(request);
      client ??= backend(config);
      const id = UserId.safeParse(await client.getUser(authorization.slice(7)));
      if (!id.success) throw new Failure(401, "sign_in_required");
      const paths = await receiptPaths(client, id.data);
      // Auth refuses deleting owners of Storage objects; a failed cleanup can be retried.
      for (let start = 0; start < paths.length; start += 100)
        await client.removeReceipts(paths.slice(start, start + 100));
      await client.cleanupAssistantFiles?.(id.data);
      await client.deleteUser(id.data);
      return reply(200, { deleted: true });
    } catch (error) {
      const failure =
        error instanceof Failure
          ? error
          : new Failure(503, "account_delete_failed");
      return reply(failure.status, { error: failure.code });
    }
  };
}
