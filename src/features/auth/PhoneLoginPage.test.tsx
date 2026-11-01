// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
const api = vi.hoisted(() => ({
  request: vi.fn(),
  verify: vi.fn(),
  signIn: vi.fn(),
  auth: {
    phoneOtpEnabled: true,
    phoneAuthMode: "mock" as "manual" | "mock" | "sms" | "off",
  },
}));
vi.mock("./AuthProvider", () => ({
  useAuth: () => ({
    ...api.auth,
    requestPhoneOtp: api.request,
    verifyPhoneOtp: api.verify,
    signIn: api.signIn,
  }),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string, values?: Record<string, unknown>) =>
      text.replace(/{{(\w+)}}/g, (_, key) => String(values?.[key] ?? "")),
    number: String,
  }),
}));
import { LoginPage } from "./LoginPage";
function mount(onSuccess = vi.fn(), email?: string) {
  return {
    ...render(
      <MemoryRouter
        initialEntries={[
          { pathname: "/login", state: email ? { email } : null },
        ]}
      >
        <LoginPage onSuccess={onSuccess} />
      </MemoryRouter>,
    ),
    onSuccess,
  };
}
async function requestCode(
  user: ReturnType<typeof userEvent.setup>,
  phone = "01712345678",
) {
  await user.type(screen.getByLabelText("ফোন নম্বর", { exact: true }), phone);
  await user.click(
    screen.getByRole("button", {
      name: api.auth.phoneAuthMode === "manual" ? "এগিয়ে যাই" : "কোড নিন",
    }),
  );
}
beforeEach(() => {
  api.auth = { phoneOtpEnabled: true, phoneAuthMode: "mock" };
  api.request.mockResolvedValue({ retryAfter: 60 });
  api.verify.mockResolvedValue(undefined);
  api.signIn.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
});
describe("phone sign-in", () => {
  it("accepts a supplied access code in manual mode without delivery or registration controls", async () => {
    api.auth.phoneAuthMode = "manual";
    const user = userEvent.setup();
    const { onSuccess } = mount();
    expect(screen.queryByLabelText("প্রবেশের কোড")).toBeNull();
    expect(
      screen.getByRole("link", { name: "নমুনা দেখুন" }).getAttribute("href"),
    ).toBe("/sample");
    expect(screen.queryByRole("link", { name: "অ্যাকাউন্ট খুলুন" })).toBeNull();
    expect(document.body.textContent).not.toMatch(
      /1318|১৩১৮|SMS|পরীক্ষার|মেয়াদ/,
    );
    await requestCode(user, "০১৭১২৩৪৫৬৭৮");
    expect(api.request).toHaveBeenCalledExactlyOnceWith("+8801712345678");
    expect(api.verify).not.toHaveBeenCalled();
    const code = screen.getByLabelText("প্রবেশের কোড") as HTMLInputElement;
    expect(code.minLength).toBe(4);
    expect(code.maxLength).toBe(8);
    expect(code.autocomplete).toBe("off");
    expect(screen.getByRole("status").textContent).toBe(
      "আপনাকে দেওয়া প্রবেশের কোডটি লিখুন।",
    );
    expect(
      screen.queryByRole("button", { name: /আবার নিন|কোড নিন/ }),
    ).toBeNull();
    expect(document.body.textContent).not.toMatch(
      /1318|১৩১৮|SMS|পরীক্ষার|মেয়াদ|সেকেন্ড/,
    );
    await user.type(code, "১২৩");
    fireEvent.submit(code.closest("form")!);
    expect(screen.getByRole("alert").textContent).toBe("কোডটি পুরো লিখুন।");
    expect(api.verify).not.toHaveBeenCalled();
    await user.clear(code);
    await user.type(code, "১২৩৪৫৬৭৮৯");
    expect(code.value).toBe("12345678");
    await user.clear(code);
    await user.type(code, "১৩১৮");
    await user.click(screen.getByRole("button", { name: "খাতা খুলুন" }));
    expect(api.verify).toHaveBeenCalledExactlyOnceWith(
      "+8801712345678",
      "1318",
    );
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(api.signIn).not.toHaveBeenCalled();
  });
  it("keeps manual number changes available without a resend cooldown", async () => {
    api.auth.phoneAuthMode = "manual";
    const user = userEvent.setup();
    mount();
    await requestCode(user);
    await user.type(screen.getByLabelText("প্রবেশের কোড"), "1234");
    await user.click(screen.getByRole("button", { name: "নম্বর বদলাই" }));
    const next = screen.getByRole("button", {
      name: "এগিয়ে যাই",
    }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    await user.click(next);
    expect(api.request).toHaveBeenCalledTimes(2);
    expect(
      (screen.getByLabelText("প্রবেশের কোড") as HTMLInputElement).value,
    ).toBe("");
    expect(
      screen.queryByRole("button", { name: /আবার নিন|কোড নিন/ }),
    ).toBeNull();
    expect(api.verify).not.toHaveBeenCalled();
  });
  it("keeps manual request errors free of code delivery and cooldown claims", async () => {
    api.auth.phoneAuthMode = "manual";
    api.request.mockRejectedValueOnce(
      Object.assign(new Error("phone_rate_limited"), { retryAfter: 60 }),
    );
    const user = userEvent.setup();
    mount();
    await requestCode(user);
    expect(screen.getByRole("alert").textContent).toContain("অপেক্ষা");
    expect(
      (screen.getByRole("button", { name: "এগিয়ে যাই" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    await user.click(screen.getByRole("button", { name: "এগিয়ে যাই" }));
    api.verify.mockRejectedValueOnce(new Error("otp_expired"));
    await user.type(screen.getByLabelText("প্রবেশের কোড"), "1234");
    await user.click(screen.getByRole("button", { name: "খাতা খুলুন" }));
    expect(screen.getByRole("alert").textContent).toBe(
      "লগইন হয়নি। আবার চেষ্টা করুন।",
    );
    expect(document.body.textContent).not.toMatch(
      /SMS|পরীক্ষার|মেয়াদ|সেকেন্ড|আবার কোড/,
    );
  });
  it("keeps a rate-limited manual code and waits for the server cooldown before verifying again", async () => {
    vi.useFakeTimers();
    api.auth.phoneAuthMode = "manual";
    api.verify.mockRejectedValueOnce(
      Object.assign(new Error("phone_rate_limited"), { retryAfter: 900 }),
    );
    mount();
    fireEvent.change(screen.getByLabelText("ফোন নম্বর", { exact: true }), {
      target: { value: "01712345678" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "এগিয়ে যাই" }));
    });
    const code = screen.getByLabelText("প্রবেশের কোড") as HTMLInputElement;
    fireEvent.change(code, { target: { value: "1234" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "খাতা খুলুন" }));
    });
    const waiting = screen.getByRole("button", {
      name: "900 সেকেন্ড পরে চেষ্টা করুন",
    }) as HTMLButtonElement;
    expect(waiting.disabled).toBe(true);
    expect(code.value).toBe("1234");
    expect(
      screen.queryByRole("button", { name: /আবার নিন|কোড নিন/ }),
    ).toBeNull();
    await act(async () => {
      fireEvent.submit(code.closest("form")!);
    });
    expect(api.verify).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "ইমেইল" }));
    fireEvent.change(screen.getByLabelText("ইমেইল", { exact: true }), {
      target: { value: "friend@example.com" },
    });
    fireEvent.change(screen.getByLabelText("পাসওয়ার্ড", { exact: true }), {
      target: { value: "Password8" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "খাতা খুলুন" }));
    });
    expect(api.signIn).toHaveBeenCalledWith("friend@example.com", "Password8");
    fireEvent.click(screen.getByRole("button", { name: "ফোন নম্বর" }));
    fireEvent.change(screen.getByLabelText("প্রবেশের কোড"), {
      target: { value: "5678" },
    });
    await act(async () => {
      vi.advanceTimersByTime(900_100);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "খাতা খুলুন" }));
    });
    expect(api.verify).toHaveBeenLastCalledWith("+8801712345678", "5678");
    expect(api.verify).toHaveBeenCalledTimes(2);
  });
  it("retains email sign-in and its draft in manual mode without a confirmation resend link", async () => {
    api.auth.phoneAuthMode = "manual";
    api.signIn.mockRejectedValueOnce(new Error("email_not_confirmed"));
    const user = userEvent.setup();
    const { onSuccess } = mount(vi.fn(), "friend@example.com");
    await user.type(
      screen.getByLabelText("পাসওয়ার্ড", { exact: true }),
      "Password8",
    );
    await user.click(screen.getByRole("button", { name: "খাতা খুলুন" }));
    expect(api.signIn).toHaveBeenCalledWith("friend@example.com", "Password8");
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: "নিশ্চিত করার ইমেইল আবার চাই" }),
    ).toBeNull();
    expect(screen.queryByRole("link", { name: "অ্যাকাউন্ট খুলুন" })).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "ফোন দিয়ে লগইন করুন" }),
    );
    expect(screen.getByLabelText("ফোন নম্বর", { exact: true })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "ইমেইল" }));
    expect(
      (screen.getByLabelText("ইমেইল", { exact: true }) as HTMLInputElement)
        .value,
    ).toBe("friend@example.com");
    expect(
      (screen.getByLabelText("পাসওয়ার্ড", { exact: true }) as HTMLInputElement)
        .value,
    ).toBe("Password8");
    await user.click(screen.getByRole("button", { name: "খাতা খুলুন" }));
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(api.request).not.toHaveBeenCalled();
    expect(api.verify).not.toHaveBeenCalled();
  });
  it("requests a normalized number, accepts four digits in test mode, and enters only after verification", async () => {
    const user = userEvent.setup();
    const { onSuccess } = mount();
    expect(screen.queryByLabelText("ইমেইল", { exact: true })).toBeNull();
    expect(screen.getByText("পরীক্ষার জন্য ফোনে SMS যাবে না।")).toBeTruthy();
    await requestCode(user, "০১৭১২৩৪৫৬৭৮");
    expect(api.request).toHaveBeenCalledExactlyOnceWith("+8801712345678");
    const code = screen.getByLabelText("কোড", {
      exact: true,
    }) as HTMLInputElement;
    expect(code.minLength).toBe(4);
    expect(code.autocomplete).toBe("one-time-code");
    expect(onSuccess).not.toHaveBeenCalled();
    api.verify.mockRejectedValueOnce(new Error("invalid_otp"));
    await user.type(code, "1111");
    await user.click(screen.getByRole("button", { name: "খাতা খুলুন" }));
    expect(screen.getByRole("alert").textContent).toContain("কোডটি মেলেনি");
    expect(onSuccess).not.toHaveBeenCalled();
    await user.clear(code);
    await user.type(code, "১৩১৮");
    await user.click(screen.getByRole("button", { name: "খাতা খুলুন" }));
    expect(api.verify).toHaveBeenLastCalledWith("+8801712345678", "1318");
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(api.signIn).not.toHaveBeenCalled();
  });
  it("validates a Bangladesh number before contacting the server", async () => {
    const user = userEvent.setup();
    mount();
    await requestCode(user, "01112345678");
    expect(api.request).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("সঠিক বাংলাদেশি");
  });
  it("uses SMS-length codes and delivery copy in real SMS mode", async () => {
    api.auth.phoneAuthMode = "sms";
    const user = userEvent.setup();
    mount();
    expect(screen.queryByText("পরীক্ষার জন্য ফোনে SMS যাবে না।")).toBeNull();
    await requestCode(user);
    expect(
      (screen.getByLabelText("কোড", { exact: true }) as HTMLInputElement)
        .minLength,
    ).toBe(6);
    expect(screen.getByRole("status").textContent).toBe(
      "ফোনে পাঠানো কোডটি লিখুন।",
    );
  });
  it("clears a previous code when the number changes and submits only the new number", async () => {
    const user = userEvent.setup();
    mount();
    await requestCode(user);
    await user.type(screen.getByLabelText("কোড", { exact: true }), "1318");
    await user.click(screen.getByRole("button", { name: "নম্বর বদলাই" }));
    expect(screen.queryByLabelText("কোড", { exact: true })).toBeNull();
    const phone = screen.getByLabelText("ফোন নম্বর", { exact: true });
    await user.clear(phone);
    await user.type(phone, "01812345678");
    await user.click(screen.getByRole("button", { name: "কোড নিন" }));
    expect(api.request).toHaveBeenLastCalledWith("+8801812345678");
    expect(
      (screen.getByLabelText("কোড", { exact: true }) as HTMLInputElement).value,
    ).toBe("");
  });
  it("enforces a visible resend delay, then requests another code without verifying", async () => {
    vi.useFakeTimers();
    api.request.mockResolvedValue({ retryAfter: 2 });
    mount();
    fireEvent.change(screen.getByLabelText("ফোন নম্বর", { exact: true }), {
      target: { value: "01712345678" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "কোড নিন" }));
    });
    const waiting = screen.getByRole("button", {
      name: "2 সেকেন্ড পরে আবার নিন",
    }) as HTMLButtonElement;
    expect(waiting.disabled).toBe(true);
    fireEvent.click(waiting);
    expect(api.request).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "আবার কোড নিন" }));
    });
    expect(api.request).toHaveBeenCalledTimes(2);
    expect(api.verify).not.toHaveBeenCalled();
  });
  it("uses the server's retry delay after an initial request is rate limited", async () => {
    api.request.mockRejectedValueOnce(
      Object.assign(new Error("phone_rate_limited"), { retryAfter: 3 }),
    );
    const user = userEvent.setup();
    mount();
    await requestCode(user);
    expect(screen.getByRole("alert").textContent).toContain("অপেক্ষা");
    expect(
      (
        screen.getByRole("button", {
          name: "3 সেকেন্ড পরে আবার নিন",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(api.request).toHaveBeenCalledOnce();
  });
  it.each(["mock", "manual"] as const)(
    "blocks changing the active %s request and ignores a late result after leaving the page",
    async (mode) => {
      api.auth.phoneAuthMode = mode;
      let finish!: (value: unknown) => void;
      api.request.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const user = userEvent.setup();
      const { unmount, onSuccess } = mount();
      await requestCode(user);
      expect(
        (
          screen.getByLabelText("ফোন নম্বর", {
            exact: true,
          }) as HTMLInputElement
        ).disabled,
      ).toBe(true);
      expect(
        (
          screen.getByRole("button", {
            name: "ইমেইল",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      unmount();
      await act(async () => {
        finish({ retryAfter: 60 });
      });
      expect(onSuccess).not.toHaveBeenCalled();
    },
  );
  it("requests a fresh challenge when verification says it expired", async () => {
    api.verify.mockRejectedValueOnce(new Error("otp_expired"));
    const user = userEvent.setup();
    mount();
    await requestCode(user);
    await user.type(screen.getByLabelText("কোড", { exact: true }), "1318");
    await user.click(screen.getByRole("button", { name: "খাতা খুলুন" }));
    expect(screen.getByRole("alert").textContent).toContain("মেয়াদ শেষ");
    expect(screen.getByLabelText("ফোন নম্বর", { exact: true })).toBeTruthy();
    expect(screen.queryByLabelText("কোড", { exact: true })).toBeNull();
  });
  it("preserves email registration handoff and leaves email sign-in available when phone is off", async () => {
    const user = userEvent.setup();
    mount(vi.fn(), "friend@example.com");
    expect(
      (screen.getByLabelText("ইমেইল", { exact: true }) as HTMLInputElement)
        .value,
    ).toBe("friend@example.com");
    await user.type(
      screen.getByLabelText("পাসওয়ার্ড", { exact: true }),
      "Password8",
    );
    await user.click(screen.getByRole("button", { name: "খাতা খুলুন" }));
    expect(api.signIn).toHaveBeenCalledWith("friend@example.com", "Password8");
    cleanup();
    api.auth = { phoneOtpEnabled: false, phoneAuthMode: "off" };
    mount();
    expect(screen.queryByRole("button", { name: "ফোন নম্বর" })).toBeNull();
    expect(screen.getByLabelText("ইমেইল", { exact: true })).toBeTruthy();
  });
});
