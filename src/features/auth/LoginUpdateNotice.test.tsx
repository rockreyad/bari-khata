// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { LoginPage } from "./LoginPage";

const api = vi.hoisted(() => ({
  waiting: true,
  canReload: (() => true) as () => boolean,
  update: vi.fn(),
  request: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock("../../lib/usePwa", () => ({
  usePwa: (canReload: () => boolean) => {
    api.canReload = canReload;
    return {
      needRefresh: [api.waiting, vi.fn()],
      updateServiceWorker: api.update,
    };
  },
}));
vi.mock("./AuthProvider", () => ({
  useAuth: () => ({
    phoneOtpEnabled: true,
    phoneAuthMode: "manual",
    requestPhoneOtp: api.request,
    verifyPhoneOtp: vi.fn(),
    signIn: api.signIn,
  }),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string) => text,
    formatDigits: String,
    number: String,
  }),
}));

beforeEach(() => {
  api.waiting = true;
  api.request.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function open(email?: string) {
  return render(
    <MemoryRouter
      initialEntries={[{ pathname: "/login", state: email ? { email } : null }]}
    >
      <Routes>
        <Route path="/login/*" element={<LoginPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

it("offers an explicit update for a waiting worker only on an empty sign-in form", async () => {
  const user = userEvent.setup();
  open();
  const update = screen.getByRole("button", { name: "আপডেট" });
  expect(update.closest("form")).toBeNull();
  expect(api.canReload()).toBe(true);
  expect(api.update).not.toHaveBeenCalled();
  await user.click(update);
  expect(api.update).toHaveBeenCalledOnce();
  expect(api.request).not.toHaveBeenCalled();
  expect(api.signIn).not.toHaveBeenCalled();
});

it("has no login update notice without a waiting worker", () => {
  api.waiting = false;
  open();
  expect(screen.queryByRole("button", { name: "আপডেট" })).toBeNull();
});

it("hides the action and blocks delayed reload while a phone number or PIN challenge exists", async () => {
  const user = userEvent.setup();
  open();
  await user.type(
    screen.getByLabelText("ফোন নম্বর", { exact: true }),
    "01712345678",
  );
  expect(screen.queryByRole("button", { name: "আপডেট" })).toBeNull();
  expect(api.canReload()).toBe(false);
  await user.click(screen.getByRole("button", { name: "এগিয়ে যাই" }));
  const pin = await screen.findByLabelText("প্রবেশের কোড", { exact: true });
  await waitFor(() => expect((pin as HTMLInputElement).disabled).toBe(false));
  expect(api.canReload()).toBe(false);
  await user.type(pin, "1318");
  expect((pin as HTMLInputElement).value).toBe("1318");
  expect(screen.queryByRole("button", { name: "আপডেট" })).toBeNull();
  expect(api.update).not.toHaveBeenCalled();
});

it("keeps both email and password safe, including hidden phone input from another login method", async () => {
  const user = userEvent.setup();
  open();
  const phone = screen.getByLabelText("ফোন নম্বর", { exact: true });
  await user.type(phone, "01712345678");
  await user.click(screen.getByRole("button", { name: "ইমেইল" }));
  expect(api.canReload()).toBe(false);
  expect(screen.queryByRole("button", { name: "আপডেট" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "ফোন নম্বর" }));
  await user.clear(screen.getByLabelText("ফোন নম্বর", { exact: true }));
  await user.click(screen.getByRole("button", { name: "ইমেইল" }));
  const email = screen.getByLabelText("ইমেইল", { exact: true });
  const password = screen.getByLabelText("পাসওয়ার্ড", { exact: true });
  await user.type(email, "owner@example.com");
  await user.type(password, "not-a-real-password");
  await user.clear(email);
  expect(api.canReload()).toBe(false);
  expect((password as HTMLInputElement).value).toBe("not-a-real-password");
  expect(screen.queryByRole("button", { name: "আপডেট" })).toBeNull();
  await user.clear(password);
  expect(api.canReload()).toBe(true);
  expect(screen.getByRole("button", { name: "আপডেট" })).toBeTruthy();
  expect(api.update).not.toHaveBeenCalled();
});

it("protects a login email supplied from another account route", () => {
  open("owner@example.com");
  expect(api.canReload()).toBe(false);
  expect(screen.queryByRole("button", { name: "আপডেট" })).toBeNull();
  expect(
    (screen.getByLabelText("ইমেইল", { exact: true }) as HTMLInputElement).value,
  ).toBe("owner@example.com");
});
