import { createContext, useContext } from "react";
import type { AccountUser } from "../../data/authSession";
import type { PhoneAuthMode } from "./phoneAuth";

export type AuthStatus = "loading" | "signed-out" | "signed-in" | "offline";
export type AuthContextValue = {
  status: AuthStatus;
  user: AccountUser | null;
  returnHomeAfterSignOut: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  requestPhoneOtp: (
    phone: string,
    captchaToken?: string,
  ) => Promise<{ retryAfter: number }>;
  verifyPhoneOtp: (phone: string, token: string) => Promise<void>;
  phoneOtpEnabled: boolean;
  phoneAuthMode: PhoneAuthMode;
};
export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("AuthProvider_missing");
  return auth;
}
