// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { LoginPage } from "./LoginPage";

const api = vi.hoisted(() => ({
  request: vi.fn(),
  verify: vi.fn(),
  signIn: vi.fn(),
  phoneOtpEnabled: true,
}));
vi.mock("./AuthProvider", () => ({
  useAuth: () => ({
    phoneOtpEnabled: api.phoneOtpEnabled,
    phoneAuthMode: api.phoneOtpEnabled ? "mock" : "off",
    requestPhoneOtp: api.request,
    verifyPhoneOtp: api.verify,
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
  api.phoneOtpEnabled = true;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function open() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/sample" element={<h1>Sample notebook</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("guest sample entry", () => {
  it.each(["phone", "email"])(
    "opens the sample from %s sign-in without submitting incomplete credentials",
    async (method) => {
      const user = userEvent.setup();
      open();
      if (method === "email")
        await user.click(screen.getByRole("button", { name: "ইমেইল" }));
      const link = screen.getByRole("link", { name: "নমুনা দেখুন" });
      expect(link.getAttribute("href")).toBe("/sample");
      expect(link.closest("form")).toBeNull();
      expect(screen.getByText("লগইন ছাড়াই অ্যাপ ঘুরে দেখুন।")).toBeTruthy();
      await user.click(link);
      expect(
        screen.getByRole("heading", { name: "Sample notebook" }),
      ).toBeTruthy();
      expect(api.request).not.toHaveBeenCalled();
      expect(api.verify).not.toHaveBeenCalled();
      expect(api.signIn).not.toHaveBeenCalled();
    },
  );

  it("keeps guest access available when phone sign-in is disabled", async () => {
    api.phoneOtpEnabled = false;
    const user = userEvent.setup();
    open();
    expect(screen.queryByRole("button", { name: "ফোন নম্বর" })).toBeNull();
    expect(screen.getByLabelText("ইমেইল", { exact: true })).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "নমুনা দেখুন" }));
    expect(
      screen.getByRole("heading", { name: "Sample notebook" }),
    ).toBeTruthy();
    expect(api.signIn).not.toHaveBeenCalled();
  });
});
