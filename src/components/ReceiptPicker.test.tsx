// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "../context/LanguageProvider";
import { setActiveOwner } from "../data/database";
import { savePreferences } from "../lib/preferences";
import { waitForLocalWrites } from "../lib/localWriteBarrier";
import { prepareReceiptFile } from "../lib/prepareReceiptFile";
import { ReceiptPicker } from "./ReceiptPicker";

vi.mock("../lib/prepareReceiptFile", () => ({ prepareReceiptFile: vi.fn() }));
const prepare = vi.mocked(prepareReceiptFile);
beforeEach(() => {
  savePreferences({ language: "bn" });
  prepare.mockReset();
  prepare.mockImplementation(async (file) => file);
  setActiveOwner(null);
});
afterEach(async () => {
  cleanup();
  await waitForLocalWrites();
  setActiveOwner(null);
  localStorage.clear();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const photo = () =>
  new File(["sample image"], "sample-camera.png", { type: "image/png" });
function mount(
  props: Partial<React.ComponentProps<typeof ReceiptPicker>> = {},
) {
  return render(
    <LanguageProvider>
      <ReceiptPicker
        scopeKey="sample-entry"
        existingCount={0}
        onFiles={vi.fn()}
        onError={vi.fn()}
        {...props}
      />
    </LanguageProvider>,
  );
}

it("prepares sequentially and commits only a complete valid batch", async () => {
  const first = deferred<File>();
  const onFiles = vi.fn(),
    onError = vi.fn();
  prepare
    .mockImplementationOnce(() => first.promise)
    .mockRejectedValueOnce(new Error("receipt_type_invalid"));
  mount({ onFiles, onError });
  const input = screen.getByLabelText("ভাউচার বা ছবি") as HTMLInputElement;
  fireEvent.change(input, {
    target: {
      files: [
        photo(),
        new File(["sample"], "sample.pdf", { type: "application/pdf" }),
      ],
    },
  });
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(input.disabled).toBe(true);
  expect(screen.getByRole("status").textContent).toBe("ফাইল গুছিয়ে নিচ্ছি…");
  await act(async () => {
    first.resolve(photo());
  });
  await waitFor(() => expect(input.disabled).toBe(false));
  expect(prepare).toHaveBeenCalledTimes(2);
  expect(onFiles).not.toHaveBeenCalled();
  expect(onError).toHaveBeenLastCalledWith("JPG, PNG, WebP ছবি বা PDF দিন।");
  expect(input.value).toBe("");
  expect(screen.queryByRole("status")).toBeNull();
  await userEvent.upload(input, photo());
  expect(onFiles).toHaveBeenCalledOnce();
});

it("holds the update write barrier through preparation and the latest draft persistence callback", async () => {
  const encoded = deferred<File>(),
    persisted = deferred<void>();
  const oldCallback = vi.fn(),
    latestCallback = vi.fn(() => persisted.promise);
  const busy = vi.fn();
  prepare.mockReturnValueOnce(encoded.promise);
  const page = mount({ onFiles: oldCallback, onProcessingChange: busy });
  fireEvent.change(screen.getByLabelText("ভাউচার বা ছবি"), {
    target: { files: [photo()] },
  });
  const flushed = vi.fn();
  const waiting = waitForLocalWrites().then(flushed);
  page.rerender(
    <LanguageProvider>
      <ReceiptPicker
        scopeKey="sample-entry"
        existingCount={0}
        onFiles={latestCallback}
        onError={vi.fn()}
        onProcessingChange={busy}
      />
    </LanguageProvider>,
  );
  await act(async () => {
    encoded.resolve(photo());
  });
  expect(oldCallback).not.toHaveBeenCalled();
  expect(latestCallback).toHaveBeenCalledOnce();
  expect(flushed).not.toHaveBeenCalled();
  expect(
    (screen.getByLabelText("ভাউচার বা ছবি") as HTMLInputElement).disabled,
  ).toBe(true);
  await act(async () => {
    persisted.resolve();
    await waiting;
  });
  expect(flushed).toHaveBeenCalledOnce();
  expect(busy.mock.calls.map(([value]) => value)).toEqual([true, false]);
});

it.each(["entry", "owner", "unmount"])(
  "does not append files after the %s changes while preparing",
  async (change) => {
    const encoded = deferred<File>(),
      onFiles = vi.fn();
    prepare.mockReturnValueOnce(encoded.promise);
    const page = mount({ onFiles });
    fireEvent.change(screen.getByLabelText("ভাউচার বা ছবি"), {
      target: { files: [photo()] },
    });
    if (change === "unmount") page.unmount();
    if (change === "owner")
      setActiveOwner("11111111-1111-4111-8111-111111111111");
    if (change === "entry")
      page.rerender(
        <LanguageProvider>
          <ReceiptPicker
            scopeKey="different-entry"
            existingCount={0}
            onFiles={onFiles}
            onError={vi.fn()}
          />
        </LanguageProvider>,
      );
    await act(async () => {
      encoded.resolve(photo());
      await waitForLocalWrites();
    });
    expect(onFiles).not.toHaveBeenCalled();
  },
);

it("counts saved receipts before preparing any files and allows selecting the same file again", async () => {
  const onError = vi.fn(),
    onFiles = vi.fn();
  const page = mount({ existingCount: 20, onError, onFiles });
  const input = screen.getByLabelText("ভাউচার বা ছবি");
  const selected = photo();
  await userEvent.upload(input, selected);
  expect(prepare).not.toHaveBeenCalled();
  expect(onError).toHaveBeenLastCalledWith(
    "একটি হিসাবে সর্বোচ্চ ২০টি ছবি বা ভাউচার রাখুন।",
  );
  page.rerender(
    <LanguageProvider>
      <ReceiptPicker
        scopeKey="sample-entry"
        existingCount={19}
        onFiles={onFiles}
        onError={onError}
      />
    </LanguageProvider>,
  );
  await userEvent.upload(input, selected);
  expect(onFiles).toHaveBeenCalledOnce();
});

it("accepts a dropped batch through the same preparation path as the file chooser", async () => {
  const onFiles = vi.fn();
  mount({ onFiles });
  const zone = screen.getByLabelText("ভাউচার বা ছবি").closest("label")!;
  const image = photo();
  const pdf = new File(["sample"], "sample.pdf", { type: "application/pdf" });
  const dataTransfer = { types: ["Files"], files: [image, pdf] };
  fireEvent.dragEnter(zone, { dataTransfer });
  expect(zone.classList.contains("is-dragging")).toBe(true);
  fireEvent.drop(zone, { dataTransfer });
  await waitFor(() => expect(onFiles).toHaveBeenCalledWith([image, pdf]));
  expect(zone.classList.contains("is-dragging")).toBe(false);
});
