// @vitest-environment jsdom
import type { ReactNode } from "react";
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
import { LedgerSchema, type Ledger } from "../../domain/model";
import { readPreferences, savePreferences } from "../../lib/preferences";
import { SettingsPage } from "./SettingsPage";

const api = vi.hoisted(() => ({
  ledger: null as unknown,
  mode: "real" as "real" | "demo",
  user: { id: "owner", phone: "+8801712345678", email: null } as {
    id: string;
    phone: string | null;
    email: string | null;
  } | null,
  status: "signed-in",
  conflict: null as unknown,
  pending: false,
  sync: vi.fn(),
  save: vi.fn(),
  notify: vi.fn(),
  go: vi.fn(),
  signOut: vi.fn(),
  setLanguage: vi.fn(),
  resolve: vi.fn(),
  download: vi.fn(),
  parse: vi.fn(),
  storage: {
    exportBackup: vi.fn(),
    importBackup: vi.fn(),
    mergeBackup: vi.fn(),
  },
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    ledger: api.ledger as Ledger,
    mode: api.mode,
    state: {
      pending: api.pending,
      lastSyncedAt: null,
      conflict: api.conflict,
      sync: api.sync,
    },
    save: api.save,
    notify: api.notify,
    go: api.go,
  }),
}));
vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({ user: api.user, status: api.status, signOut: api.signOut }),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    language: "bn",
    setLanguage: api.setLanguage,
    t: (text: string, values: Record<string, string | number> = {}) =>
      text.replace(/{{(\w+)}}/g, (_, key: string) => String(values[key] ?? "")),
    money: (amount: number) => `৳${amount / 100}`,
    number: String,
    formatDigits: String,
    date: (value: string | null) => value ?? "—",
  }),
}));
vi.mock("../../data/repository", () => ({
  createWorkspaceStorage: () => api.storage,
  parseBackup: api.parse,
}));
vi.mock("../../data/sync", () => ({
  isCloudConfigured: true,
  resolveCloudConflict: api.resolve,
}));
vi.mock("../../lib/display", () => ({
  saveFile: api.download,
  todayDhaka: () => "2026-11-02",
}));
vi.mock("../../components/Sheet", () => ({
  Sheet: ({
    title,
    children,
    footer,
    onClose,
  }: {
    title: string;
    children: ReactNode;
    footer?: ReactNode;
    onClose: () => void;
  }) => (
    <section role="dialog" aria-label={title}>
      <h2>{title}</h2>
      {children}
      {footer}
      <button onClick={onClose}>বন্ধ করুন</button>
    </section>
  ),
}));

