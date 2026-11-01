import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getCloudSession } from "../../data/sync";
import { getActiveOwner } from "../../data/database";
import type { Account } from "../../domain/model";

import {
  SharedStatementSchema,
  type SharedStatement,
  type SharedKind,
} from "./shareModel";
export {
  SharedStatementSchema,
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
export async function readShare(
  token: string,
  offset = 0,
  revision?: number,
  kind?: SharedKind,
): Promise<SharedStatement | null> {
  if (!validShareToken(token)) return null;
  const { url, key } = config();
  // Shared links must never inherit a remembered owner's access token or cached financial response.
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
  const result = await publicClient.rpc("read_contact_share", {
    p_token: token,
    p_offset: offset,
    p_limit: 40,
    p_revision: revision ?? null,
    ...(kind ? { p_kind: kind } : {}),
  });
  if (result.error)
    throw new Error(
      result.error.message.includes("share_changed")
        ? "share_changed"
        : "share_request_failed",
    );
  return result.data === null ? null : SharedStatementSchema.parse(result.data);
}
