import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  approveAssistantAuthorization,
  assistantInstallCommand,
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
  it("installs the OAuth server without starting a second login", () => {
    expect(assistantInstallCommand("https://app.example/api/mcp")).toBe(
      "codex mcp add bari-khata --url 'https://app.example/api/mcp'",
    );
  });
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
  it("normalizes connection timestamp aliases without inventing activity", async () => {
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({
          connections: [
            {
              id: "legacy",
              name: "Assistant",
              scopes: ["ledger:read"],
              created_at: "2026-11-04T09:30:00+06:00",
              last_used_at: "2026-11-04T04:15:01.123456+00:00",
              revoked_at: null,
              expires_at: "2026-12-04T00:00:00Z",
            },
            {
              id: "unknown-activity",
              name: "Older assistant",
              scopes: ["ledger:read"],
              createdAt: "2026-11-02T00:00:00Z",
              lastUsedAt: null,
            },
            {
              id: "missing-activity",
              name: "Old client",
              scopes: ["ledger:read"],
            },
          ],
        }),
      ),
    );
    const { connections } = await loadAssistantConnections(api.owner!);
    expect(connections[0]).toMatchObject({
      createdAt: "2026-11-04T09:30:00+06:00",
      lastUsedAt: "2026-11-04T04:15:01.123456+00:00",
      revokedAt: null,
      expiresAt: "2026-12-04T00:00:00Z",
    });
    expect(connections[1].lastUsedAt).toBeNull();
    expect(connections[2].lastUsedAt).toBeUndefined();
  });
  it("accepts aliases that identify the same instant in different offsets", async () => {
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({
          connections: [
            {
              id: "one",
              name: "Assistant",
              scopes: ["ledger:read"],
              createdAt: "2026-11-04T09:30:00+06:00",
              created_at: "2026-11-04T03:30:00Z",
              lastUsedAt: null,
              last_used_at: null,
            },
          ],
        }),
      ),
    );
    const { connections } = await loadAssistantConnections(api.owner!);
    expect(connections[0]).toMatchObject({
      createdAt: "2026-11-04T09:30:00+06:00",
      lastUsedAt: null,
    });
  });
  it.each([
    ["createdAt", "created_at"],
    ["revokedAt", "revoked_at"],
    ["lastUsedAt", "last_used_at"],
    ["expiresAt", "expires_at"],
  ])("rejects conflicting %s aliases", async (field, alias) => {
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({
          connections: [
            {
              id: "one",
              name: "Assistant",
              scopes: ["ledger:read"],
              [field]: "2026-11-04T03:30:00Z",
              [alias]: "2026-11-04T03:31:00Z",
            },
          ],
        }),
      ),
    );
    await expect(loadAssistantConnections(api.owner!)).rejects.toThrow(
      "assistant_invalid_response",
    );
  });
  it.each([
    [null, "2026-11-04T03:30:00Z"],
    ["2026-11-04T03:30:00Z", null],
  ])(
    "rejects contradictory revocation nullness",
    async (revokedAt, revoked_at) => {
      fetcher.mockResolvedValue(
        new Response(
          JSON.stringify({
            connections: [
              {
                id: "one",
                name: "Assistant",
                scopes: ["ledger:read"],
                revokedAt,
                revoked_at,
              },
            ],
          }),
        ),
      );
      await expect(loadAssistantConnections(api.owner!)).rejects.toThrow(
        "assistant_invalid_response",
      );
    },
  );
  it.each([
    "createdAt",
    "created_at",
    "lastUsedAt",
    "last_used_at",
    "revokedAt",
    "revoked_at",
    "expiresAt",
    "expires_at",
  ])("rejects malformed %s connection metadata", async (field) => {
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({
          connections: [
            {
              id: "one",
              name: "Assistant",
              scopes: ["ledger:read"],
              [field]: "not-a-timestamp",
            },
          ],
        }),
      ),
    );
    await expect(loadAssistantConnections(api.owner!)).rejects.toThrow(
      "assistant_invalid_response",
    );
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
