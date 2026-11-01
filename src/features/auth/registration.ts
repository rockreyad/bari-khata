import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const RegistrationSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((email) => email.toLowerCase()),
    password: z.string().min(8).max(128),
    confirmation: z.string(),
  })
  .refine((value) => value.password === value.confirmation, {
    path: ["confirmation"],
    message: "password_mismatch",
  });
export function validateRegistration(
  email: string,
  password: string,
  confirmation: string,
) {
  const result = RegistrationSchema.safeParse({
    email: email.trim(),
    password,
    confirmation,
  });
  if (!result.success) {
    const field = result.error.issues[0].path[0];
    throw new Error(
      field === "email"
        ? "invalid_email"
        : field === "confirmation"
          ? "password_mismatch"
          : "password_weak",
    );
  }
  return result.data;
}
const EmailSchema = z.email().max(254);
const client = () => {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key || key.startsWith("sb_secret_"))
    throw new Error("cloud_not_configured");
  // Confirmation never signs the device into a different person's notebook.
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `bari-registration-${crypto.randomUUID()}`,
    },
  });
};
export function confirmationRedirect(origin = window.location.origin) {
  const url = new URL(origin);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("invalid_origin");
  return new URL("/auth/confirm", url.origin).href;
}
function failure(error: { code?: string; message?: string }) {
  if (error.code === "weak_password") return new Error("password_weak");
  if (
    error.code?.includes("rate_limit") ||
    error.code === "over_request_rate_limit"
  )
    return new Error("registration_rate_limited");
  if (error.code === "signup_disabled")
    return new Error("registration_unavailable");
  return new Error("registration_failed");
}
export async function registerAccount(
  email: string,
  password: string,
  confirmation: string,
) {
  const fields = validateRegistration(email, password, confirmation);
  const cloud = client();
  const { data, error } = await cloud.auth.signUp({
    email: fields.email,
    password: fields.password,
    options: { emailRedirectTo: confirmationRedirect() },
  });
  if (error && error.code !== "user_already_exists") throw failure(error);
  if (data.session) {
    await cloud.auth.signOut({ scope: "local" });
    throw new Error("registration_confirmation_required");
  }
}
export async function resendRegistration(email: string) {
  const parsed = EmailSchema.safeParse(email.trim());
  if (!parsed.success) throw new Error("invalid_email");
  const cloud = client();
  const { error } = await cloud.auth.resend({
    type: "signup",
    email: parsed.data,
    options: { emailRedirectTo: confirmationRedirect() },
  });
  if (error && error.code !== "user_already_exists") throw failure(error);
}
const TokenHashSchema = z.string().regex(/^[a-zA-Z0-9_-]{20,512}$/);
const AccessTokenSchema = z
  .string()
  .min(20)
  .max(16384)
  .regex(/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/);
const ConfirmationSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("token_hash"), tokenHash: TokenHashSchema })
    .strict(),
  z
    .object({ kind: z.literal("access_token"), accessToken: AccessTokenSchema })
    .strict(),
]);
export type Confirmation = z.infer<typeof ConfirmationSchema>;

export function readConfirmation(search: string, hash: string) {
  const query = new URLSearchParams(search),
    fragment = new URLSearchParams(hash.replace(/^#/, ""));
  const keys = [
    "token_hash",
    "type",
    "code",
    "access_token",
    "refresh_token",
    "token_type",
    "expires_in",
    "expires_at",
    "provider_token",
    "provider_refresh_token",
    "error",
    "error_code",
    "error_description",
  ];
  const sources = [query, fragment].filter((params) =>
    keys.some((key) => params.has(key)),
  );
  const hasCredential = sources.length > 0;
  const invalid = { confirmation: null, hasCredential };
  if (sources.length !== 1) return invalid;
  const params = sources[0];
  if (
    keys.some((key) => params.getAll(key).length > 1) ||
    [
      "code",
      "error",
      "error_code",
      "error_description",
      "provider_token",
      "provider_refresh_token",
    ].some((key) => params.has(key))
  )
    return invalid;
  if (params.has("token_hash")) {
    if (
      params.get("type") !== "email" ||
      [
        "access_token",
        "refresh_token",
        "token_type",
        "expires_in",
        "expires_at",
      ].some((key) => params.has(key))
    )
      return invalid;
    const tokenHash = TokenHashSchema.safeParse(params.get("token_hash"));
    return tokenHash.success
      ? {
          confirmation: {
            kind: "token_hash" as const,
            tokenHash: tokenHash.data,
          },
          hasCredential,
        }
      : invalid;
  }
  if (
    params !== fragment ||
    !["signup", "email"].includes(params.get("type") ?? "") ||
    (params.has("token_type") && params.get("token_type") !== "bearer")
  )
    return invalid;
  const accessToken = AccessTokenSchema.safeParse(params.get("access_token"));
  return accessToken.success
    ? {
        confirmation: {
          kind: "access_token" as const,
          accessToken: accessToken.data,
        },
        hasCredential,
      }
    : invalid;
}

export async function confirmRegistration(input: Confirmation) {
  const parsed = ConfirmationSchema.safeParse(input);
  if (!parsed.success) throw new Error("confirmation_invalid");
  const cloud = client();
  let result;
  try {
    result =
      parsed.data.kind === "token_hash"
        ? await cloud.auth.verifyOtp({
            token_hash: parsed.data.tokenHash,
            type: "email",
          })
        : await cloud.auth.getUser(parsed.data.accessToken);
  } catch {
    throw new Error("confirmation_network");
  }
  const { data, error } = result;
  if (error) {
    if (
      error.status === 0 ||
      error.name === "AuthRetryableFetchError" ||
      /fetch|network|connection/i.test(error.message)
    )
      throw new Error("confirmation_network");
    if (error.status === 429 || error.code?.includes("rate_limit"))
      throw new Error("confirmation_rate_limited");
    throw new Error("confirmation_invalid");
  }
  if (parsed.data.kind === "token_hash") {
    await cloud.auth.signOut({ scope: "local" }).catch(() => undefined);
    if (!("session" in data) || !data.session)
      throw new Error("confirmation_invalid");
  }
  const email = EmailSchema.safeParse(data.user?.email);
  if (!data.user?.email_confirmed_at || !email.success)
    throw new Error("confirmation_invalid");
  return email.data;
}
export const registrationErrorText = (code: string) =>
  ({
    invalid_email: "সঠিক ইমেইল ঠিকানা লিখুন।",
    password_weak: "অন্তত ৮ অক্ষরের পাসওয়ার্ড দিন।",
    password_mismatch: "দুইবার লেখা পাসওয়ার্ড মেলেনি।",
    registration_rate_limited: "একটু অপেক্ষা করে আবার চেষ্টা করুন।",
    registration_unavailable:
      "নতুন অ্যাকাউন্ট খোলা এখন বন্ধ আছে। পরে চেষ্টা করুন।",
    cloud_not_configured: "লগইনের সংযোগ এখনও প্রস্তুত হয়নি।",
    registration_confirmation_required:
      "ইমেইল নিশ্চিত করার ব্যবস্থা প্রস্তুত হয়নি। পরে চেষ্টা করুন।",
  })[code] ?? "অ্যাকাউন্ট খোলা যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।";
