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
export function readConfirmation(search: string, hash: string) {
  const query = new URLSearchParams(search),
    fragment = new URLSearchParams(hash.replace(/^#/, ""));
  const hasCredential = [query, fragment].some((params) =>
    [
      "token_hash",
      "type",
      "code",
      "access_token",
      "refresh_token",
      "error",
      "error_description",
    ].some((key) => params.has(key)),
  );
  const values = [
    ...query.getAll("token_hash"),
    ...fragment.getAll("token_hash"),
  ];
  const types = [...query.getAll("type"), ...fragment.getAll("type")];
  const tokenHash =
    values.length === 1 &&
    types.length === 1 &&
    types[0] === "email" &&
    /^[a-zA-Z0-9_-]{20,512}$/.test(values[0])
      ? values[0]
      : null;
  return { tokenHash, hasCredential };
}
export async function confirmRegistration(tokenHash: string) {
  if (!/^[a-zA-Z0-9_-]{20,512}$/.test(tokenHash))
    throw new Error("confirmation_invalid");
  const cloud = client();
  let result;
  try {
    result = await cloud.auth.verifyOtp({
      token_hash: tokenHash,
      type: "email",
    });
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
  if (!data.user || !data.session) throw new Error("confirmation_invalid");
  const email = data.user.email ?? "";
  await cloud.auth.signOut({ scope: "local" }).catch(() => undefined);
  return EmailSchema.safeParse(email).success ? email : "";
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
