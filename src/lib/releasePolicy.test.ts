// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { APP_VERSION } from "./appVersion";

const [major, minor, patch] = APP_VERSION.split(".").map(Number);
const nextVersion = `${major}.${minor}.${patch + 1}`;
const laterVersion = `${major}.${minor}.${patch + 2}`;

beforeEach(() => {
  vi.resetModules();
});
afterEach(async () => {
  (await import("./localWriteBarrier")).setFinancialWritesAllowed(true);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const response = (body: unknown) => ({ ok: true, json: async () => body });

it("compares numerical stable versions and rejects ambiguous or inconsistent policies", async () => {
  const { compareVersions, ReleasePolicySchema, VersionSchema } =
    await import("./releasePolicy");
  expect(compareVersions("0.1.10", "0.1.4")).toBe(1);
  for (const invalid of [
    "0.01.4",
    "0.1.4-beta",
    "0.1",
    "9999999999999999999.1.4",
  ])
    expect(VersionSchema.safeParse(invalid).success).toBe(false);
  expect(
    ReleasePolicySchema.safeParse({
      latestVersion: "0.1.4",
      minimumSupportedVersion: "0.1.5",
    }).success,
  ).toBe(false);
});

it("allows optional releases, enforces newer minimums and never lowers a known floor", async () => {
  const api = await import("./releasePolicy");
  const barrier = await import("./localWriteBarrier");
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      response({
        latestVersion: laterVersion,
        minimumSupportedVersion: APP_VERSION,
      }),
    )
    .mockResolvedValueOnce(
      response({
        latestVersion: laterVersion,
        minimumSupportedVersion: nextVersion,
      }),
    )
    .mockResolvedValueOnce(
      response({
        latestVersion: APP_VERSION,
        minimumSupportedVersion: APP_VERSION,
      }),
    )
    .mockResolvedValueOnce(response({ latestVersion: "broken" }));
  vi.stubGlobal("fetch", fetcher);
  await api.checkReleasePolicy(true);
  expect(api.getReleaseState().required).toBe(false);
  expect(barrier.assertFinancialWritesAllowed).not.toThrow();
  await api.checkReleasePolicy(true);
  expect(api.getReleaseState().required).toBe(true);
  expect(barrier.assertFinancialWritesAllowed).toThrow(
    "client_update_required",
  );
  await api.checkReleasePolicy(true);
  await api.checkReleasePolicy(true);
  expect(api.getReleaseState().minimumSupportedVersion).toBe(nextVersion);
  expect(api.getReleaseState().required).toBe(true);
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    cache: "no-store",
    credentials: "same-origin",
  });
});

it("deduplicates concurrent checks and skips offline checks without discarding policy", async () => {
  const api = await import("./releasePolicy");
  let resolve!: (value: unknown) => void;
  const fetcher = vi.fn(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const first = api.checkReleasePolicy(true);
  expect(api.checkReleasePolicy(true)).toBe(first);
  await Promise.resolve();
  resolve(
    response({
      latestVersion: APP_VERSION,
      minimumSupportedVersion: APP_VERSION,
    }),
  );
  await first;
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await api.checkReleasePolicy(true);
  expect(fetcher).toHaveBeenCalledOnce();
});

it("treats server PT426 as mandatory, including same-version and malformed details", async () => {
  const api = await import("./releasePolicy");
  expect(
    api.reportClientUpdateRequired({ code: "PT500", message: "other" }),
  ).toBe(false);
  expect(
    api.reportClientUpdateRequired({
      code: "PT426",
      message: "client_update_required",
      details: JSON.stringify({ minimumSupportedVersion: APP_VERSION }),
    }),
  ).toBe(true);
  expect(api.getReleaseState().required).toBe(true);
  api.reportClientUpdateRequired({
    code: "PT426",
    message: "client_update_required",
    details: "invalid",
  });
  expect(api.getReleaseState().required).toBe(true);
  expect(api.getReleaseState().minimumSupportedVersion).toBe(APP_VERSION);
});

it("aborts a hung check and allows a later check to succeed", async () => {
  vi.useFakeTimers();
  const api = await import("./releasePolicy");
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    )
    .mockResolvedValueOnce(
      response({
        latestVersion: nextVersion,
        minimumSupportedVersion: nextVersion,
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  const first = api.checkReleasePolicy(true);
  await vi.advanceTimersByTimeAsync(10_000);
  await first;
  await api.checkReleasePolicy(true);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(api.getReleaseState().required).toBe(true);
});
