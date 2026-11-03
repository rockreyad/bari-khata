// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session, User } from "@supabase/supabase-js";
import App from "../../App";
import { lockAccount } from "../../data/authSession";

const sdk = vi.hoisted(() => ({
  owner: null as string | null,
  session: null as Session | null,
  listener: null as ((event: string, session: Session | null) => void) | null,
  getSession: vi.fn(),
  getUser: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("../../data/database", () => ({
  getActiveOwner: () => sdk.owner,
  setActiveOwner: (owner: string | null) => {
    sdk.owner = owner;
  },
}));
vi.mock("../../data/sync", () => ({
  getCloudClient: () => ({
    auth: {
      getSession: sdk.getSession,
      getUser: sdk.getUser,
      onAuthStateChange: (listener: typeof sdk.listener) => {
        sdk.listener = listener;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  }),
  signIn: sdk.signIn,
  signOut: sdk.signOut,
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({ t: (value: string) => value }),
}));
vi.mock("../../app/NotebookProvider", () => ({
  NotebookProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../../app/AppShell", async () => {
  const { useAuth } = await import("./AuthProvider");
  const { useLocation, useNavigate } = await import("react-router");
  return {
    AppShell() {
      const auth = useAuth();
      const location = useLocation();
      const navigate = useNavigate();
      return (
        <>
          <output aria-label="current page">
            {location.pathname + location.search}
          </output>
          <button
            onClick={async () => {
              await auth.signOut();
              navigate("/login", { replace: true });
            }}
          >
            Sign out
          </button>
        </>
      );
    },
  };
});
vi.mock("./LoginPage", async () => {
  const { useAuth } = await import("./AuthProvider");
  const { useLocation } = await import("react-router");
  return {
    LoginPage({ onSuccess }: { onSuccess: () => void }) {
      const auth = useAuth();
      const location = useLocation();
      return (
        <>
          <output aria-label="login return page">{location.state?.from}</output>
          <button
            onClick={async () => {
              await auth.signIn("owner@example.com", "test-password");
              onSuccess();
            }}
          >
            Sign in
          </button>
        </>
      );
    },
  };
});

const user = {
  id: "04cf4daf-01a7-427b-a008-c811576b14b9",
  email: "owner@example.com",
  app_metadata: {},
} as User;
const session = {
  access_token: "test-access-token",
  refresh_token: "test-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  user,
} as Session;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sdk.owner = null;
  sdk.session = session;
  sdk.listener = null;
  sdk.getSession.mockImplementation(async () => ({
    data: { session: sdk.session },
    error: null,
  }));
  sdk.getUser.mockResolvedValue({ data: { user }, error: null });
  sdk.signIn.mockImplementation(async () => {
    sdk.session = session;
  });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

it.each(["/settings/account", "/settings/account/password"])(
  "returns home after explicit sign-out from %s even before remote sign-out finishes",
  async (path) => {
    let finish!: () => void;
    const signingOut = new Promise<void>((resolve) => {
      finish = resolve;
    });
    sdk.signOut.mockImplementation(() => {
      lockAccount();
      sdk.session = null;
      return signingOut;
    });
    window.history.replaceState({}, "", path);
    render(<App />);
    await screen.findByRole("button", { name: "Sign out" });
    const browser = userEvent.setup();
    await browser.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() =>
      expect(screen.getByLabelText("login return page").textContent).toBe("/"),
    );
    await act(async () => {
      finish();
      await signingOut;
    });
    await browser.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(screen.getByLabelText("current page").textContent).toBe("/"),
    );
  },
);

it("preserves the requested page when a session expires without explicit sign-out", async () => {
  const path = "/works/door?tab=labour";
  window.history.replaceState({}, "", path);
  render(<App />);
  await screen.findByRole("button", { name: "Sign out" });
  await act(async () => {
    sdk.session = null;
    sdk.listener?.("SIGNED_OUT", null);
  });
  await waitFor(() =>
    expect(screen.getByLabelText("login return page").textContent).toBe(path),
  );
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() =>
    expect(screen.getByLabelText("current page").textContent).toBe(path),
  );
  expect(sdk.signOut).not.toHaveBeenCalled();
});
