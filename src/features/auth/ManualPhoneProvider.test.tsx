// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { Session, User } from "@supabase/supabase-js";

const sdk = vi.hoisted(() => ({
  owner: null as string | null,
  listener: null as ((event: string, session: Session | null) => void) | null,
  getSession: vi.fn(),
  getUser: vi.fn(),
  setSession: vi.fn(),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  passwordSignIn: vi.fn(),
  passwordSignOut: vi.fn(),
  verifyManual: vi.fn(),
}));
vi.mock("../../data/database", () => ({
  getActiveOwner: () => sdk.owner,
  setActiveOwner: (id: string | null) => {
    sdk.owner = id;
  },
}));
vi.mock("../../data/sync", () => ({
  getCloudClient: () => ({
    auth: {
      getSession: sdk.getSession,
      getUser: sdk.getUser,
      setSession: sdk.setSession,
      signInWithOtp: sdk.signInWithOtp,
      verifyOtp: sdk.verifyOtp,
      onAuthStateChange: (listener: typeof sdk.listener) => {
        sdk.listener = listener;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  }),
  signIn: sdk.passwordSignIn,
  signOut: sdk.passwordSignOut,
}));
vi.mock("./phoneAuth", async (original) => ({
  ...(await original<typeof import("./phoneAuth")>()),
  readPhoneAuthMode: () => "manual",
  verifyManualPhoneCode: sdk.verifyManual,
}));
import { AuthProvider, useAuth } from "./AuthProvider";
import {
  isAccountLocked,
  lockAccount,
  readRememberedAccount,
} from "../../data/authSession";

const phone = "+8801712345678";
const phoneUser: User = {
  id: "04cf4daf-01a7-427b-a008-c811576b14b9",
  phone: "8801712345678",
  aud: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-11-01T00:00:00Z",
};
const otherUser: User = {
  ...phoneUser,
  id: "6469be7b-04cf-4151-9ac7-8df032c3e076",
  phone: undefined,
  email: "other@example.com",
};
function tokensFor(user: User) {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
  return {
    access_token: [
      encode({ alg: "HS256", typ: "JWT" }),
      encode({
        sub: user.id,
        aud: "authenticated",
        role: "authenticated",
        phone: user.phone,
        exp: 4000000000,
      }),
      "test-signature",
    ].join("."),
    refresh_token: `test-refresh-${user.id}`,
  };
}
const tokens = tokensFor(phoneUser);
const session = (user: User): Session => ({
  ...tokensFor(user),
  token_type: "bearer",
  expires_in: 3600,
  user,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let auth: ReturnType<typeof useAuth>;
function Probe() {
  auth = useAuth();
  return (
    <output aria-label="account">
      {auth.status}:{auth.user?.id ?? ""}
    </output>
  );
}
async function mountSignedOut() {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() =>
    expect(screen.getByLabelText("account").textContent).toBe("signed-out:"),
  );
}
async function requestPhone() {
  await act(async () => {
    await auth.requestPhoneOtp(phone);
  });
}
function outcome(promise: Promise<void>) {
  return promise.then(
    () => "accepted",
    (error: Error) => error.message,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sdk.owner = null;
  sdk.listener = null;
  sdk.getSession.mockResolvedValue({ data: { session: null }, error: null });
  sdk.getUser.mockResolvedValue({ data: { user: phoneUser }, error: null });
  sdk.verifyManual.mockResolvedValue(tokens);
  sdk.setSession.mockResolvedValue({
    data: { session: session(phoneUser), user: phoneUser },
    error: null,
  });
  sdk.passwordSignIn.mockResolvedValue(undefined);
  sdk.passwordSignOut.mockImplementation(async () => {
    lockAccount();
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("unexpected_fetch")),
  );
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  sdk.owner = null;
});

describe("manual phone session boundaries", () => {
  it("prepares the phone locally without requesting an OTP or verifying a code", async () => {
    await mountSignedOut();
    let retryAfter: number | undefined;
    await act(async () => {
      ({ retryAfter } = await auth.requestPhoneOtp("০১৭১২৩৪৫৬৭৮"));
    });
    expect(auth.phoneAuthMode).toBe("manual");
    expect(auth.phoneOtpEnabled).toBe(true);
    expect(retryAfter).toBe(1);
    expect(sdk.signInWithOtp).not.toHaveBeenCalled();
    expect(sdk.verifyOtp).not.toHaveBeenCalled();
    expect(sdk.verifyManual).not.toHaveBeenCalled();
    expect(sdk.setSession).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(isAccountLocked()).toBe(true);
    expect(sdk.owner).toBeNull();
  });

  it("installs matching manual tokens before unlocking and remembering the phone account", async () => {
    const installation = deferred<{
      data: { session: Session; user: User };
      error: null;
    }>();
    sdk.setSession.mockImplementation(() => {
      sdk.listener?.("SIGNED_IN", session(phoneUser));
      return installation.promise;
    });
    await mountSignedOut();
    await requestPhone();
    let result!: Promise<string>;
    await act(async () => {
      result = outcome(auth.verifyPhoneOtp("০১৭১২৩৪৫৬৭৮", " ৯৮৭৬ "));
    });
    expect(sdk.verifyManual).toHaveBeenCalledWith(phone, "9876");
    expect(sdk.setSession).toHaveBeenCalledWith(tokens);
    expect(sdk.owner).toBeNull();
    expect(readRememberedAccount()).toBeNull();
    expect(isAccountLocked()).toBe(true);
    expect(screen.getByLabelText("account").textContent).toBe("signed-out:");
    await act(async () => {
      installation.resolve({
        data: { session: session(phoneUser), user: phoneUser },
        error: null,
      });
      await result;
    });
    expect(await result).toBe("accepted");
    expect(sdk.owner).toBe(phoneUser.id);
    expect(readRememberedAccount()).toEqual({
      id: phoneUser.id,
      email: null,
      phone: phoneUser.phone,
    });
    expect(isAccountLocked()).toBe(false);
    expect(screen.getByLabelText("account").textContent).toBe(
      `signed-in:${phoneUser.id}`,
    );
    expect(sdk.signInWithOtp).not.toHaveBeenCalled();
    expect(sdk.verifyOtp).not.toHaveBeenCalled();
  });

  it("rejects a code for a phone other than the locally prepared phone", async () => {
    await mountSignedOut();
    await requestPhone();
    await expect(auth.verifyPhoneOtp("+8801812345678", "9876")).rejects.toThrow(
      "otp_expired",
    );
    expect(sdk.verifyManual).not.toHaveBeenCalled();
    expect(sdk.setSession).not.toHaveBeenCalled();
    expect(sdk.owner).toBeNull();
    expect(isAccountLocked()).toBe(true);
    expect(readRememberedAccount()).toBeNull();
  });

  it.each(["logout", "another account"] as const)(
    "does not install stale manual tokens after %s while verification is pending",
    async (change) => {
      const gateway = deferred<typeof tokens>();
      sdk.verifyManual.mockReturnValue(gateway.promise);
      await mountSignedOut();
      await requestPhone();
      let result!: Promise<string>;
      await act(async () => {
        result = outcome(auth.verifyPhoneOtp(phone, "9876"));
      });
      await act(async () => {
        if (change === "logout") await auth.signOut();
        else {
          sdk.getSession.mockResolvedValue({
            data: { session: session(otherUser) },
            error: null,
          });
          await auth.signIn("other@example.com", "test-password");
        }
      });
      await act(async () => {
        gateway.resolve(tokens);
        await result;
      });
      expect(await result).toBe("account_changed");
      expect(sdk.setSession).not.toHaveBeenCalled();
      if (change === "logout") {
        expect(sdk.owner).toBeNull();
        expect(isAccountLocked()).toBe(true);
        expect(readRememberedAccount()).toBeNull();
        expect(screen.getByLabelText("account").textContent).toBe(
          "signed-out:",
        );
      } else {
        expect(sdk.owner).toBe(otherUser.id);
        expect(isAccountLocked()).toBe(false);
        expect(readRememberedAccount()).toEqual({
          id: otherUser.id,
          email: otherUser.email,
          phone: null,
        });
        expect(screen.getByLabelText("account").textContent).toBe(
          `signed-in:${otherUser.id}`,
        );
      }
    },
  );

  it("keeps the account locked if logout happens during SDK installation", async () => {
    const installation = deferred<{
      data: { session: Session; user: User };
      error: null;
    }>();
    sdk.setSession.mockReturnValue(installation.promise);
    await mountSignedOut();
    await requestPhone();
    let result!: Promise<string>;
    await act(async () => {
      result = outcome(auth.verifyPhoneOtp(phone, "9876"));
    });
    expect(sdk.setSession).toHaveBeenCalledWith(tokens);
    await act(async () => {
      await auth.signOut();
      sdk.listener?.("SIGNED_IN", session(phoneUser));
      installation.resolve({
        data: { session: session(phoneUser), user: phoneUser },
        error: null,
      });
      await result;
    });
    expect(await result).toBe("account_changed");
    expect(sdk.owner).toBeNull();
    expect(isAccountLocked()).toBe(true);
    expect(readRememberedAccount()).toBeNull();
    expect(screen.getByLabelText("account").textContent).toBe("signed-out:");
  });

  it("does not accept or unlock a session returned for a different phone", async () => {
    const wrongPhoneUser = { ...phoneUser, phone: "8801812345678" };
    sdk.verifyManual.mockResolvedValue(tokensFor(wrongPhoneUser));
    sdk.setSession.mockResolvedValue({
      data: { session: session(wrongPhoneUser), user: wrongPhoneUser },
      error: null,
    });
    await mountSignedOut();
    await requestPhone();
    let result!: string;
    await act(async () => {
      result = await outcome(auth.verifyPhoneOtp(phone, "9876"));
    });
    expect(result).toBe("invalid_otp");
    expect(sdk.owner).toBeNull();
    expect(isAccountLocked()).toBe(true);
    expect(readRememberedAccount()).toBeNull();
    expect(screen.getByLabelText("account").textContent).toBe("signed-out:");
  });
});
