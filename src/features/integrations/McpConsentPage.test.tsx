// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { McpConsentPage } from "./McpConsentPage";
import { integrationsEnglish } from "./integrationsEnglish";

const api = vi.hoisted(() => ({
  owner: "00000000-0000-4000-8000-000000000001" as string | null,
  status: "signed-in",
  language: "bn",
  load: vi.fn(),
  approve: vi.fn(),
}));
vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({
    status: api.status,
    user: api.owner ? { id: api.owner, email: "owner@example.test" } : null,
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
    money: String,
  }),
}));
vi.mock("./mcpClient", async (original) => ({
  ...(await original<typeof import("./mcpClient")>()),
  loadAssistantAuthorization: api.load,
  approveAssistantAuthorization: api.approve,
}));
function LoginDestination() {
  const location = useLocation();
  return <output>{JSON.stringify(location.state)}</output>;
}
const requestId = "00000000-0000-4000-8000-000000000003";
const callback = "https://assistant.example/callback?code=opaque-code";
function mount(redirect = vi.fn(), path = `/mcp/consent?request=${requestId}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/mcp/consent"
          element={<McpConsentPage onRedirect={redirect} />}
        />
        <Route path="/login" element={<LoginDestination />} />
      </Routes>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  api.owner = "00000000-0000-4000-8000-000000000001";
  api.status = "signed-in";
  api.language = "bn";
  api.load.mockResolvedValue({
    authorization: {
      requestId,
      clientName: "My personal assistant",
      redirectUri: "https://assistant.example/callback",
      scopes: ["ledger:read", "entries:create"],
    },
  });
  api.approve.mockResolvedValue({ redirectUrl: callback });
});
afterEach(cleanup);

describe("MCP consent", () => {
  it("preserves the full consent request when sign-in is needed", async () => {
    api.owner = null;
    api.status = "signed-out";
    mount();
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        `/mcp/consent?request=${requestId}`,
      ),
    );
    expect(api.load).not.toHaveBeenCalled();
  });
  it("lets an owner reduce requested scopes and then returns to the registered client", async () => {
    const user = userEvent.setup();
    const redirect = vi.fn();
    mount(redirect);
    expect(
      await screen.findByRole("heading", { name: "My personal assistant" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("checkbox", { name: "আগের হিসাব সংশোধন" }),
    ).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "নতুন হিসাব রাখা" }));
    await user.click(
      screen.getByRole("button", { name: "অনুমতি দিয়ে যুক্ত করুন" }),
    );
    await waitFor(() =>
      expect(api.approve).toHaveBeenCalledWith(api.owner, {
        requestId,
        approve: true,
        name: "My personal assistant",
        scopes: ["ledger:read"],
        policy: { confirmationRequired: false, maxAmountPaisa: null },
      }),
    );
    expect(redirect).toHaveBeenCalledWith(callback);
  });
  it("returns a denied authorization without granting any scopes", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(
      await screen.findByRole("button", { name: "অনুমতি দেব না" }),
    );
    await waitFor(() =>
      expect(api.approve).toHaveBeenCalledWith(
        api.owner,
        expect.objectContaining({ requestId, approve: false, scopes: [] }),
      ),
    );
  });
  it("submits rapid clicks once and keeps the completed decision locked until navigation", async () => {
    let finish!: (result: { redirectUrl: string }) => void;
    api.approve.mockReturnValue(
      new Promise<{ redirectUrl: string }>((resolve) => {
        finish = resolve;
      }),
    );
    const redirect = vi.fn();
    mount(redirect);
    const allow = await screen.findByRole("button", {
      name: "অনুমতি দিয়ে যুক্ত করুন",
    });
    act(() => {
      fireEvent.click(allow);
      fireEvent.click(allow);
    });
    expect(api.approve).toHaveBeenCalledTimes(1);
    expect((allow as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish({ redirectUrl: callback }));
    expect(
      screen.getByRole("heading", { name: "অনুমতি দেওয়া হয়েছে" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "অনুমতি দিয়ে যুক্ত করুন" }),
    ).toBeNull();
    expect(
      screen.queryByRole("checkbox", { name: "নতুন হিসাব রাখা" }),
    ).toBeNull();
    expect(screen.getByRole("status").textContent).toContain(
      "এই অনুরোধে আর অনুমতি দিতে হবে না।",
    );
    fireEvent.click(screen.getByRole("button", { name: "সহকারীতে ফিরে যান" }));
    expect(redirect).toHaveBeenCalledTimes(2);
    expect(api.approve).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("opaque-code");
  });
  it("retries the handoff without granting access again if browser navigation fails", async () => {
    const user = userEvent.setup();
    const redirect = vi.fn().mockImplementationOnce(() => {
      throw new Error("navigation blocked");
    });
    mount(redirect);
    await user.click(
      await screen.findByRole("button", { name: "অনুমতি দিয়ে যুক্ত করুন" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "অনুমতির সিদ্ধান্ত রাখা হয়েছে",
    );
    expect(
      screen.getByRole("heading", { name: "অনুমতি দেওয়া হয়েছে" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "সহকারীতে ফিরে যান" }));
    expect(redirect).toHaveBeenCalledTimes(2);
    expect(api.approve).toHaveBeenCalledTimes(1);
  });
  it("allows retry after a failed approval without losing the selected permissions", async () => {
    const user = userEvent.setup();
    api.approve.mockRejectedValueOnce(new Error("temporarily_unavailable"));
    mount();
    await user.click(
      await screen.findByRole("checkbox", { name: "নতুন হিসাব রাখা" }),
    );
    await user.click(
      screen.getByRole("button", { name: "অনুমতি দিয়ে যুক্ত করুন" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "সংযোগ দেওয়া যায়নি",
    );
    await user.click(
      screen.getByRole("button", { name: "অনুমতি দিয়ে যুক্ত করুন" }),
    );
    await screen.findByRole("heading", { name: "অনুমতি দেওয়া হয়েছে" });
    expect(api.approve).toHaveBeenCalledTimes(2);
    expect(api.approve.mock.calls[1][1].scopes).toEqual(["ledger:read"]);
  });
  it("shows translated consent and saved-decision feedback in English during handoff", async () => {
    const user = userEvent.setup();
    api.language = "en";
    const redirect = vi.fn().mockImplementationOnce(() => {
      throw new Error("navigation blocked");
    });
    mount(redirect);
    expect(
      await screen.findByRole("heading", {
        name: "Connect your assistant to your notebook",
      }),
    ).toBeTruthy();
    expect(screen.getByText("Your notebook, your permissions")).toBeTruthy();
    expect(screen.getByText("MCP connection")).toBeTruthy();
    expect(
      screen.getByText(
        "The assistant will show the connection result on its own page at the final step.",
      ),
    ).toBeTruthy();
    await user.click(
      await screen.findByRole("button", { name: "Allow and connect" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Access granted" }),
    ).toBeTruthy();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Your access decision is saved. Use the button below to return to your assistant.",
    );
    expect(screen.getByRole("status").textContent).toContain(
      "You do not need to approve this request again.",
    );
    await user.click(
      screen.getByRole("button", { name: "Return to assistant" }),
    );
    expect(api.approve).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledTimes(2);
  });
  it("brings invalid amount feedback above the permissions without losing the entered limit", async () => {
    const user = userEvent.setup();
    const redirect = vi.fn();
    mount(redirect);
    const limit = await screen.findByRole("textbox", {
      name: "একবারে সর্বোচ্চ টাকা",
    });
    await user.type(limit, "0");
    await user.click(
      screen.getByRole("button", { name: "অনুমতি দিয়ে যুক্ত করুন" }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("টাকার সীমায় সঠিক অঙ্ক লিখুন।");
    expect(document.activeElement).toBe(alert);
    expect(
      alert.compareDocumentPosition(limit) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect((limit as HTMLInputElement).value).toBe("0");
    expect(api.approve).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
  it("does not query the API when the authorization request is missing", () => {
    mount(vi.fn(), "/mcp/consent");
    expect(screen.getByRole("alert").textContent).toContain(
      "সংযোগের অনুরোধ নেই",
    );
    expect(api.load).not.toHaveBeenCalled();
  });
});
