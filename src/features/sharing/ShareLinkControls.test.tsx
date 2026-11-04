// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShareLinkControls } from "./ShareLinkControls";

const mocks = vi.hoisted(() => ({
  sync: vi.fn(),
  status: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
  notify: vi.fn(),
}));
const environment = vi.hoisted(() => ({ mode: "real" }));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    mode: environment.mode,
    state: { sync: mocks.sync },
    notify: mocks.notify,
  }),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({ t: (text: string) => text }),
}));
vi.mock("./shareClient", () => ({
  shareStatus: mocks.status,
  createShare: mocks.create,
  revokeShare: mocks.revoke,
  liveShareUrl: (token: string) => `http://localhost/shared#${token}`,
}));

const scope = {
  personId: "sample-worker",
  account: "labour" as const,
  workId: "sample-tiles",
};
const anotherScope = { ...scope, personId: "sample-other-worker" };
const link = {
  id: "sample-id",
  token: "sample-token",
  createdAt: "2026-11-01T12:00:00Z",
};
const url = "http://localhost/shared#sample-token";
const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
const originalShare = Object.getOwnPropertyDescriptor(navigator, "share");
function navigatorValue(key: "clipboard" | "share", value: unknown) {
  Object.defineProperty(navigator, key, { configurable: true, value });
}
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
async function createButton() {
  const button = await screen.findByRole<HTMLButtonElement>("button", {
    name: "লিংক তৈরি করুন",
  });
  await waitFor(() => expect(button.disabled).toBe(false));
  return button;
}
async function created() {
  const user = userEvent.setup();
  const view = render(<ShareLinkControls scope={scope} />);
  await user.click(await createButton());
  await screen.findByDisplayValue(url);
  return { user, ...view };
}

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  environment.mode = "real";
  mocks.status.mockResolvedValue(null);
  mocks.sync.mockResolvedValue({ status: "synced" });
  mocks.create.mockResolvedValue(link);
  mocks.revoke.mockResolvedValue(undefined);
  navigatorValue("share", undefined);
});
afterEach(() => {
  cleanup();
  for (const [key, descriptor] of [
    ["clipboard", originalClipboard],
    ["share", originalShare],
  ] as const) {
    if (descriptor) Object.defineProperty(navigator, key, descriptor);
    else Reflect.deleteProperty(navigator, key);
  }
});

