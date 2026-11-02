// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageProvider, useLanguageContext } from "./LanguageProvider";
import { localizedDigits } from "../lib/numerals";
import { MoneyInput } from "../components/ui/MoneyInput";
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
function Probe() {
  const { t, formatDigits, money, number, date, setLanguage } =
    useLanguageContext();
  const [amount, setAmount] = useState("1250.50");
  return (
    <>
      <p data-testid="label">{formatDigits("8টি দরজা ১২")}</p>
      <p data-testid="copy">
        {t("{{count}}টি হিসাবের তথ্য যোগ করা বাকি", { count: 12 })}
      </p>
      <p data-testid="money">{money(125050)}</p>
      <p data-testid="number">{number(2026)}</p>
      <p data-testid="date">{date("2026-11-02", { year: "numeric" })}</p>
      <p data-testid="instant">
        {date("2026-11-01T20:30:00Z", { year: "numeric" })}
      </p>
      <MoneyInput
        aria-label="Amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <output data-testid="stored">{amount}</output>
      <button onClick={() => setLanguage("en")}>English</button>
      <button onClick={() => setLanguage("bn")}>বাংলা</button>
    </>
  );
}
it("normalizes both numeral scripts without changing punctuation or non-numeric text", () => {
  expect(localizedDigits("দরজা 8 / ১২.50%", "bn")).toBe("দরজা ৮ / ১২.৫০%");
  expect(localizedDigits("দরজা ৮ / ১২.৫০%", "en")).toBe("দরজা 8 / 12.50%");
});
it("switches text, amounts, dates and editable money digits live while keeping canonical stored amounts", async () => {
  render(
    <LanguageProvider>
      <Probe />
    </LanguageProvider>,
  );
  expect(screen.getByTestId("label").textContent).toBe("৮টি দরজা ১২");
  expect(screen.getByTestId("copy").textContent).toContain("১২টি");
  expect(screen.getByTestId("money").textContent).toBe("৳\u202f১,২৫০.৫");
  expect(screen.getByTestId("number").textContent).toContain(
    "২০২৬".slice(0, 1),
  );
  expect(screen.getByTestId("date").textContent).toContain("২০২৬");
  expect(screen.getByTestId("instant").textContent).toBe(
    screen.getByTestId("date").textContent,
  );
  const input = screen.getByRole("textbox", {
    name: "Amount",
  }) as HTMLInputElement;
  expect(input.value).toBe("১২৫০.৫০");
  fireEvent.change(input, { target: { value: "9৩.5" } });
  expect(input.value).toBe("৯৩.৫");
  expect(screen.getByTestId("stored").textContent).toBe("93.5");
  await userEvent.click(screen.getByRole("button", { name: "English" }));
  expect(screen.getByTestId("money").textContent).toBe("৳\u202f1,250.5");
  expect(screen.getByTestId("label").textContent).toBe("8টি দরজা 12");
  expect(screen.getByTestId("copy").textContent).toContain("12");
  expect(screen.getByTestId("date").textContent).toContain("2026");
  expect(screen.getByTestId("instant").textContent).toBe(
    screen.getByTestId("date").textContent,
  );
  expect(input.value).toBe("93.5");
  await userEvent.click(screen.getByRole("button", { name: "বাংলা" }));
  expect(input.value).toBe("৯৩.৫");
});

it.each(["bn", "en"] as const)(
  "keeps %s money, counts and dates consistent when native Intl digits fall back",
  async (language) => {
    const view = render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    if (language === "en")
      await userEvent.click(screen.getByRole("button", { name: "English" }));
    const fields = ["money", "number", "date", "instant"];
    const expected = fields.map(
      (field) => screen.getByTestId(field).textContent,
    );
    const script = language === "bn" ? "en" : "bn";
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
      return (value: number | bigint) => localizedDigits(format(value), script);
    });
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
      return (value?: number | Date) => localizedDigits(format(value), script);
    });
    view.rerender(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    fields.forEach((field, index) => {
      const shown = screen.getByTestId(field).textContent;
      expect(shown).toBe(expected[index]);
      expect(shown).not.toMatch(language === "bn" ? /[0-9]/ : /[০-৯]/);
    });
    expect(screen.getByTestId("stored").textContent).toBe("1250.50");
  },
);
