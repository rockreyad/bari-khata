// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPassword } from "./SettingsPassword";
const api = vi.hoisted(() => ({
  change: vi.fn(),
  owner: "00000000-0000-4000-8000-000000000001" as string | null,
}));
vi.mock("../auth/changePassword", () => ({ changeEmailPassword: api.change }));
vi.mock("../../data/database", () => ({ getActiveOwner: () => api.owner }));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({ t: (text: string) => text }),
}));
const account = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "owner@example.com",
  phone: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  api.owner = account.id;
  api.change.mockResolvedValue(undefined);
});
afterEach(cleanup);
async function fill() {
  const user = userEvent.setup();
  await user.click(screen.getByText("পাসওয়ার্ড পরিবর্তন"));
  await user.type(
    screen.getByLabelText("এখনকার পাসওয়ার্ড", { exact: true }),
    "old-password",
  );
  await user.type(
    screen.getByLabelText("নতুন পাসওয়ার্ড", { exact: true }),
    "new-password",
  );
  await user.type(
    screen.getByLabelText("নতুন পাসওয়ার্ড আবার লিখুন", { exact: true }),
    "new-password",
  );
  return user;
}
it("saves through current-password verification and offers a separate sign-in action after success", async () => {
  const signIn = vi.fn().mockResolvedValue(undefined),
    busy = vi.fn();
  render(
    <SettingsPassword
      user={account}
      onBusyChange={busy}
      onSignInAgain={signIn}
    />,
  );
  const user = await fill();
  await user.click(
    screen.getByRole("button", { name: "নতুন পাসওয়ার্ড রাখুন" }),
  );
  expect(await screen.findByText("পাসওয়ার্ড বদলেছে")).toBeTruthy();
  expect(api.change).toHaveBeenCalledWith(account, {
    currentPassword: "old-password",
    password: "new-password",
    confirmation: "new-password",
  });
  expect(screen.queryByLabelText("এখনকার পাসওয়ার্ড")).toBeNull();
  expect(signIn).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "নতুন পাসওয়ার্ড দিয়ে ঢুকি" }),
  );
  expect(signIn).toHaveBeenCalledOnce();
  expect(busy).toHaveBeenCalledWith(true);
  expect(busy).toHaveBeenLastCalledWith(false);
});
it("shows a useful incorrect-current-password error without signing out", async () => {
  const signIn = vi.fn();
  api.change.mockRejectedValue(new Error("current_password_invalid"));
  render(
    <SettingsPassword
      user={account}
      onBusyChange={vi.fn()}
      onSignInAgain={signIn}
    />,
  );
  const user = await fill();
  await user.click(
    screen.getByRole("button", { name: "নতুন পাসওয়ার্ড রাখুন" }),
  );
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("এখনকার পাসওয়ার্ড মেলেনি");
  expect(alert.closest("form")?.firstElementChild).toBe(alert);
  expect(document.activeElement).toBe(alert);
  expect(signIn).not.toHaveBeenCalled();
});
it("prevents duplicate submissions and never invokes sign-out when the owner changes", async () => {
  let done!: () => void;
  api.change.mockReturnValue(
    new Promise<void>((resolve) => {
      done = resolve;
    }),
  );
  const signIn = vi.fn();
  render(
    <SettingsPassword
      user={account}
      onBusyChange={vi.fn()}
      onSignInAgain={signIn}
    />,
  );
  const user = await fill();
  const submit = screen.getByRole("button", { name: "নতুন পাসওয়ার্ড রাখুন" });
  await user.click(submit);
  await user.click(submit);
  expect(api.change).toHaveBeenCalledOnce();
  api.owner = "00000000-0000-4000-8000-000000000002";
  done();
  await waitFor(() =>
    expect(screen.queryByText("পাসওয়ার্ড বদলেছে")).toBeNull(),
  );
  expect(signIn).not.toHaveBeenCalled();
});
it("clears typed passwords when the disclosure is closed", async () => {
  render(
    <SettingsPassword
      user={account}
      onBusyChange={vi.fn()}
      onSignInAgain={vi.fn()}
    />,
  );
  const user = await fill();
  await user.click(screen.getByText("পাসওয়ার্ড পরিবর্তন"));
  await user.click(screen.getByText("পাসওয়ার্ড পরিবর্তন"));
  expect(
    (
      screen.getByLabelText("এখনকার পাসওয়ার্ড", {
        exact: true,
      }) as HTMLInputElement
    ).value,
  ).toBe("");
  expect(
    (
      screen.getByLabelText("নতুন পাসওয়ার্ড", {
        exact: true,
      }) as HTMLInputElement
    ).value,
  ).toBe("");
});
