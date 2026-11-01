import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AccountUser } from "../../data/authSession";
import { getActiveOwner } from "../../data/database";

const EmailAccountSchema = z.object({
  id: z.uuid(),
  email: z.email().max(254),
});
const PasswordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  password: z.string().min(8).max(128),
  confirmation: z.string().max(128),
});
export type PasswordChange = z.infer<typeof PasswordChangeSchema>;
export type PasswordClient = {
  auth: Pick<
    SupabaseClient["auth"],
    "signInWithPassword" | "updateUser" | "signOut"
  >;
};
export function canChangeEmailPassword(user: AccountUser | null) {
  return Boolean(
    user &&
    EmailAccountSchema.safeParse(user).success &&
    !/@phone\.bari\.invalid$/i.test(user.email ?? ""),
  );
}
function passwordClient(): PasswordClient {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key || key.startsWith("sb_secret_"))
    throw new Error("cloud_not_configured");
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `bari-password-change-${crypto.randomUUID()}`,
    },
  });
}
function failure(error: { code?: string }, verifying = false) {
  if (error.code === "invalid_credentials" || error.code === "invalid_grant")
    return new Error("current_password_invalid");
  if (error.code === "weak_password") return new Error("password_weak");
  if (error.code === "same_password") return new Error("password_same");
  if (
    error.code?.includes("rate_limit") ||
    error.code === "over_request_rate_limit"
  )
    return new Error("password_rate_limited");
  if (error.code === "email_not_confirmed")
    return new Error("email_not_confirmed");
  return new Error(
    verifying ? "password_verification_failed" : "password_change_failed",
  );
}
export async function changeEmailPassword(
  user: AccountUser,
  input: PasswordChange,
  options: {
    createClient?: () => PasswordClient;
    readOwner?: () => string | null;
  } = {},
): Promise<void> {
  if (!canChangeEmailPassword(user))
    throw new Error("password_change_unavailable");
  const parsed = PasswordChangeSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues[0].path[0] === "currentPassword"
        ? "current_password_required"
        : "password_weak",
    );
  const fields = parsed.data;
  if (fields.password !== fields.confirmation)
    throw new Error("password_mismatch");
  if (fields.password === fields.currentPassword)
    throw new Error("password_same");
  const readOwner = options.readOwner ?? getActiveOwner;
  const stillCurrent = () => readOwner() === user.id;
  if (!stillCurrent()) throw new Error("account_changed");
  const email = user.email!.trim().toLowerCase();
  const cloud = (options.createClient ?? passwordClient)();
  try {
    // Verify in memory so checking a password never switches the open notebook.
    const verified = await cloud.auth.signInWithPassword({
      email,
      password: fields.currentPassword,
    });
    if (!stillCurrent()) throw new Error("account_changed");
    if (verified.error) throw failure(verified.error, true);
    if (
      !verified.data.session ||
      verified.data.user?.id !== user.id ||
      verified.data.user.email?.toLowerCase() !== email ||
      verified.data.user.app_metadata?.bari_manual_phone_auth === true
    )
      throw new Error("account_changed");
    const result = await cloud.auth.updateUser({
      password: fields.password,
      current_password: fields.currentPassword,
    });
    if (!stillCurrent()) throw new Error("account_changed");
    if (result.error) throw failure(result.error);
    if (result.data.user?.id !== user.id)
      throw new Error("password_change_failed");
  } finally {
    await cloud.auth.signOut({ scope: "local" }).catch(() => {});
  }
}
