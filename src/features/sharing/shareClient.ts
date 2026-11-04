import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getCloudSession } from "../../data/sync";
import { getActiveOwner } from "../../data/database";
import type { Account } from "../../domain/model";

import {
  SharedStatementSchema,
  SHARED_PAGE_SIZE,
  validateSharedPage,
  SharedEntrySchema,
  SHARED_QUERY_MAX_LENGTH,
  SHARED_RECEIPT_MAX_BYTES,
  SHARED_RECEIPT_MIMES,
  type SharedStatement,
  type SharedKind,
  type SharedEntry,
} from "./shareModel";
export {
  SharedStatementSchema,
  SHARED_PAGE_SIZE,
  validateSharedPage,
  SharedEntrySchema,
  type SharedEntry,
  type SharedStatement,
  type SharedKind,
} from "./shareModel";

const ShareStatusSchema = z.object({
  id: z.uuid(),
  createdAt: z.string().datetime({ offset: true }),
});
export type ShareStatus = z.infer<typeof ShareStatusSchema>;
export type ShareScope = {
  personId: string;
  account: Account;
  workId?: string;
};
const config = () => {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key || key.startsWith("sb_secret_"))
    throw new Error("share_not_configured");
  return { url, key };
};
export const validShareToken = (token: string) => /^[a-f0-9]{64}$/.test(token);
export function liveShareUrl(token: string, origin = window.location.origin) {
  if (!validShareToken(token)) throw new Error("invalid_share_token");
  return new URL(`/shared#${token}`, origin).href;
}
const scopeArgs = (scope: ShareScope) => ({
  p_person_id: scope.personId,
  p_account: scope.account,
  p_work_id: scope.workId || null,
});
async function ownerClient() {
  const owner = getActiveOwner();
  const session = await getCloudSession();
  if (!owner || !session || session.user.id !== owner)
    throw new Error("share_sign_in_required");
  const { url, key } = config();
  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return {
    client,
    check: () => {
      if (getActiveOwner() !== owner) throw new Error("owner_mismatch");
    },
  };
}
export async function shareStatus(scope: ShareScope) {
  const { client, check } = await ownerClient();
  const result = await client.rpc("contact_share_status", scopeArgs(scope));
  check();
  if (result.error) throw new Error("share_request_failed");
  return result.data === null ? null : ShareStatusSchema.parse(result.data);
}
export async function createShare(scope: ShareScope) {
  const { client, check } = await ownerClient();
  const result = await client.rpc("create_contact_share", scopeArgs(scope));
  check();
  if (result.error) throw new Error("share_request_failed");
  return ShareStatusSchema.extend({
    token: z.string().regex(/^[a-f0-9]{64}$/),
  }).parse(result.data);
}
export async function revokeShare(id: string) {
  const { client, check } = await ownerClient();
  const result = await client.rpc("revoke_contact_share", {
    p_id: z.uuid().parse(id),
  });
  check();
  if (result.error || result.data !== true)
    throw new Error("share_request_failed");
}
let publicClient: SupabaseClient | null = null;
function anonymousClient() {
  const { url, key } = config();
  // Capability reads never inherit an owner's session or cached financial response.
  publicClient ??= createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, cache: "no-store", credentials: "omit" }),
    },
  });
  return publicClient;
}
export async function readShare(
  token: string,
  offset = 0,
  revision?: number,
  kind?: SharedKind,
  options?: { signal?: AbortSignal; query?: string; grouped?: boolean },
): Promise<SharedStatement | null> {
  if (!validShareToken(token)) return null;
  options?.signal?.throwIfAborted();
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 100000 ||
    (revision !== undefined &&
      (!Number.isSafeInteger(revision) || revision < 1))
  )
    throw new Error("share_invalid_page");
  const query = options?.query ?? "";
  if (typeof query !== "string" || query.length > SHARED_QUERY_MAX_LENGTH)
    throw new Error("share_invalid_page");
  const request = anonymousClient().rpc(
    options?.grouped ? "read_contact_share_activity" : "search_contact_share",
    {
      p_token: token,
      p_offset: offset,
      p_limit: SHARED_PAGE_SIZE,
      p_revision: revision ?? null,
      p_query: query,
      ...(kind ? { p_kind: kind } : {}),
    },
  );
  const result = await (options?.signal
    ? request.abortSignal(options.signal)
    : request);
  options?.signal?.throwIfAborted();
  if (result.error)
    throw new Error(
      result.error.message.includes("share_changed")
        ? "share_changed"
        : "share_request_failed",
    );
  return result.data === null
    ? null
    : validateSharedPage(
        SharedStatementSchema.parse(result.data),
        offset,
        revision,
        kind,
      );
}

