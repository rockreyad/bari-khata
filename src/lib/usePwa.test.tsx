// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePwa } from "./usePwa";
import { trackLocalWrite } from "./localWriteBarrier";

const nativeWindow = window;
const originalWorker = Object.getOwnPropertyDescriptor(
  navigator,
  "serviceWorker",
);
let container: EventTarget;
let waiting: { postMessage: ReturnType<typeof vi.fn> } | null;
let installing: (EventTarget & { state: ServiceWorkerState }) | null;
let postMessage: ReturnType<typeof vi.fn>;
let checkForUpdate: ReturnType<typeof vi.fn>;
const reload = vi.fn();
beforeEach(() => {
  vi.stubEnv("PROD", true);
  reload.mockClear();
  vi.stubGlobal(
    "window",
    new Proxy(nativeWindow, {
      get(target, property) {
        return property === "location"
          ? { reload }
          : Reflect.get(target, property, target);
      },
    }),
  );
  postMessage = vi.fn();
  checkForUpdate = vi.fn().mockResolvedValue(undefined);
  waiting = { postMessage };
  installing = null;
  container = new nativeWindow.EventTarget();
  const registration = Object.assign(new nativeWindow.EventTarget(), {
    get waiting() {
      return waiting;
    },
    update: checkForUpdate,
  });
  Object.defineProperty(registration, "waiting", { get: () => waiting });
  Object.defineProperty(registration, "installing", { get: () => installing });
  Object.assign(container, {
    controller: {},
    register: vi.fn().mockResolvedValue(registration),
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: container,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  if (originalWorker)
    Object.defineProperty(navigator, "serviceWorker", originalWorker);
  else Reflect.deleteProperty(navigator, "serviceWorker");
});

it("checks for new releases on reconnect and return without activating or reloading", async () => {
  const visible = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("visible");
  const { unmount } = renderHook(() => usePwa());
  await waitFor(() => expect(checkForUpdate).toHaveBeenCalledOnce());
  window.dispatchEvent(new nativeWindow.Event("online"));
  expect(checkForUpdate).toHaveBeenCalledTimes(2);
  visible.mockReturnValue("hidden");
  document.dispatchEvent(new nativeWindow.Event("visibilitychange"));
  expect(checkForUpdate).toHaveBeenCalledTimes(2);
  visible.mockReturnValue("visible");
  document.dispatchEvent(new nativeWindow.Event("visibilitychange"));
  expect(checkForUpdate).toHaveBeenCalledTimes(3);
  expect(postMessage).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
  unmount();
  window.dispatchEvent(new nativeWindow.Event("online"));
  document.dispatchEvent(new nativeWindow.Event("visibilitychange"));
  expect(checkForUpdate).toHaveBeenCalledTimes(3);
});

it("does not reload when auth input arrives after Update, and allows a later explicit safe reload", async () => {
  const { result, rerender } = renderHook(({ safe }) => usePwa(() => safe), {
    initialProps: { safe: true },
  });
  await waitFor(() => expect(result.current.needRefresh[0]).toBe(true));
  await act(() => result.current.updateServiceWorker());
  expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: "SKIP_WAITING" });
  rerender({ safe: false });
  waiting = null;
  act(() =>
    container.dispatchEvent(new nativeWindow.Event("controllerchange")),
  );
  expect(reload).not.toHaveBeenCalled();
  expect(result.current.needRefresh[0]).toBe(true);
  await act(() => result.current.updateServiceWorker());
  expect(reload).not.toHaveBeenCalled();
  rerender({ safe: true });
  await act(() => result.current.updateServiceWorker());
  expect(reload).toHaveBeenCalledOnce();
});

it("does not activate or reload while the latest guard is blocked", async () => {
  const { result } = renderHook(() => usePwa(() => false));
  await waitFor(() => expect(result.current.needRefresh[0]).toBe(true));
  await act(() => result.current.updateServiceWorker());
  expect(postMessage).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});

it("keeps the existing unguarded explicit update behavior and cancels reload listeners on unmount", async () => {
  const { result, unmount } = renderHook(() => usePwa());
  await waitFor(() => expect(result.current.needRefresh[0]).toBe(true));
  await act(() => result.current.updateServiceWorker());
  expect(postMessage).toHaveBeenCalledOnce();
  unmount();
  act(() =>
    container.dispatchEvent(new nativeWindow.Event("controllerchange")),
  );
  expect(reload).not.toHaveBeenCalled();
});

it("reloads only after explicit update activation when the form stays blank", async () => {
  const { result } = renderHook(() => usePwa());
  await waitFor(() => expect(result.current.needRefresh[0]).toBe(true));
  expect(reload).not.toHaveBeenCalled();
  await act(() => result.current.updateServiceWorker());
  expect(reload).not.toHaveBeenCalled();
  waiting = null;
  await act(async () =>
    container.dispatchEvent(new nativeWindow.Event("controllerchange")),
  );
  await waitFor(() => expect(reload).toHaveBeenCalledOnce());
});

