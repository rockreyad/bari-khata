// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharedStatementSchema, type SharedStatement } from "./shareModel";
import { useSharedMonthly } from "./useSharedMonthly";

const mocked = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./shareClient", () => ({ readShare: mocked.read }));
const firstToken = "a".repeat(64);
const secondToken = "b".repeat(64);
function source(revision = 1, amount = 10000) {
  return SharedStatementSchema.parse({
    person: { name: "নমুনা দোকান", role: "দোকান", kind: "shop" },
    projectName: "নমুনা বাড়ি",
    account: "materials",
    workName: "নমুনা দরজা",
    updatedAt: "2026-11-06T12:00:00Z",
    revision,
    total: 1,
    nextOffset: null,
    counts: { payment: 1 },
    totals: {
      cost: 20000,
      paid: amount,
      payable: 20000 - amount,
      advance: 0,
      historicalCost: 0,
    },
    rows: [
      {
        key: `sample-${revision}`,
        date: "2026-11-06",
        kind: "payment",
        historical: false,
        charge: 0,
        paid: amount,
        description: "নমুনা টাকা",
        works: "নমুনা দরজা",
      },
    ],
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
beforeEach(() => {
  window.history.replaceState(null, "", `/shared#${firstToken}`);
  mocked.read.mockReset();
  mocked.read.mockResolvedValue(source());
});
afterEach(cleanup);

describe("shared monthly cash loading", () => {
  it("loads once per financial scope and ignores paginated/search result changes", async () => {
    const statement = source();
    const hook = renderHook(({ page }) => useSharedMonthly(firstToken, page), {
      initialProps: { page: statement },
    });
    await waitFor(() => expect(hook.result.current.busy).toBe(false));
    expect(hook.result.current.data?.totals.received).toBe(10000);
    expect(mocked.read).toHaveBeenCalledWith(firstToken, 0, 1, "payment", {
      signal: expect.any(AbortSignal),
    });
    hook.rerender({
      page: { ...statement, total: 0, nextOffset: null, rows: [] },
    });
    expect(hook.result.current.busy).toBe(false);
    expect(hook.result.current.data?.totals.received).toBe(10000);
    expect(mocked.read).toHaveBeenCalledOnce();
  });

  it("hides old months synchronously and cancels them when the revision changes", async () => {
    const pending = deferred<SharedStatement>();
    mocked.read.mockReturnValueOnce(pending.promise);
    const hook = renderHook(({ page }) => useSharedMonthly(firstToken, page), {
      initialProps: { page: source() },
    });
    const signal = mocked.read.mock.lastCall?.[4].signal as AbortSignal;
    const next = source(2, 15000);
    mocked.read.mockResolvedValue(next);
    hook.rerender({ page: next });
    expect(signal.aborted).toBe(true);
    expect(hook.result.current.data).toBeNull();
    await waitFor(() => expect(hook.result.current.data?.revision).toBe(2));
    await act(async () => pending.resolve(source()));
    expect(hook.result.current.data?.totals.received).toBe(15000);
  });

  it("discards the previous token's successful response and clears data while the new link loads", async () => {
    const old = deferred<SharedStatement>();
    mocked.read.mockReturnValueOnce(old.promise);
    const hook = renderHook(
      ({ token, page }) => useSharedMonthly(token, page),
      { initialProps: { token: firstToken, page: source() } },
    );
    const signal = mocked.read.mock.lastCall?.[4].signal as AbortSignal;
    const next = source(2, 9000);
    mocked.read.mockResolvedValue(next);
    window.history.replaceState(null, "", `/shared#${secondToken}`);
    hook.rerender({ token: secondToken, page: next });
    expect(hook.result.current.data).toBeNull();
    expect(signal.aborted).toBe(true);
    await waitFor(() =>
      expect(hook.result.current.data?.totals.received).toBe(9000),
    );
    await act(async () => old.resolve(source()));
    expect(hook.result.current.data?.totals.received).toBe(9000);
  });

  it("does not publish an old capability after a same-tick hash change", async () => {
    const pending = deferred<SharedStatement>();
    mocked.read.mockReturnValueOnce(pending.promise);
    const hook = renderHook(() => useSharedMonthly(firstToken, source()));
    window.history.replaceState(null, "", `/shared#${secondToken}`);
    await act(async () => pending.resolve(source()));
    expect(hook.result.current.data).toBeNull();
  });

  it("keeps failed loads empty and retries the complete scope", async () => {
    mocked.read.mockRejectedValueOnce(new Error("offline"));
    const hook = renderHook(() => useSharedMonthly(firstToken, source()));
    await waitFor(() =>
      expect(hook.result.current.error).toBe("share_request_failed"),
    );
    expect(hook.result.current.data).toBeNull();
    act(() => hook.result.current.retry());
    expect(hook.result.current.data).toBeNull();
    await waitFor(() => expect(hook.result.current.busy).toBe(false));
    expect(hook.result.current.error).toBe("");
    expect(hook.result.current.data?.totals.received).toBe(10000);
    expect(mocked.read).toHaveBeenCalledTimes(2);
  });

  it.each([
    "share_unavailable",
    "share_changed",
    "share_invalid_page",
    "share_monthly_too_large",
  ])("preserves %s for the page to handle", async (error) => {
    mocked.read.mockRejectedValueOnce(new Error(error));
    const hook = renderHook(() => useSharedMonthly(firstToken, source()));
    await waitFor(() => expect(hook.result.current.error).toBe(error));
    expect(hook.result.current.data).toBeNull();
  });

  it("converts invalid raw server data to a controlled failure", async () => {
    mocked.read.mockResolvedValue({
      ...source(),
      rows: [{ ...source().rows[0], paid: 0.5 }],
    });
    const hook = renderHook(() => useSharedMonthly(firstToken, source()));
    await waitFor(() =>
      expect(hook.result.current.error).toBe("share_invalid_page"),
    );
    expect(hook.result.current.data).toBeNull();
  });

  it("clears cached display data immediately when disabled or the share disappears", async () => {
    const hook = renderHook(
      ({ page, enabled }) => useSharedMonthly(firstToken, page, enabled),
      {
        initialProps: {
          page: source() as SharedStatement | null,
          enabled: true,
        },
      },
    );
    await waitFor(() => expect(hook.result.current.data).not.toBeNull());
    hook.rerender({ page: source(), enabled: false });
    expect(hook.result.current.data).toBeNull();
    expect(hook.result.current.busy).toBe(false);
    hook.rerender({ page: null, enabled: true });
    expect(hook.result.current.data).toBeNull();
    expect(hook.result.current.error).toBe("");
  });

  it("aborts a pending request on unmount", () => {
    const pending = deferred<SharedStatement>();
    mocked.read.mockReturnValueOnce(pending.promise);
    const hook = renderHook(() => useSharedMonthly(firstToken, source()));
    const signal = mocked.read.mock.lastCall?.[4].signal as AbortSignal;
    hook.unmount();
    expect(signal.aborted).toBe(true);
  });
});
