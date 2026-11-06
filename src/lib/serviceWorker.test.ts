import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import { serviceWorkerSource } from "../../scripts/serviceWorker";

function worker() {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const clients = [
    { id: "old", postMessage: vi.fn() },
    { id: "new", postMessage: vi.fn() },
  ];
  const stores = new Map([
    ["bari-khata-previous", new Map([["/assets/old.js", "old chunk"]])],
    [
      "bari-khata-current",
      new Map([
        ["/index.html", "new document"],
        ["/assets/new.js", "new chunk"],
      ]),
    ],
    ["unrelated", new Map()],
  ]);
  const caches = {
    keys: async () => [...stores.keys()],
    delete: vi.fn(async (key: string) => stores.delete(key)),
    open: async (key: string) => ({
      match: async (path: string) => stores.get(key)?.get(path),
      addAll: vi.fn(),
    }),
  };
  const fetch = vi.fn(async () => "network");
  const skipWaiting = vi.fn();
  runInNewContext(
    serviceWorkerSource("current", ["/index.html", "/assets/new.js"]),
    {
      URL,
      caches,
      fetch,
      self: {
        location: { origin: "https://example.test" },
        skipWaiting,
        addEventListener: (
          type: string,
          handler: (event: Record<string, unknown>) => void,
        ) => handlers.set(type, handler),
        clients: { claim: async () => {}, matchAll: async () => clients },
      },
    },
  );
  const send = async (type: string, data: Record<string, unknown> = {}) => {
    let result: unknown;
    handlers.get(type)!({
      ...data,
      waitUntil: (promise: Promise<unknown>) => {
        result = promise;
      },
      respondWith: (promise: Promise<unknown>) => {
        result = promise;
      },
    });
    return result;
  };
  const request = (path: string, mode = "cors", method = "GET") =>
    send("fetch", {
      request: { url: `https://example.test${path}`, mode, method },
    });
  return { clients, stores, caches, fetch, skipWaiting, send, request };
}

it("keeps old chunks while any older or unknown live tab remains and never navigates it", async () => {
  const app = worker();
  await app.send("activate");
  expect(app.clients[0].postMessage).toHaveBeenCalledWith({
    type: "REQUEST_CLIENT_BUILD",
  });
  expect(app.caches.delete).not.toHaveBeenCalled();
  await app.send("message", {
    source: { id: "new" },
    data: { type: "CLIENT_BUILD", build: "current" },
  });
  await app.send("message", {
    source: { id: "old" },
    data: { type: "CLIENT_BUILD", build: "previous" },
  });
  expect(await app.request("/assets/old.js")).toBe("old chunk");
  expect(await app.request("/ledger", "navigate")).toBe("new document");
  expect(app.caches.delete).not.toHaveBeenCalled();
  expect(app.skipWaiting).not.toHaveBeenCalled();
});

it("prunes only old app caches after every live tab acknowledges the current document", async () => {
  const app = worker();
  for (const client of app.clients)
    await app.send("message", {
      source: client,
      data: { type: "CLIENT_BUILD", build: "current" },
    });
  expect(app.stores.has("bari-khata-previous")).toBe(false);
  expect(app.stores.has("bari-khata-current")).toBe(true);
  expect(app.stores.has("unrelated")).toBe(true);
});

it("does not intercept release policy, financial API, cross-origin or non-GET requests", async () => {
  const app = worker();
  for (const path of ["/release.json", "/api/ledger"])
    expect(await app.request(path)).toBeUndefined();
  expect(await app.request("/assets/new.js", "cors", "POST")).toBeUndefined();
  expect(
    await app.send("fetch", {
      request: {
        url: "https://other.test/assets/new.js",
        method: "GET",
        mode: "cors",
      },
    }),
  ).toBeUndefined();
  expect(await app.request("/assets/new.js")).toBe("new chunk");
  expect(app.fetch).not.toHaveBeenCalled();
});
