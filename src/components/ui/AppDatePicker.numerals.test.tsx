// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  LanguageProvider,
  useLanguageContext,
} from "../../context/LanguageProvider";
import { localizedDigits } from "../../lib/numerals";
import { AppDatePicker } from "./AppDatePicker";

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
  localStorage.clear();
  vi.restoreAllMocks();
});

function Calendar() {
  const { setLanguage } = useLanguageContext();
  const [date, setDate] = useState("2026-11-01");
  return (
    <>
      <button onClick={() => setLanguage("en")}>English</button>
      <form aria-label="Entry">
        <AppDatePicker
          aria-label="Date"
          name="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </form>
      <output data-testid="stored-date">{date}</output>
    </>
  );
}

it("keeps calendar display and accessible dates in the selected script when native Intl uses the other digits", async () => {
  let nativeScript: "bn" | "en" = "en";
  const nativeDate = Object.getOwnPropertyDescriptor(
    Intl.DateTimeFormat.prototype,
    "format",
  )!.get!;
  vi.spyOn(
    Intl.DateTimeFormat.prototype as unknown as { format: unknown },
    "format",
    "get",
  ).mockImplementation(function (this: Intl.DateTimeFormat) {
    const format = nativeDate.call(this) as Intl.DateTimeFormat["format"];
    return (value?: number | Date) =>
      localizedDigits(format(value), nativeScript);
  });
  const nativeNumber = Object.getOwnPropertyDescriptor(
    Intl.NumberFormat.prototype,
    "format",
  )!.get!;
  vi.spyOn(
    Intl.NumberFormat.prototype as unknown as { format: unknown },
    "format",
    "get",
  ).mockImplementation(function (this: Intl.NumberFormat) {
    const format = nativeNumber.call(this) as Intl.NumberFormat["format"];
    return (value: number | bigint) =>
      localizedDigits(format(value), nativeScript);
  });
  const user = userEvent.setup();
  render(
    <LanguageProvider>
      <Calendar />
    </LanguageProvider>,
  );
  const trigger = screen.getByRole("button", { name: "Date" });
  expect(trigger.textContent).toContain("২০২৬");
  expect(trigger.textContent).not.toMatch(/[0-9]/);
  await user.click(trigger);
  let grid = screen.getByRole("grid");
  expect(grid.getAttribute("aria-label")).toContain("২০২৬");
  expect(grid.textContent).not.toMatch(/[0-9]/);
  const selected = grid.querySelector(".calendar-selected button")!;
  expect(selected.getAttribute("aria-label")).toContain("২০২৬");
  expect(selected.getAttribute("aria-label")).not.toMatch(/[0-9]/);
  const year = screen.getByRole("combobox", { name: "বছর" });
  expect(year.textContent).toContain("২০২৬");
  await user.click(year);
  expect(screen.getByRole("option", { name: "২০২৭" })).toBeTruthy();
  await user.click(screen.getByRole("option", { name: "২০২৬" }));
  await user.click(
    screen.getByRole("button", { name: "বৃহস্পতিবার, ৫ নভেম্বর, ২০২৬" }),
  );
  expect(screen.getByTestId("stored-date").textContent).toBe("2026-11-05");
  expect(
    new FormData(
      screen.getByRole("form", { name: "Entry" }) as HTMLFormElement,
    ).get("date"),
  ).toBe("2026-11-05");

  nativeScript = "bn";
  await user.click(screen.getByRole("button", { name: "English" }));
  expect(trigger.textContent).toContain("2026");
  expect(trigger.textContent).not.toMatch(/[০-৯]/);
  await user.click(trigger);
  grid = screen.getByRole("grid");
  expect(grid.getAttribute("aria-label")).toContain("2026");
  expect(grid.textContent).not.toMatch(/[০-৯]/);
  expect(
    grid.querySelector(".calendar-selected button")?.getAttribute("aria-label"),
  ).not.toMatch(/[০-৯]/);
  expect(screen.getByRole("combobox", { name: "Year" }).textContent).toContain(
    "2026",
  );
  expect(screen.getByTestId("stored-date").textContent).toBe("2026-11-05");
});
