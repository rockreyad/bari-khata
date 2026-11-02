// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { LedgerSchema } from "../../domain/model";
import { AssistantSettingsPage } from "./AssistantSettingsPage";
import { integrationsEnglish } from "./integrationsEnglish";

const api = vi.hoisted(() => ({
  owner: "00000000-0000-4000-8000-000000000001" as string | null,
  mode: "real" as "real" | "demo",
  status: "signed-in",
  language: "bn" as "bn" | "en",
  connections: vi.fn(),
  proposals: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
  approve: vi.fn(),
  go: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    mode: api.mode,
    go: api.go,
    ledger: LedgerSchema.parse({}),
  }),
}));
vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({
    status: api.status,
    user: api.owner ? { id: api.owner } : null,
  }),
}));
vi.mock("../../data/database", () => ({ getActiveOwner: () => api.owner }));
vi.mock("../../data/sync", () => ({ getCloudSession: vi.fn() }));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string, values: Record<string, string | number> = {}) =>
      (api.language === "en"
        ? (integrationsEnglish[text] ?? text)
        : text
      ).replace(/{{(\w+)}}/g, (_, key: string) => String(values[key] ?? "")),
    number: String,
    formatDigits: String,
    language: api.language,
    money: (value: number) => `৳${value / 100}`,
    date: (value: string) => value,
  }),
}));
vi.mock("./mcpClient", async (original) => ({
  ...(await original<typeof import("./mcpClient")>()),
  loadAssistantConnections: api.connections,
  loadAssistantProposals: api.proposals,
  createAssistantConnection: api.create,
  revokeAssistantConnection: api.revoke,
  approveAssistantProposal: api.approve,
}));
const endpoint = "https://bari.example/api/mcp";
const connection = {
  id: "connection-one",
  name: "আমার সহকারী",
  scopes: ["ledger:read", "entries:create"],
  policy: { confirmationRequired: false },
  createdAt: "2026-11-02T00:00:00Z",
};
function mount() {
  return render(
    <MemoryRouter>
      <AssistantSettingsPage />
    </MemoryRouter>,
  );
}
async function openKeySetup(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByText("অন্যভাবে সংযোগ দিন", { exact: true }),
  );
  await user.click(screen.getByRole("button", { name: "চাবি দিয়ে যোগ করুন" }));
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.owner = "00000000-0000-4000-8000-000000000001";
  api.mode = "real";
  api.status = "signed-in";
  api.language = "bn";
  api.connections.mockResolvedValue({
    connections: [],
    endpoint,
    available: true,
  });
  api.proposals.mockResolvedValue({ proposals: [] });
  api.create.mockResolvedValue({
    connection,
    endpoint,
    token: "one-time-private-key",
  });
  api.revoke.mockResolvedValue({});
  api.approve.mockResolvedValue({});
});
afterEach(cleanup);

