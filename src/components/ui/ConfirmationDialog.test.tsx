// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmationDialog } from "./ConfirmationDialog";

vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string, values: Record<string, string> = {}) =>
      text.replaceAll("{{text}}", values.text ?? ""),
  }),
}));
afterEach(cleanup);

it("starts on cancel, supports Escape and restores focus to its opener", async () => {
  const user = userEvent.setup();
  function Page() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>লেনদেন মুছুন</button>
        {open ? (
          <ConfirmationDialog
            title="হিসাব বাদ দেবেন?"
            confirmLabel="বাদ দিন"
            onClose={() => setOpen(false)}
            onConfirm={vi.fn()}
          />
        ) : null}
      </>
    );
  }
  render(<Page />);
  const opener = screen.getByRole("button", { name: "লেনদেন মুছুন" });
  await user.click(opener);
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "ফিরে যাই" }),
  );
  expect(screen.queryByRole("textbox")).toBeNull();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(opener);
});

it("requires the exact confirmation text including its case", async () => {
  const user = userEvent.setup(),
    confirm = vi.fn();
  render(
    <ConfirmationDialog
      title="অ্যাকাউন্ট মুছবেন?"
      typedConfirmation="DELETE"
      confirmLabel="মুছুন"
      onConfirm={confirm}
      onClose={vi.fn()}
    />,
  );
  const input = screen.getByRole("textbox"),
    submit = screen.getByRole("button", { name: "মুছুন" });
  expect(screen.getByText("DELETE", { selector: "strong" })).toBeTruthy();
  expect(screen.getByLabelText("নিশ্চিত করতে DELETE লিখুন")).toBe(input);
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  await user.type(input, "delete");
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  await user.clear(input);
  await user.type(input, "DELETE ");
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  await user.clear(input);
  await user.type(input, "DELETE");
  await user.click(submit);
  expect(confirm).toHaveBeenCalledTimes(1);
});

it("blocks duplicate submission and dismissal while an operation is pending", async () => {
  const user = userEvent.setup(),
    close = vi.fn();
  let finish!: () => void;
  const confirm = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <ConfirmationDialog
      title="মুছবেন?"
      confirmLabel="মুছুন"
      onConfirm={confirm}
      onClose={close}
    />,
  );
  const submit = screen.getByRole("button", { name: "মুছুন" });
  await user.dblClick(submit);
  await user.keyboard("{Escape}");
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
  expect(
    (screen.getByRole("button", { name: "ফিরে যাই" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  finish();
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "মুছুন" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
});

it("keeps failed confirmation open and allows a retry without losing its typed text", async () => {
  const user = userEvent.setup();
  const confirm = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(undefined);
  render(
    <ConfirmationDialog
      title="সরাবেন?"
      typedConfirmation="DELETE"
      confirmLabel="মুছুন"
      onConfirm={confirm}
      onClose={vi.fn()}
    />,
  );
  await user.type(screen.getByRole("textbox"), "DELETE");
  await user.click(screen.getByRole("button", { name: "মুছুন" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "কাজটি হয়নি। আবার চেষ্টা করুন।",
  );
  const error = screen.getByRole("alert");
  expect(document.activeElement).toBe(error);
  expect(
    error.compareDocumentPosition(screen.getByRole("textbox")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
    "DELETE",
  );
  await user.click(screen.getByRole("button", { name: "মুছুন" }));
  expect(confirm).toHaveBeenCalledTimes(2);
});

it("bolds the same DELETE keyword in a translated account instruction", async () => {
  const user = userEvent.setup(),
    confirm = vi.fn();
  render(
    <ConfirmationDialog
      title="সরাবেন?"
      typedConfirmation="DELETE"
      typedLabel="Type DELETE to confirm"
      confirmLabel="মুছুন"
      onConfirm={confirm}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByText("DELETE", { selector: "strong" })).toBeTruthy();
  await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
  const submit = screen.getByRole("button", { name: "মুছুন" });
  expect((submit as HTMLButtonElement).disabled).toBe(false);
  await user.click(submit);
  expect(confirm).toHaveBeenCalledOnce();
});
