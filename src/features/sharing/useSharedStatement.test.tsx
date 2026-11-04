// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SharedStatementSchema,
  type SharedKind,
  type SharedStatement,
} from "./shareModel";
import { useSharedStatement } from "./useSharedStatement";

const mocked = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./shareClient", () => ({ readShare: mocked.read }));
const firstToken = "a".repeat(64);
const secondToken = "b".repeat(64);
function page(
  offset = 0,
  total = 55,
  revision = 1,
  kind: SharedKind = "expense",
) {
  const length = Math.min(20, Math.max(0, total - offset));
  return SharedStatementSchema.parse({
    person: { name: "নমুনা দোকান", role: "দোকান", kind: "shop" },
    projectName: "নমুনা বাড়ি",
    account: "materials",
    workName: "নমুনা খাতা",
    updatedAt: "2026-11-04T01:00:00Z",
    revision,
    total,
    nextOffset: offset + length < total ? offset + length : null,
    totals: {
      cost: 55000,
      paid: 25000,
      payable: 30000,
      advance: 0,
      historicalCost: 0,
    },
    counts: { expense: total, payment: 0, expense_credit: 0, refund: 0 },
    rows: Array.from({ length }, (_, index) => ({
      key: `sample-${offset + index}`,
      date: "2026-11-04",
      kind,
      historical: false,
      charge: kind === "expense" ? 1000 : 0,
      paid: kind === "payment" ? 1000 : 0,
      description: `নমুনা ${offset + index}`,
      works: "নমুনা খাতা",
    })),
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const mount = () => renderHook(() => useSharedStatement());
type Hook = ReturnType<typeof mount>;
const ready = (hook: Hook) =>
  waitFor(() => expect(hook.result.current.busy).toBe(false));
beforeEach(() => {
  window.history.replaceState(null, "", `/shared#${firstToken}`);
  mocked.read.mockReset();
  mocked.read.mockImplementation(async (_token, offset = 0) => page(offset));
});
afterEach(cleanup);

describe("bounded shared statement page navigation", () => {
  it("debounces server-wide search, aborts old work immediately and suppresses stale rows", async () => {
    const hook = mount();
    await ready(hook);
    const oldPage = deferred<SharedStatement>();
    mocked.read.mockReturnValueOnce(oldPage.promise);
    act(() => {
      void hook.result.current.next();
    });
    const oldSignal = mocked.read.mock.lastCall?.[4].signal as AbortSignal;
    const searched = { ...page(0, 1), counts: page().counts };
    mocked.read.mockResolvedValueOnce(searched);
    act(() => {
      hook.result.current.setQuery("সিমে");
      hook.result.current.setQuery("সিমেন্ট");
    });
    expect(oldSignal.aborted).toBe(true);
    expect(hook.result.current.query).toBe("সিমেন্ট");
    expect(hook.result.current.statement?.rows).toEqual([]);
    expect(hook.result.current.statement?.person.name).toBe("নমুনা দোকান");
    expect(hook.result.current.busy).toBe(true);
    expect(mocked.read).toHaveBeenCalledTimes(2);
    await act(async () => {
      oldPage.resolve(page(20));
    });
    expect(hook.result.current.statement?.rows).toEqual([]);
    await ready(hook);
    expect(mocked.read).toHaveBeenCalledTimes(3);
    expect(mocked.read.mock.lastCall).toEqual([
      firstToken,
      0,
      undefined,
      undefined,
      { signal: expect.any(AbortSignal), grouped: true, query: "সিমেন্ট" },
    ]);
    expect(hook.result.current.statement).toEqual(searched);
  });
  it("pins query and revision across next and previous pages and bounds search length", async () => {
    const hook = mount();
    await ready(hook);
    act(() => hook.result.current.setQuery("x".repeat(250)));
    expect(hook.result.current.query).toHaveLength(200);
    await ready(hook);
    await act(async () => {
      await hook.result.current.next();
    });
    expect(mocked.read.mock.lastCall).toEqual([
      firstToken,
      20,
      1,
      undefined,
      {
        signal: expect.any(AbortSignal),
        grouped: true,
        query: "x".repeat(200),
      },
    ]);
    await act(async () => {
      await hook.result.current.previous();
    });
    expect(mocked.read.mock.lastCall).toEqual([
      firstToken,
      0,
      1,
      undefined,
      {
        signal: expect.any(AbortSignal),
        grouped: true,
        query: "x".repeat(200),
      },
    ]);
  });
  it("clears a pending query when the capability changes before debounce completes", async () => {
    const hook = mount();
    await ready(hook);
    act(() => {
      hook.result.current.setQuery("পুরোনো");
      window.history.replaceState(null, "", `/shared#${secondToken}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await ready(hook);
    expect(hook.result.current.query).toBe("");
    expect(hook.result.current.token).toBe(secondToken);
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    });
    expect(mocked.read.mock.calls).toHaveLength(2);
    expect(mocked.read.mock.lastCall?.[0]).toBe(secondToken);
    expect(mocked.read.mock.lastCall?.[4].query).toBeUndefined();
  });
  it("keeps an initial failure empty and allows retry without a pinned revision", async () => {
    mocked.read.mockRejectedValueOnce(new Error("offline"));
    const hook = mount();
    await ready(hook);
    expect(hook.result.current).toMatchObject({
      statement: null,
      error: "share_request_failed",
      missing: false,
      loading: false,
    });
    await act(async () => {
      await hook.result.current.load();
    });
    expect(hook.result.current.statement?.rows).toHaveLength(20);
    expect(hook.result.current.error).toBe("");
    expect(mocked.read.mock.lastCall?.slice(0, 4)).toEqual([
      firstToken,
      0,
      undefined,
      undefined,
    ]);
  });

  it("aborts a pending load on explicit reload and suppresses its late completion", async () => {
    const initial = deferred<SharedStatement>();
    mocked.read.mockReturnValueOnce(initial.promise);
    const hook = mount();
    const signal = mocked.read.mock.lastCall?.[4].signal as AbortSignal;
    mocked.read.mockResolvedValueOnce(page(0, 2, 2));
    await act(async () => {
      await hook.result.current.reload();
    });
    expect(signal.aborted).toBe(true);
    await act(async () => {
      initial.resolve(page());
    });
    expect(hook.result.current.statement?.revision).toBe(2);
    expect(hook.result.current.statement?.rows).toHaveLength(2);
    expect(hook.result.current.busy).toBe(false);
  });

  it("shows only the current twenty rows and refetches previous pages with the pinned revision", async () => {
    const hook = mount();
    await ready(hook);
    expect(hook.result.current.statement?.rows).toHaveLength(20);
    expect(hook.result.current).toMatchObject({
      pageStart: 0,
      pageNumber: 1,
      canPrevious: false,
      canNext: true,
    });
    expect(mocked.read).toHaveBeenNthCalledWith(
      1,
      firstToken,
      0,
      undefined,
      undefined,
      { signal: expect.any(AbortSignal), grouped: true },
    );
    await act(async () => {
      await hook.result.current.next();
    });
    expect(hook.result.current).toMatchObject({
      pageStart: 20,
      pageNumber: 2,
      canPrevious: true,
    });
    expect(hook.result.current.statement?.rows).toHaveLength(20);
    expect(hook.result.current.statement?.rows[0].key).toBe("sample-20");
    await act(async () => {
      await hook.result.current.next();
    });
    expect(hook.result.current).toMatchObject({
      pageStart: 40,
      pageNumber: 3,
      canNext: false,
    });
    expect(hook.result.current.statement?.rows).toHaveLength(15);
    await act(async () => {
      await hook.result.current.previous();
    });
    expect(hook.result.current).toMatchObject({ pageStart: 20, pageNumber: 2 });
    await act(async () => {
      await hook.result.current.previous();
    });
    expect(hook.result.current).toMatchObject({
      pageStart: 0,
      pageNumber: 1,
      canPrevious: false,
    });
    expect(mocked.read.mock.calls.map((args) => [args[1], args[2]])).toEqual([
      [0, undefined],
      [20, 1],
      [40, 1],
      [20, 1],
      [0, 1],
    ]);
    expect(hook.result.current.statement?.rows).toHaveLength(20);
  });

  it("blocks synchronous double navigation before React has rendered the busy state", async () => {
    const hook = mount();
    await ready(hook);
    const pending = deferred<SharedStatement>();
    mocked.read.mockReturnValueOnce(pending.promise);
    act(() => {
      void hook.result.current.next();
      void hook.result.current.next();
      void hook.result.current.previous();
    });
    expect(mocked.read).toHaveBeenCalledTimes(2);
    expect(hook.result.current).toMatchObject({
      busy: true,
      canNext: false,
      canPrevious: false,
    });
    await act(async () => {
      pending.resolve(page(20));
    });
    expect(hook.result.current).toMatchObject({
      pageStart: 20,
      pageNumber: 2,
      busy: false,
    });
  });

  it("preserves the displayed page and offset history on transient next and previous failures", async () => {
    const hook = mount();
    await ready(hook);
    const initial = hook.result.current.statement;
    mocked.read.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await hook.result.current.next();
    });
    expect(hook.result.current).toMatchObject({
      statement: initial,
      pageStart: 0,
      pageNumber: 1,
      error: "share_request_failed",
      canNext: true,
    });
    await act(async () => {
      await hook.result.current.next();
    });
    const second = hook.result.current.statement;
    mocked.read.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await hook.result.current.previous();
    });
    expect(hook.result.current).toMatchObject({
      statement: second,
      pageStart: 20,
      pageNumber: 2,
      error: "share_request_failed",
      canPrevious: true,
    });
    await act(async () => {
      await hook.result.current.previous();
    });
    expect(hook.result.current).toMatchObject({
      pageStart: 0,
      pageNumber: 1,
      error: "",
    });
  });

  it("retries the exact failed previous request instead of resetting or advancing the displayed page", async () => {
    const hook = mount();
    await ready(hook);
    await act(async () => {
      await hook.result.current.next();
    });
    await act(async () => {
      await hook.result.current.next();
    });
    mocked.read.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await hook.result.current.previous();
    });
    expect(hook.result.current).toMatchObject({
      pageStart: 40,
      pageNumber: 3,
      error: "share_request_failed",
    });
    await act(async () => {
      await hook.result.current.retry();
    });
    expect(mocked.read.mock.lastCall?.slice(0, 4)).toEqual([
      firstToken,
      20,
      1,
      undefined,
    ]);
    expect(hook.result.current).toMatchObject({
      pageStart: 20,
      pageNumber: 2,
      error: "",
      canPrevious: true,
    });
    expect(hook.result.current.statement?.rows[0].key).toBe("sample-20");
  });

  it("clears stale pages and reloads from zero without carrying old revision, offsets or keys", async () => {
    const hook = mount();
    await ready(hook);
    mocked.read.mockRejectedValueOnce(new Error("share_changed"));
    await act(async () => {
      await hook.result.current.next();
    });
    expect(hook.result.current).toMatchObject({
      statement: null,
      stale: true,
      error: "share_changed",
      canNext: false,
      canPrevious: false,
      busy: false,
    });
    mocked.read.mockResolvedValueOnce(page(0, 1, 2));
    await act(async () => {
      await hook.result.current.reload();
    });
    expect(hook.result.current).toMatchObject({
      pageStart: 0,
      pageNumber: 1,
      stale: false,
      error: "",
      canNext: false,
    });
    expect(hook.result.current.statement?.revision).toBe(2);
    expect(mocked.read.mock.lastCall?.slice(0, 4)).toEqual([
      firstToken,
      0,
      undefined,
      undefined,
    ]);
  });

  it("clears every private page field when a share is revoked", async () => {
    const hook = mount();
    await ready(hook);
    await act(async () => {
      await hook.result.current.next();
    });
    mocked.read.mockResolvedValueOnce(null);
    await act(async () => {
      await hook.result.current.previous();
    });
    expect(hook.result.current).toMatchObject({
      statement: null,
      missing: true,
      pageStart: 0,
      pageNumber: 1,
      busy: false,
      canPrevious: false,
      canNext: false,
    });
  });

  it("retains the same-token summary shell but clears every old row on filter change and ignores the aborted page's late response", async () => {
    const hook = mount();
    await ready(hook);
    const metadata = hook.result.current.statement!;
    const old = deferred<SharedStatement>();
    const filtered = deferred<SharedStatement>();
    mocked.read
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(filtered.promise);
    act(() => {
      void hook.result.current.next();
    });
    const oldSignal = mocked.read.mock.lastCall?.[4].signal as AbortSignal;
    act(() => {
      hook.result.current.setFilter("payment");
    });
    expect(hook.result.current).toMatchObject({
      statement: { ...metadata, rows: [], nextOffset: null },
      busy: true,
      loading: false,
      filter: "payment",
      pageNumber: 1,
      pageStart: 0,
      canPrevious: false,
      canNext: false,
    });
    expect(oldSignal.aborted).toBe(true);
    expect(mocked.read.mock.lastCall?.slice(0, 4)).toEqual([
      firstToken,
      0,
      undefined,
      "payment",
    ]);
    await act(async () => {
      old.resolve(page(20));
    });
    expect(hook.result.current.statement).toEqual({
      ...metadata,
      rows: [],
      nextOffset: null,
    });
    await act(async () => {
      filtered.resolve(page(0, 2, 1, "payment"));
    });
    expect(
      hook.result.current.statement?.rows.every(
        (row) => row.kind === "payment",
      ),
    ).toBe(true);
    expect(hook.result.current).toMatchObject({
      filter: "payment",
      busy: false,
      canNext: false,
    });
  });

  it("resets filter and clears rows on token change while ignoring the older token's out-of-order response", async () => {
    const first = deferred<SharedStatement>();
    const second = deferred<SharedStatement>();
    mocked.read
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const hook = mount();
    const firstSignal = mocked.read.mock.lastCall?.[4].signal as AbortSignal;
    act(() => {
      window.history.replaceState(null, "", `/shared#${secondToken}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(hook.result.current).toMatchObject({
      token: secondToken,
      statement: null,
      filter: "",
      loading: true,
    });
    expect(firstSignal.aborted).toBe(true);
    await act(async () => {
      second.resolve({
        ...page(0, 1),
        person: { ...page().person, name: "অন্য নমুনা দোকান" },
      });
    });
    await act(async () => {
      first.resolve(page());
    });
    expect(hook.result.current.statement?.person.name).toBe("অন্য নমুনা দোকান");
    expect(hook.result.current.statement?.rows).toHaveLength(1);
  });

  it("resets a selected kind when the capability changes", async () => {
    const hook = mount();
    await ready(hook);
    mocked.read.mockResolvedValueOnce(page(0, 1, 1, "payment"));
    act(() => {
      hook.result.current.setFilter("payment");
    });
    await ready(hook);
    act(() => {
      window.history.replaceState(null, "", `/shared#${secondToken}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await ready(hook);
    expect(hook.result.current.filter).toBe("");
    expect(mocked.read.mock.lastCall?.slice(0, 4)).toEqual([
      secondToken,
      0,
      undefined,
      undefined,
    ]);
  });

  it.each(["markUnavailable", "markStale"] as const)(
    "lets CSV %s invalidate a pending page before it can repaint",
    async (marker) => {
      const hook = mount();
      await ready(hook);
      const pending = deferred<SharedStatement>();
      mocked.read.mockReturnValueOnce(pending.promise);
      act(() => {
        void hook.result.current.next();
      });
      const signal = mocked.read.mock.lastCall?.[4].signal as AbortSignal;
      act(() => {
        hook.result.current[marker]();
      });
      expect(signal.aborted).toBe(true);
      await act(async () => {
        pending.resolve(page(20));
      });
      expect(hook.result.current).toMatchObject({
        statement: null,
        busy: false,
        missing: marker === "markUnavailable",
        stale: marker === "markStale",
        canNext: false,
        canPrevious: false,
      });
    },
  );

  it("aborts on unmount and ignores all later completions and retained callbacks", async () => {
    const pending = deferred<SharedStatement>();
    mocked.read.mockReturnValueOnce(pending.promise);
    const hook = mount();
    const callbacks = hook.result.current;
    const signal = mocked.read.mock.lastCall?.[4].signal as AbortSignal;
    hook.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      pending.resolve(page());
      await callbacks.reload();
      await callbacks.next();
      callbacks.setFilter("payment");
    });
    expect(mocked.read).toHaveBeenCalledTimes(1);
  });

  it("accepts an empty statement without inventing a continuation", async () => {
    mocked.read.mockResolvedValueOnce(page(0, 0));
    const hook = mount();
    await ready(hook);
    expect(hook.result.current.statement?.rows).toEqual([]);
    expect(hook.result.current).toMatchObject({
      missing: false,
      canNext: false,
      canPrevious: false,
      error: "",
    });
  });

  it("rejects nonadjacent duplicated keys instead of showing a row twice at different offsets", async () => {
    const hook = mount();
    await ready(hook);
    await act(async () => {
      await hook.result.current.next();
    });
    const bad = page(40);
    bad.rows[0].key = "sample-0";
    mocked.read.mockResolvedValueOnce(bad);
    await act(async () => {
      await hook.result.current.next();
    });
    expect(hook.result.current).toMatchObject({
      pageStart: 20,
      pageNumber: 2,
      error: "share_invalid_page",
    });
    expect(hook.result.current.statement?.rows[0].key).toBe("sample-20");
  });

  it.each([
    "total",
    "person",
    "projectName",
    "account",
    "workName",
    "updatedAt",
    "totals",
    "counts",
    "contracts",
  ] as const)(
    "rejects changed %s metadata without replacing the current page",
    async (field) => {
      const hook = mount();
      await ready(hook);
      const initial = hook.result.current.statement;
      const bad = page(20);
      switch (field) {
        case "total":
          bad.total++;
          break;
        case "person":
          bad.person.name = "বদলে যাওয়া নমুনা";
          break;
        case "projectName":
          bad.projectName = "অন্য নমুনা";
          break;
        case "account":
          bad.account = "other";
          break;
        case "workName":
          bad.workName = "অন্য খাতা";
          break;
        case "updatedAt":
          bad.updatedAt = "2026-11-04T02:00:00Z";
          break;
        case "totals":
          bad.totals.paid++;
          break;
        case "counts":
          bad.counts.expense++;
          break;
        case "contracts":
          bad.contracts.push({
            title: "নমুনা কাজ",
            workName: "খাতা",
            total: 1000,
            netPaid: 0,
            remaining: 1000,
          });
          break;
      }
      mocked.read.mockResolvedValueOnce(bad);
      await act(async () => {
        await hook.result.current.next();
      });
      expect(hook.result.current).toMatchObject({
        statement: initial,
        pageStart: 0,
        error: "share_invalid_page",
      });
    },
  );

  it("rejects a changed revision and requires refresh rather than mixing revisions", async () => {
    const hook = mount();
    await ready(hook);
    mocked.read.mockResolvedValueOnce(page(20, 55, 2));
    await act(async () => {
      await hook.result.current.next();
    });
    expect(hook.result.current).toMatchObject({
      statement: null,
      stale: true,
      error: "share_changed",
      canNext: false,
    });
  });

  it("rejects an unsafe financial response rather than treating it as a valid page", async () => {
    const bad = page();
    bad.rows[0].charge = Number.MAX_SAFE_INTEGER + 1;
    mocked.read.mockResolvedValueOnce(bad);
    const hook = mount();
    await ready(hook);
    expect(hook.result.current).toMatchObject({
      statement: null,
      error: "share_invalid_page",
      canNext: false,
    });
  });

  it.each([
    "oversized",
    "duplicate",
    "no-progress",
    "skipped-offset",
    "wrong-kind",
  ])("rejects an invalid %s page", async (problem) => {
    const bad = page();
    if (problem === "oversized")
      bad.rows.push({ ...bad.rows[0], key: "extra" });
    if (problem === "duplicate") bad.rows[1].key = bad.rows[0].key;
    if (problem === "no-progress") {
      bad.rows = [];
      bad.nextOffset = 0;
    }
    if (problem === "skipped-offset") bad.nextOffset = 21;
    mocked.read.mockResolvedValueOnce(bad);
    const hook = mount();
    if (problem === "wrong-kind") {
      await ready(hook);
      mocked.read.mockResolvedValueOnce(bad);
      act(() => {
        hook.result.current.setFilter("payment");
      });
    }
    await ready(hook);
    expect(hook.result.current).toMatchObject({
      error: "share_invalid_page",
      canNext: false,
      canPrevious: false,
    });
    if (problem === "wrong-kind")
      expect(hook.result.current.statement?.rows).toEqual([]);
    else expect(hook.result.current.statement).toBeNull();
  });
});
