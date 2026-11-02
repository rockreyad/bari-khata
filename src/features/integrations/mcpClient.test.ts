import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  approveAssistantAuthorization,
  createAssistantConnection,
  loadAssistantConnections,
} from "./mcpClient";

const api = vi.hoisted(() => ({
  owner: "00000000-0000-4000-8000-000000000001" as string | null,
  session: vi.fn(),
}));
vi.mock("../../data/sync", () => ({ getCloudSession: api.session }));
vi.mock("../../data/database", () => ({ getActiveOwner: () => api.owner }));
const fetcher = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  api.owner = "00000000-0000-4000-8000-000000000001";
  api.session.mockResolvedValue({
    access_token: "first-party-session",
    user: { id: api.owner },
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => vi.unstubAllGlobals());
describe("assistant administration API client", () => {
  it("sends first-party auth without caching and verifies response data", async () => {
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({
          available: true,
          endpoint: "https://app.example/api/mcp",
          connections: [],
        }),
      ),
    );
    await expect(loadAssistantConnections(api.owner!)).resolves.toEqual({
      available: true,
      endpoint: "https://app.example/api/mcp",
      connections: [],
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/mcp-admin?resource=connections",
      expect.objectContaining({
        cache: "no-store",
        headers: { Authorization: "Bearer first-party-session" },
      }),
    );
  });
  it("rejects a changed owner before sending a request", async () => {
    api.session.mockResolvedValue({
      access_token: "different-owner-token",
      user: { id: "different-owner" },
    });
    await expect(loadAssistantConnections(api.owner!)).rejects.toThrow(
      "sign_in_required",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not accept a secret from a response with an unsafe endpoint", async () => {
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({
          connection: {
            id: "one",
            name: "Assistant",
            scopes: ["ledger:read"],
            policy: {},
          },
          token: "secret",
          endpoint: "javascript:alert(1)",
        }),
      ),
    );
    await expect(
      createAssistantConnection(api.owner!, {
        name: "Assistant",
        scopes: ["ledger:read"],
        policy: {},
      }),
    ).rejects.toThrow("assistant_invalid_response");
  });
  it("rejects unsafe authorization redirects", async () => {
    fetcher.mockResolvedValue(
      new Response(JSON.stringify({ redirectUrl: "javascript:alert(1)" })),
    );
    await expect(
      approveAssistantAuthorization(api.owner!, {
        requestId: "request",
        approve: true,
        name: "Assistant",
        scopes: ["ledger:read"],
        policy: {},
      }),
    ).rejects.toThrow("assistant_invalid_response");
  });
  it("rejects a response if the account changes while its body is being read", async () => {
    const firstOwner = api.owner!;
    fetcher.mockResolvedValue({
      ok: true,
      json: async () => {
        api.owner = "00000000-0000-4000-8000-000000000002";
        return {
          available: true,
          connections: [],
          endpoint: "https://app.example/api/mcp",
        };
      },
    });
    await expect(loadAssistantConnections(firstOwner)).rejects.toThrow(
      "account_changed",
    );
  });
});
