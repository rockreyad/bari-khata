// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageProvider } from "../../context/LanguageProvider";
import type { ReceiptInput } from "../../data/repository";
import { savePreferences } from "../../lib/preferences";
import { HouseAttachments } from "./HouseAttachments";

beforeEach(() => savePreferences({ language: "bn" }));
afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("limits only new selections to 5 MiB and preserves a restored larger receipt when rejecting a batch", async () => {
  const legacy: ReceiptInput = {
    id: "legacy",
    entryId: "sample-entry",
    name: "sample-legacy.pdf",
    file: new File([new Uint8Array(6 * 1024 * 1024)], "sample-legacy.pdf", {
      type: "application/pdf",
    }),
  };
  const accepted = new File(
    [new Uint8Array(5 * 1024 * 1024)],
    "sample-boundary.pdf",
    { type: "application/pdf" },
  );
  const oversized = new File(
    [new Uint8Array(5 * 1024 * 1024 + 1)],
    "sample-over-limit.pdf",
    { type: "application/pdf" },
  );
  const changed = vi.fn(),
    failed = vi.fn();
  function Form() {
    const [files, setFiles] = useState([legacy]);
    return (
      <HouseAttachments
        files={files}
        entryId="sample-entry"
        onError={failed}
        onChange={(next) => {
          changed(next);
          setFiles(next);
        }}
      />
    );
  }
  const user = userEvent.setup();
  render(
    <LanguageProvider>
      <Form />
    </LanguageProvider>,
  );
  const input = screen.getByLabelText("ভাউচার বা ছবি");
  await user.upload(input, [accepted, oversized]);
  expect(failed).toHaveBeenLastCalledWith(
    "ফাইলটি ৫ MB-এর মধ্যে রাখুন। বড় ছবি হলে ছোট করে আবার দিন।",
  );
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByText(legacy.name!)).toBeTruthy();
  expect(screen.queryByText(accepted.name)).toBeNull();
  await user.upload(input, accepted);
  expect(changed).toHaveBeenCalledOnce();
  const next = changed.mock.calls[0][0] as ReceiptInput[];
  expect(next[0]).toBe(legacy);
  expect(next[1]).toMatchObject({
    entryId: "sample-entry",
    name: accepted.name,
    file: accepted,
  });
  expect(screen.getByText(accepted.name)).toBeTruthy();
});

it("explains the new file limit through the real English language provider", async () => {
  savePreferences({ language: "en" });
  const failed = vi.fn(),
    changed = vi.fn();
  render(
    <LanguageProvider>
      <HouseAttachments
        files={[]}
        entryId="sample-entry"
        onError={failed}
        onChange={changed}
      />
    </LanguageProvider>,
  );
  await userEvent.upload(
    screen.getByLabelText("Receipt or photo"),
    new File([new Uint8Array(5 * 1024 * 1024 + 1)], "sample-large.pdf", {
      type: "application/pdf",
    }),
  );
  expect(failed).toHaveBeenCalledWith(
    "Keep each file within 5 MB. Try a smaller photo if needed.",
  );
  expect(changed).not.toHaveBeenCalled();
});

it("reports a rejected draft write when removing a receipt", async () => {
  const failed = vi.fn();
  const onChange = vi.fn().mockRejectedValue(new Error("disk unavailable"));
  render(
    <LanguageProvider>
      <HouseAttachments
        files={[
          {
            id: "sample-receipt",
            entryId: "sample-entry",
            name: "sample.pdf",
            file: new File(["sample"], "sample.pdf", {
              type: "application/pdf",
            }),
          },
        ]}
        entryId="sample-entry"
        onError={failed}
        onChange={onChange}
      />
    </LanguageProvider>,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "সরান: sample.pdf" }),
  );
  await waitFor(() =>
    expect(failed).toHaveBeenCalledWith("ফাইলটি রাখা যায়নি। আবার চেষ্টা করুন।"),
  );
  expect(onChange).toHaveBeenCalledWith([]);
});
