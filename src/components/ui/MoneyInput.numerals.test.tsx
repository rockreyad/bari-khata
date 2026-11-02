// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { localizedDigits } from "../../lib/numerals";
import { parseAmount } from "../../domain/ledger";
import { MoneyInput } from "./MoneyInput";
const locale = vi.hoisted(() => ({ language: "bn" as "bn" | "en" }));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    language: locale.language,
    t: (value: string) => value,
    formatDigits: (value: string | number) =>
      localizedDigits(value, locale.language),
    money: (value: number) => `৳${value / 100}`,
    number: (value: number) => localizedDigits(value, locale.language),
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
afterEach(() => {
  cleanup();
  locale.language = "bn";
});
function Field({
  initial = "",
  name = "amount",
}: {
  initial?: string;
  name?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <MoneyInput
        aria-label="Amount"
        name={name}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <output data-testid="canonical">{value}</output>
    </>
  );
}
it.each(["162", "93000.50"])(
  "keeps English keyboard input %s canonical while displaying Bengali",
  async (value) => {
    render(<Field />);
    const input = screen.getByRole("textbox", {
      name: "Amount",
    }) as HTMLInputElement;
    await userEvent.type(input, value);
    expect(input.value).toBe(localizedDigits(value, "bn"));
    expect(screen.getByTestId("canonical").textContent).toBe(value);
    expect(parseAmount(screen.getByTestId("canonical").textContent!)).toBe(
      parseAmount(value),
    );
  },
);
it("preserves the insertion caret while consecutive English digits are inserted into a Bengali amount", async () => {
  const user = userEvent.setup();
  render(<Field initial="1000" />);
  const input = screen.getByRole("textbox", {
    name: "Amount",
  }) as HTMLInputElement;
  await user.click(input);
  input.setSelectionRange(1, 1);
  await user.keyboard("23");
  expect(input.value).toBe("১২৩০০০");
  expect(screen.getByTestId("canonical").textContent).toBe("123000");
  expect(input.selectionStart).toBe(3);
});
it("does not commit partial IME composition or alter its text before composition ends", () => {
  render(<Field initial="1" />);
  const input = screen.getByRole("textbox", {
    name: "Amount",
  }) as HTMLInputElement;
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "১6" } });
  expect(input.value).toBe("১6");
  expect(screen.getByTestId("canonical").textContent).toBe("1");
  fireEvent.compositionEnd(input, { data: "6" });
  expect(input.value).toBe("১৬");
  expect(screen.getByTestId("canonical").textContent).toBe("16");
});
it("keeps existing English values and exact decimals unchanged when the display language changes", async () => {
  const view = render(<Field initial="93000.50" />);
  const input = screen.getByRole("textbox", {
    name: "Amount",
  }) as HTMLInputElement;
  expect(input.value).toBe("৯৩০০০.৫০");
  locale.language = "en";
  view.rerender(<Field initial="93000.50" />);
  expect(input.value).toBe("93000.50");
  expect(screen.getByTestId("canonical").textContent).toBe("93000.50");
});

it("keeps calculator arithmetic available while rejecting an entire pasted expression containing letters", async () => {
  const user = userEvent.setup();
  render(<Field initial="162" />);
  await user.click(
    screen.getByRole("button", { name: "হিসাব করার ক্যালকুলেটর" }),
  );
  const expression = screen.getByRole("textbox", {
    name: "ক্যালকুলেটরের হিসাব",
  }) as HTMLInputElement;
  await user.clear(expression);
  await user.paste("(৫ + 2) × 3 ÷ 2 − ১");
  expect(expression.value).toBe("(৫ + ২) × ৩ ÷ ২ − ১");
  expression.setSelectionRange(0, expression.value.length);
  await user.paste("1e3");
  expect(expression.value).toBe("(৫ + ২) × ৩ ÷ ২ − ১");
  await user.click(screen.getByRole("button", { name: "এই টাকা লিখি" }));
  expect(screen.getByTestId("canonical").textContent).toBe("9.5");
  expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe(
    "৯.৫",
  );
});

it("preserves grouped currency pastes in the calculator without loosening the amount field", async () => {
  const user = userEvent.setup();
  render(<Field />);
  const amount = screen.getByLabelText("Amount") as HTMLInputElement;
  await user.click(amount);
  await user.paste("৳1,500.50");
  expect(amount.value).toBe("");
  await user.click(
    screen.getByRole("button", { name: "হিসাব করার ক্যালকুলেটর" }),
  );
  const expression = screen.getByRole("textbox", {
    name: "ক্যালকুলেটরের হিসাব",
  }) as HTMLInputElement;
  await user.paste("৳1,500.50 + ৯৯.50");
  expect(expression.value).toBe("৳১,৫০০.৫০ + ৯৯.৫০");
  await user.click(screen.getByRole("button", { name: "এই টাকা লিখি" }));
  expect(screen.getByTestId("canonical").textContent).toBe("1600");
});
