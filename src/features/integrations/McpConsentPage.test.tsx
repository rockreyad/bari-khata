// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { McpConsentPage } from "./McpConsentPage";

const api = vi.hoisted(() => ({
  owner: "00000000-0000-4000-8000-000000000001" as string | null,
  status: "signed-in",
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
      text.replace(/{{(\w+)}}/g, (_, key: string) => String(values[key] ?? "")),
    number: String,
    formatDigits: String,
    language: "bn",
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