describe("owner live sharing controls", () => {
  it("keeps the initial card concise and blocks creation until link status loads", async () => {
    const loading = pending<null>();
    mocks.status.mockReturnValue(loading.promise);
    render(<ShareLinkControls scope={scope} />);
    expect(screen.getByRole("heading", { name: "লিংক পাঠান" })).toBeTruthy();
    expect(screen.getByText("নতুন হিসাবও এই লিংকে দেখা যাবে।")).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "লিংক তৈরি করুন" })
        .disabled,
    ).toBe(true);
    expect(screen.queryByText("লিংক সামলান")).toBeNull();
    expect(
      screen.queryByText(
        "যাঁর কাছে লিংক থাকবে, তিনি শুধু এই হিসাব দেখতে পারবেন। কোনো তথ্য বদলাতে পারবেন না।",
      ),
    ).toBeNull();
    await act(async () => loading.resolve(null));
    await createButton();
  });

  it("keeps sample books separate and does not request a real share", () => {
    environment.mode = "demo";
    render(<ShareLinkControls scope={scope} />);
    expect(
      screen.getByText(
        "নমুনা খাতা থেকে লিংক দেওয়া যায় না। নিজের খাতায় ব্যবহার করুন।",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("requires a successful status retry before warning about and replacing an existing link", async () => {
    const retry = pending<{ id: string; createdAt: string }>();
    mocks.status
      .mockRejectedValueOnce(new Error("offline"))
      .mockReturnValueOnce(retry.promise);
    const user = userEvent.setup();
    render(<ShareLinkControls scope={scope} />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "লিংকের খবর পাওয়া যায়নি। আবার চেষ্টা করুন।",
    );
    expect(screen.queryByRole("button", { name: "লিংক তৈরি করুন" })).toBeNull();
    expect(screen.queryByRole("button", { name: "নতুন লিংক নিন" })).toBeNull();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "আবার চেষ্টা করুন" }));
    await waitFor(() => expect(mocks.status).toHaveBeenCalledTimes(2));
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "লিংক তৈরি করুন" })
        .disabled,
    ).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
    await act(async () =>
      retry.resolve({ id: link.id, createdAt: link.createdAt }),
    );
    await screen.findByText(
      "আগের লিংক চালু আছে। নতুন লিংক নিলে আগেরটি বন্ধ হবে।",
    );
    expect(mocks.status).toHaveBeenNthCalledWith(2, scope);
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "নতুন লিংক নিন" }));
    await screen.findByDisplayValue(url);
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(scope);
  });

  it.each(["conflict", "offline", "signed-out"])(
    "does not create a link after sync reports %s",
    async (status) => {
      mocks.sync.mockResolvedValue({ status });
      const user = userEvent.setup();
      render(<ShareLinkControls scope={scope} />);
      await user.click(await createButton());
      expect((await screen.findByRole("alert")).textContent).toContain(
        "আগে ইন্টারনেটে হিসাব জমা হতে হবে",
      );
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );

  it("creates only the requested scope after syncing, and keeps revoke collapsed", async () => {
    const { user } = await created();
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith(scope);
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(screen.getByText("লিংক চালু আছে")).toBeTruthy();
    expect(screen.getByRole("button", { name: "লিংক কপি করুন" })).toBeTruthy();
    expect(screen.getByText("লিংক সামলান").closest("details")?.open).toBe(
      false,
    );
    expect(
      screen.getByRole("button", { name: "লিংক বন্ধ করুন" }).closest("details")
        ?.open,
    ).toBe(false);
    await user.click(screen.getByText("লিংক সামলান"));
    expect(screen.getByText("নতুন লিংক নিলে আগেরটি বন্ধ হবে।")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "লিংক বন্ধ করুন" }));
    await createButton();
    expect(mocks.revoke).toHaveBeenCalledWith(link.id);
    expect(screen.queryByDisplayValue(url)).toBeNull();
    expect(mocks.notify).toHaveBeenCalledWith("লিংক বন্ধ হয়েছে।");
  });

  it("explains replacement without inventing a recoverable URL for an existing link", async () => {
    mocks.status.mockResolvedValue({ id: link.id, createdAt: link.createdAt });
    const user = userEvent.setup();
    render(<ShareLinkControls scope={scope} />);
    await screen.findByText(
      "আগের লিংক চালু আছে। নতুন লিংক নিলে আগেরটি বন্ধ হবে।",
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "লিংক কপি করুন" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "নতুন লিংক নিন" }));
    await screen.findByDisplayValue(url);
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith(scope);
  });

  it("copies only on explicit action with one short confirmation", async () => {
    const { user } = await created();
    const writeText = vi.fn().mockResolvedValue(undefined);
    navigatorValue("clipboard", { writeText });
    expect(writeText).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "লিংক কপি করুন" }));
    expect(writeText).toHaveBeenCalledWith(url);
    expect(mocks.notify).toHaveBeenCalledExactlyOnceWith("লিংক কপি হয়েছে।");
    expect(mocks.sync).toHaveBeenCalledTimes(1);
  });

  it.each(["missing", "rejected"])(
    "selects the URL for manual copy when clipboard is %s",
    async (kind) => {
      const { user } = await created();
      navigatorValue(
        "clipboard",
        kind === "missing"
          ? undefined
          : { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      );
      await user.click(screen.getByRole("button", { name: "লিংক কপি করুন" }));
      const input = screen.getByDisplayValue<HTMLInputElement>(url);
      expect(document.activeElement).toBe(input);
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(url.length);
      expect(mocks.notify).toHaveBeenCalledExactlyOnceWith(
        "লিংকটি বেছে কপি করুন।",
      );
    },
  );

  it("opens the native share sheet only on an explicit click and ignores cancellation", async () => {
    const share = vi
      .fn()
      .mockRejectedValue(new DOMException("Cancelled", "AbortError"));
    navigatorValue("share", share);
    const { user } = await created();
    const writeText = vi.fn();
    navigatorValue("clipboard", { writeText });
    expect(share).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "অন্যভাবে পাঠান" }));
    expect(share).toHaveBeenCalledExactlyOnceWith({ url });
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "লিংক কপি করুন" })
        .disabled,
    ).toBe(false);
  });

  it("keeps copy available after a native share failure", async () => {
    navigatorValue("share", vi.fn().mockRejectedValue(new Error("failed")));
    const { user } = await created();
    await user.click(screen.getByRole("button", { name: "অন্যভাবে পাঠান" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "লিংক পাঠানো যায়নি। কপি করে পাঠান।",
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "লিংক কপি করুন" })
        .disabled,
    ).toBe(false);
  });

  it("locks repeated clicks while syncing and stops before creation after scope changes", async () => {
    const sync = pending<{ status: string }>();
    mocks.sync.mockReturnValue(sync.promise);
    const view = render(<ShareLinkControls scope={scope} />);
    const button = await createButton();
    act(() => {
      button.click();
      button.click();
    });
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    view.rerender(<ShareLinkControls scope={anotherScope} />);
    await createButton();
    await act(async () => sync.resolve({ status: "synced" }));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("does not publish a late create result after changing away from and back to a scope", async () => {
    const creating = pending<typeof link>();
    mocks.create.mockReturnValueOnce(creating.promise);
    const user = userEvent.setup();
    const view = render(<ShareLinkControls scope={scope} />);
    await user.click(await createButton());
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    view.rerender(<ShareLinkControls scope={anotherScope} />);
    await createButton();
    view.rerender(<ShareLinkControls scope={scope} />);
    await createButton();
    await act(async () => creating.resolve(link));
    expect(screen.queryByDisplayValue(url)).toBeNull();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("keeps a new scope locked when an older create request finishes", async () => {
    const first = pending<typeof link>(),
      second = pending<typeof link>();
    mocks.create
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const user = userEvent.setup();
    const view = render(<ShareLinkControls scope={scope} />);
    await user.click(await createButton());
    view.rerender(<ShareLinkControls scope={anotherScope} />);
    await user.click(await createButton());
    await act(async () => first.resolve(link));
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "অপেক্ষা করুন…" })
        .disabled,
    ).toBe(true);
    expect(screen.queryByDisplayValue(url)).toBeNull();
    await act(async () =>
      second.resolve({
        ...link,
        id: "sample-second-id",
        token: "sample-second-token",
      }),
    );
    await screen.findByDisplayValue(
      "http://localhost/shared#sample-second-token",
    );
  });

  it("ignores an old status response when another scope is shown", async () => {
    const status = pending<null>();
    mocks.status
      .mockReturnValueOnce(status.promise)
      .mockResolvedValueOnce({ id: link.id, createdAt: link.createdAt });
    const view = render(<ShareLinkControls scope={scope} />);
    view.rerender(<ShareLinkControls scope={anotherScope} />);
    await screen.findByText("লিংক চালু আছে");
    await act(async () => status.resolve(null));
    expect(screen.getByText("লিংক চালু আছে")).toBeTruthy();
  });

  it("does not create after unmount while sync is pending", async () => {
    const sync = pending<{ status: string }>();
    mocks.sync.mockReturnValue(sync.promise);
    const user = userEvent.setup();
    const view = render(<ShareLinkControls scope={scope} />);
    await user.click(await createButton());
    view.unmount();
    await act(async () => sync.resolve({ status: "synced" }));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("does not announce stale clipboard or revoke completions after a scope change", async () => {
    const { user, rerender } = await created();
    const copying = pending<void>();
    navigatorValue("clipboard", {
      writeText: vi.fn().mockReturnValue(copying.promise),
    });
    await user.click(screen.getByRole("button", { name: "লিংক কপি করুন" }));
    rerender(<ShareLinkControls scope={anotherScope} />);
    await createButton();
    await act(async () => copying.resolve());
    expect(mocks.notify).not.toHaveBeenCalled();
    await user.click(await createButton());
    await screen.findByDisplayValue(url);
    await user.click(screen.getByText("লিংক সামলান"));
    const revoking = pending<void>();
    mocks.revoke.mockReturnValue(revoking.promise);
    await user.click(screen.getByRole("button", { name: "লিংক বন্ধ করুন" }));
    rerender(<ShareLinkControls scope={scope} />);
    await createButton();
    await act(async () => revoking.resolve());
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "লিংক তৈরি করুন" })).toBeTruthy();
  });
});
