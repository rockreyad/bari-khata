// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePwa } from "./usePwa";

const nativeWindow = window;
const originalWorker = Object.getOwnPropertyDescriptor(
  navigator,
  "serviceWorker",
);
let container: EventTarget;
let waiting: { postMessage: ReturnType<typeof vi.fn> } | null;
let postMessage: ReturnType<typeof vi.fn>;
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
  waiting = { postMessage };
  container = new nativeWindow.EventTarget();
  const registration = Object.assign(new nativeWindow.EventTarget(), {
    get waiting() {
      return waiting;
    },
    installing: null,
    update: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(registration, "waiting", { get: () => waiting });
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
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (originalWorker)
    Object.defineProperty(navigator, "serviceWorker", originalWorker);
  else Reflect.deleteProperty(navigator, "serviceWorker");
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
  act(() =>
    container.dispatchEvent(new nativeWindow.Event("controllerchange")),
  );
  expect(reload).toHaveBeenCalledOnce();
});
