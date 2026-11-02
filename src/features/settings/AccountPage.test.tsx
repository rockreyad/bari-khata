// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { AccountPage, AccountPasswordPage } from "./AccountPage";

const owner = "00000000-0000-4000-8000-000000000001";
const api = vi.hoisted(() => ({
  user: null as null | {
    id: string;
    email: string | null;
    phone: string | null;
  },
  owner: null as string | null,
  mode: "real" as "real" | "demo",
  status: "signed-in",
  pending: false,
  conflict: null as unknown,
  go: vi.fn(),
  signOut: vi.fn(),
  remove: vi.fn(),
  backup: vi.fn(),
  download: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    mode: api.mode,
    go: api.go,
    state: { pending: api.pending, conflict: api.conflict, syncing: false },
  }),
}));
vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({ user: api.user, status: api.status, signOut: api.signOut }),
}));
vi.mock("../../data/database", () => ({ getActiveOwner: () => api.owner }));
vi.mock("../../data/repository", () => ({
  createWorkspaceStorage: () => ({ exportBackup: api.backup }),
}));
vi.mock("../../lib/display", () => ({
  saveFile: api.download,
  todayDhaka: () => "2026-11-02",
}));
vi.mock("../auth/deleteAccount", () => ({ deleteOwnAccount: api.remove }));
vi.mock("../auth/changePassword", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../auth/changePassword")>()),
  changeEmailPassword: vi.fn(),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string, values: Record<string, string | number> = {}) =>
      text.replace(/{{(\w+)}}/g, (_, key: string) => String(values[key] ?? "")),
    formatDigits: String,
  }),
}));
function Location() {
  return <output data-testid="route">{useLocation().pathname}</output>;
}
function mount(password = false) {
  return render(
    <MemoryRouter
      initialEntries={[
        password ? "/settings/account/password" : "/settings/account",
      ]}
    >
      {password ? <AccountPasswordPage /> : <AccountPage />}
      <Location />
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  api.user = { id: owner, email: "owner@example.com", phone: null };
  api.owner = owner;
  api.mode = "real";
  api.status = "signed-in";
  api.pending = false;
  api.conflict = null;
  api.remove.mockResolvedValue(undefined);
  api.backup.mockResolvedValue("private backup");
  api.signOut.mockImplementation(async () => {
    api.owner = null;
  });
});
afterEach(cleanup);
describe("dedicated account settings", () => {
  it("opens password settings on a separate route and keeps navigation/backups/recovery simple", async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.getByRole("heading", { name: "অ্যাকাউন্ট" })).toBeTruthy();
    expect(screen.queryByLabelText("এখনকার পাসওয়ার্ড")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: /^পাসওয়ার্ড পরিবর্তন/ }),
    );
    expect(api.go).toHaveBeenLastCalledWith("/settings/account/password");
    await user.click(screen.getByRole("button", { name: /^মুছে রাখা তথ্য/ }));
    expect(api.go).toHaveBeenLastCalledWith("/settings/removed");
    await user.click(
      screen.getByRole("button", { name: /^হিসাবের কপি নামাই/ }),
    );
    expect(api.download).toHaveBeenCalledWith(
      "private backup",
      "bari-khata-2026-11-02.json",
      "application/json",
    );
    expect(await screen.findByText("কপি নামানো হয়েছে")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "সেটিংসে ফিরুন" }));
    expect(api.go).toHaveBeenLastCalledWith("/settings");
  });
  it("downloads the exported backup bytes under a JSON filename, preserving money and receipt data", async () => {
    const backup = JSON.stringify({
      ledger: { entries: [{ id: "payment-1", amount: 16225 }] },
      receipts: [{ id: "voucher-1", data: "AQIDBA==" }],
    });
    api.backup.mockResolvedValueOnce(backup);
    let downloaded: File | undefined;
    api.download.mockImplementationOnce(
      (contents: BlobPart, filename: string, type: string) => {
        downloaded = new File([contents], filename, { type });
      },
    );
    mount();
    await userEvent.click(
      screen.getByRole("button", { name: /^হিসাবের কপি নামাই/ }),
    );
    expect(downloaded?.name).toBe("bari-khata-2026-11-02.json");
    expect(downloaded?.type).toBe("application/json");
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(downloaded!);
    });
    expect(text).toBe(backup);
    expect(JSON.parse(text)).toEqual({
      ledger: { entries: [{ id: "payment-1", amount: 16225 }] },
      receipts: [{ id: "voucher-1", data: "AQIDBA==" }],
    });
    expect(screen.getByText("কপি নামানো হয়েছে")).toBeTruthy();
  });
  it("keeps phone PIN accounts separate from email password settings", () => {
    api.user = { id: owner, email: null, phone: "+8801712345678" };
    mount();
    expect(screen.getByText("+8801712345678")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /^পাসওয়ার্ড পরিবর্তন/ }),
    ).toBeNull();
    expect(
      screen.getByText("আপনাকে দেওয়া PIN দিয়ে ফোন নম্বরে লগইন করবেন।"),
    ).toBeTruthy();
  });
  it.each(["phone.bari.invalid", "PHONE.BARI.INVALID"])(
    "shows a manual phone account's number instead of its internal %s alias",
    (domain) => {
      const alias = `managed-identity@${domain}`;
      api.user = { id: owner, email: alias, phone: "+8801712345678" };
      mount();
      expect(screen.getByText("+8801712345678")).toBeTruthy();
      expect(screen.queryByText(alias)).toBeNull();
      expect(screen.getByText("ফোন নম্বরে লগইন")).toBeTruthy();
      expect(screen.queryByText("ইমেইলে লগইন")).toBeNull();
      expect(
        screen.queryByRole("button", { name: /^পাসওয়ার্ড পরিবর্তন/ }),
      ).toBeNull();
    },
  );
  it("keeps real email identity and password settings when an email account also has a phone", () => {
    api.user = {
      id: owner,
      email: "owner@example.com",
      phone: "+8801712345678",
    };
    mount();
    expect(screen.getByText("owner@example.com")).toBeTruthy();
    expect(screen.getByText("ইমেইলে লগইন")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /^পাসওয়ার্ড পরিবর্তন/ }),
    ).toBeTruthy();
    expect(screen.queryByText("ফোন নম্বরে লগইন")).toBeNull();
  });
  it("renders the password form directly on its own page", () => {
    mount(true);
    expect(
      screen.getByLabelText("এখনকার পাসওয়ার্ড", { exact: true }),
    ).toBeTruthy();
    expect(document.querySelector("details.settings-password")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "অ্যাকাউন্ট মুছতে চাই" }),
    ).toBeNull();
  });
  it.each(["pending", "offline", "conflict"])(
    "blocks deleting an account with %s state",
    (state) => {
      if (state === "pending") api.pending = true;
      if (state === "offline") api.status = "offline";
      if (state === "conflict") api.conflict = {};
      mount();
      expect(
        (
          screen.getByRole("button", {
            name: "অ্যাকাউন্ট মুছতে চাই",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      expect(api.remove).not.toHaveBeenCalled();
    },
  );
  it("hides real identity and destructive controls from demo account settings", () => {
    api.mode = "demo";
    mount();
    expect(screen.queryByText("owner@example.com")).toBeNull();
    expect(screen.queryByRole("button", { name: "লগআউট" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "অ্যাকাউন্ট মুছতে চাই" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /^মুছে রাখা তথ্য/ }),
    ).toBeTruthy();
  });
});
async function openDelete() {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "অ্যাকাউন্ট মুছতে চাই" }),
  );
  return user;
}
describe("typed account deletion", () => {
  it("requires exact DELETE, leaves Cancel focused and signs out only after successful deletion", async () => {
    mount();
    const user = await openDelete();
    const remove = screen.getByRole("button", {
      name: "অ্যাকাউন্ট মুছে ফেলুন",
    });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "ফিরে যাই" }),
    );
    expect((remove as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("DELETE", { selector: "strong" })).toBeTruthy();
    const input = screen.getByLabelText("নিশ্চিত করতে DELETE লিখুন");
    await user.type(input, "delete");
    expect((remove as HTMLButtonElement).disabled).toBe(true);
    await user.clear(input);
    await user.type(input, "DELETE");
    await user.click(remove);
    await waitFor(() =>
      expect(screen.getByTestId("route").textContent).toBe("/login"),
    );
    expect(api.remove).toHaveBeenCalledExactlyOnceWith(owner, "DELETE");
    expect(api.signOut).toHaveBeenCalledOnce();
  });
  it("cancel never calls deletion and returns focus to the original control", async () => {
    mount();
    const user = await openDelete();
    await user.click(screen.getByRole("button", { name: "ফিরে যাই" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.remove).not.toHaveBeenCalled();
    expect(api.signOut).not.toHaveBeenCalled();
  });
  it("keeps a failure open for retry without signing out", async () => {
    api.remove.mockRejectedValue(new Error("account_delete_failed"));
    mount();
    const user = await openDelete();
    await user.type(
      screen.getByLabelText("নিশ্চিত করতে DELETE লিখুন"),
      "DELETE",
    );
    await user.click(
      screen.getByRole("button", {
        name: "অ্যাকাউন্ট মুছে ফেলুন",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "অ্যাকাউন্ট মুছতে পুরো কাজ শেষ হয়নি। আবার চেষ্টা করুন।",
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(api.signOut).not.toHaveBeenCalled();
  });
  it("prevents double submission and never signs a different account out", async () => {
    let done!: () => void;
    api.remove.mockReturnValue(
      new Promise<void>((resolve) => {
        done = resolve;
      }),
    );
    mount();
    const user = await openDelete();
    fireEvent.change(screen.getByLabelText("নিশ্চিত করতে DELETE লিখুন"), {
      target: { value: "DELETE" },
    });
    const remove = screen.getByRole("button", {
      name: "অ্যাকাউন্ট মুছে ফেলুন",
    });
    await user.click(remove);
    await user.click(remove);
    expect(api.remove).toHaveBeenCalledOnce();
    api.owner = "00000000-0000-4000-8000-000000000002";
    done();
    await waitFor(() =>
      expect((remove as HTMLButtonElement).disabled).toBe(false),
    );
    expect(api.signOut).not.toHaveBeenCalled();
  });
  it("locks the same deleted account even if its settings page was closed during the request", async () => {
    let done!: () => void;
    api.remove.mockReturnValue(
      new Promise<void>((resolve) => {
        done = resolve;
      }),
    );
    const page = mount();
    const user = await openDelete();
    fireEvent.change(screen.getByLabelText("নিশ্চিত করতে DELETE লিখুন"), {
      target: { value: "DELETE" },
    });
    await user.click(
      screen.getByRole("button", {
        name: "অ্যাকাউন্ট মুছে ফেলুন",
      }),
    );
    page.unmount();
    done();
    await waitFor(() => expect(api.signOut).toHaveBeenCalledOnce());
  });
});
