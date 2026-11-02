// @vitest-environment jsdom
import { createRef, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { localizedDigits } from "../../lib/numerals";
import { NumericInput, type NumericInputProps } from "./NumericInput";
const locale = vi.hoisted(() => ({ language: "bn" as "bn" | "en" }));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    formatDigits: (value: string | number) =>
      localizedDigits(value, locale.language),
  }),
}));
afterEach(() => {
  cleanup();
  locale.language = "bn";
});
function Field({
  initial = "",
  type = "text",
  ...props
}: NumericInputProps & { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <NumericInput
        {...props}
        aria-label="Number"
        name="quantity"
        type={type}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <output data-testid="canonical">{value}</output>
    </>
  );
}
it("keeps a phone keyboard and forwarded input ref while emitting canonical mixed-script phone digits", async () => {
  const ref = createRef<HTMLInputElement>();
  const changed = vi.fn();
  render(
    <NumericInput
      ref={ref}
      aria-label="Phone"
      type="tel"
      name="phone"
      defaultValue="+88017"
      onChange={(event) =>
        changed(
          event.target.value,
          event.currentTarget.value,
          event.target.name,
        )
      }
    />,
  );
  const input = screen.getByRole("textbox", {
    name: "Phone",
  }) as HTMLInputElement;
  expect(ref.current).toBe(input);
  expect(input.type).toBe("tel");
  expect(input.inputMode).toBe("tel");
  expect(input.value).toBe("+৮৮০১৭");
  await userEvent.type(input, "১২3");
  expect(input.value).toBe("+৮৮০১৭১২৩");
  expect(changed).toHaveBeenLastCalledWith("+88017123", "+88017123", "phone");
});
it("uses a text-backed decimal keyboard instead of letting native number sanitization erase Bengali digits", async () => {
  render(<Field initial="162" type="number" />);
  const input = screen.getByRole("textbox", {
    name: "Number",
  }) as HTMLInputElement;
  expect(input.type).toBe("text");
  expect(input.inputMode).toBe("decimal");
  expect(input.value).toBe("১৬২");
  await userEvent.type(input, ".50");
  expect(input.value).toBe("১৬২.৫০");
  expect(screen.getByTestId("canonical").textContent).toBe("162.50");
});
it("preserves the decimal suffix and cursor when a middle selection is deleted then edited", async () => {
  const user = userEvent.setup();
  render(<Field initial="93000.50" />);
  const input = screen.getByRole("textbox", {
    name: "Number",
  }) as HTMLInputElement;
  await user.click(input);
  input.setSelectionRange(3, 5);
  await user.keyboard("{Backspace}2");
  expect(input.value).toBe("৯৩০২.৫০");
  expect(screen.getByTestId("canonical").textContent).toBe("9302.50");
  expect(input.selectionStart).toBe(4);
});
it("pastes mixed-script digits into a selected range without moving the rest of the amount", async () => {
  const user = userEvent.setup();
  render(<Field initial="1000" />);
  const input = screen.getByRole("textbox", {
    name: "Number",
  }) as HTMLInputElement;
  await user.click(input);
  input.setSelectionRange(1, 4);
  await user.paste("৬২.50");
  expect(input.value).toBe("১৬২.৫০");
  expect(screen.getByTestId("canonical").textContent).toBe("162.50");
});
it("switches an uncontrolled existing value between display languages without changing its canonical state", async () => {
  const view = render(
    <NumericInput aria-label="Quantity" defaultValue="১২.৫০" />,
  );
  const input = screen.getByRole("textbox", {
    name: "Quantity",
  }) as HTMLInputElement;
  expect(input.value).toBe("১২.৫০");
  locale.language = "en";
  view.rerender(<NumericInput aria-label="Quantity" defaultValue="99" />);
  expect(input.value).toBe("12.50");
  locale.language = "bn";
  view.rerender(<NumericInput aria-label="Quantity" defaultValue="99" />);
  expect(input.value).toBe("১২.৫০");
});
it("rejects ambiguous separators without changing the previously entered amount", () => {
  render(<Field initial="162" />);
  const input = screen.getByRole("textbox", {
    name: "Number",
  }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "১,5" } });
  expect(input.value).toBe("১৬২");
  expect(screen.getByTestId("canonical").textContent).toBe("162");
  fireEvent.change(input, { target: { value: "১ 2" } });
  expect(input.value).toBe("১৬২");
  expect(screen.getByTestId("canonical").textContent).toBe("162");
});

