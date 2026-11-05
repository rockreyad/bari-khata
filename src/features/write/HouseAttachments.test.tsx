// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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

it("limits only new selections to 2 MiB and preserves a restored larger receipt when rejecting a batch", async () => {
  const legacy: ReceiptInput = {
    id: "legacy",
    entryId: "sample-entry",
    name: "sample-legacy.pdf",
    file: new File([new Uint8Array(3 * 1024 * 1024)], "sample-legacy.pdf", {
      type: "application/pdf",
    }),
  };
  const accepted = new File(
    [new Uint8Array(2 * 1024 * 1024)],
    "sample-boundary.pdf",
    { type: "application/pdf" },
  );
  const oversized = new File(
    [new Uint8Array(2 * 1024 * 1024 + 1)],
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
    "ছবি বা PDF দিন। প্রতিটি ২ MB-এর মধ্যে, সর্বোচ্চ ২০টি।",
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
    new File([new Uint8Array(2 * 1024 * 1024 + 1)], "sample-large.pdf", {
      type: "application/pdf",
    }),
  );
  expect(failed).toHaveBeenCalledWith(
    "Use photos or PDFs, each up to 2 MB, with at most 20 files.",
  );
  expect(changed).not.toHaveBeenCalled();
});
