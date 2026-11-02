import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Ledger } from "../../src/domain/model.js";
import { McpError, type McpConfig } from "./common.js";

export type Connection = {
  id: string;
  ownerId: string;
  name: string;
  clientId?: string | null;
  scopes: string[];
  policy: { confirmationRequired?: boolean; maxAmountPaisa?: number | null };
  expiresAt?: string;
  [key: string]: unknown;
};
export type Principal = {
  connection: Connection;
  snapshot: {
    revision: number;
    document: Ledger | null;
    updatedAt: string | null;
  };
};
export type Asset = {
  id: string;
  ownerId: string;
  connectionId: string | null;
  path: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  status: string;
  immutable?: boolean;
};
export interface McpStore {
  call<T = unknown>(action: string, data: Record<string, unknown>): Promise<T>;
  user(token: string): Promise<string>;
  uploadUrl(path: string): Promise<string>;
  put(path: string, bytes: Uint8Array, mime: string): Promise<void>;
  download(path: string): Promise<Uint8Array>;
  list(prefix: string): Promise<string[]>;
  remove(paths: string[]): Promise<void>;
}
export function createMcpStore(config: McpConfig): McpStore {
  const admin: SupabaseClient = createClient(config.url, config.serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const bucketFor = (path: string) =>
    admin.storage.from(
      /\/\.mcp-(?:staging|chunks)\//.test(path)
        ? "bari-mcp-staging"
        : "bari-receipts",
    );
  return {
    async call<T>(action: string, data: Record<string, unknown>): Promise<T> {
      const result =
        action === "find_duplicates"
          ? await admin.rpc("mcp_find_duplicates", {
              p_token_hash: data.tokenHash,
              p_keys: data.keys,
            })
          : action === "list_audit"
            ? await admin.rpc("mcp_audit", {
                p_token_hash: data.tokenHash,
                p_limit: data.limit ?? 30,
                p_offset: data.offset ?? 0,
                p_entity_id: data.entryId ?? null,
                p_revision: data.expectedRevision ?? null,
                p_include_all: data.includeAll ?? true,
              })
            : await admin.rpc("mcp_server", { p_action: action, p_data: data });
      if (result.error) {
        const code = /^mcp_[a-z_]+$/.test(result.error.message)
          ? result.error.message
          : "service_unavailable";
        const status = /unauthorized|revoked|invalid_token/.test(code)
          ? 401
          : /forbidden|scope_required/.test(code)
            ? 403
            : /not_found/.test(code)
              ? 404
              : /mismatch|conflict/.test(code)
                ? 409
                : /limit/.test(code)
                  ? 429
                  : code === "service_unavailable"
                    ? 503
                    : 400;
        throw new McpError(code, status);
      }
      return result.data as T;
    },
    async user(token) {
      if (token.split(".").length !== 3)
        throw new McpError("unauthorized", 401);
      const result = await admin.auth.getUser(token);
      if (result.error || !result.data.user || result.data.user.is_anonymous)
        throw new McpError("unauthorized", 401);
      return result.data.user.id;
    },
    async uploadUrl(path) {
      const { data, error } = await bucketFor(path).createSignedUploadUrl(
        path,
        { upsert: false },
      );
      if (error || !data) throw new McpError("upload_unavailable", 503);
      return data.signedUrl;
    },
    async put(path, bytes, mime) {
      const { error } = await bucketFor(path).upload(path, bytes, {
        contentType: mime,
        upsert: false,
      });
      if (error) throw new McpError("upload_conflict", 409);
    },
    async download(path) {
      const { data, error } = await bucketFor(path).download(path);
      if (error || !data) throw new McpError("file_not_found", 404);
      return new Uint8Array(await data.arrayBuffer());
    },
    async list(prefix) {
      const { data, error } = await bucketFor(`${prefix}/`).list(prefix, {
        limit: 45,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new McpError("upload_unavailable", 503);
      return (data ?? []).map((item) => `${prefix}/${item.name}`);
    },
    async remove(paths) {
      for (const path of paths) {
        const { error } = await bucketFor(path).remove([path]);
        if (error) throw new McpError("upload_unavailable", 503);
      }
    },
  };
}