it("rechecks the current editing guard after queued local writes finish", async () => {
  const { result, rerender } = renderHook(({ safe }) => usePwa(() => safe), {
    initialProps: { safe: true },
  });
  await waitFor(() => expect(result.current.needRefresh[0]).toBe(true));
  let finish!: () => void;
  void trackLocalWrite(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
    "guard-draft",
  );
  let update!: Promise<boolean | undefined>;
  act(() => {
    update = result.current.updateServiceWorker();
  });
  rerender({ safe: false });
  finish();
  await act(() => update);
  expect(postMessage).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});

it("allows a safe explicit mandatory reload after activation in another tab", async () => {
  waiting = null;
  const { result } = renderHook(() => usePwa());
  await waitFor(() => expect(checkForUpdate).toHaveBeenCalledOnce());
  await act(() => result.current.updateServiceWorker(true, true));
  expect(reload).toHaveBeenCalledOnce();
});

it("waits for the installing worker to finish before activating the required update", async () => {
  waiting = null;
  const { result } = renderHook(() => usePwa());
  await waitFor(() => expect(checkForUpdate).toHaveBeenCalledOnce());
  const worker = Object.assign(new nativeWindow.EventTarget(), {
    state: "installing" as ServiceWorkerState,
  });
  installing = worker;
  const listening = vi.spyOn(worker, "addEventListener");
  let updating!: Promise<boolean | undefined>;
  act(() => {
    updating = result.current.updateServiceWorker(true, true);
  });
  await waitFor(() => expect(listening).toHaveBeenCalled());
  expect(postMessage).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
  waiting = { postMessage };
  worker.state = "installed";
  worker.dispatchEvent(new nativeWindow.Event("statechange"));
  await act(() => updating);
  expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: "SKIP_WAITING" });
  expect(reload).not.toHaveBeenCalled();
});

it("reports an unfinished download after the bounded wait without reloading an older shell", async () => {
  waiting = null;
  const { result } = renderHook(() => usePwa());
  await waitFor(() => expect(checkForUpdate).toHaveBeenCalledOnce());
  installing = Object.assign(new nativeWindow.EventTarget(), {
    state: "installing" as ServiceWorkerState,
  });
  vi.useFakeTimers();
  const updating = result.current.updateServiceWorker(true, true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_010);
  });
  await expect(updating).resolves.toBe(false);
  expect(reload).not.toHaveBeenCalled();
  expect(postMessage).not.toHaveBeenCalled();
});

it("allows a safe explicit mandatory reload when ServiceWorker is unavailable", async () => {
  Reflect.deleteProperty(navigator, "serviceWorker");
  const { result } = renderHook(() => usePwa());
  await act(() => result.current.updateServiceWorker(true, true));
  expect(reload).toHaveBeenCalledOnce();
});

it("drains local writes started while checking for an update before fallback reload", async () => {
  waiting = null;
  const { result } = renderHook(() => usePwa());
  await waitFor(() => expect(checkForUpdate).toHaveBeenCalledOnce());
  let finishUpdate!: () => void;
  checkForUpdate.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishUpdate = resolve;
      }),
  );
  let updating!: Promise<boolean | undefined>;
  act(() => {
    updating = result.current.updateServiceWorker(true, true);
  });
  await waitFor(() => expect(finishUpdate).toBeTypeOf("function"));
  let finishDraft!: () => void;
  void trackLocalWrite(
    new Promise<void>((resolve) => {
      finishDraft = resolve;
    }),
    "during-update-draft",
  );
  finishUpdate();
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(reload).not.toHaveBeenCalled();
  finishDraft();
  await act(() => updating);
  expect(reload).toHaveBeenCalledOnce();
});

it("rechecks the guard while draining writes after controllerchange", async () => {
  const { result, rerender } = renderHook(({ safe }) => usePwa(() => safe), {
    initialProps: { safe: true },
  });
  await waitFor(() => expect(result.current.needRefresh[0]).toBe(true));
  await act(() => result.current.updateServiceWorker());
  let finish!: () => void;
  void trackLocalWrite(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
    "controller-draft",
  );
  act(() => {
    container.dispatchEvent(new nativeWindow.Event("controllerchange"));
  });
  rerender({ safe: false });
  finish();
  await waitFor(() => expect(result.current.needRefresh[0]).toBe(true));
  expect(reload).not.toHaveBeenCalled();
});

it("announces the current document build without claiming an older tab is current", async () => {
  const meta = document.createElement("meta");
  meta.name = "bari-build";
  meta.content = "this-document-build";
  document.head.append(meta);
  const announce = vi.fn();
  Object.assign(container, { controller: { postMessage: announce } });
  renderHook(() => usePwa());
  await waitFor(() =>
    expect(announce).toHaveBeenCalledWith({
      type: "CLIENT_BUILD",
      build: "this-document-build",
    }),
  );
  meta.remove();
});
