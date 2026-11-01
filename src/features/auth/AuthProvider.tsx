import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  ACCOUNT_LOCK_EVENT,
  ACCOUNT_LOCK_STORAGE_KEY,
  isAccountLocked,
  lockAccount,
  readRememberedAccount,
  rememberAccount,
  type AccountUser,
} from "../../data/authSession";
import { getActiveOwner, setActiveOwner } from "../../data/database";
import {
  getCloudClient,
  signIn as passwordSignIn,
  signOut as passwordSignOut,
} from "../../data/sync";
import { normalizeBangladeshPhone } from "./phone";
import {
  readPhoneAuthMode,
  normalizePhoneCode,
  requestMockPhoneOtp,
  verifyMockPhoneOtp,
  type PhoneAuthMode,
} from "./phoneAuth";

export type AuthStatus = "loading" | "signed-out" | "signed-in" | "offline";
type AuthContextValue = {
  status: AuthStatus;
  user: AccountUser | null;
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
const AuthContext = createContext<AuthContextValue | null>(null);
const phoneAuthMode = readPhoneAuthMode();
const phoneOtpEnabled = phoneAuthMode !== "off";
const userDetails = (user: User): AccountUser => ({
  id: user.id,
  email: user.email?.trim() || null,
  phone: user.phone?.trim() || null,
});
const offline = () => typeof navigator !== "undefined" && !navigator.onLine;
const networkError = (error: unknown) =>
  error instanceof Error &&
  /fetch|network|timeout|connection/i.test(error.message);

export function AuthProvider({ children }: { children: ReactNode }) {
  const explicitlyLocked = useRef(isAccountLocked());
  const accessRevision = useRef(0);
  const phoneRequest = useRef(0);
  const phoneChallenge = useRef<{ phone: string; id: string } | null>(null);
  const phoneLoginTarget = useRef<string | null>(null);
  const phoneVerifying = useRef(false);
  const [state, setState] = useState<{
    status: AuthStatus;
    user: AccountUser | null;
  }>({ status: "loading", user: null });
  const accept = useCallback((user: AccountUser, status: AuthStatus) => {
    setActiveOwner(user.id);
    rememberAccount(user);
    setState({ status, user });
  }, []);
  const clear = useCallback(() => {
    setActiveOwner(null);
    setState({ status: "signed-out", user: null });
  }, []);

  useEffect(() => {
    let alive = true;
    let revision = 0;
    const cloud = getCloudClient();
    const locked = () => {
      explicitlyLocked.current = true;
      accessRevision.current++;
      phoneRequest.current++;
      phoneChallenge.current = null;
      revision++;
      clear();
    };
    window.addEventListener(ACCOUNT_LOCK_EVENT, locked);
    const storageLocked = (event: StorageEvent) => {
      if (event.key === ACCOUNT_LOCK_STORAGE_KEY && event.newValue === "1")
        locked();
    };
    window.addEventListener("storage", storageLocked);
    const acceptSession = (session: Session | null) => {
      if (!alive || (session && explicitlyLocked.current)) return;
      revision++;
      if (session) {
        if (
          phoneLoginTarget.current &&
          session.user.phone &&
          session.user.phone.replace(/^\+/, "") ===
            phoneLoginTarget.current.slice(1)
        )
          return;
        accept(userDetails(session.user), offline() ? "offline" : "signed-in");
      } else {
        lockAccount();
        clear();
      }
    };
    const subscription = cloud?.auth.onAuthStateChange((event, session) => {
      if (event !== "INITIAL_SESSION") acceptSession(session);
    }).data.subscription;
    const restore = async () => {
      if (explicitlyLocked.current || isAccountLocked()) {
        clear();
        return;
      }
      const attempt = revision;
      const remembered = readRememberedAccount();
      if (!cloud) {
        if (alive) clear();
        return;
      }
      if (offline()) {
        if (alive && attempt === revision)
          remembered ? accept(remembered, "offline") : clear();
        return;
      }
      const fallback = remembered
        ? window.setTimeout(() => {
            if (
              alive &&
              attempt === revision &&
              !explicitlyLocked.current &&
              !isAccountLocked() &&
              readRememberedAccount()?.id === remembered.id
            )
              accept(remembered, "offline");
          }, 5000)
        : null;
      try {
        const { data, error } = await cloud.auth.getSession();
        if (error) throw error;
        if (!data.session) {
          if (alive && attempt === revision) {
            lockAccount();
            clear();
          }
          return;
        }
        const verified = await cloud.auth.getUser(data.session.access_token);
        if (verified.error) throw verified.error;
        if (alive && attempt === revision && verified.data.user)
          accept(userDetails(verified.data.user), "signed-in");
      } catch (error) {
        if (!alive || attempt !== revision) return;
        if ((offline() || networkError(error)) && remembered)
          accept(remembered, "offline");
        else {
          lockAccount();
          clear();
        }
      } finally {
        if (fallback !== null) window.clearTimeout(fallback);
      }
    };
    const onOffline = () =>
      setState((current) =>
        current.user ? { ...current, status: "offline" } : current,
      );
    void restore();
    window.addEventListener("online", restore);
    window.addEventListener("offline", onOffline);
    return () => {
      alive = false;
      subscription?.unsubscribe();
      window.removeEventListener(ACCOUNT_LOCK_EVENT, locked);
      window.removeEventListener("storage", storageLocked);
      window.removeEventListener("online", restore);
      window.removeEventListener("offline", onOffline);
    };
  }, [accept, clear]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const attempt = accessRevision.current;
      await passwordSignIn(email.trim(), password);
      const result = await getCloudClient()!.auth.getSession();
      if (result.error || !result.data.session)
        throw new Error("sign_in_failed");
      if (attempt !== accessRevision.current)
        throw new Error("account_changed");
      explicitlyLocked.current = false;
      accept(userDetails(result.data.session.user), "signed-in");
    },
    [accept],
  );
  const signOut = useCallback(async () => {
    await passwordSignOut();
  }, []);
  const requestPhoneOtp = useCallback(
    async (input: string, captchaToken?: string) => {
      if (!phoneOtpEnabled) throw new Error("phone_otp_unavailable");
      if (getActiveOwner()) throw new Error("account_changed");
      const phone = normalizeBangladeshPhone(input);
      const attempt = accessRevision.current;
      const request = ++phoneRequest.current;
      phoneChallenge.current = null;
      if (phoneAuthMode === "mock") {
        const result = await requestMockPhoneOtp(phone);
        if (
          attempt !== accessRevision.current ||
          request !== phoneRequest.current ||
          getActiveOwner()
        )
          throw new Error("account_changed");
        phoneChallenge.current = { phone, id: result.challengeId };
        return { retryAfter: result.retryAfter };
      }
      const cloud = getCloudClient();
      if (!cloud) throw new Error("cloud_not_configured");
      const result = await cloud.auth.signInWithOtp({
        phone,
        options: { shouldCreateUser: true, captchaToken },
      });
      if (result.error)
        throw new Error(
          result.error.code?.includes("rate_limit")
            ? "phone_rate_limited"
            : "phone_otp_failed",
        );
      if (
        attempt !== accessRevision.current ||
        request !== phoneRequest.current ||
        getActiveOwner()
      )
        throw new Error("account_changed");
      phoneChallenge.current = { phone, id: "sms" };
      return { retryAfter: 60 };
    },
    [],
  );
  const verifyPhoneOtp = useCallback(
    async (input: string, token: string) => {
      if (!phoneOtpEnabled) throw new Error("phone_otp_unavailable");
      if (getActiveOwner()) throw new Error("account_changed");
      const phone = normalizeBangladeshPhone(input);
      const code = normalizePhoneCode(token, phoneAuthMode);
      const challenge = phoneChallenge.current;
      if (!challenge || challenge.phone !== phone)
        throw new Error("otp_expired");
      const attempt = accessRevision.current;
      const request = phoneRequest.current;
      const stillCurrent = () =>
        attempt === accessRevision.current &&
        request === phoneRequest.current &&
        !getActiveOwner();
      const cloud = getCloudClient();
      if (!cloud) throw new Error("cloud_not_configured");
      if (phoneVerifying.current) throw new Error("phone_rate_limited");
      phoneVerifying.current = true;
      phoneLoginTarget.current = phone;
      try {
        let result;
        if (phoneAuthMode === "mock") {
          const session = await verifyMockPhoneOtp(phone, code, challenge.id);
          if (!stillCurrent()) throw new Error("account_changed");
          result = await cloud.auth.setSession(session);
        } else
          result = await cloud.auth.verifyOtp({
            phone,
            token: code,
            type: "sms",
          });
        if (result.error || !result.data.session || !result.data.user)
          throw new Error(
            result.error?.code === "otp_expired"
              ? "otp_expired"
              : "invalid_otp",
          );
        if (!stillCurrent()) throw new Error("account_changed");
        if (
          !result.data.user.phone ||
          normalizeBangladeshPhone(result.data.user.phone) !== phone
        )
          throw new Error("invalid_otp");
        phoneChallenge.current = null;
        explicitlyLocked.current = false;
        accept(userDetails(result.data.user), "signed-in");
      } finally {
        phoneLoginTarget.current = null;
        phoneVerifying.current = false;
      }
    },
    [accept],
  );
  const value = useMemo(
    () => ({
      ...state,
      signIn,
      signOut,
      requestPhoneOtp,
      verifyPhoneOtp,
      phoneOtpEnabled,
      phoneAuthMode,
    }),
    [state, signIn, signOut, requestPhoneOtp, verifyPhoneOtp],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("AuthProvider_missing");
  return auth;
}
