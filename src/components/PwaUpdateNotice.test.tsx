// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PwaUpdateNotice } from "./PwaUpdateNotice";

const api = vi.hoisted(() => ({
  waiting: true,
  canReload: (() => true) as () => boolean,
  update: vi.fn(),
  required: false,
}));
vi.mock("../lib/usePwa", () => ({
  usePwa: (canReload: () => boolean) => {
    api.canReload = canReload;
    return {
      needRefresh: [api.waiting, vi.fn()],
      updateServiceWorker: api.update,
    };
  },
}));
vi.mock("../context/LanguageProvider", () => ({
  useLanguageContext: () => ({ t: String }),
}));
vi.mock("../lib/useReleasePolicy", () => ({
  useReleasePolicy: () => ({ required: api.required }),
}));
beforeEach(() => {
  api.waiting = true;
  api.required = false;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

it("offers the same simple update action without activating automatically", async () => {
  const user = userEvent.setup();
  render(<PwaUpdateNotice blocked={false} floating />);
  expect(screen.getByRole("status").textContent).toContain("নতুন আপডেট এসেছে");
  expect(api.canReload()).toBe(true);
  expect(api.update).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "আপডেট করুন" }));
  expect(api.update).toHaveBeenCalledOnce();
});

it("keeps a live reload guard when an editing route opens after the update click", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<PwaUpdateNotice blocked={false} floating />);
  await user.click(screen.getByRole("button", { name: "আপডেট করুন" }));
  rerender(<PwaUpdateNotice blocked floating />);
  expect(api.canReload()).toBe(false);
  expect(screen.queryByRole("button", { name: "আপডেট করুন" })).toBeNull();
  rerender(<PwaUpdateNotice blocked={false} floating />);
  expect(api.canReload()).toBe(true);
});

it.each(["form", "dialog", "alertdialog"])(
  "blocks activation while a %s editor exists and leaves its draft intact",
  async (editor) => {
    const user = userEvent.setup();
    const draft = <input aria-label="খসড়া" defaultValue="নমুনা লেখা" />;
    const { rerender } = render(
      <>
        <PwaUpdateNotice blocked={false} floating />
        {editor === "form" ? (
          <form>{draft}</form>
        ) : (
          <section role={editor}>{draft}</section>
        )}
      </>,
    );
    expect(api.canReload()).toBe(false);
    await user.click(screen.getByRole("button", { name: "আপডেট করুন" }));
    expect(api.update).not.toHaveBeenCalled();
    expect((screen.getByLabelText("খসড়া") as HTMLInputElement).value).toBe(
      "নমুনা লেখা",
    );
    rerender(<PwaUpdateNotice blocked={false} floating />);
    expect(api.canReload()).toBe(true);
    await user.click(screen.getByRole("button", { name: "আপডেট করুন" }));
    expect(api.update).toHaveBeenCalledOnce();
  },
);

it("does not show the update notice without a downloaded update", () => {
  api.waiting = false;
  render(<PwaUpdateNotice blocked={false} floating />);
  expect(screen.queryByRole("status")).toBeNull();
});

it("keeps the editor mounted and explains a required update while its save is blocked", () => {
  const { rerender } = render(
    <>
      <PwaUpdateNotice blocked floating />
      <form>
        <input aria-label="খসড়া" defaultValue="অরক্ষিত লেখা" />
      </form>
    </>,
  );
  const input = screen.getByLabelText("খসড়া");
  api.required = true;
  rerender(
    <>
      <PwaUpdateNotice blocked floating />
      <form>
        <input aria-label="খসড়া" defaultValue="অরক্ষিত লেখা" />
      </form>
    </>,
  );
  expect(screen.getByRole("alert").textContent).toContain("ফর্মটি বন্ধ করুন");
  expect(screen.getByLabelText("খসড়া")).toBe(input);
  expect((input as HTMLInputElement).value).toBe("অরক্ষিত লেখা");
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
});

it("offers an explicit required update even without a waiting worker", async () => {
  api.required = true;
  api.waiting = false;
  const user = userEvent.setup();
  render(<PwaUpdateNotice blocked={false} floating />);
  expect(screen.getByRole("alert").textContent).toContain("কপি নামানো যাবে");
  await user.click(screen.getByRole("button"));
  expect(api.update).toHaveBeenCalledWith(true, true);
});

it("keeps offline drafts in place until an update can be downloaded", () => {
  api.required = true;
  api.waiting = false;
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  render(<PwaUpdateNotice blocked={false} floating />);
  expect(screen.getByRole("alert").textContent).toContain(
    "ফোনের লেখা মুছবেন না",
  );
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
});

it("enables the required update after the editing route closes and React removes its form", async () => {
  api.required = true;
  const { rerender } = render(
    <>
      <PwaUpdateNotice blocked floating />
      <form>
        <input aria-label="খসড়া" defaultValue="লেখা" />
      </form>
    </>,
  );
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  rerender(<PwaUpdateNotice blocked={false} floating />);
  await waitFor(() =>
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  expect(screen.getByRole("alert").textContent).toContain("কপি নামানো যাবে");
  expect(api.canReload()).toBe(true);
});

it("observes an independently mounted editor without relying on a notice rerender", async () => {
  api.required = true;
  render(<PwaUpdateNotice blocked={false} floating />);
  const editor = document.createElement("form");
  document.body.append(editor);
  await waitFor(() =>
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
      true,
    ),
  );
  editor.remove();
  await waitFor(() =>
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
});
