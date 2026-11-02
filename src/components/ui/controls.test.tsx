// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as Dialog from "@radix-ui/react-dialog";
import { AppSelect, selectChoices } from "./AppSelect";
import { AppDatePicker, calendarDate, calendarValue } from "./AppDatePicker";
import { AppMenu } from "./AppMenu";
import { MoneyInput } from "./MoneyInput";

vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    language: "bn",
    t: (text: string) => text,
    money: (value: number) => `৳${value / 100}`,
    number: String,
    formatDigits: String,
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

describe("app select", () => {
  it("uses a custom keyboard-operable trigger and preserves empty filter values", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    function Field() {
      const [value, setValue] = useState("");
      return (
        <AppSelect
          aria-label="কাজ"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            changed(event.target.value);
          }}
        >
          <option value="">সব খাতা</option>
          <option value="cement">সিমেন্ট</option>
          <option value="tiles">টাইলস</option>
        </AppSelect>
      );
    }
    render(<Field />);
    const trigger = screen.getByRole("combobox", { name: "কাজ" });
    expect(trigger.tagName).toBe("BUTTON");
    await user.click(trigger);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(changed).toHaveBeenLastCalledWith("cement");
    expect(trigger.textContent).toContain("সিমেন্ট");
    await user.click(trigger);
    await user.keyboard("{Home}{Enter}");
    expect(changed).toHaveBeenLastCalledWith("");
    expect(trigger.textContent).toContain("সব খাতা");
  });
  it("retains disabled options and nested option groups without exposing a native popup", async () => {
    const changed = vi.fn();
    const children = (
      <>
        <option value="">সব</option>
        <optgroup label="মাল">
          <option value="cement" disabled>
            সিমেন্ট
          </option>
          <option value="steel">রড</option>
        </optgroup>
      </>
    );
    expect(
      selectChoices(children).map((choice) => [
        choice.value,
        choice.disabled,
        choice.group,
      ]),
    ).toEqual([
      ["", false, ""],
      ["cement", true, "মাল"],
      ["steel", false, "মাল"],
    ]);
    render(
      <AppSelect aria-label="মাল" disabled value="steel" onChange={changed}>
        {children}
      </AppSelect>,
    );
    const trigger = screen.getByRole("combobox", { name: "মাল" });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    await userEvent.setup().click(trigger);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(changed).not.toHaveBeenCalled();
  });
});

describe("native form compatibility", () => {
  it("submits empty filter values as empty strings, never the internal sentinel", () => {
    render(
      <form aria-label="বিল">
        <AppSelect name="work" value="">
          <option value="">সব</option>
          <option value="cement">সিমেন্ট</option>
        </AppSelect>
      </form>,
    );
    const form = screen.getByRole("form", { name: "বিল" }) as HTMLFormElement;
    expect(new FormData(form).get("work")).toBe("");
  });
  it("keeps an empty required choice invalid and makes its custom picker available", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <AppSelect aria-label="জরুরি খাতা" name="work" value="" required>
          <option value="">বেছে নিন</option>
          <option value="cement">সিমেন্ট</option>
        </AppSelect>
        <button type="submit">রাখুন</button>
      </form>,
    );
    await user.click(screen.getByRole("button", { name: "রাখুন" }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).not.toBeNull();
  });
});

describe("app calendar", () => {
  it("opens the custom calendar and emits the exact local date", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(
      <AppDatePicker
        aria-label="তারিখ"
        value="2026-11-01"
        onChange={(event) => changed(event.target.value)}
      />,
    );
    expect(document.querySelector('input[type="date"]')).toBeNull();
    await user.click(screen.getByRole("button", { name: "তারিখ" }));
    await user.click(
      screen.getByRole("button", {
        name: "বৃহস্পতিবার, ৫ নভেম্বর, ২০২৬",
      }),
    );
    expect(changed).toHaveBeenCalledExactlyOnceWith("2026-11-05");
    expect(screen.queryByRole("grid")).toBeNull();
  });
  it("blocks an empty required date and opens the custom calendar", async () => {
    const user = userEvent.setup();
    const submitted = vi.fn();
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted();
        }}
      >
        <AppDatePicker name="date" aria-label="বিলের তারিখ" value="" required />
        <button type="submit">রাখুন</button>
      </form>,
    );
    await user.click(screen.getByRole("button", { name: "রাখুন" }));
    expect(submitted).not.toHaveBeenCalled();
    expect(screen.getByRole("grid")).not.toBeNull();
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });
  it("keeps invalid or impossible dates out of the calendar and round-trips leap days", () => {
    expect(calendarDate("2026-02-30")).toBeUndefined();
    expect(calendarDate("2026-02-29")).toBeUndefined();
    expect(calendarDate("not-a-date")).toBeUndefined();
    expect(calendarValue(calendarDate("2024-02-29")!)).toBe("2024-02-29");
  });
});

