// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { NotebookProvider } from "./NotebookProvider";

const api = vi.hoisted(() => ({
  state: {
    ledger: null,
    error: "local_data_unavailable" as string | null,
    pending: true,
    save: vi.fn(),
    sync: vi.fn(),
  },
  waiting: true,
  canReload: (() => false) as () => boolean,
  update: vi.fn(),
  usePwa: vi.fn(),
}));
vi.mock("../data/useLedger", () => ({ useLedger: () => api.state }));
vi.mock("../data/database", () => ({ getActiveOwner: () => "owner-one" }));
vi.mock("../context/LanguageProvider", () => ({
  useLanguageContext: () => ({ t: String }),
}));
vi.mock("../lib/usePwa", () => ({
  usePwa: (canReload: () => boolean) => {
    api.usePwa();
    api.canReload = canReload;
    return {
      needRefresh: [api.waiting, vi.fn()],
      updateServiceWorker: api.update,
    };
  },
}));

beforeEach(() => {
  api.state.error = "local_data_unavailable";
  api.state.pending = true;
  api.waiting = true;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function open() {
  return render(
    <MemoryRouter>
      <NotebookProvider mode="real">
        <main>খাতা</main>
      </NotebookProvider>
    </MemoryRouter>,
  );
}

it.each(["local_data_unavailable", "local_data_invalid"])(
  "offers an explicit app update after %s without saving or syncing pending records",
  (error) => {
    api.state.error = error;
    open();
    expect(
      screen.getByRole("heading", { name: "খাতা পড়া যাচ্ছে না" }),
    ).toBeTruthy();
    expect(screen.queryByRole("main")).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "আবার চেষ্টা করুন",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(api.canReload()).toBe(true);
    expect(api.update).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "আপডেট করুন" }));

    expect(api.update).toHaveBeenCalledOnce();
    expect(api.state.save).not.toHaveBeenCalled();
    expect(api.state.sync).not.toHaveBeenCalled();
    expect(api.state.pending).toBe(true);
  },
);

it("keeps checking for an update on the error screen before one is available", () => {
  api.waiting = false;
  open();
  expect(api.usePwa).toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "আপডেট করুন" })).toBeNull();
  expect(screen.getByRole("button", { name: "আবার চেষ্টা করুন" })).toBeTruthy();
  expect(api.update).not.toHaveBeenCalled();
});

it("retains the live form guard and leaves a draft untouched when an update is clicked", () => {
  open();
  render(
    <form>
      <input aria-label="খসড়া" defaultValue="অসমাপ্ত লেখা" />
    </form>,
  );
  expect(api.canReload()).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "আপডেট করুন" }));
  expect(api.update).not.toHaveBeenCalled();
  expect((screen.getByLabelText("খসড়া") as HTMLInputElement).value).toBe(
    "অসমাপ্ত লেখা",
  );
  expect(api.state.save).not.toHaveBeenCalled();
  expect(api.state.sync).not.toHaveBeenCalled();
});

it("does not offer an update while the notebook is still opening", () => {
  api.state.error = null;
  open();
  expect(screen.getByRole("heading", { name: "খাতা খুলছে…" })).toBeTruthy();
  expect(api.usePwa).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "আপডেট করুন" })).toBeNull();
});
