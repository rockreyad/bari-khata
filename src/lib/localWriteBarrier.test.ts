import { afterEach, expect, it } from "vitest";
import {
  assertFinancialWritesAllowed,
  setFinancialWritesAllowed,
  trackLocalWrite,
  waitForLocalWrites,
} from "./localWriteBarrier";

afterEach(() => setFinancialWritesAllowed(true));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("drains queued editor cleanup and writes chained behind an active write", async () => {
  const first = deferred();
  const second = deferred();
  let complete = false;
  void Promise.resolve()
    .catch(() => {})
    .then(() => {})
    .then(() => {
      void trackLocalWrite(first.promise, "queued-draft").then(() =>
        trackLocalWrite(second.promise, "queued-draft"),
      );
    });
  const barrier = waitForLocalWrites().then(() => {
    complete = true;
  });
  await new Promise((done) => setTimeout(done, 5));
  expect(complete).toBe(false);
  first.resolve();
  await new Promise((done) => setTimeout(done, 5));
  expect(complete).toBe(false);
  second.resolve();
  await barrier;
  expect(complete).toBe(true);
});

it("keeps a failed final draft unsafe until that draft is saved or discarded", async () => {
  await expect(
    trackLocalWrite(Promise.reject(new Error("disk_full")), "failed-draft"),
  ).rejects.toThrow("disk_full");
  await expect(waitForLocalWrites()).rejects.toThrow("draft_flush_failed");
  await trackLocalWrite(Promise.resolve(), "unrelated-draft");
  await expect(waitForLocalWrites()).rejects.toThrow("draft_flush_failed");
  await trackLocalWrite(Promise.resolve(), "failed-draft");
  await expect(waitForLocalWrites()).resolves.toBeUndefined();
});

it("blocks new financial commits while allowing draft persistence and drain", async () => {
  setFinancialWritesAllowed(false);
  expect(assertFinancialWritesAllowed).toThrow("client_update_required");
  await trackLocalWrite(Promise.resolve(), "allowed-draft");
  await expect(waitForLocalWrites()).resolves.toBeUndefined();
});
