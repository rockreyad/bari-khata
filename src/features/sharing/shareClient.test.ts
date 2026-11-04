import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SHARED_PAGE_SIZE,
  SharedStatementSchema,
  validateSharedPage,
  type SharedStatement,
} from "./shareModel";

const owner = vi.hoisted(() => ({ session: vi.fn(), id: vi.fn() }));
vi.mock("../../data/sync", () => ({ getCloudSession: owner.session }));
vi.mock("../../data/database", () => ({ getActiveOwner: owner.id }));

const token = "a".repeat(64);
function page(count = SHARED_PAGE_SIZE, total = 25, offset = 0) {
  return SharedStatementSchema.parse({
    person: { name: "নমুনা দোকান", role: "দোকান", kind: "shop" },
    projectName: "নমুনা বাড়ি",
    account: "materials",
    workName: "নমুনা খাতা",
    updatedAt: "2026-11-04T10:00:00Z",
    revision: 7,
    total,
    nextOffset: offset + count < total ? offset + count : null,
    totals: {
      cost: 2500,
      paid: 0,
      payable: 2500,
      advance: 0,
      historicalCost: 0,
    },
    rows: Array.from({ length: count }, (_, index) => ({
      key: `bill-${offset + index}`,
      date: "2026-11-04",
      kind: "expense",
      historical: false,
      charge: 100,
      paid: 0,
      description: "নমুনা মাল",
      works: "নমুনা খাতা",
    })),
  });
}

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://share-test.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public-test-anon-key");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockResolvedValue(
    new Response(JSON.stringify(page()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  owner.id.mockReset().mockReturnValue("signed-in-owner");
  owner.session.mockReset().mockResolvedValue({ access_token: "owner-secret" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("public shared statement client", () => {
  it("sends a scoped server query without putting private search text in the URL", async () => {
    const { readShare } = await import("./shareClient");
    await readShare(token, 0, undefined, undefined, { query: "সিমেন্ট" });
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("সিমেন্ট");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      p_query: "সিমেন্ট",
      p_limit: 20,
    });
    await expect(
      readShare(token, 0, undefined, undefined, { query: "a".repeat(201) }),
    ).rejects.toThrow("share_invalid_page");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("requests only twenty rows without owner authentication, cookies or response caching", async () => {
    const { readShare, liveShareUrl } = await import("./shareClient");
    const result = await readShare(token);
    expect(result?.rows).toHaveLength(20);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [input, init] = fetchMock.mock.calls[0];
    const url = new URL(String(input));
    expect(url.pathname).toBe("/rest/v1/rpc/search_contact_share");
    expect(url.href).not.toContain(token);
    expect(JSON.parse(String(init?.body))).toEqual({
      p_token: token,
      p_offset: 0,
      p_limit: 20,
      p_revision: null,
      p_query: "",
    });
    expect(init).toMatchObject({ cache: "no-store", credentials: "omit" });
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer public-test-anon-key",
    );
    expect(owner.session).not.toHaveBeenCalled();
    expect(owner.id).not.toHaveBeenCalled();
    const link = new URL(liveShareUrl(token, "https://example.test"));
    expect(link.pathname).toBe("/shared");
    expect(link.search).toBe("");
    expect(link.hash).toBe(`#${token}`);
  });

  it("pins the requested revision and kind without changing the anonymous request", async () => {
    const filtered = page(5, 5);
    filtered.rows = filtered.rows.map((row) => ({
      ...row,
      kind: "payment",
      charge: 0,
      paid: 100,
    }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(filtered)));
    const { readShare } = await import("./shareClient");
    expect(await readShare(token, 0, 7, "payment")).toEqual(filtered);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      p_revision: 7,
      p_kind: "payment",
      p_limit: SHARED_PAGE_SIZE,
    });
  });

  it("passes cancellation into the actual request and rejects an aborted response", async () => {
    let requestSignal: AbortSignal | null | undefined;
    fetchMock.mockImplementationOnce(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          requestSignal = init?.signal;
          requestSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const { readShare } = await import("./shareClient");
    const controller = new AbortController();
    const request = readShare(token, 0, undefined, undefined, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(requestSignal).toBe(controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not start a request for an already aborted signal or invalid token", async () => {
    const { readShare } = await import("./shareClient");
    const controller = new AbortController();
    controller.abort();
    await expect(
      readShare(token, 0, undefined, undefined, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await readShare("not-a-share-token")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a server response that ignores the requested page boundary", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(page(21, 25))));
    const { readShare } = await import("./shareClient");
    await expect(readShare(token)).rejects.toThrow("share_invalid_page");
  });

  it("keeps revocation and revision changes distinct from other failures", async () => {
    fetchMock.mockResolvedValueOnce(new Response("null")).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: "P0001", message: "share_changed" }),
        {
          status: 400,
        },
      ),
    );
    const { readShare } = await import("./shareClient");
    expect(await readShare(token)).toBeNull();
    await expect(readShare(token, 20, 7)).rejects.toThrow("share_changed");
  });
});

function detail() {
  return {
    ...page(1, 1).rows[0],
    revision: 7,
    note: "নমুনা নোট",
    paymentParts: [],
    paymentMethods: ["cash"],
    lines: [{ label: "নমুনা মাল", amount: 100, workName: "নমুনা খাতা" }],
    receipts: [
      { id: "receipt", name: "ভাউচার.pdf", mime: "application/pdf", size: 8 },
    ],
  };
}
describe("capability entry details and receipts", () => {
  it("validates exact entry and revision and only exposes public detail fields", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ...detail(), source: "private", ownerId: "private" }),
      ),
    );
    const { readSharedEntry } = await import("./shareClient");
    const result = await readSharedEntry(token, "bill-0", 7);
    expect(result).toEqual(detail());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      p_token: token,
      p_entry_id: "bill-0",
      p_revision: 7,
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "read_contact_share_entry",
    );
    expect(String(fetchMock.mock.calls[0][0])).not.toContain(token);
    expect(owner.session).not.toHaveBeenCalled();
  });
  it("rejects another entry or revision and unsafe metadata", async () => {
    const { readSharedEntry } = await import("./shareClient");
    for (const [change, error] of [
      [{ key: "other" }, "share_invalid_page"],
      [{ revision: 8 }, "share_changed"],
      [{ receipts: [{ ...detail().receipts[0], mime: "text/html" }] }, ""],
    ] as const) {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ ...detail(), ...change })),
      );
      await expect(readSharedEntry(token, "bill-0", 7)).rejects.toThrow(error);
    }
  });
  it("accepts privacy-redacted partial-work details without inventing global notes, methods or receipts", async () => {
    const partial = {
      ...detail(),
      note: "",
      paymentMethods: [],
      receipts: [],
      paymentParts: [],
    };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(partial)));
    const { readSharedEntry } = await import("./shareClient");
    expect(await readSharedEntry(token, "bill-0", 7)).toEqual(partial);
  });
  it("downloads a receipt by anonymous POST with body-only capability and bounded allowed binary", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("%PDF-1.7", {
        headers: { "Content-Type": "application/pdf", "Content-Length": "8" },
      }),
    );
    const { readSharedReceipt } = await import("./shareClient");
    const blob = await readSharedReceipt(token, "bill-0", "receipt", 7);
    expect(await blob.text()).toBe("%PDF-1.7");
    expect(blob.type).toBe("application/pdf");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/shared-receipt");
    expect(init).toMatchObject({
      method: "POST",
      cache: "no-store",
      credentials: "omit",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      token,
      entryId: "bill-0",
      receiptId: "receipt",
      revision: 7,
    });
    expect(new Headers(init?.headers).get("Authorization")).toBeNull();
  });
  it.each([
    [404, "share_unavailable"],
    [409, "share_changed"],
    [413, "share_receipt_too_large"],
    [502, "share_receipt_failed"],
    [503, "share_receipt_failed"],
  ])("handles receipt status %i", async (status, error) => {
    fetchMock.mockResolvedValueOnce(
      new Response("{}", { status: Number(status) }),
    );
    const { readSharedReceipt } = await import("./shareClient");
    await expect(
      readSharedReceipt(token, "bill-0", "receipt", 7),
    ).rejects.toThrow(String(error));
  });
  it("rejects unsafe MIME and declared oversize receipts before consuming their body", async () => {
    const { readSharedReceipt } = await import("./shareClient");
    fetchMock.mockResolvedValueOnce(
      new Response("<html>", { headers: { "Content-Type": "text/html" } }),
    );
    await expect(
      readSharedReceipt(token, "bill-0", "receipt", 7),
    ).rejects.toThrow("share_receipt_failed");
    fetchMock.mockResolvedValueOnce(
      new Response("x", {
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(10 * 1024 * 1024 + 1),
        },
      }),
    );
    await expect(
      readSharedReceipt(token, "bill-0", "receipt", 7),
    ).rejects.toThrow("share_receipt_too_large");
  });
  it("cancels an oversized stream even when no content length was supplied", async () => {
    const cancel = vi.fn();
    const chunk = new Uint8Array(6 * 1024 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
      },
      cancel,
    });
    fetchMock.mockResolvedValueOnce(
      new Response(stream, { headers: { "Content-Type": "image/png" } }),
    );
    const { readSharedReceipt } = await import("./shareClient");
    await expect(
      readSharedReceipt(token, "bill-0", "receipt", 7),
    ).rejects.toThrow("share_receipt_too_large");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("cancels receipt streaming immediately when its viewer closes", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    fetchMock.mockResolvedValueOnce(
      new Response(stream, { headers: { "Content-Type": "application/pdf" } }),
    );
    const { readSharedReceipt } = await import("./shareClient");
    const controller = new AbortController();
    const pending = readSharedReceipt(token, "bill-0", "receipt", 7, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(stream.locked).toBe(true));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });
});