describe("assistant settings", () => {
  it("prioritizes Codex while keeping setup and key details closed until requested", async () => {
    mount();
    const codex = await screen.findByText("Codex-এ যোগ করুন", {
      exact: true,
    });
    const claude = screen.getByText("Claude-এ যোগ করুন", { exact: true });
    const other = screen.getByText("অন্যভাবে সংযোগ দিন", { exact: true });
    for (const summary of [codex, claude, other])
      expect(summary.closest("details")!.open).toBe(false);
    expect(
      codex.compareDocumentPosition(claude) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "সহকারীর নাম" })).toBeNull();
    expect(screen.queryByRole("button", { name: "চাবি তৈরি করুন" })).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "আপনার অনুমোদনের অপেক্ষায়" }),
    ).toBeNull();
  });
  it("explains Claude custom connectors with automatic OAuth registration", async () => {
    const user = userEvent.setup();
    mount();
    const summary = await screen.findByText("Claude-এ যোগ করুন", {
      exact: true,
    });
    await user.click(summary);
    const help = summary.closest("details")!;
    expect(help.open).toBe(true);
    expect(
      within(help).getByText(
        "Authentication-এ Sign in now এবং OAuth client-এ Register automatically বেছে নিন।",
      ),
    ).toBeTruthy();
    expect(
      within(help)
        .getByRole("link", { name: "Claude-এর অফিসিয়াল নির্দেশনা" })
        .getAttribute("href"),
    ).toBe(
      "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
    );
    expect(within(help).queryByRole("note")).toBeNull();
    expect(api.create).not.toHaveBeenCalled();
  });

  it.each(["http://127.0.0.1:5180/api/mcp", "https://localhost/api/mcp"])(
    "explains Claude deployment requirements for %s without changing the copied address",
    async (localEndpoint) => {
      api.connections.mockResolvedValue({
        connections: [],
        endpoint: localEndpoint,
        available: true,
      });
      const user = userEvent.setup();
      const copy = vi
        .spyOn(navigator.clipboard, "writeText")
        .mockResolvedValue();
      mount();
      await user.click(
        await screen.findByText("Claude-এ যোগ করুন", { exact: true }),
      );
      expect(screen.getByRole("note").textContent).toContain(
        "প্রকাশিত HTTPS ঠিকানা লাগবে",
      );
      expect(
        (
          screen.getByRole("button", {
            name: "ঠিকানা কপি করুন",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
      expect(
        screen.getByText("Codex-এ যোগ করুন", { exact: true }),
      ).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "ঠিকানা কপি করুন" }));
      expect(copy).toHaveBeenCalledWith(localEndpoint);
    },
  );

  it("renders the Claude setup guide in English when English is selected", async () => {
    api.language = "en";
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByText("Add to Claude", { exact: true }));
    expect(
      screen.getByText(
        "Under Authentication, choose Sign in now. Under OAuth client, choose Register automatically.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Official Claude instructions" }),
    ).toBeTruthy();
  });

  it("shows the OAuth address and copies a ready install command without creating a key", async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    mount();
    await screen.findByRole("textbox", { name: "সংযোগের ঠিকানা" });
    await user.click(screen.getByRole("button", { name: "ঠিকানা কপি করুন" }));
    expect(copy).toHaveBeenCalledWith(endpoint);
    await user.click(screen.getByText("Codex-এ যোগ করুন"));
    await user.click(screen.getByRole("button", { name: "কমান্ড কপি করুন" }));
    expect(copy).toHaveBeenLastCalledWith(
      `codex mcp add bari-khata --url '${endpoint}'\ncodex mcp login bari-khata`,
    );
    expect(api.create).not.toHaveBeenCalled();
  });

  it("creates a named scoped connection with integer-poisha limits, shows its key once and copies JSON", async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    mount();
    await openKeySetup(user);
    await user.type(
      screen.getByRole("textbox", { name: "সহকারীর নাম" }),
      "আমার সহকারী",
    );
    await user.type(
      screen.getByRole("textbox", { name: "একবারে সর্বোচ্চ টাকা" }),
      "5000",
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: "হিসাব রাখার আগে প্রতিবার আমাকে দেখাবে",
      }),
    );
    await user.click(screen.getByRole("button", { name: "চাবি তৈরি করুন" }));
    const secretInput = await screen.findByLabelText("গোপন চাবি");
    expect((secretInput as HTMLInputElement).type).toBe("password");
    expect(api.create).toHaveBeenCalledWith(
      api.owner,
      expect.objectContaining({
        name: "আমার সহকারী",
        scopes: expect.arrayContaining(["ledger:read", "entries:create"]),
        policy: { confirmationRequired: true, maxAmountPaisa: 500000 },
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "সংযোগের JSON কপি করুন" }),
    );
    expect(JSON.parse(copy.mock.calls.at(-1)![0])).toEqual({
      mcpServers: {
        "bari-khata": {
          url: endpoint,
          headers: { Authorization: "Bearer one-time-private-key" },
        },
      },
    });
    expect(JSON.stringify(localStorage)).not.toContain("one-time-private-key");
    expect(JSON.stringify(sessionStorage)).not.toContain(
      "one-time-private-key",
    );
    await user.click(screen.getByRole("button", { name: "চাবি দেখান" }));
    expect((secretInput as HTMLInputElement).type).toBe("text");
    await user.click(screen.getByRole("button", { name: "চাবি আড়াল করুন" }));
    expect((secretInput as HTMLInputElement).type).toBe("password");
    await user.click(screen.getByRole("button", { name: "চাবি বন্ধ করুন" }));
    expect(screen.queryByDisplayValue("one-time-private-key")).toBeNull();
  });

  it("lets an owner revoke a connection and refreshes the list", async () => {
    api.connections.mockResolvedValueOnce({
      connections: [connection],
      endpoint,
      available: true,
    });
    const user = userEvent.setup();
    mount();
    await user.click(
      await screen.findByRole("button", { name: "অনুমতি বন্ধ করুন" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "এই সহকারীর অনুমতি বন্ধ করবেন?",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "অনুমতি বন্ধ করুন" }),
    );
    await waitFor(() =>
      expect(api.revoke).toHaveBeenCalledWith(api.owner, connection.id),
    );
    await waitFor(() => expect(screen.queryByText(connection.name)).toBeNull());
    expect(screen.getByRole("status").textContent).toContain(
      "সহকারীর অনুমতি বন্ধ হয়েছে",
    );
  });
  it("keeps connection permission details collapsed while revocation remains available", async () => {
    api.connections.mockResolvedValue({
      connections: [connection],
      endpoint,
      available: true,
    });
    const user = userEvent.setup();
    mount();
    const item = (await screen.findByText(connection.name)).closest("li")!;
    const summary = within(item).getByText("অনুমতি ও বিস্তারিত", {
      exact: true,
    });
    const details = summary.closest("details")!;
    expect(details.open).toBe(false);
    expect(
      within(item).getByRole("button", { name: "অনুমতি বন্ধ করুন" }),
    ).toBeTruthy();
    await user.click(summary);
    expect(details.open).toBe(true);
    expect(within(details).getByText(/হিসাব খোঁজা ও দেখা/)).toBeTruthy();
    expect(
      within(item).getByRole("button", { name: "অনুমতি বন্ধ করুন" }),
    ).toBeTruthy();
  });

  it("reviews a concrete proposal and sends approval for its ID", async () => {
    api.proposals.mockResolvedValueOnce({
      proposals: [
        {
          id: "proposal-one",
          status: "awaiting_approval",
          command: {
            type: "record_payment",
            amount_paisa: 600000,
            date: "2026-11-02",
            note: "আগের বাকি",
          },
        },
      ],
    });
    const user = userEvent.setup();
    mount();
    expect(await screen.findByText("৳6000")).toBeTruthy();
    expect(screen.getByText("আগের বাকি")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "মেনে নিই" }));
    await waitFor(() =>
      expect(api.approve).toHaveBeenCalledWith(api.owner, "proposal-one", true),
    );
  });

  it("keeps the sample informational and never reads personal connections or proposals", () => {
    api.mode = "demo";
    mount();
    expect(screen.getByText("নমুনায় সংযোগ দেওয়া যায় না")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "সহকারী যোগ করুন",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(api.connections).not.toHaveBeenCalled();
    expect(api.proposals).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("textbox", { name: "সংযোগের ঠিকানা" }),
    ).toBeNull();
  });

  it("does not allow approval when the server has no concrete command details", async () => {
    api.proposals.mockResolvedValueOnce({
      proposals: [{ id: "proposal-missing", status: "pending" }],
    });
    mount();
    const button = await screen.findByRole("button", { name: "মেনে নিই" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText(
        "এই প্রস্তাবের পুরো বিবরণ নেই। সহকারীকে নতুন করে দেখতে বলুন।",
      ),
    ).toBeTruthy();
    expect(api.approve).not.toHaveBeenCalled();
  });

  it("shows financial effects and keeps approved proposals pending assistant completion", async () => {
    api.proposals.mockResolvedValueOnce({
      proposals: [
        {
          id: "proposal-approved",
          status: "approved",
          actorName: "আমার সহকারী",
          command: { type: "record_payment", amount_paisa: 600000 },
          result: {
            before: {
              cost_paisa: 1000000,
              paid_paisa: 100000,
              payable_paisa: 900000,
              advance_paisa: 0,
            },
            after: {
              cost_paisa: 1000000,
              paid_paisa: 700000,
              payable_paisa: 300000,
              advance_paisa: 0,
            },
          },
        },
      ],
    });
    mount();
    expect(await screen.findByText("অনলাইনের হিসাবে যা বদলাবে")).toBeTruthy();
    expect(screen.getByRole("table").textContent).toContain("৳3000");
    expect(
      screen.getByText("আপনি মেনে নিয়েছেন। সহকারীর কাজ শেষ করার অপেক্ষায়।"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "মেনে নিই" })).toBeNull();
    expect(api.approve).not.toHaveBeenCalled();
  });

  it("does not expose a late-created key after the active account changes", async () => {
    let finish: (value: unknown) => void = () => {};
    api.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    const rendered = mount();
    await openKeySetup(user);
    await user.type(
      screen.getByRole("textbox", { name: "সহকারীর নাম" }),
      "আমার সহকারী",
    );
    await user.click(screen.getByRole("button", { name: "চাবি তৈরি করুন" }));
    api.owner = "00000000-0000-4000-8000-000000000002";
    rendered.rerender(
      <MemoryRouter>
        <AssistantSettingsPage />
      </MemoryRouter>,
    );
    finish({ connection, endpoint, token: "old-owner-private-key" });
    await waitFor(() =>
      expect(screen.queryByDisplayValue("old-owner-private-key")).toBeNull(),
    );
  });
});
