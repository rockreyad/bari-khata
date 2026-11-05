// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { z } from "zod";
import { getAccountDatabase, setActiveOwner } from "../../data/database";
import { createWorkspaceStorage } from "../../data/repository";
import { useInlineDraft } from "./useInlineDraft";
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({ mode: "real" }),
}));
const Schema = z.object({ text: z.string().max(100) });
const initial = { text: "" };
let owner: string | undefined;
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  if (owner) await getAccountDatabase(owner).delete();
  owner = undefined;
  setActiveOwner(null);
});
function Editor({ id }: { id: string }) {
  const { value, update, ready } = useInlineDraft(
    `inline:${id}`,
    Schema,
    initial,
  );
  return (
    <input
      aria-label="draft"
      disabled={!ready}
      value={value.text}
      onChange={(event) => update({ text: event.target.value })}
    />
  );
}
it("isolates drafts when the same mounted editor switches between identities", async () => {
  owner = crypto.randomUUID();
  setActiveOwner(owner);
  const storage = createWorkspaceStorage();
  await storage.saveDraft("inline:A", { text: "নমুনা প্রথম লেখা" });
  const view = render(<Editor id="A" />);
  await waitFor(() =>
    expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe(
      "নমুনা প্রথম লেখা",
    ),
  );
  fireEvent.change(screen.getByLabelText("draft"), {
    target: { value: "নমুনা বদলানো প্রথম লেখা" },
  });
  view.rerender(<Editor id="B" />);
  await waitFor(() =>
    expect((screen.getByLabelText("draft") as HTMLInputElement).disabled).toBe(
      false,
    ),
  );
  expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe("");
  fireEvent.change(screen.getByLabelText("draft"), {
    target: { value: "নমুনা দ্বিতীয় লেখা" },
  });
  await waitFor(async () =>
    expect(await storage.readDraft("inline:B")).toEqual({
      text: "নমুনা দ্বিতীয় লেখা",
    }),
  );
  expect(await storage.readDraft("inline:A")).toEqual({
    text: "নমুনা বদলানো প্রথম লেখা",
  });
  view.rerender(<Editor id="A" />);
  await waitFor(() =>
    expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe(
      "নমুনা বদলানো প্রথম লেখা",
    ),
  );
});