describe("embedded calculator", () => {
  it("applies exact decimal money through the normal input callback", async () => {
    const user = userEvent.setup();
    function Field() {
      const [value, setValue] = useState("42");
      return (
        <MoneyInput
          aria-label="টাকা"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      );
    }
    render(<Field />);
    await user.click(
      screen.getByRole("button", { name: "হিসাব করার ক্যালকুলেটর" }),
    );
    const expression = screen.getByRole("textbox", {
      name: "ক্যালকুলেটরের হিসাব",
    });
    await user.clear(expression);
    await user.type(expression, "0.1+0.2");
    expect(screen.getByRole("status").textContent).toContain("৳0.3");
    await user.click(screen.getByRole("button", { name: "এই টাকা লিখি" }));
    expect(
      (
        screen.getByRole("textbox", {
          name: "টাকা",
        }) as HTMLInputElement
      ).value,
    ).toBe("0.3");
    expect(
      screen.queryByRole("textbox", { name: "ক্যালকুলেটরের হিসাব" }),
    ).toBeNull();
  });
  it("does not change entered money for division by zero or Escape", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<MoneyInput aria-label="টাকা" value="1700" onChange={changed} />);
    await user.click(
      screen.getByRole("button", { name: "হিসাব করার ক্যালকুলেটর" }),
    );
    const expression = screen.getByRole("textbox", {
      name: "ক্যালকুলেটরের হিসাব",
    });
    await user.clear(expression);
    await user.type(expression, "100/0");
    await user.click(screen.getByRole("button", { name: "এই টাকা লিখি" }));
    const notice = screen.getByRole("alert");
    expect(notice.textContent).toContain("শূন্য দিয়ে ভাগ");
    expect(document.activeElement).toBe(notice);
    expect(
      notice.compareDocumentPosition(expression) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(expression.getAttribute("aria-invalid")).toBe("true");
    await user.click(expression);
    await user.click(screen.getByRole("button", { name: "এই টাকা লিখি" }));
    expect(document.activeElement).toBe(notice);
    expect((expression as HTMLInputElement).value).toBe("100/0");
    expect(changed).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("textbox", { name: "ক্যালকুলেটরের হিসাব" }),
    ).toBeNull();
    expect(
      (
        screen.getByRole("textbox", {
          name: "টাকা",
        }) as HTMLInputElement
      ).value,
    ).toBe("1700");
  });
  it("accepts keypad calculations without a separate phone calculator", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(
      <MoneyInput
        aria-label="টাকা"
        value=""
        onChange={(event) => changed(event.target.value)}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "হিসাব করার ক্যালকুলেটর" }),
    );
    const dialog = screen.getByRole("dialog");
    for (const label of ["5", "যোগ", "7", "গুণ", "2"])
      await user.click(within(dialog).getByRole("button", { name: label }));
    await user.click(
      within(dialog).getByRole("button", { name: "এই টাকা লিখি" }),
    );
    expect(changed).toHaveBeenCalledExactlyOnceWith("19");
  });
});

