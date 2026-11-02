import { z } from "zod";
import type { Session } from "@supabase/supabase-js";
import { getAccountDatabase, getActiveOwner } from "../../data/database";
import { getCloudSession } from "../../data/sync";

export async function assertAccountCanBeDeleted(owner: string) {
  if (getActiveOwner() !== owner) throw new Error("account_changed");
  const database = getAccountDatabase(owner);
  const [row, outbox, conflict] = await Promise.all([
    database.workspaces.get("real"),
    database.outbox.where("workspace").equals("real").count(),
    database.conflicts.get("real"),
  ]);
  if (getActiveOwner() !== owner) throw new Error("account_changed");
  if (row?.ownerId !== owner) throw new Error("account_changed");
  if (row.pending || outbox || conflict)
    throw new Error("account_has_pending_data");
}
export async function deleteOwnAccount(
  owner: string,
  confirmation: string,
  options: {
    fetcher?: typeof fetch;
    readOwner?: () => string | null;
    session?: () => Promise<Session | null>;
    ready?: (owner: string) => Promise<void>;
  } = {},
) {
  z.uuid().parse(owner);
  if (confirmation !== "DELETE") throw new Error("confirmation_required");
  const readOwner = options.readOwner ?? getActiveOwner;
  const current = () => {
    if (readOwner() !== owner) throw new Error("account_changed");
  };
  current();
  const ready = options.ready ?? assertAccountCanBeDeleted;
  await ready(owner);
  const session = await (options.session ?? getCloudSession)();
  current();
  if (!session || session.user.id !== owner || !session.access_token)
    throw new Error("sign_in_required");
  await ready(owner);
  current();
  const response = await (options.fetcher ?? fetch)("/api/account-delete", {
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ confirmation }),
  });
  const value: unknown = await response.json().catch(() => null);
  current();
  if (!response.ok) {
    const parsed = z
      .object({
        error: z.enum([
          "account_delete_unavailable",
          "sign_in_required",
          "account_too_large",
        ]),
      })
      .safeParse(value);
    throw new Error(
      parsed.success ? parsed.data.error : "account_delete_failed",
    );
  }
  if (!z.strictObject({ deleted: z.literal(true) }).safeParse(value).success)
    throw new Error("account_delete_failed");
}
