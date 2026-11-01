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
  passwordSignIn: vi.fn(),
  passwordSignOut: vi.fn(),
  request: vi.fn(),
  verify: vi.fn(),
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
  readPhoneAuthMode: () => "mock",
  requestMockPhoneOtp: sdk.request,
  verifyMockPhoneOtp: sdk.verify,
}));
import { AuthProvider, useAuth } from "./AuthProvider";
import {
  isAccountLocked,
  lockAccount,
  readRememberedAccount,
} from "../../data/authSession";

const phone = "+8801712345678";
const phoneId = "04cf4daf-01a7-427b-a008-c811576b14b9";
const otherId = "6469be7b-04cf-4151-9ac7-8df032c3e076";
const phoneUser = {
  id: phoneId,
  email: "",
  phone: "8801712345678",
  aud: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-11-01T00:00:00Z",
} as unknown as User;
const otherUser = {
  ...phoneUser,
  id: otherId,
  phone: null,
  email: "other@example.com",
} as unknown as User;
const session = (user: User): Session => ({
  access_token: "test-access-token",
  refresh_token: "test-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  user,
});
const tokens = {
  access_token: "gateway-access-token",
  refresh_token: "gateway-refresh-token",
};
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
  localStorage.clear();
  sdk.owner = null;
  sdk.listener = null;
  sdk.getSession.mockResolvedValue({ data: { session: null }, error: null });
  sdk.getUser.mockResolvedValue({ data: { user: phoneUser }, error: null });
  sdk.request.mockResolvedValue({
    challengeId: "c".repeat(64),
    retryAfter: 60,
  });
  sdk.verify.mockResolvedValue(tokens);
  sdk.setSession.mockResolvedValue({
    data: { session: session(phoneUser), user: phoneUser },
    error: null,
  });
  sdk.passwordSignIn.mockResolvedValue(undefined);
  sdk.passwordSignOut.mockImplementation(async () => {
    lockAccount();
  });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  sdk.owner = null;
});

describe("phone session installation boundaries", () => {
  it("waits for validated SDK installation before accepting a matching phone auth event", async () => {
    const installed = deferred<{
      data: { session: Session; user: User };
      error: null;
    }>();
    const initialRestore = deferred<{ data: { session: null }; error: null }>();
    sdk.getSession.mockReturnValue(initialRestore.promise);
    sdk.setSession.mockImplementation(() => {
      sdk.listener?.("SIGNED_IN", session(phoneUser));
      return installed.promise;
    });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await act(async () => {
      await auth.requestPhoneOtp(phone);
    });
    let result!: Promise<string>;
    await act(async () => {
      result = outcome(auth.verifyPhoneOtp(phone, "9876"));
    });
    expect(sdk.setSession).toHaveBeenCalledWith(tokens);
    expect(sdk.owner).toBeNull();
    expect(readRememberedAccount()).toBeNull();
    expect(screen.getByLabelText("account").textContent).toBe("loading:");
    await act(async () => {
      installed.resolve({
        data: { session: session(phoneUser), user: phoneUser },
        error: null,
      });
      await result;
    });
    expect(await result).toBe("accepted");
    await act(async () => {
      initialRestore.resolve({ data: { session: null }, error: null });
      await initialRestore.promise;
    });
    expect(sdk.owner).toBe(phoneId);
    expect(readRememberedAccount()).toMatchObject({
      id: phoneId,
      email: null,
      phone: "8801712345678",
    });
    expect(isAccountLocked()).toBe(false);
    expect(screen.getByLabelText("account").textContent).toBe(
      `signed-in:${phoneId}`,
    );
  });

  it("does not install or unlock a phone session after logout while verification is pending", async () => {
    const gateway = deferred<typeof tokens>();
    sdk.verify.mockReturnValue(gateway.promise);
    await mountSignedOut();
    let result!: Promise<string>;
    await act(async () => {
      result = outcome(auth.verifyPhoneOtp(phone, "9876"));
    });
    await act(async () => {
      await auth.signOut();
    });
    await act(async () => {
      gateway.resolve(tokens);
      await result;
    });
    expect(await result).toBe("account_changed");
    expect(sdk.setSession).not.toHaveBeenCalled();
    expect(sdk.owner).toBeNull();
    expect(isAccountLocked()).toBe(true);
    expect(readRememberedAccount()).toBeNull();
    expect(screen.getByLabelText("account").textContent).toBe("signed-out:");
  });

  it("preserves a different account that signs in while the phone gateway is pending", async () => {
    const gateway = deferred<typeof tokens>();
    sdk.verify.mockReturnValue(gateway.promise);
    await mountSignedOut();
    let result!: Promise<string>;
    await act(async () => {
      result = outcome(auth.verifyPhoneOtp(phone, "9876"));
    });
    sdk.getSession.mockResolvedValue({
      data: { session: session(otherUser) },
      error: null,
    });
    await act(async () => {
      await auth.signIn("other@example.com", "test-password");
    });
    expect(sdk.owner).toBe(otherId);
    await act(async () => {
      gateway.resolve(tokens);
      await result;
    });
    expect(await result).toBe("account_changed");
    expect(sdk.setSession).not.toHaveBeenCalled();
    expect(sdk.owner).toBe(otherId);
    expect(readRememberedAccount()).toMatchObject({
      id: otherId,
      email: "other@example.com",
    });
    expect(screen.getByLabelText("account").textContent).toBe(
      `signed-in:${otherId}`,
    );
  });
});
