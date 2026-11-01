// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SpendingChart } from "./SpendingChart";
import { LedgerSchema } from "../../domain/model";
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (value: string) => value,
    money: (value: number) =>
      `৳${new Intl.NumberFormat("bn-BD").format(value / 100)}`,
    date: (value: string, options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("bn-BD", options).format(
        new Date(`${value}T12:00:00+06:00`),
      ),
  }),
}));
afterEach(cleanup);
it("lets the owner compare a selected month and retains exact returns without counting payments", async () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "w", name: "খাতা" }],
    entries: [
      {
        id: "august",
        kind: "expense",
        date: "2026-08-01",
        lines: [{ id: "a", workId: "w", label: "মাল", amount: 10000 }],
      },
      {
        id: "return",
        kind: "expense_credit",
        date: "2026-08-02",
        lines: [{ id: "r", workId: "w", label: "ফেরত", amount: 2000 }],
      },
      {
        id: "november",
        kind: "expense",
        account: "labour",
        date: "2026-11-01",
        lines: [
          {
            id: "n",
            workId: "w",
            label: "কাজ",
            costType: "labour",
            amount: 5000,
          },
        ],
      },
      {
        id: "paid",
        kind: "payment",
        date: "2026-11-01",
        allocations: [{ workId: "w", amount: 6000 }],
        paymentParts: [{ amount: 6000 }],
      },
    ],
  });
  const { container } = render(<SpendingChart ledger={ledger} workId="w" />);
  expect(screen.getByRole("heading", { name: "৳৫০" })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "নভেম্বর ২০২৬", pressed: true }),
  ).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "আগস্ট ২০২৬" }));
  expect(screen.getByRole("heading", { name: "৳৮০" })).toBeTruthy();
  expect(
    container.querySelectorAll("svg.spending-chart-plot path"),
  ).toHaveLength(4);
  expect(screen.queryByText("অন্য খরচ")).toBeNull();
  expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
});
it("hides an empty chart", () => {
  const { container } = render(
    <SpendingChart ledger={LedgerSchema.parse({})} />,
  );
  expect(container.childElementCount).toBe(0);
});
