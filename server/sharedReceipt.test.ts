import { beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  createSharedReceiptHandler,
  SHARED_RECEIPT_LIMIT,
  type SharedReceiptBackend,
  type SharedReceiptConfig,
} from "./sharedReceipt";
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
const config: SharedReceiptConfig = {
  url: "https://db.example",
  origin: "https://bari.example",
  serviceKey: "server-only",
  vercel: true,
};
const input = {
  token: "a".repeat(64),
  entryId: "sample-entry",
  receiptId: "sample-receipt",
  revision: 7,
};
const payload = new TextEncoder().encode("%PDF-sample voucher");
const metadata = {
  storagePath: "00000000-0000-4000-8000-000000000001/sample-receipt",
  id: input.receiptId,
  name: "নমুনা.pdf",
  mime: "application/pdf",
  size: payload.length,
};
const authorize = vi.fn(),
  download = vi.fn();
const backend: SharedReceiptBackend = { authorize, download };
function request(
  body: unknown = input,
  headers: Record<string, string> = {},
  options: { method?: string; signal?: AbortSignal; raw?: string } = {},
) {
  return new Request(`${config.origin}/api/shared-receipt`, {
    method: options.method ?? "POST",
    signal: options.signal,
    headers: {
      Origin: config.origin,
      "Content-Type": "application/json",
      ...headers,
    },
    ...(options.method === "GET"
      ? {}
      : { body: options.raw ?? JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  authorize.mockResolvedValue(metadata);
  download.mockImplementation(
    async () =>
      new Response(payload, { headers: { "Content-Type": "application/pdf" } }),
  );
});
it("authorizes the exact capability, streams its private receipt and rechecks authorization before release", async () => {
  const response = await createSharedReceiptHandler(config, backend)(request());
  expect(response.status).toBe(200);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(payload);
  expect(authorize).toHaveBeenCalledTimes(2);
  expect(authorize.mock.calls[0][0]).toEqual(input);
  expect(download).toHaveBeenCalledExactlyOnceWith(
    metadata.storagePath,
    expect.any(AbortSignal),
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("cross-origin-resource-policy")).toBe(
    "same-origin",
  );
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect([...response.headers].join()).not.toContain(input.token);
  expect([...response.headers].join()).not.toContain("00000000-0000");
});
it.each(["wrong-person-entry", "wrong-work-entry", "wrong-receipt", "revoked"])(
  "does not access storage when capability authorization denies %s",
  async (reason) => {
    authorize.mockResolvedValue(null);
    const response = await createSharedReceiptHandler(
      config,
      backend,
    )(
      request({
        ...input,
        ...(reason === "wrong-receipt"
          ? { receiptId: "other-receipt" }
          : { entryId: reason }),
      }),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "share_unavailable" });
    expect(download).not.toHaveBeenCalled();
  },
);
it("rejects a stale revision before reading storage", async () => {
  authorize.mockRejectedValue(new Error("share_changed"));
  const response = await createSharedReceiptHandler(config, backend)(request());
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "share_changed" });
  expect(download).not.toHaveBeenCalled();
});
it.each([null, "stale"])(
  "does not release bytes when authorization changes while the file is read: %s",
  async (value) => {
    authorize.mockResolvedValueOnce(metadata);
    if (value === null) authorize.mockResolvedValueOnce(null);
    else authorize.mockRejectedValueOnce(new Error("share_changed"));
    const response = await createSharedReceiptHandler(
      config,
      backend,
    )(request());
    expect(response.status).toBe(value === null ? 404 : 409);
    expect(await response.text()).not.toContain("%PDF");
  },
);
it.each([
  { ...input, ownerId: "other" },
  { ...input, token: "short" },
  { ...input, revision: 0 },
  { ...input, receiptId: "" },
])("rejects malformed or extra identity fields %#", async (body) => {
  expect(
    (await createSharedReceiptHandler(config, backend)(request(body))).status,
  ).toBe(400);
  expect(authorize).not.toHaveBeenCalled();
});
it.each([
  { Origin: "https://evil.example" },
  { "Sec-Fetch-Site": "cross-site" },
] as Record<string, string>[])(
  "rejects a different request origin %#",
  async (headers) => {
    expect(
      (
        await createSharedReceiptHandler(
          config,
          backend,
        )(request(input, headers))
      ).status,
    ).toBe(403);
    expect(authorize).not.toHaveBeenCalled();
  },
);
it("requires POST JSON and bounds request bytes before authorization", async () => {
  const handler = createSharedReceiptHandler(config, backend);
  expect((await handler(request(input, {}, { method: "GET" }))).status).toBe(
    405,
  );
  expect(
    (await handler(request(input, { "Content-Type": "text/plain" }))).status,
  ).toBe(415);
  expect(
    (await handler(request(input, {}, { raw: "x".repeat(1025) }))).status,
  ).toBe(413);
  expect(authorize).not.toHaveBeenCalled();
});
it.each([
  { storagePath: "../sample-receipt" },
  { storagePath: "00000000-0000-4000-8000-000000000001/other" },
  { id: "other" },
  { mime: "text/html" },
])("refuses contradictory or unsafe backend metadata %#", async (change) => {
  authorize.mockResolvedValue({ ...metadata, ...change });
  expect(
    (await createSharedReceiptHandler(config, backend)(request())).status,
  ).toBe(502);
  expect(download).not.toHaveBeenCalled();
});
it("rejects a legacy oversized receipt before storage and caps a dishonest streaming response", async () => {
  authorize.mockResolvedValueOnce({
    ...metadata,
    size: SHARED_RECEIPT_LIMIT + 1,
  });
  const handler = createSharedReceiptHandler(config, backend);
  expect((await handler(request())).status).toBe(413);
  expect(download).not.toHaveBeenCalled();
  const cancel = vi.fn();
  download.mockResolvedValueOnce(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(SHARED_RECEIPT_LIMIT));
          controller.enqueue(new Uint8Array(1));
        },
        cancel,
      }),
      { headers: { "Content-Type": "application/pdf" } },
    ),
  );
  expect((await handler(request())).status).toBe(413);
  expect(cancel).toHaveBeenCalledOnce();
});
it.each(["mime", "signature", "size"])(
  "rejects a mismatched file %s",
  async (change) => {
    if (change === "mime")
      download.mockResolvedValueOnce(
        new Response(payload, { headers: { "Content-Type": "text/html" } }),
      );
    if (change === "signature")
      download.mockResolvedValueOnce(
        new Response(new Uint8Array(payload.length), {
          headers: { "Content-Type": "application/pdf" },
        }),
      );
    if (change === "size")
      download.mockResolvedValueOnce(
        new Response(payload.slice(1), {
          headers: { "Content-Type": "application/pdf" },
        }),
      );
    expect(
      (await createSharedReceiptHandler(config, backend)(request())).status,
    ).toBe(502);
  },
);
it("does not read or release a receipt after cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  expect(
    (
      await createSharedReceiptHandler(
        config,
        backend,
      )(request(input, {}, { signal: controller.signal }))
    ).status,
  ).toBe(499);
  expect(authorize).not.toHaveBeenCalled();
  const second = new AbortController();
  download.mockImplementationOnce(async () => {
    second.abort();
    return new Response(payload, {
      headers: { "Content-Type": "application/pdf" },
    });
  });
  expect(
    (
      await createSharedReceiptHandler(
        config,
        backend,
      )(request(input, {}, { signal: second.signal }))
    ).status,
  ).toBe(499);
});
it("uses only server credentials and the fixed private bucket after service-role authorization", async () => {
  const rpc = vi.fn().mockReturnValue({
    abortSignal: vi.fn().mockResolvedValue({ data: metadata, error: null }),
  });
  vi.mocked(createClient).mockReturnValue({ rpc } as unknown as ReturnType<
    typeof createClient
  >);
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(payload, { headers: { "Content-Type": "application/pdf" } }),
    );
  vi.stubGlobal("fetch", fetcher);
  try {
    expect((await createSharedReceiptHandler(config)(request())).status).toBe(
      200,
    );
    expect(rpc).toHaveBeenCalledWith("contact_share_receipt_authorization", {
      p_token: input.token,
      p_entry_id: input.entryId,
      p_receipt_id: input.receiptId,
      p_revision: input.revision,
    });
    expect(String(fetcher.mock.calls[0][0])).toBe(
      `https://db.example/storage/v1/object/authenticated/bari-receipts/${metadata.storagePath}`,
    );
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      headers: { apikey: "server-only", Authorization: "Bearer server-only" },
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