describe("shared page validation", () => {
  it("accepts initial, final and empty complete pages while preserving optional legacy fields", () => {
    const initial = page();
    expect(validateSharedPage(initial, 0, 7, "expense")).toBe(initial);
    expect(validateSharedPage(page(5, 25, 20), 20, 7).nextOffset).toBeNull();
    expect(validateSharedPage(page(0, 0), 0).rows).toEqual([]);
    expect(initial.totals.adjustment).toBeUndefined();
    expect(initial.rows[0].adjustmentBasis).toBeUndefined();
  });

  it.each([
    ["skipped offset", { nextOffset: 21 }],
    ["repeated offset", { nextOffset: 0 }],
    ["missing continuation", { nextOffset: null }],
    ["empty nonterminal page", { rows: [], nextOffset: 20 }],
    ["more than requested", { rows: page(21, 25).rows, nextOffset: 21 }],
    [
      "duplicate row keys",
      { rows: [page().rows[0], page().rows[0]], nextOffset: 2 },
    ],
    [
      "empty row key",
      { rows: [{ ...page().rows[0], key: "" }], nextOffset: 1 },
    ],
    ["rows beyond total", { total: 19, nextOffset: null }],
    ["extra continuation", { total: 20, nextOffset: 20 }],
  ])("rejects %s", (_name, changes) => {
    expect(() =>
      validateSharedPage({ ...page(), ...changes } as SharedStatement, 0),
    ).toThrow("share_invalid_page");
  });

  it("rejects the wrong filter or revision and invalid offsets", () => {
    expect(() => validateSharedPage(page(), 0, 8)).toThrow("share_changed");
    expect(() => validateSharedPage(page(), 0, 7, "payment")).toThrow(
      "share_invalid_page",
    );
    for (const offset of [-1, 0.5, 100001, Number.NaN])
      expect(() => validateSharedPage(page(), offset)).toThrow(
        "share_invalid_page",
      );
  });
});
