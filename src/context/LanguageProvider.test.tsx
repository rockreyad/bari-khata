// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageProvider, useLanguageContext } from "./LanguageProvider";
import { localizedDigits } from "../lib/numerals";
import { MoneyInput } from "../components/ui/MoneyInput";
afterEach(() => {
  cleanup();
  localStorage.clear();
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
  expect(screen.getByTestId("money").textContent).toBe("৳১,২৫০.৫");
  expect(screen.getByTestId("number").textContent).toContain(
    "২০২৬".slice(0, 1),
  );
  expect(screen.getByTestId("date").textContent).toContain("২০২৬");
  const input = screen.getByRole("textbox", {
    name: "Amount",
  }) as HTMLInputElement;
  expect(input.value).toBe("১২৫০.৫০");
  fireEvent.change(input, { target: { value: "9৩.5" } });
  expect(input.value).toBe("৯৩.৫");
  expect(screen.getByTestId("stored").textContent).toBe("93.5");
  await userEvent.click(screen.getByRole("button", { name: "English" }));
  expect(screen.getByTestId("label").textContent).toBe("8টি দরজা 12");
  expect(screen.getByTestId("copy").textContent).toContain("12");
  expect(screen.getByTestId("date").textContent).toContain("2026");
  expect(input.value).toBe("93.5");
  await userEvent.click(screen.getByRole("button", { name: "বাংলা" }));
  expect(input.value).toBe("৯৩.৫");
});
