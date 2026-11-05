// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LedgerSchema } from "../../domain/model";
import { PersonNotebooks } from "./PersonNotebooks";

vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: String,
    formatDigits: String,
    language: "bn",
  }),
}));
let mobile = false;
beforeEach(() => {
  mobile = false;
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: mobile && query === "(max-width: 760px)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: () => true,
    })),
  );
});
beforeAll(() => {
  if (!window.PointerEvent)
    window.PointerEvent = MouseEvent as typeof PointerEvent;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("lets one contact open each linked notebook and return to all notebooks without creating a job", async () => {
  const ledger = LedgerSchema.parse({
    works: [
      { id: "bathroom", name: "বাথরুম" },
      { id: "electric", name: "ইলেকট্রিক" },
    ],
    people: [
      { id: "worker", name: "মোরশেদ", workIds: ["bathroom", "electric"] },
    ],
  });
  const before = JSON.stringify(ledger);
  const onSelect = vi.fn();
  function Filter() {
    const [selected, setSelected] = useState("electric");
    return (
      <PersonNotebooks
        ledger={ledger}
        person={ledger.people[0]}
        selectedWorkId={selected}
        onSelect={(id) => {
          setSelected(id);
          onSelect(id);
        }}
      />
    );
  }
  render(<Filter />);
  const user = userEvent.setup();
  const select = screen.getByRole("button", { name: "খাতা বেছে দেখুন" });
  expect(select.textContent).toContain("ইলেকট্রিক");
  expect(screen.queryByRole("heading")).toBeNull();
  await user.click(select);
  expect(screen.getByRole("dialog", { name: "খাতা বেছে দেখুন" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "বাথরুম" }));
  expect(onSelect).toHaveBeenLastCalledWith("bathroom");
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(select.textContent).toContain("বাথরুম");
  await waitFor(() => expect(document.activeElement).toBe(select));
  expect(screen.queryByRole("dialog")).toBeNull();
  await user.click(select);
  await user.click(screen.getByRole("button", { name: "সব খাতা" }));
  expect(onSelect).toHaveBeenLastCalledWith("");
  expect(select.textContent).toContain("সব খাতা");
  expect(JSON.stringify(ledger)).toBe(before);
});

it("preserves an explicitly selected notebook outside the contact's relationships without adding it", async () => {
  const ledger = LedgerSchema.parse({
    works: [
      { id: "linked", name: "সম্পর্ক রাখা খাতা" },
      { id: "selected", name: "সরাসরি খোলা অন্য খাতা" },
    ],
    people: [{ id: "person", name: "নমুনা", workIds: ["linked"] }],
  });
  const before = JSON.stringify(ledger);
  const onSelect = vi.fn();
  render(
    <PersonNotebooks
      ledger={ledger}
      person={ledger.people[0]}
      selectedWorkId="selected"
      onSelect={onSelect}
    />,
  );
  const user = userEvent.setup();
  const select = screen.getByRole("button", { name: "খাতা বেছে দেখুন" });
  expect(select.textContent).toContain("সরাসরি খোলা অন্য খাতা");
  await user.click(select);
  expect(
    screen.getByRole("button", {
      name: "সরাসরি খোলা অন্য খাতা",
      pressed: true,
    }),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "সব খাতা" }));
  expect(onSelect).toHaveBeenCalledExactlyOnceWith("");
  expect(JSON.stringify(ledger)).toBe(before);
});

it("keeps all-notebook scope available when the contact has only one linked notebook", async () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "only", name: "একমাত্র খাতা" }],
    people: [{ id: "person", name: "নমুনা", workIds: ["only"] }],
  });
  const onSelect = vi.fn();
  render(
    <PersonNotebooks
      ledger={ledger}
      person={ledger.people[0]}
      selectedWorkId=""
      onSelect={onSelect}
    />,
  );
  const user = userEvent.setup();
  const select = screen.getByRole("button", { name: "খাতা বেছে দেখুন" });
  expect(select.textContent).toContain("সব খাতা");
  expect(onSelect).not.toHaveBeenCalled();
  await user.click(select);
  expect(
    screen.getByRole("button", { name: "সব খাতা", pressed: true }),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "একমাত্র খাতা" }));
  expect(onSelect).toHaveBeenCalledExactlyOnceWith("only");
});

it("shows a valid selected notebook even when the contact has no related notebooks", () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "selected", name: "সরাসরি খোলা খাতা" }],
    people: [{ id: "person", name: "নমুনা" }],
  });
  render(
    <PersonNotebooks
      ledger={ledger}
      person={ledger.people[0]}
      selectedWorkId="selected"
      onSelect={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("button", { name: "খাতা বেছে দেখুন" }).textContent,
  ).toContain("সরাসরি খোলা খাতা");
});

it("hides the filter when there are no related or currently selected notebooks", () => {
  const ledger = LedgerSchema.parse({
    people: [{ id: "person", name: "নমুনা" }],
  });
  const { container } = render(
    <PersonNotebooks
      ledger={ledger}
      person={ledger.people[0]}
      selectedWorkId=""
      onSelect={vi.fn()}
    />,
  );
  expect(container.firstChild).toBeNull();
});

it.each(["desktop", "mobile"])(
  "closes without changing scope and restores focus on %s",
  async (viewport) => {
    mobile = viewport === "mobile";
    const ledger = LedgerSchema.parse({
      works: [{ id: "work", name: "নমুনা খাতা" }],
      people: [{ id: "person", name: "নমুনা মানুষ", workIds: ["work"] }],
    });
    const onSelect = vi.fn();
    render(
      <PersonNotebooks
        ledger={ledger}
        person={ledger.people[0]}
        selectedWorkId="work"
        onSelect={onSelect}
      />,
    );
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "খাতা বেছে দেখুন" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-description")).toBe("নমুনা খাতা");
    await user.click(trigger);
    let dialog = screen.getByRole("dialog", { name: "খাতা বেছে দেখুন" });
    expect(within(dialog).getByText("নমুনা মানুষ")).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
    await user.click(within(dialog).getByRole("button", { name: "বন্ধ করুন" }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(trigger);
    dialog = screen.getByRole("dialog", { name: "খাতা বেছে দেখুন" });
    expect(dialog).toBeTruthy();
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  },
);

it("closes an unchanged selection without writing scope again", async () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "work", name: "নমুনা খাতা" }],
    people: [{ id: "person", name: "নমুনা", workIds: ["work"] }],
  });
  const onSelect = vi.fn();
  render(
    <PersonNotebooks
      ledger={ledger}
      person={ledger.people[0]}
      selectedWorkId="work"
      onSelect={onSelect}
    />,
  );
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "খাতা বেছে দেখুন" });
  await user.click(trigger);
  await user.click(
    screen.getByRole("button", { name: "নমুনা খাতা", pressed: true }),
  );
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(onSelect).not.toHaveBeenCalled();
});