it.each(["1e3", "-100", "১২a৩", "10.2.3"])(
  "rejects the entire invalid paste %s and keeps the selected digits ready for replacement",
  async (pasted) => {
    const user = userEvent.setup();
    render(<Field initial="93000.50" />);
    const input = screen.getByRole("textbox", {
      name: "Number",
    }) as HTMLInputElement;
    await user.click(input);
    input.setSelectionRange(1, 4, "backward");
    await user.paste(pasted);
    expect(input.value).toBe("৯৩০০০.৫০");
    expect(screen.getByTestId("canonical").textContent).toBe("93000.50");
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(4);
    expect(input.selectionDirection).toBe("backward");
    await user.keyboard("৬");
    expect(input.value).toBe("৯৬০.৫০");
    expect(screen.getByTestId("canonical").textContent).toBe("960.50");
  },
);

it.each(["bn", "en"] as const)(
  "rejects typed letters without a change callback and preserves middle insertion in %s",
  async (language) => {
    locale.language = language;
    const user = userEvent.setup();
    const changed = vi.fn();
    render(
      <NumericInput
        aria-label="Amount"
        defaultValue="123.50"
        onChange={changed}
      />,
    );
    const input = screen.getByRole("textbox", {
      name: "Amount",
    }) as HTMLInputElement;
    await user.click(input);
    input.setSelectionRange(1, 1);
    await user.keyboard("e");
    expect(input.value).toBe(localizedDigits("123.50", language));
    expect(input.selectionStart).toBe(1);
    expect(changed).not.toHaveBeenCalled();
    await user.keyboard("6");
    expect(input.value).toBe(localizedDigits("1623.50", language));
    expect(input.selectionStart).toBe(2);
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ value: "1623.50" }),
      }),
    );
  },
);

it("accepts only whole digits for PINs, including mixed-script digits", async () => {
  const user = userEvent.setup();
  render(<Field inputMode="numeric" type="password" />);
  const input = screen.getByLabelText("Number") as HTMLInputElement;
  await user.type(input, "1a৩.1-8");
  expect(input.value).toBe("১৩১৮");
  expect(screen.getByTestId("canonical").textContent).toBe("1318");
  await user.clear(input);
  await user.paste("1e3");
  expect(input.value).toBe("");
  expect(screen.getByTestId("canonical").textContent).toBe("");
});

it("accepts formatted phone pastes and rejects pasted letters without altering the number", async () => {
  const user = userEvent.setup();
  render(<Field type="tel" />);
  const input = screen.getByRole("textbox", {
    name: "Number",
  }) as HTMLInputElement;
  await user.click(input);
  await user.paste("+৮৮০ (১৭১২) 345-678");
  expect(input.value).toBe("+৮৮০ (১৭১২) ৩৪৫-৬৭৮");
  expect(screen.getByTestId("canonical").textContent).toBe(
    "+880 (1712) 345-678",
  );
  input.setSelectionRange(0, input.value.length);
  await user.paste("01712abc45678");
  expect(screen.getByTestId("canonical").textContent).toBe(
    "+880 (1712) 345-678",
  );
});

it("rejects a completed nonnumeric composition while preserving the amount and caret", () => {
  render(<Field initial="123.50" />);
  const input = screen.getByRole("textbox", {
    name: "Number",
  }) as HTMLInputElement;
  input.focus();
  input.setSelectionRange(1, 2);
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "১ক৩.৫০" } });
  expect(input.value).toBe("১ক৩.৫০");
  expect(screen.getByTestId("canonical").textContent).toBe("123.50");
  fireEvent.compositionEnd(input, { data: "ক" });
  expect(input.value).toBe("১২৩.৫০");
  expect(input.selectionStart).toBe(1);
  expect(input.selectionEnd).toBe(2);
  expect(screen.getByTestId("canonical").textContent).toBe("123.50");
});

it("commits the final mobile input event when the keyboard only marks native composition events", () => {
  render(<Field initial="1" />);
  const input = screen.getByRole("textbox", {
    name: "Number",
  }) as HTMLInputElement;
  fireEvent.input(input, { target: { value: "১6" }, isComposing: true });
  expect(input.value).toBe("১6");
  expect(screen.getByTestId("canonical").textContent).toBe("1");
  fireEvent.input(input, { target: { value: "১৬" }, isComposing: false });
  expect(input.value).toBe("১৬");
  expect(screen.getByTestId("canonical").textContent).toBe("16");
});
