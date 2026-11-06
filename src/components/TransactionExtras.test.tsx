// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TransactionExtras } from "./TransactionExtras";

vi.mock("../context/LanguageProvider", () => ({
  useLanguageContext: () => ({ t: (value: string) => value }),
}));
afterEach(cleanup);

it("folds date, note and the existing optional receipt controls together without losing mounted values", async () => {
  const user = userEvent.setup();
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  render(
    <form onSubmit={submit}>
      <TransactionExtras
        dateField={
          <label>
            তারিখ
            <input defaultValue="2026-11-06" />
          </label>
        }
        noteField={
          <label>
            নোট
            <textarea defaultValue="নমুনা আগের নোট" />
          </label>
        }
      >
        <label>
          ছবি যোগ করি
          <input type="file" />
        </label>
      </TransactionExtras>
      <button type="submit">রাখুন</button>
    </form>,
  );
  const details = screen.getByRole("group", {
    name: "ভাউচার, নোট ও তারিখ",
  }) as HTMLDetailsElement;
  const date = within(details).getByLabelText("তারিখ");
  const note = within(details).getByLabelText("নোট");
  expect(date.closest("details")).toBe(details);
  expect(note.closest("details")).toBe(details);
  const summary = within(details)
    .getByText("ভাউচার, নোট ও তারিখ")
    .closest("summary")!;
  expect(details.open).toBe(false);
  const receipt = within(details).getByLabelText(
    "ছবি যোগ করি",
  ) as HTMLInputElement;
  expect(receipt.required).toBe(false);
  await user.click(summary);
  expect(details.open).toBe(true);
  await user.upload(
    receipt,
    new File(["synthetic receipt"], "sample.pdf", { type: "application/pdf" }),
  );
  await user.type(note, " নতুন কথা");
  await user.click(summary);
  expect(details.open).toBe(false);
  expect(within(details).getByLabelText("ছবি যোগ করি")).toBe(receipt);
  expect(receipt.files?.[0].name).toBe("sample.pdf");
  expect((note as HTMLTextAreaElement).value).toBe("নমুনা আগের নোট নতুন কথা");
  expect((date as HTMLInputElement).value).toBe("2026-11-06");
  expect(submit).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  expect(submit).toHaveBeenCalledOnce();
});

it("opens restored receipts without remounting their controls and remains user-collapsible", async () => {
  const user = userEvent.setup();
  const mounted = vi.fn();
  const removed = vi.fn();
  function Receipt() {
    const [value, setValue] = useState("sample.pdf");
    useEffect(() => {
      mounted();
      return removed;
    }, []);
    return (
      <input
        aria-label="আগের রসিদ"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    );
  }
  function Form({ restored }: { restored: boolean }) {
    return (
      <TransactionExtras
        dateField={
          <label>
            তারিখ
            <input />
          </label>
        }
        hasReceipts={restored}
      >
        <Receipt />
      </TransactionExtras>
    );
  }
  const view = render(<Form restored={false} />);
  const input = screen.getByRole("textbox", {
    name: "আগের রসিদ",
    hidden: true,
  });
  const details = input.closest("details")!;
  expect(details.open).toBe(false);
  view.rerender(<Form restored />);
  await waitFor(() => expect(details.open).toBe(true));
  await user.type(input, " নতুন নাম");
  await user.click(screen.getByText("ভাউচার, নোট ও তারিখ").closest("summary")!);
  expect(details.open).toBe(false);
  view.rerender(<Form restored />);
  expect(details.open).toBe(false);
  expect(screen.getByRole("textbox", { name: "আগের রসিদ", hidden: true })).toBe(
    input,
  );
  expect((input as HTMLInputElement).value).toBe("sample.pdf নতুন নাম");
  expect(mounted).toHaveBeenCalledOnce();
  expect(removed).not.toHaveBeenCalled();
});

it("keeps date-only extras foldable without an empty receipt area", () => {
  render(
    <TransactionExtras
      dateField={
        <label>
          তারিখ
          <input />
        </label>
      }
    />,
  );
  const details = screen.getByRole("group", {
    name: "ভাউচার, নোট ও তারিখ",
  }) as HTMLDetailsElement;
  expect(details.open).toBe(false);
  expect(details.querySelector(".transaction-extras-receipts")).toBeNull();
});

it("reveals a date that failed validation", async () => {
  const view = render(
    <TransactionExtras dateField={<input aria-label="তারিখ" />} />,
  );
  const details = screen.getByLabelText("তারিখ").closest("details")!;
  expect(details.open).toBe(false);
  view.rerender(
    <TransactionExtras defaultOpen dateField={<input aria-label="তারিখ" />} />,
  );
  await waitFor(() => expect(details.open).toBe(true));
});