function validEntryRequest(entryId: string, revision: number) {
  return (
    entryId.length > 0 &&
    entryId.length <= 160 &&
    Number.isSafeInteger(revision) &&
    revision > 0
  );
}
export async function readSharedEntry(
  token: string,
  entryId: string,
  revision: number,
  options?: { signal?: AbortSignal },
): Promise<SharedEntry | null> {
  if (!validShareToken(token)) return null;
  options?.signal?.throwIfAborted();
  if (!validEntryRequest(entryId, revision))
    throw new Error("share_invalid_page");
  const request = anonymousClient().rpc("read_contact_share_entry", {
    p_token: token,
    p_entry_id: entryId,
    p_revision: revision,
  });
  const result = await (options?.signal
    ? request.abortSignal(options.signal)
    : request);
  options?.signal?.throwIfAborted();
  if (result.error)
    throw new Error(
      result.error.message.includes("share_changed")
        ? "share_changed"
        : "share_request_failed",
    );
  if (result.data === null) return null;
  const entry = SharedEntrySchema.parse(result.data);
  if (entry.revision !== revision) throw new Error("share_changed");
  if (entry.key !== entryId) throw new Error("share_invalid_page");
  return entry;
}

export async function readSharedReceipt(
  token: string,
  entryId: string,
  receiptId: string,
  revision: number,
  options?: { signal?: AbortSignal },
): Promise<Blob> {
  options?.signal?.throwIfAborted();
  if (
    !validShareToken(token) ||
    !validEntryRequest(entryId, revision) ||
    !receiptId.length ||
    receiptId.length > 160
  )
    throw new Error("share_unavailable");
  const response = await fetch("/api/shared-receipt", {
    method: "POST",
    cache: "no-store",
    credentials: "omit",
    signal: options?.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, entryId, receiptId, revision }),
  });
  options?.signal?.throwIfAborted();
  if (!response.ok)
    throw new Error(
      response.status === 409
        ? "share_changed"
        : response.status === 404
          ? "share_unavailable"
          : response.status === 413
            ? "share_receipt_too_large"
            : "share_receipt_failed",
    );
  const mime = (response.headers.get("Content-Type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!(SHARED_RECEIPT_MIMES as readonly string[]).includes(mime)) {
    await response.body?.cancel();
    throw new Error("share_receipt_failed");
  }
  const declared = response.headers.get("Content-Length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > SHARED_RECEIPT_MAX_BYTES)
  ) {
    await response.body?.cancel();
    throw new Error("share_receipt_too_large");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("share_receipt_failed");
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  options?.signal?.addEventListener("abort", cancel, { once: true });
  const chunks: BlobPart[] = [];
  let size = 0;
  try {
    while (true) {
      options?.signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > SHARED_RECEIPT_MAX_BYTES - size) {
        await reader.cancel();
        throw new Error("share_receipt_too_large");
      }
      size += value.byteLength;
      chunks.push(new Uint8Array(value));
    }
    options?.signal?.throwIfAborted();
  } catch (cause) {
    await reader.cancel().catch(() => {});
    throw cause;
  } finally {
    options?.signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  if (!size || (declared !== null && Number(declared) !== size))
    throw new Error("share_receipt_failed");
  return new Blob(chunks, { type: mime });
}
