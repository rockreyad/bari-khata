// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormError, useFormError } from "./FormError";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Form() {
  const [, setError, notice] = useFormError();
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setError("কী বাবদ খরচ, ছোট করে লিখুন।");
      }}
    >
      <FormError {...notice} />
      <label>
        নোট
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <button type="submit">রাখুন</button>
      <button type="button" onClick={() => setError("")}>
        মুছুন
      </button>
    </form>
  );
}

it("brings each failed attempt into view without interrupting subsequent typing", async () => {
  const scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scroll,
  });
  const user = userEvent.setup();
  render(<Form />);
  expect(screen.queryByRole("alert")).toBeNull();
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  const notice = screen.getByRole("alert");
  expect(document.activeElement).toBe(notice);
  expect(scroll).toHaveBeenCalledExactlyOnceWith({
    block: "start",
    behavior: "instant",
  });
  const input = screen.getByRole("textbox", { name: "নোট" });
  await user.type(input, "দরজা আনার ভাড়া");
  expect(document.activeElement).toBe(input);
  expect(scroll).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  expect(document.activeElement).toBe(notice);
  expect(scroll).toHaveBeenCalledTimes(2);
  expect((input as HTMLInputElement).value).toBe("দরজা আনার ভাড়া");
  await user.click(screen.getByRole("button", { name: "মুছুন" }));
  expect(screen.queryByRole("alert")).toBeNull();
});
