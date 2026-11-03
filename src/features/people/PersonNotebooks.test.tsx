// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
afterEach(cleanup);

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
  const select = screen.getByRole("combobox", { name: "খাতা বেছে দেখুন" });
  expect(select.textContent).toContain("ইলেকট্রিক");
  expect(screen.queryByRole("heading")).toBeNull();
  await user.click(select);
  await user.click(screen.getByRole("option", { name: "বাথরুম" }));
  expect(onSelect).toHaveBeenLastCalledWith("bathroom");
  expect(select.textContent).toContain("বাথরুম");
  await user.click(select);
  await user.click(screen.getByRole("option", { name: "সব খাতা" }));
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
  const select = screen.getByRole("combobox", { name: "খাতা বেছে দেখুন" });
  expect(select.textContent).toContain("সরাসরি খোলা অন্য খাতা");
  await user.click(select);
  expect(
    screen.getByRole("option", {
      name: "সরাসরি খোলা অন্য খাতা",
      selected: true,
    }),
  ).toBeTruthy();
  await user.click(screen.getByRole("option", { name: "সব খাতা" }));
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
  const select = screen.getByRole("combobox", { name: "খাতা বেছে দেখুন" });
  expect(select.textContent).toContain("সব খাতা");
  expect(onSelect).not.toHaveBeenCalled();
  await user.click(select);
  expect(
    screen.getByRole("option", { name: "সব খাতা", selected: true }),
  ).toBeTruthy();
  await user.click(screen.getByRole("option", { name: "একমাত্র খাতা" }));
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
    screen.getByRole("combobox", { name: "খাতা বেছে দেখুন" }).textContent,
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
