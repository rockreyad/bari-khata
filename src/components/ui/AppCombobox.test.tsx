// @vitest-environment jsdom
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  within,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AppCombobox,
  comboboxSuggestions,
  matchingSuggestions,
} from "./AppCombobox";

vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({ t: (text: string) => text }),
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
const choices = [
  { value: "সিমেন্ট", description: "Crown" },
  { value: "সিমেন্ট", description: "Shah" },
  { value: "লোহা", description: "16 মিমি" },
  { value: "Tiles", label: "টাইলস", description: "Chinese" },
];

describe("custom free-text suggestions", () => {
  it("deduplicates names without hiding their brands and matches Bengali digits", () => {
    const items = comboboxSuggestions(choices);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      value: "সিমেন্ট",
      description: "Crown · Shah",
    });
    expect(matchingSuggestions(items, "shah")[0].value).toBe("সিমেন্ট");
    expect(matchingSuggestions(items, "১৬")[0].value).toBe("লোহা");
    expect(matchingSuggestions(items, "টাইলস")[0].value).toBe("Tiles");
    expect(
      matchingSuggestions(
        Array.from({ length: 30 }, (_, index) => ({ value: `মাল ${index}` })),
        "",
      ),
    ).toHaveLength(8);
  });
  it("uses custom options and selects with arrows/Enter without submitting the form", async () => {
    const user = userEvent.setup();
    const submitted = vi.fn();
    function Field() {
      const [value, setValue] = useState("");
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitted();
          }}
        >
          <AppCombobox
            aria-label="মালের নাম"
            value={value}
            suggestions={choices}
            onChange={(event) => setValue(event.target.value)}
          />
        </form>
      );
    }
    render(<Field />);
    const input = screen.getByRole("combobox", {
      name: "মালের নাম",
    }) as HTMLInputElement;
    await user.click(input);
    await user.type(input, "সি");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option").textContent).toContain("Crown · Shah");
    expect(document.querySelector("datalist")).toBeNull();
    expect(input.hasAttribute("list")).toBe(false);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(input.value).toBe("সিমেন্ট");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(submitted).not.toHaveBeenCalled();
  });
  it("keeps a newly typed name valid without forcing a suggestion", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(
      <AppCombobox
        aria-label="নতুন নাম"
        defaultValue=""
        suggestions={choices}
        onChange={(event) => changed(event.target.value)}
      />,
    );
    const input = screen.getByRole("combobox", {
      name: "নতুন নাম",
    }) as HTMLInputElement;
    await user.type(input, "আমার নতুন মাল");
    expect(screen.getByText("এই নামেই লিখতে পারবেন")).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(input.value).toBe("আমার নতুন মাল");
    expect(changed).toHaveBeenLastCalledWith("আমার নতুন মাল");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("supports pointer selection and keeps focus on the editable name", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(
      <AppCombobox
        aria-label="মাল"
        suggestions={choices}
        onChange={(event) => changed(event.target.value)}
      />,
    );
    const input = screen.getByRole("combobox", { name: "মাল" });
    await user.click(input);
    await user.click(screen.getByRole("option", { name: /লোহা/ }));
    expect(changed).toHaveBeenCalledExactlyOnceWith("লোহা");
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("closes suggestions when tabbing to another input without pulling focus back", async () => {
    const user = userEvent.setup();
    render(
      <>
        <AppCombobox aria-label="মাল" suggestions={choices} />
        <input aria-label="পরের ঘর" />
      </>,
    );
    await user.click(screen.getByRole("combobox", { name: "মাল" }));
    expect(screen.getByRole("listbox")).not.toBeNull();
    await user.keyboard("{Tab}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "পরের ঘর" }),
    );
  });
  it("keeps the parent dialog open for suggestion selection and Escape", async () => {
    const user = userEvent.setup();
    const parentClosed = vi.fn();
    const changed = vi.fn();
    render(
      <Dialog.Root
        defaultOpen
        onOpenChange={(open) => {
          if (!open) parentClosed();
        }}
      >
        <Dialog.Portal>
          <Dialog.Content>
            <Dialog.Title>খরচ লিখি</Dialog.Title>
            <Dialog.Description>মালের বিবরণ</Dialog.Description>
            <AppCombobox
              aria-label="মালের নাম"
              suggestions={choices}
              onChange={(event) => changed(event.target.value)}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>,
    );
    const input = screen.getByRole("combobox", { name: "মালের নাম" });
    await user.click(input);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(changed).toHaveBeenCalledExactlyOnceWith("সিমেন্ট");
    expect(screen.getByRole("dialog", { name: "খরচ লিখি" })).not.toBeNull();
    await user.click(input);
    expect(
      within(screen.getByRole("listbox")).getAllByRole("option").length,
    ).toBeGreaterThan(0);
    await user.keyboard("{Escape}");
    expect(parentClosed).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "খরচ লিখি" })).not.toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("does not accept a suggestion while a Bengali IME composition is finishing", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(
      <AppCombobox
        aria-label="মাল"
        suggestions={choices}
        onChange={(event) => changed(event.target.value)}
      />,
    );
    const input = screen.getByRole("combobox", { name: "মাল" });
    await user.click(input);
    await user.keyboard("{ArrowDown}");
    fireEvent.keyDown(input, {
      key: "Enter",
      code: "Enter",
      isComposing: true,
    });
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).not.toBeNull();
    await user.keyboard("{Enter}");
    expect(changed).toHaveBeenCalledExactlyOnceWith("সিমেন্ট");
  });
});
