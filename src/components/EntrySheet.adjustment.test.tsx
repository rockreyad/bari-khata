// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EntrySheet } from "./EntrySheet";
import { LanguageProvider } from "../context/LanguageProvider";
import { LedgerSchema } from "../domain/model";
const { storage } = vi.hoisted(() => ({ storage: vi.fn() }));
vi.mock("../data/repository", () => ({ createWorkspaceStorage: storage }));
afterEach(cleanup);
it("blocks generic edit/create URLs for adjustments before any draft storage mounts", () => {
  const ledger = LedgerSchema.parse({
    people: [{ id: "person", name: "পরীক্ষার নাম" }],
    entries: [
      {
        id: "adjust",
        kind: "adjustment",
        personId: "person",
        note: "হিসাব মিলিয়েছি",
        adjustment: {
          target: "person",
          basis: "balance",
          account: "materials",
          before: 10000,
          after: 5000,
          delta: -5000,
          workId: null,
        },
      },
    ],
  });
  const save = vi.fn();
  for (const props of [
    { editEntryId: "adjust" },
    { initialKind: "adjustment" },
  ]) {
    const page = render(
      <LanguageProvider>
        <EntrySheet
          ledger={ledger}
          presentation="page"
          {...props}
          onSave={save}
          onClose={vi.fn()}
        />
      </LanguageProvider>,
    );
    expect(
      screen.getByText("এই সমন্বয় বদলানো যাবে না। দরকার হলে আবার হিসাব মেলান।"),
    ).toBeTruthy();
    expect(page.container.querySelector("form")).toBeNull();
    expect(storage).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    page.unmount();
  }
});