describe("app action menu", () => {
  it("offers keyboard actions and keeps disabled actions inactive", async () => {
    const user = userEvent.setup();
    const chosen = vi.fn();
    render(
      <AppMenu
        label="আরও"
        items={[
          { label: "তথ্য বদলাই", onSelect: chosen },
          { label: "মুছুন", onSelect: vi.fn(), disabled: true },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "আরও" }));
    const disabled = screen.getByRole("menuitem", { name: "মুছুন" });
    expect(disabled.getAttribute("data-disabled")).not.toBeNull();
    await user.keyboard("{Home}{Enter}");
    expect(chosen).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("controls inside an entry dialog", () => {
  it("keeps nested calendar month choices inside the open form", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    const dismissed = vi.fn();
    render(
      <Dialog.Root
        defaultOpen
        onOpenChange={(open) => {
          if (!open) dismissed();
        }}
      >
        <Dialog.Portal>
          <Dialog.Content>
            <Dialog.Title>খরচ লিখি</Dialog.Title>
            <Dialog.Description>খরচের তথ্য</Dialog.Description>
            <AppDatePicker
              aria-label="এন্ট্রির তারিখ"
              value="2026-11-01"
              onChange={(event) => changed(event.target.value)}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>,
    );
    await user.click(screen.getByRole("button", { name: "এন্ট্রির তারিখ" }));
    await user.click(screen.getByRole("combobox", { name: "মাস" }));
    await user.click(screen.getByRole("option", { name: "ডিসেম্বর" }));
    await user.click(
      screen.getByRole("button", { name: "শনিবার, ৫ ডিসেম্বর, ২০২৬" }),
    );
    expect(changed).toHaveBeenCalledExactlyOnceWith("2026-12-05");
    expect(screen.getByRole("dialog", { name: "খরচ লিখি" })).not.toBeNull();
    expect(dismissed).not.toHaveBeenCalled();
  });
  it("applies calculator values without submitting or dismissing the parent form", async () => {
    const user = userEvent.setup();
    const submitted = vi.fn();
    const changed = vi.fn();
    const dismissed = vi.fn();
    render(
      <Dialog.Root
        defaultOpen
        onOpenChange={(open) => {
          if (!open) dismissed();
        }}
      >
        <Dialog.Portal>
          <Dialog.Content>
            <Dialog.Title>টাকা দিলাম</Dialog.Title>
            <Dialog.Description>টাকার পরিমাণ</Dialog.Description>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitted();
              }}
            >
              <MoneyInput
                aria-label="মূল টাকা"
                value="100"
                onChange={(event) => changed(event.target.value)}
              />
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>,
    );
    await user.click(
      screen.getByRole("button", { name: "হিসাব করার ক্যালকুলেটর" }),
    );
    const expression = screen.getByRole("textbox", {
      name: "ক্যালকুলেটরের হিসাব",
    });
    await user.clear(expression);
    await user.type(expression, "1500+200");
    await user.click(screen.getByRole("button", { name: "এই টাকা লিখি" }));
    expect(changed).toHaveBeenCalledExactlyOnceWith("1700");
    expect(screen.getByRole("dialog", { name: "টাকা দিলাম" })).not.toBeNull();
    expect(submitted).not.toHaveBeenCalled();
    expect(dismissed).not.toHaveBeenCalled();
  });
});

function usePhoneViewport() {
  const original = window.matchMedia;
  window.matchMedia = vi.fn((query) => ({
    matches: query.includes("max-width: 760px"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: () => true,
  }));
  return () => {
    cleanup();
    window.matchMedia = original;
  };
}

describe("compact phone popup boundaries", () => {
  it("uses a portaled date dialog instead of anchoring a tall calendar above a field", async () => {
    const restore = usePhoneViewport();
    try {
      const user = userEvent.setup();
      const changed = vi.fn();
      const parentClosed = vi.fn();
      render(
        <Dialog.Root
          defaultOpen
          onOpenChange={(open) => {
            if (!open) parentClosed();
          }}
        >
          <Dialog.Portal>
            <Dialog.Content>
              <Dialog.Title>কাজের খাতা</Dialog.Title>
              <Dialog.Description>কাজের তথ্য</Dialog.Description>
              <AppDatePicker
                aria-label="কাজ শুরুর তারিখ"
                value="2026-11-01"
                onChange={(event) => changed(event.target.value)}
              />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>,
      );
      const trigger = screen.getByRole("button", { name: "কাজ শুরুর তারিখ" });
      await user.click(trigger);
      const calendar = screen.getByRole("dialog", { name: "তারিখ বেছে নিন" });
      expect(calendar.getAttribute("data-control-layout")).toBe("modal");
      expect(
        calendar.closest("[data-radix-popper-content-wrapper]"),
      ).toBeNull();
      expect(
        within(calendar).getByRole("button", { name: "বন্ধ করুন" }),
      ).not.toBeNull();
      await user.click(within(calendar).getByRole("combobox", { name: "মাস" }));
      await user.click(screen.getByRole("option", { name: "ডিসেম্বর" }));
      await user.click(
        screen.getByRole("button", { name: "শনিবার, ৫ ডিসেম্বর, ২০২৬" }),
      );
      expect(changed).toHaveBeenCalledExactlyOnceWith("2026-12-05");
      expect(screen.getByRole("dialog", { name: "কাজের খাতা" })).not.toBeNull();
      expect(parentClosed).not.toHaveBeenCalled();
      await waitFor(() => expect(document.activeElement).toBe(trigger));
    } finally {
      restore();
    }
  });
  it("keeps the complete calculator in a phone dialog and Escape closes only that calculator", async () => {
    const restore = usePhoneViewport();
    try {
      const user = userEvent.setup();
      const changed = vi.fn();
      const parentClosed = vi.fn();
      render(
        <Dialog.Root
          defaultOpen
          onOpenChange={(open) => {
            if (!open) parentClosed();
          }}
        >
          <Dialog.Portal>
            <Dialog.Content>
              <Dialog.Title>টাকা দিলাম</Dialog.Title>
              <Dialog.Description>টাকার হিসাব</Dialog.Description>
              <MoneyInput
                aria-label="ফোনের টাকা"
                value="500"
                onChange={(event) => changed(event.target.value)}
              />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>,
      );
      const trigger = screen.getByRole("button", {
        name: "হিসাব করার ক্যালকুলেটর",
      });
      await user.click(trigger);
      const calculator = screen.getByRole("dialog", { name: "হিসাব করি" });
      expect(calculator.getAttribute("data-control-layout")).toBe("modal");
      expect(
        calculator.closest("[data-radix-popper-content-wrapper]"),
      ).toBeNull();
      for (const key of ["সব মুছি", "3", "গুণ", "5"]) {
        await user.click(within(calculator).getByRole("button", { name: key }));
      }
      await user.click(
        within(calculator).getByRole("button", { name: "এই টাকা লিখি" }),
      );
      expect(changed).toHaveBeenCalledExactlyOnceWith("15");
      expect(screen.getByRole("dialog", { name: "টাকা দিলাম" })).not.toBeNull();
      await user.click(trigger);
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog", { name: "হিসাব করি" })).toBeNull();
      expect(screen.getByRole("dialog", { name: "টাকা দিলাম" })).not.toBeNull();
      expect(parentClosed).not.toHaveBeenCalled();
      await waitFor(() => expect(document.activeElement).toBe(trigger));
    } finally {
      restore();
    }
  });
});