function Location() {
  return <output data-testid="route">{useLocation().pathname}</output>;
}
function mount() {
  return render(
    <MemoryRouter initialEntries={["/settings"]}>
      <SettingsPage />
      <Location />
    </MemoryRouter>,
  );
}
async function openRow(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
) {
  await user.click(screen.getByText(label, { exact: true }));
}
function backup(isDemo = false) {
  return {
    format: "bari-khata-backup",
    version: 1,
    exportedAt: "2026-11-02T00:00:00Z",
    ledger: LedgerSchema.parse({ isDemo }),
    receipts: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.ledger = LedgerSchema.parse({
    project: { id: "home", name: "নিজের বাড়ি", currency: "BDT" },
  });
  api.mode = "real";
  api.user = { id: "owner", phone: "+8801712345678", email: null };
  api.conflict = null;
  api.pending = false;
  api.status = "signed-in";
  api.sync.mockResolvedValue({ status: "synced" });
  api.signOut.mockResolvedValue(undefined);
  api.resolve.mockResolvedValue(undefined);
  api.storage.exportBackup.mockResolvedValue("test-backup");
  api.storage.importBackup.mockResolvedValue(undefined);
  api.storage.mergeBackup.mockResolvedValue({ changed: true });
  api.parse.mockReturnValue(backup());
  api.save.mockImplementation(async (change: (ledger: Ledger) => Ledger) => {
    api.ledger = change(api.ledger as Ledger);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.palette;
});

describe("organized settings", () => {
  it("shows a phone-only profile and compact rows with editing and backup controls inside sheets", () => {
    mount();
    expect(screen.getByText("+8801712345678")).toBeTruthy();
    expect(screen.getByText("রং ও সাজ", { exact: true })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "কপি নামান" })).toBeNull();
    expect(screen.queryByRole("button", { name: "লগআউট" })).toBeNull();
  });

  it("changes appearance inside a sheet and preserves the stored language", async () => {
    savePreferences({ language: "en" });
    const user = userEvent.setup();
    mount();
    await openRow(user, "রং ও সাজ");
    expect(
      screen.getByRole("dialog", { name: "নিজের মতো সাজান" }),
    ).toBeTruthy();
    await user.click(screen.getByText("অপরাজিতা", { exact: true }));
    await user.click(screen.getByText("গভীর রাত", { exact: true }));
    expect(readPreferences()).toEqual({
      language: "en",
      theme: "dark",
      palette: "violet",
    });
    await user.click(screen.getByRole("button", { name: "বন্ধ করুন" }));
    await openRow(user, "ভাষা");
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(api.setLanguage).toHaveBeenCalledWith("en");
  });

  it("edits a trimmed notebook name without changing financial records", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "খাতার নাম বদলান" }));
    const input = screen.getByRole("textbox", { name: "খাতার নাম" });
    await user.clear(input);
    await user.type(input, "  নতুন বাড়ি  ");
    await user.click(screen.getByRole("button", { name: "রাখুন" }));
    await waitFor(() => expect(api.save).toHaveBeenCalledOnce());
    expect((api.ledger as Ledger).project.name).toBe("নতুন বাড়ি");
    expect((api.ledger as Ledger).entries).toEqual([]);
  });

  it("downloads the scoped backup and requires confirmation before merging it", async () => {
    const user = userEvent.setup();
    const { container } = mount();
    await openRow(user, "হিসাবের কপি");
    await user.click(screen.getByRole("button", { name: "কপি নামান" }));
    await waitFor(() =>
      expect(api.download).toHaveBeenCalledWith(
        "test-backup",
        "bari-khata-2026-11-02.json",
      ),
    );
    const input = container.querySelector('input[type="file"]')!;
    const file = new File(["{}"], "sample.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByRole("dialog", {
      name: "কপি থেকে হিসাব মেলান",
    });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const confirm = screen.getByRole("button", {
      name: "নতুন ও বাছাই করা তথ্য আনুন",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(api.storage.mergeBackup).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("checkbox", {
        name: "তালিকা দেখে নতুন ও বাছাই করা তথ্য আনতে চাই।",
      }),
    );
    await user.click(confirm);
    await waitFor(() =>
      expect(api.storage.mergeBackup).toHaveBeenCalledWith("{}", {
        confirmed: true,
        expectedLedger: api.ledger,
        decisions: {},
        at: expect.any(String),
      }),
    );
  });

  it("keeps a failed restore retryable and leaves the confirmation visible", async () => {
    api.storage.mergeBackup.mockRejectedValueOnce(
      new Error("work_history_would_be_lost"),
    );
    const user = userEvent.setup();
    const { container } = mount();
    await openRow(user, "হিসাবের কপি");
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [new File(["{}"], "backup.json")] },
    });
    await screen.findByRole("dialog", {
      name: "কপি থেকে হিসাব মেলান",
    });
    await user.click(
      screen.getByRole("checkbox", {
        name: "তালিকা দেখে নতুন ও বাছাই করা তথ্য আনতে চাই।",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "নতুন ও বাছাই করা তথ্য আনুন" }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("ইতিহাস রাখতে নতুন কপি বেছে নিন");
    expect(alert.parentElement?.firstElementChild).toBe(alert);
    expect(document.activeElement).toBe(alert);
    expect(
      screen.getByRole("dialog", { name: "কপি থেকে হিসাব মেলান" }),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "নতুন ও বাছাই করা তথ্য আনুন",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("keeps cloud conflicts visible and exposes both resolution choices", async () => {
    api.conflict = {};
    const user = userEvent.setup();
    mount();
    expect(
      screen.getByText("এই ফোন ও অনলাইনের হিসাব আলাদা হয়েছে।"),
    ).toBeTruthy();
    await openRow(user, "সংরক্ষণের অবস্থা");
    await user.click(screen.getByRole("button", { name: "অনলাইনের কপি নিন" }));
    await waitFor(() => expect(api.resolve).toHaveBeenCalledWith("use-cloud"));
    await user.click(
      screen.getByRole("button", { name: "এই ফোনের কপি রাখুন" }),
    );
    await waitFor(() => expect(api.resolve).toHaveBeenCalledWith("keep-local"));
  });

  it("shows guest return access while hiding real-account actions", async () => {
    api.mode = "demo";
    api.user = null;
    const user = userEvent.setup();
    mount();
    expect(screen.queryByText("অ্যাকাউন্ট", { exact: true })).toBeNull();
    expect(screen.queryByText("সংরক্ষণের অবস্থা", { exact: true })).toBeNull();
    await user.click(screen.getByRole("button", { name: "নিজের খাতা খুলুন" }));
    expect(screen.getByTestId("route").textContent).toBe("/login");
    expect(api.signOut).not.toHaveBeenCalled();
  });
});

it("opens account settings on a separate page for either real sign-in method", async () => {
  const user = userEvent.setup();
  for (const email of [null, "owner@example.com"]) {
    api.user = {
      id: "00000000-0000-4000-8000-000000000001",
      email,
      phone: email ? null : "+8801700000091",
    };
    const page = mount();
    await user.click(screen.getByRole("button", { name: "অ্যাকাউন্ট" }));
    expect(api.go).toHaveBeenLastCalledWith("/settings/account");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("পাসওয়ার্ড পরিবর্তন")).toBeNull();
    page.unmount();
  }
});
it.each(["real", "demo"] as const)(
  "does not show the unused removed-record option in %s mode",
  (mode) => {
    api.mode = mode;
    mount();
    expect(screen.queryByRole("button", { name: "মুছে রাখা তথ্য" })).toBeNull();
  },
);

it.each(["real", "demo"] as const)(
  "keeps record corrections and adjustments in their own context instead of settings in %s mode",
  (mode) => {
    api.mode = mode;
    mount();
    expect(
      screen.queryByRole("button", { name: "পুরোনো হিসাব ঠিক করি" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "হিসাব মিলিয়ে নিই" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "হিসাবের কপি" })).toBeTruthy();
    if (mode === "real")
      expect(
        screen.getByRole("button", { name: "সংরক্ষণের অবস্থা" }),
      ).toBeTruthy();
  },
);
