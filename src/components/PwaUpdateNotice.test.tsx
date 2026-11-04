// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PwaUpdateNotice } from "./PwaUpdateNotice";

const api = vi.hoisted(() => ({
  waiting: true,
  canReload: (() => true) as () => boolean,
  update: vi.fn(),
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
beforeEach(() => {
  api.waiting = true;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
