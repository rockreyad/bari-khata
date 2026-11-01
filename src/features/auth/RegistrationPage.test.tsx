// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router";
const api = vi.hoisted(() => ({
  register: vi.fn(),
  resend: vi.fn(),
  confirm: vi.fn(),
  signIn: vi.fn(),
  auth: { user: null as { id: string } | null, status: "signed-out" },
}));
vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ ...api.auth, signIn: api.signIn, phoneOtpEnabled: false }),
}));
vi.mock("./registration", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./registration")>()),
  registerAccount: api.register,
  resendRegistration: api.resend,
  confirmRegistration: api.confirm,
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string, values?: Record<string, unknown>) =>
      text.replace(/{{(\w+)}}/g, (_, key) => String(values?.[key] ?? "")),
    formatDigits: String,
    number: String,
  }),
}));
import { RegistrationPage } from "./RegistrationPage";
import { ConfirmEmailPage } from "./ConfirmEmailPage";
import { ResendEmailPage } from "./ResendEmailPage";
import { LoginPage } from "./LoginPage";
import { validateRegistration } from "./registration";
function LocationProbe() {
  const location = useLocation();
  return (
    <span aria-label="route">
      {location.pathname + location.search + location.hash}
    </span>
  );
}
function renderPage(path = "/register") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/register" element={<RegistrationPage />} />
        <Route
          path="/auth/confirm"
          element={
            <>
              <ConfirmEmailPage />
              <Link
                to={`/auth/confirm#token_hash=${"c".repeat(64)}&type=email`}
              >
                Another confirmation
              </Link>
            </>
          }
        />
        <Route path="/register/resend" element={<ResendEmailPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<p>Own notebook</p>} />
      </Routes>
    </MemoryRouter>,
  );
}
async function fillRegistration(
  user: ReturnType<typeof userEvent.setup>,
  password = "Password8",
  repeat = password,
) {
  await user.type(
    screen.getByLabelText("ইমেইল", { exact: true }),
    "friend@example.com",
  );
  await user.type(
    screen.getByLabelText("পাসওয়ার্ড", { exact: true }),
    password,
  );
  await user.type(
    screen.getByLabelText("পাসওয়ার্ড আবার লিখুন", { exact: true }),
    repeat,
  );
}
beforeEach(() => {
  api.auth = { user: null, status: "signed-out" };
  api.register.mockImplementation(async (email, password, confirmation) => {
    validateRegistration(email, password, confirmation);
  });
  api.resend.mockResolvedValue(undefined);
  api.confirm.mockResolvedValue("friend@example.com");
  api.signIn.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe("registration form", () => {
  it("offers registration from login and keeps a repeated password mismatch on the form", async () => {
    const user = userEvent.setup();
    renderPage("/login");
    await user.click(screen.getByRole("link", { name: "অ্যাকাউন্ট খুলুন" }));
    await fillRegistration(user, "Password8", "different");
    await user.click(screen.getByRole("button", { name: "অ্যাকাউন্ট খুলুন" }));
    expect(screen.getByRole("alert").textContent).toContain("পাসওয়ার্ড মেলেনি");
    expect(screen.getByLabelText("পাসওয়ার্ড", { exact: true })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "ইমেইল দেখুন" })).toBeNull();
  });
  it("hides passwords by default, allows revealing, then shows confirmation instructions and a resend cooldown", async () => {
    const user = userEvent.setup();
    renderPage();
    await fillRegistration(user);
    const password = screen.getByLabelText("পাসওয়ার্ড", {
      exact: true,
    }) as HTMLInputElement;
    expect(password.type).toBe("password");
    expect(password.autocomplete).toBe("new-password");
    await user.click(
      screen.getAllByRole("button", { name: "পাসওয়ার্ড দেখি" })[0],
    );
    expect(password.type).toBe("text");
    await user.click(screen.getByRole("button", { name: "অ্যাকাউন্ট খুলুন" }));
    expect(screen.getByRole("heading", { name: "ইমেইল দেখুন" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "friend@example.com",
    );
    expect(
      (
        screen.getByRole("button", {
          name: /সেকেন্ড পরে আবার পাঠান/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.queryByLabelText("পাসওয়ার্ড", { exact: true })).toBeNull();
    expect(api.signIn).not.toHaveBeenCalled();
    await user.click(screen.getByRole("link", { name: "লগইন করি" }));
    expect(
      (screen.getByLabelText("ইমেইল", { exact: true }) as HTMLInputElement)
        .value,
    ).toBe("friend@example.com");
  });
  it("never creates another account while an owner's notebook is already signed in", () => {
    api.auth = { user: { id: "existing-owner" }, status: "signed-in" };
    renderPage();
    expect(
      screen.getByRole("heading", { name: "এই ফোনে আপনার খাতা খোলা আছে" }),
    ).toBeTruthy();
    expect(screen.queryByRole("form")).toBeNull();
    expect(api.register).not.toHaveBeenCalled();
  });
  it("keeps the submitted fields available after a registration network failure", async () => {
    api.register.mockRejectedValue(new Error("registration_failed"));
    const user = userEvent.setup();
    renderPage();
    await fillRegistration(user);
    await user.click(screen.getByRole("button", { name: "অ্যাকাউন্ট খুলুন" }));
    expect(screen.getByRole("alert").textContent).toContain("ইন্টারনেট সংযোগ");
    expect(
      (screen.getByLabelText("ইমেইল", { exact: true }) as HTMLInputElement)
        .value,
    ).toBe("friend@example.com");
    expect(
      (screen.getByLabelText("পাসওয়ার্ড", { exact: true }) as HTMLInputElement)
        .value,
    ).toBe("Password8");
  });
});
describe("explicit email confirmation", () => {
  it("strips the token, waits for a click, and confirms without replacing an already signed-in owner", async () => {
    api.auth = { user: { id: "existing-owner" }, status: "signed-in" };
    const user = userEvent.setup();
    renderPage(`/auth/confirm#token_hash=${"a".repeat(64)}&type=email`);
    await waitFor(() =>
      expect(screen.getByLabelText("route").textContent).toBe("/auth/confirm"),
    );
    expect(api.confirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "ইমেইল নিশ্চিত করি" }));
    expect(api.confirm).toHaveBeenCalledExactlyOnceWith({
      kind: "token_hash",
      tokenHash: "a".repeat(64),
    });
    expect(
      screen.getByRole("heading", { name: "ইমেইল নিশ্চিত হয়েছে" }),
    ).toBeTruthy();
    expect(api.auth.user?.id).toBe("existing-owner");
    expect(api.signIn).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole("link", { name: "নিজের খাতায় ফিরি" })
        .getAttribute("href"),
    ).toBe("/");
  });
  it("retains the same link for a network retry but offers a new email for an expired link", async () => {
    api.confirm.mockRejectedValueOnce(new Error("confirmation_network"));
    const user = userEvent.setup();
    renderPage(`/auth/confirm#token_hash=${"b".repeat(64)}&type=email`);
    await user.click(screen.getByRole("button", { name: "ইমেইল নিশ্চিত করি" }));
    expect(screen.getByRole("alert").textContent).toContain("লিংকটি আছে");
    expect(
      screen.queryByRole("heading", { name: "লিংকটি কাজ করছে না" }),
    ).toBeNull();
    api.confirm.mockRejectedValueOnce(new Error("confirmation_invalid"));
    await user.click(screen.getByRole("button", { name: "ইমেইল নিশ্চিত করি" }));
    expect(api.confirm).toHaveBeenNthCalledWith(2, {
      kind: "token_hash",
      tokenHash: "b".repeat(64),
    });
    expect(screen.getByRole("link", { name: "নতুন ইমেইল চাই" })).toBeTruthy();
  });
  it("ignores a late response after another confirmation link replaces its scope", async () => {
    let resolve!: (value: string) => void;
    api.confirm.mockImplementationOnce(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    const user = userEvent.setup();
    renderPage(`/auth/confirm#token_hash=${"b".repeat(64)}&type=email`);
    await user.click(screen.getByRole("button", { name: "ইমেইল নিশ্চিত করি" }));
    await user.click(
      screen.getByRole("link", { name: "Another confirmation" }),
    );
    resolve("old@example.com");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "ইমেইল নিশ্চিত করি" }),
      ).toBeTruthy(),
    );
    expect(
      screen.queryByRole("heading", { name: "ইমেইল নিশ্চিত হয়েছে" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "ইমেইল নিশ্চিত করি" }));
    expect(api.confirm).toHaveBeenLastCalledWith({
      kind: "token_hash",
      tokenHash: "c".repeat(64),
    });
  });
  it("scrubs a default hosted callback, waits for a click, and keeps the existing owner", async () => {
    api.auth = { user: { id: "existing-owner" }, status: "signed-in" };
    const accessToken = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl";
    const user = userEvent.setup();
    renderPage(
      `/auth/confirm#access_token=${accessToken}&refresh_token=do-not-retain&token_type=bearer&expires_in=3600&type=signup`,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("route").textContent).toBe("/auth/confirm"),
    );
    expect(api.confirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "ইমেইল নিশ্চিত করি" }));
    expect(api.confirm).toHaveBeenCalledExactlyOnceWith({
      kind: "access_token",
      accessToken,
    });
    expect(
      screen.getByRole("heading", { name: "ইমেইল নিশ্চিত হয়েছে" }),
    ).toBeTruthy();
    expect(api.auth.user?.id).toBe("existing-owner");
    expect(api.signIn).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole("link", { name: "নিজের খাতায় ফিরি" })
        .getAttribute("href"),
    ).toBe("/");
  });
  it("retries a default hosted callback after a network failure without restoring credentials to the URL", async () => {
    const accessToken = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl";
    api.confirm.mockRejectedValueOnce(new Error("confirmation_network"));
    const user = userEvent.setup();
    renderPage(`/auth/confirm#access_token=${accessToken}&type=signup`);
    await user.click(screen.getByRole("button", { name: "ইমেইল নিশ্চিত করি" }));
    expect(screen.getByRole("alert").textContent).toContain("লিংকটি আছে");
    expect(screen.getByLabelText("route").textContent).toBe("/auth/confirm");
    await user.click(screen.getByRole("button", { name: "ইমেইল নিশ্চিত করি" }));
    expect(api.confirm).toHaveBeenNthCalledWith(2, {
      kind: "access_token",
      accessToken,
    });
    expect(
      screen.getByRole("link", { name: "লগইন করি" }).getAttribute("href"),
    ).toBe("/login");
    expect(api.signIn).not.toHaveBeenCalled();
  });
  it.each([
    "?code=test-code",
    "#access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl&type=recovery",
    `#token_hash=${"b".repeat(64)}&type=email&error=denied`,
  ])(
    "scrubs and rejects an unsupported or failed callback: %s",
    async (credentials) => {
      renderPage(`/auth/confirm${credentials}`);
      await waitFor(() =>
        expect(screen.getByLabelText("route").textContent).toBe(
          "/auth/confirm",
        ),
      );
      expect(
        screen.getByRole("heading", { name: "লিংকটি কাজ করছে না" }),
      ).toBeTruthy();
      expect(api.confirm).not.toHaveBeenCalled();
      expect(api.signIn).not.toHaveBeenCalled();
    },
  );
  it("rejects a recovery token without attempting confirmation", () => {
    renderPage(`/auth/confirm#token_hash=${"b".repeat(64)}&type=recovery`);
    expect(
      screen.getByRole("heading", { name: "লিংকটি কাজ করছে না" }),
    ).toBeTruthy();
    expect(api.confirm).not.toHaveBeenCalled();
  });
});
describe("confirmation email recovery", () => {
  it("validates and resends only on request, then enforces a visible cooldown", async () => {
    const user = userEvent.setup();
    renderPage("/register/resend");
    expect(api.resend).not.toHaveBeenCalled();
    await user.type(
      screen.getByLabelText("ইমেইল", { exact: true }),
      "friend@example.com",
    );
    await user.click(screen.getByRole("button", { name: "ইমেইল পাঠান" }));
    expect(api.resend).toHaveBeenCalledExactlyOnceWith("friend@example.com");
    expect(screen.getByRole("status").textContent).toContain(
      "নতুন অ্যাকাউন্ট হলে",
    );
    expect(
      (
        screen.getByRole("button", {
          name: /সেকেন্ড পরে আবার পাঠান/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("provides a confirmation-email route for an unconfirmed password sign-in", async () => {
    api.signIn.mockRejectedValue(new Error("email_not_confirmed"));
    const user = userEvent.setup();
    renderPage("/login");
    await user.type(
      screen.getByLabelText("ইমেইল", { exact: true }),
      "friend@example.com",
    );
    await user.type(
      screen.getByLabelText("পাসওয়ার্ড", { exact: true }),
      "Password8",
    );
    await user.click(screen.getByRole("button", { name: "খাতা খুলুন" }));
    expect(screen.getByRole("alert").textContent).toContain("ইমেইল নিশ্চিত");
    expect(
      screen
        .getByRole("link", { name: "নিশ্চিত করার ইমেইল আবার চাই" })
        .getAttribute("href"),
    ).toBe("/register/resend");
  });
});
