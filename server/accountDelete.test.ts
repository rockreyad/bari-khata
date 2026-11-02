import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  accountDeleteConfigured,
  createAccountDeleteHandler,
  type AccountDeleteBackend,
  type AccountDeleteConfig,
} from "./accountDelete";
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

const owner = "00000000-0000-4000-8000-000000000001";
const config: AccountDeleteConfig = {
  url: "https://db.example",
  serviceKey: "server-only",
  origin: "https://bari.example",
  vercel: true,
};
const getUser = vi.fn(),
  listReceipts = vi.fn(),
  removeReceipts = vi.fn(),
  deleteUser = vi.fn();
const backend: AccountDeleteBackend = {
  getUser,
  listReceipts,
  removeReceipts,
  deleteUser,
};
function request(
  body: unknown = { confirmation: "DELETE" },
  headers: Record<string, string | undefined> = {},
  options: { method?: string; url?: string; raw?: string } = {},
) {
  return new Request(options.url ?? `${config.origin}/api/account-delete`, {
    method: options.method ?? "POST",
    headers: {
      Origin: config.origin,
      Authorization: `Bearer ${"a".repeat(30)}`,
      "Content-Type": "application/json",
      ...Object.fromEntries(
        Object.entries(headers).filter(
          (item): item is [string, string] => item[1] !== undefined,
        ),
      ),
    },
    ...(options.method !== "GET"
      ? { body: options.raw ?? JSON.stringify(body) }
      : {}),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue(owner);
  listReceipts.mockResolvedValue([]);
  removeReceipts.mockResolvedValue(undefined);
  deleteUser.mockResolvedValue(undefined);
});
describe("self-account deletion", () => {
  it("uses only the verified bearer account, removes its nested receipts then deletes that account", async () => {
    listReceipts.mockImplementation(async (prefix: string) =>
      prefix === owner
        ? [
            { id: null, name: "entry" },
            { id: "file", name: "receipt.pdf" },
          ]
        : [{ id: "file2", name: "nested.jpg" }],
    );
    const response = await createAccountDeleteHandler(
      config,
      backend,
    )(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(listReceipts.mock.calls).toEqual([
      [owner, 0],
      [`${owner}/entry`, 0],
    ]);
    expect(removeReceipts).toHaveBeenCalledWith([
      `${owner}/receipt.pdf`,
      `${owner}/entry/nested.jpg`,
    ]);
    expect(deleteUser).toHaveBeenCalledExactlyOnceWith(owner);
    expect(removeReceipts.mock.invocationCallOrder[0]).toBeLessThan(
      deleteUser.mock.invocationCallOrder[0],
    );
  });
  it.each([
    { confirmation: "delete" },
    { confirmation: "DELETE", ownerId: "other" },
    { confirmation: "DELETE", token: "other" },
    null,
  ])(
    "rejects wrong confirmation or extra identity fields %#",
    async (fields) => {
      const result = await createAccountDeleteHandler(
        config,
        backend,
      )(request(fields));
      expect(result.status).toBe(400);
      expect(getUser).not.toHaveBeenCalled();
      expect(deleteUser).not.toHaveBeenCalled();
    },
  );
  it.each([
    { Authorization: "" },
    { Authorization: "Bearer short" },
    { Authorization: "Basic whatever" },
  ])("requires a bearer token %#", async (headers) => {
    expect(
      (
        await createAccountDeleteHandler(
          config,
          backend,
        )(request(undefined, headers))
      ).status,
    ).toBe(401);
    expect(deleteUser).not.toHaveBeenCalled();
  });
  it("checks the token with Auth before reading or deleting anything", async () => {
    getUser.mockResolvedValue(null);
    expect(
      (await createAccountDeleteHandler(config, backend)(request())).status,
    ).toBe(401);
    expect(listReceipts).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });
  it.each([
    { Origin: "https://evil.example" },
    { "Sec-Fetch-Site": "cross-site" },
    { Origin: "null" },
  ])("rejects cross-origin requests %#", async (headers) => {
    expect(
      (
        await createAccountDeleteHandler(
          config,
          backend,
        )(request(undefined, headers))
      ).status,
    ).toBe(403);
    expect(getUser).not.toHaveBeenCalled();
  });
  it("rejects another request host even with the approved Origin", async () => {
    expect(
      (
        await createAccountDeleteHandler(
          config,
          backend,
        )(
          request(
            undefined,
            {},
            { url: "https://evil.example/api/account-delete" },
          ),
        )
      ).status,
    ).toBe(403);
  });
  it("requires POST JSON with a small bounded body", async () => {
    const handler = createAccountDeleteHandler(config, backend);
    expect(
      (await handler(request(undefined, {}, { method: "GET" }))).status,
    ).toBe(405);
    expect(
      (await handler(request(undefined, { "Content-Type": "text/plain" })))
        .status,
    ).toBe(415);
    expect(
      (await handler(request(undefined, {}, { raw: "x".repeat(1025) }))).status,
    ).toBe(413);
    expect(getUser).not.toHaveBeenCalled();
  });
  it("does not delete the user when scoped receipt cleanup fails", async () => {
    listReceipts.mockResolvedValue([{ id: "one", name: "receipt.pdf" }]);
    removeReceipts.mockRejectedValue(new Error("private error details"));
    const result = await createAccountDeleteHandler(config, backend)(request());
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ error: "account_delete_failed" });
    expect(deleteUser).not.toHaveBeenCalled();
  });
  it("purges only the verified owner's assistant files before deleting the account", async () => {
    const cleanupAssistantFiles = vi.fn().mockResolvedValue(undefined);
    const response = await createAccountDeleteHandler(config, {
      ...backend,
      cleanupAssistantFiles,
    })(request());
    expect(response.status).toBe(200);
    expect(cleanupAssistantFiles).toHaveBeenCalledExactlyOnceWith(owner);
    expect(cleanupAssistantFiles.mock.invocationCallOrder[0]).toBeLessThan(
      deleteUser.mock.invocationCallOrder[0],
    );
  });
  it("retains the account for retry if assistant staging cleanup fails", async () => {
    const cleanupAssistantFiles = vi
      .fn()
      .mockRejectedValue(new Error("private storage error"));
    const response = await createAccountDeleteHandler(config, {
      ...backend,
      cleanupAssistantFiles,
    })(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "account_delete_failed" });
    expect(deleteUser).not.toHaveBeenCalled();
  });
  it("does not invoke either cleanup for an opaque MCP bearer rejected by Auth", async () => {
    const cleanupAssistantFiles = vi.fn();
    getUser.mockResolvedValue(null);
    const token = `bkm_p_${"A".repeat(43)}`;
    const response = await createAccountDeleteHandler(config, {
      ...backend,
      cleanupAssistantFiles,
    })(request(undefined, { Authorization: `Bearer ${token}` }));
    expect(response.status).toBe(401);
    expect(getUser).toHaveBeenCalledExactlyOnceWith(token);
    expect(listReceipts).not.toHaveBeenCalled();
    expect(cleanupAssistantFiles).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });
  it("keeps legacy account deletion available when the assistant staging bucket does not exist", async () => {
    const storageRemove = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createClient).mockReturnValue({
      auth: {
        getUser: async () => ({ data: { user: { id: owner } }, error: null }),
        admin: { deleteUser },
      },
      storage: {
        from: (bucket: string) => ({
          list: async () =>
            bucket === "bari-mcp-staging"
              ? {
                  data: null,
                  error: { message: "Bucket not found", statusCode: "404" },
                }
              : { data: [], error: null },
          remove: storageRemove,
        }),
      },
    } as unknown as ReturnType<typeof createClient>);
    deleteUser.mockResolvedValue({ error: null });
    const response = await createAccountDeleteHandler(config)(request());
    expect(response.status).toBe(200);
    expect(storageRemove).not.toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledExactlyOnceWith(owner);
  });
  it("rejects unsafe storage names before removing any object", async () => {
    listReceipts.mockResolvedValue([
      { id: "one", name: "../another-owner/receipt.pdf" },
    ]);
    expect(
      (await createAccountDeleteHandler(config, backend)(request())).status,
    ).toBe(503);
    expect(removeReceipts).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });
  it("loads later storage pages before removing objects and batches deletion", async () => {
    listReceipts.mockImplementation(async (_prefix: string, offset: number) =>
      offset === 0
        ? Array.from({ length: 100 }, (_, n) => ({
            name: `${n}.pdf`,
            id: `${n}`,
          }))
        : [{ name: "last.pdf", id: "last" }],
    );
    const response = await createAccountDeleteHandler(
      config,
      backend,
    )(request());
    expect(response.status).toBe(200);
    expect(listReceipts.mock.calls).toEqual([
      [owner, 0],
      [owner, 100],
    ]);
    expect(removeReceipts.mock.calls.map(([paths]) => paths.length)).toEqual([
      100, 1,
    ]);
  });
  it("never enables a local handler against a remote database", () => {
    expect(
      accountDeleteConfigured({
        ...config,
        local: true,
        vercel: false,
        origin: "http://localhost:5180",
      }),
    ).toBe(false);
    expect(
      accountDeleteConfigured({
        ...config,
        local: true,
        vercel: false,
        origin: "http://localhost:5180",
        url: "http://127.0.0.1:55431",
      }),
    ).toBe(true);
    expect(accountDeleteConfigured({ ...config, vercel: false })).toBe(false);
    expect(accountDeleteConfigured({ ...config, serviceKey: "" })).toBe(false);
  });
});
