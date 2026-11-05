// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageProvider } from "../../context/LanguageProvider";
import { formatMoney } from "../../lib/formatMoney";
import { savePreferences } from "../../lib/preferences";
import { SpendingSeriesChart } from "./SpendingChart";
import type { SpendingMonth } from "./monthlySpending";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const month = (value: string, amount: number): SpendingMonth => ({
  month: value,
  material: amount,
  labour: 0,
  other: 0,
  total: amount,
});
const fixture = () => [
  month("2025-12", 120025),
  month("2026-08", -20005),
  month("2026-11", 900000),
];

function Controlled({
  rows,
  initial = "",
}: {
  rows: SpendingMonth[];
  initial?: string;
}) {
  const [selected, setSelected] = useState(initial);
  return (
    <>
      <SpendingSeriesChart
        rows={rows}
        selectedMonth={selected}
        onMonthChange={setSelected}
        presentation="embedded"
        windowed
      />
      <output data-testid="month-scope">{selected}</output>
    </>
  );
}
function mount(rows = fixture(), initial = "", language: "bn" | "en" = "en") {
  savePreferences({ language });
  return render(
    <LanguageProvider>
      <Controlled rows={rows} initial={initial} />
    </LanguageProvider>,
  );
}

it("fills only the visible six-month window and lets the owner reach older years", async () => {
  const rows = fixture();
  const before = JSON.stringify(rows);
  const view = mount(rows);
  expect(screen.getByRole("img").getAttribute("aria-description")).toContain(
    `August 2026 · ${formatMoney(-20005, "en")}`,
  );
  expect(screen.getByRole("img").textContent).toBe("");
  expect(
    screen.getByRole("navigation", { name: "Chart date range" }).textContent,
  ).toContain("June 2026 – November 2026");
  const nodes = screen.getByRole("group", {
    name: "Choose a month on the graph",
  });
  expect(within(nodes).getAllByRole("button")).toHaveLength(6);
  expect(
    within(nodes).getByRole("button", {
      name: `July 2026 · ${formatMoney(0, "en")}`,
    }),
  ).toBeTruthy();
  expect(
    within(nodes).getByRole("button", {
      name: `August 2026 · ${formatMoney(-20005, "en")}`,
    }),
  ).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Later months" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);

  await userEvent.click(screen.getByRole("button", { name: "Earlier months" }));
  expect(
    screen.getByRole("navigation", { name: "Chart date range" }).textContent,
  ).toContain("December 2025 – May 2026");
  expect(
    within(nodes).getByRole("button", {
      name: `December 2025 · ${formatMoney(120025, "en")}`,
    }),
  ).toBeTruthy();
  expect(
    (
      screen.getByRole("button", {
        name: "Earlier months",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(view.container.innerHTML).not.toMatch(/NaN|Infinity/);
  expect(JSON.stringify(rows)).toBe(before);
});

it("reveals a month restored from the URL and toggles the same month back to all results", async () => {
  const view = mount(fixture(), "2025-12");
  const december = screen.getByRole("button", {
    name: "December 2025",
    pressed: true,
  });
  expect(
    view.container.querySelector("output.spending-chart-callout strong")
      ?.textContent,
  ).toBe(formatMoney(120025, "en"));
  await userEvent.click(december);
  expect(screen.getByTestId("month-scope").textContent).toBe("");
  expect(
    view.container.querySelector("output.spending-chart-callout"),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: "December 2025", pressed: false }),
  ).toBeTruthy();
});

it("clears the selected month before paging away from its visible window", async () => {
  mount(fixture(), "2026-11");
  expect(screen.getByTestId("month-scope").textContent).toBe("2026-11");
  await userEvent.click(screen.getByRole("button", { name: "Earlier months" }));
  expect(screen.getByTestId("month-scope").textContent).toBe("");
  expect(
    screen.getByRole("button", { name: "December 2025", pressed: false }),
  ).toBeTruthy();
});

it("moves focus and the controlled scope together when choosing months with the keyboard", () => {
  mount(fixture(), "2025-12");
  const nodes = screen.getByRole("group", {
    name: "Choose a month on the graph",
  });
  const december = within(nodes).getByRole("button", {
    name: `December 2025 · ${formatMoney(120025, "en")}`,
  });
  december.focus();
  fireEvent.keyDown(december, { key: "ArrowRight" });
  expect(screen.getByTestId("month-scope").textContent).toBe("2026-01");
  expect(document.activeElement).toBe(
    within(nodes).getByRole("button", {
      name: `January 2026 · ${formatMoney(0, "en")}`,
    }),
  );
});

it.each([0, -20005, Number.MAX_SAFE_INTEGER])(
  "retains the exact %s paise month without treating zero or returns as missing data",
  async (amount) => {
    const view = mount([month("2026-11", amount)], "", "bn");
    await userEvent.click(screen.getByRole("button", { name: "নভেম্বর ২০২৬" }));
    expect(
      view.container.querySelector("output.spending-chart-callout strong")
        ?.textContent,
    ).toBe(formatMoney(amount, "bn"));
    expect(view.container.innerHTML).not.toMatch(/NaN|Infinity/);
  },
);

it("keeps a single supplied month centered and an empty series hidden", () => {
  savePreferences({ language: "en" });
  const view = render(
    <LanguageProvider>
      <SpendingSeriesChart
        rows={[month("2026-11", 125)]}
        presentation="embedded"
      />
    </LanguageProvider>,
  );
  expect(
    view.container.querySelector<HTMLButtonElement>(".spending-chart-node")
      ?.style.left,
  ).toBe("50%");
  expect(view.container.innerHTML).not.toMatch(/NaN|Infinity/);
  view.rerender(
    <LanguageProvider>
      <SpendingSeriesChart rows={[]} presentation="embedded" />
    </LanguageProvider>,
  );
  expect(view.container.childElementCount).toBe(0);
});
