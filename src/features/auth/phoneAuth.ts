import { z } from "zod";
import { normalizeBangladeshPhone } from "./phone";

export type PhoneAuthMode = "mock" | "sms" | "off";
export function readPhoneAuthMode(): PhoneAuthMode {
  const value = import.meta.env.VITE_PHONE_AUTH_MODE;
  if (value === "mock" || value === "sms" || value === "off") return value;
  return value === undefined && import.meta.env.VITE_ENABLE_PHONE_OTP === "true"
    ? "sms"
    : "off";
}
export function normalizePhoneCode(value: string, mode: PhoneAuthMode) {
  const code = value
    .trim()
    .replace(/[০-৯]/g, (digit) => String("০১২৩৪৫৬৭৮৯".indexOf(digit)));
  if (mode === "off") throw new Error("phone_otp_unavailable");
  if (!(mode === "mock" ? /^\d{4,8}$/ : /^\d{6,8}$/).test(code))
    throw new Error("invalid_otp");
  return code;
}
const ChallengeSchema = z.object({
  challengeId: z.string().regex(/^[a-f0-9]{64}$/),
  retryAfter: z.number().int().min(1).max(300),
});
const SessionSchema = z.object({
  access_token: z.string().min(20).max(16384),
  refresh_token: z.string().min(1).max(1024),
});
const FailureSchema = z.object({
  error: z.enum([
    "invalid_phone",
    "invalid_otp",
    "phone_rate_limited",
    "phone_requires_sms",
    "phone_auth_unavailable",
    "otp_expired",
    "otp_attempts_exceeded",
  ]),
  retryAfter: z.number().int().min(1).max(300).optional(),
});
async function mockRequest(path: "request" | "verify", body: unknown) {
  if (readPhoneAuthMode() !== "mock") throw new Error("phone_otp_unavailable");
  let response: Response;
  try {
    response = await fetch(`/api/dev-phone-otp/${path}`, {
      method: "POST",
      credentials: "omit",
      mode: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("phone_network_error");
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("phone_auth_unavailable");
  }
  if (!response.ok) {
    const parsed = FailureSchema.safeParse(data);
    const failure = new Error(
      parsed.success ? parsed.data.error : "phone_auth_unavailable",
    );
    if (parsed.success && parsed.data.retryAfter)
      Object.assign(failure, { retryAfter: parsed.data.retryAfter });
    throw failure;
  }
  return data;
}
export async function requestMockPhoneOtp(input: string) {
  const phone = normalizeBangladeshPhone(input);
  const response = await mockRequest("request", { phone });
  const parsed = ChallengeSchema.safeParse(response);
  if (!parsed.success) throw new Error("phone_auth_unavailable");
  return parsed.data;
}
export async function verifyMockPhoneOtp(
  input: string,
  token: string,
  challengeId: string,
) {
  const phone = normalizeBangladeshPhone(input);
  const code = normalizePhoneCode(token, readPhoneAuthMode());
  if (!/^[a-f0-9]{64}$/.test(challengeId)) throw new Error("invalid_otp");
  const response = await mockRequest("verify", { phone, code, challengeId });
  const parsed = SessionSchema.safeParse(response);
  if (!parsed.success) throw new Error("phone_auth_unavailable");
  try {
    const body = parsed.data.access_token.split(".")[1];
    const claims = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/")));
    // The SDK validates the session; this first checks that it targets the requested phone.
    if (normalizeBangladeshPhone(claims.phone) !== phone) throw new Error();
  } catch {
    throw new Error("phone_auth_unavailable");
  }
  return parsed.data;
}
