// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SpendingChart } from "./SpendingChart";
import { LedgerSchema } from "../../domain/model";
import { formatMoney } from "../../lib/formatMoney";
const locale = vi.hoisted(() => ({ language: "bn" as "bn" | "en" }));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (value: string, values: Record<string, string> = {}) =>
      Object.entries(values).reduce(
        (text, [key, replacement]) =>
          text.replaceAll(`{{${key}}}`, replacement),
        value,
      ),
    money: (value: number) => formatMoney(value, locale.language),
    date: (value: string, options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(
        locale.language === "bn" ? "bn-BD" : "en-BD",
        options,
      ).format(new Date(`${value}T12:00:00+06:00`)),
  }),
}));
afterEach(() => {
  cleanup();
  locale.language = "bn";
});
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
  expect(screen.getByRole("heading", { name: "৳\u202f৫০" })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "নভেম্বর ২০২৬", pressed: true }),
  ).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "আগস্ট ২০২৬" }));
  expect(screen.getByRole("heading", { name: "৳\u202f৮০" })).toBeTruthy();
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

it("shows an unbilled worker payment in the cash chart rather than displaying a zero cost chart", () => {
  const ledger = LedgerSchema.parse({
    works: [{ id: "w", name: "কাজ" }],
    entries: [
      {
        id: "paid",
        kind: "payment",
        account: "labour",
        date: "2026-11-01",
        allocations: [{ workId: "w", amount: 16200 }],
        paymentParts: [{ amount: 16200 }],
      },
    ],
  });
  render(
    <SpendingChart ledger={ledger} basis="paid" title="মাসে মাসে দিয়েছি" />,
  );
  expect(screen.getByRole("heading", { name: "৳\u202f১৬২" })).toBeTruthy();
  expect(screen.getByText("মিস্ত্রির টাকা")).toBeTruthy();
});

function cashLedger(
  entries: {
    id: string;
    kind?: "payment" | "refund";
    date: string;
    amount: number;
    account?: "materials" | "labour" | "other";
  }[],
) {
  return LedgerSchema.parse({
    works: [{ id: "w", name: "কাজ" }],
    entries: entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind ?? "payment",
      date: entry.date,
      account: entry.account ?? "labour",
      allocations: [{ workId: "w", amount: entry.amount }],
      paymentParts: [{ amount: entry.amount }],
    })),
  });
}
function graphNode(month: string, amount: number) {
  return screen.getByRole("button", {
    name: `${month} · ${formatMoney(amount, locale.language)}`,
  });
}
it("keeps an embedded chart quiet initially, then selects an exact month by touching a visible node", async () => {
  const ledger = cashLedger([
    { id: "august", date: "2026-08-01", amount: 10025 },
    { id: "returned", kind: "refund", date: "2026-08-02", amount: 2005 },
    { id: "november", date: "2026-11-01", amount: 16200 },
  ]);
  const before = JSON.stringify(ledger);
  const { container } = render(
    <SpendingChart ledger={ledger} basis="paid" presentation="embedded" />,
  );
  expect(screen.getByRole("region", { name: "মাসের হিসাব" })).toBeTruthy();
  expect(container.querySelector("h2")).toBeNull();
  expect(container.querySelector(".spending-chart-legend")).toBeNull();
  expect(container.querySelector("output")).toBeNull();
  expect(screen.queryByText("৳ ১৬২")).toBeNull();
  expect(container.querySelectorAll(".spending-chart-node")).toHaveLength(6);
  const august = graphNode("আগস্ট ২০২৬", 8020);
  expect(august.getAttribute("aria-pressed")).toBe("false");
  await userEvent.pointer([
    { keys: "[TouchA>]", target: august },
    { keys: "[/TouchA]" },
  ]);
  expect(august.getAttribute("aria-pressed")).toBe("true");
  expect(
    screen.getByRole("button", { name: "আগস্ট ২০২৬", pressed: true }),
  ).toBeTruthy();
  expect(container.querySelector("output > strong")?.textContent).toBe(
    "৳\u202f৮০.২",
  );
  expect(screen.getAllByText("৳ ৮০.২")).toHaveLength(1);
  expect(container.querySelector(".spending-chart-legend")).toBeNull();
  expect(JSON.stringify(ledger)).toBe(before);
});

it("uses keyboard node navigation and month controls for zero and negative months", async () => {
  const ledger = cashLedger([
    { id: "paid", date: "2026-06-01", amount: 16200 },
    { id: "returned", kind: "refund", date: "2026-11-01", amount: 2000 },
  ]);
  const { container } = render(
    <SpendingChart ledger={ledger} basis="paid" presentation="embedded" />,
  );
  const user = userEvent.setup();
  const november = graphNode("নভেম্বর ২০২৬", -2000);
  november.focus();
  await user.keyboard("{Enter}");
  expect(container.querySelector("output > strong")?.textContent).toBe(
    formatMoney(-2000, "bn"),
  );
  await user.keyboard("{Home}");
  expect(document.activeElement).toBe(graphNode("জুন ২০২৬", 16200));
  expect(container.querySelector("output > strong")?.textContent).toBe(
    "৳\u202f১৬২",
  );
  await user.keyboard("{ArrowRight}");
  expect(document.activeElement).toBe(graphNode("জুলাই ২০২৬", 0));
  expect(container.querySelector("output > strong")?.textContent).toBe(
    "৳\u202f০",
  );
  await user.keyboard(" ");
  expect(
    screen.getByRole("button", { name: "জুলাই ২০২৬", pressed: true }),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "নভেম্বর ২০২৬" }));
  expect(november.getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelector("output > strong")?.textContent).toBe(
    formatMoney(-2000, "bn"),
  );
  expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
});

it("shows a selected total once and keeps a useful category breakdown only after interaction", async () => {
  const ledger = cashLedger([
    {
      id: "materials",
      date: "2026-11-01",
      amount: 10000,
      account: "materials",
    },
    { id: "labour", date: "2026-11-01", amount: 5000 },
  ]);
  const { container } = render(
    <SpendingChart ledger={ledger} basis="paid" presentation="embedded" />,
  );
  expect(container.querySelector(".spending-chart-legend")).toBeNull();
  await userEvent.click(graphNode("নভেম্বর ২০২৬", 15000));
  expect(screen.getAllByText("৳ ১৫০")).toHaveLength(1);
  const legend = container.querySelector(
    ".spending-chart-legend",
  ) as HTMLElement;
  expect(within(legend).getByText("মালের টাকা")).toBeTruthy();
  expect(within(legend).getByText("৳ ১০০")).toBeTruthy();
  expect(within(legend).getByText("মিস্ত্রির টাকা")).toBeTruthy();
  expect(within(legend).getByText("৳ ৫০")).toBeTruthy();
  expect(
    container.querySelectorAll("svg.spending-chart-plot path"),
  ).toHaveLength(2);
});

it("keeps zero-valued nodes when paid money and its refund cancel out", async () => {
  const ledger = cashLedger([
    { id: "paid", date: "2026-11-01", amount: 16200 },
    { id: "returned", kind: "refund", date: "2026-11-02", amount: 16200 },
  ]);
  const { container } = render(
    <SpendingChart ledger={ledger} basis="paid" presentation="embedded" />,
  );
  expect(container.querySelectorAll(".spending-chart-node")).toHaveLength(6);
  await userEvent.click(graphNode("নভেম্বর ২০২৬", 0));
  expect(container.querySelector("output > strong")?.textContent).toBe(
    "৳\u202f০",
  );
  expect(container.querySelector(".spending-chart-legend")).toBeNull();
  expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
});

it("retains every paisa in the selected callout when switching displayed number languages", async () => {
  const ledger = cashLedger([
    { id: "paid", date: "2026-11-01", amount: Number.MAX_SAFE_INTEGER },
  ]);
  const view = render(
    <SpendingChart ledger={ledger} basis="paid" presentation="embedded" />,
  );
  await userEvent.click(graphNode("নভেম্বর ২০২৬", Number.MAX_SAFE_INTEGER));
  expect(view.container.querySelector("output > strong")?.textContent).toBe(
    formatMoney(Number.MAX_SAFE_INTEGER, "bn"),
  );
  locale.language = "en";
  view.rerender(
    <SpendingChart ledger={ledger} basis="paid" presentation="embedded" />,
  );
  expect(view.container.querySelector("output > strong")?.textContent).toBe(
    formatMoney(Number.MAX_SAFE_INTEGER, "en"),
  );
  expect(
    view.container.querySelector("output > strong")?.textContent,
  ).toContain(".91");
  expect(view.container.innerHTML).not.toMatch(/NaN|Infinity/);
});

it.each(["first", "last"] as const)(
  "anchors a long %s-node callout inside its canvas without a fixed-width centering offset",
  async (edge) => {
    const amount =
      edge === "first" ? Number.MAX_SAFE_INTEGER - 2 : Number.MAX_SAFE_INTEGER;
    const ledger =
      edge === "first"
        ? cashLedger([
            { id: "june", date: "2026-06-01", amount },
            { id: "november", date: "2026-11-01", amount: 1 },
            { id: "returned", kind: "refund", date: "2026-11-02", amount: 1 },
          ])
        : cashLedger([{ id: "november", date: "2026-11-01", amount }]);
    const { container } = render(
      <SpendingChart ledger={ledger} basis="paid" presentation="embedded" />,
    );
    await userEvent.click(
      graphNode(edge === "first" ? "জুন ২০২৬" : "নভেম্বর ২০২৬", amount),
    );
    const callout = container.querySelector("output")!;
    expect(callout.querySelector("strong")?.textContent).toBe(
      formatMoney(amount, "bn"),
    );
    expect(callout.style[edge === "first" ? "left" : "right"]).toBe("8px");
    expect(callout.style[edge === "first" ? "right" : "left"]).toBe("");
    expect(callout.classList.contains("is-center")).toBe(false);
    expect(callout.classList.contains("is-below")).toBe(true);
  },
);

it.each(["card", "embedded"] as const)(
  "keeps the %s curve clean until node selection while retaining its interactive controls",
  async (presentation) => {
    const ledger = cashLedger([
      { id: "paid", date: "2026-11-01", amount: 16200 },
    ]);
    const { container } = render(
      <SpendingChart
        ledger={ledger}
        basis="paid"
        presentation={presentation}
      />,
    );
    const nodes = [
      ...container.querySelectorAll<HTMLButtonElement>(".spending-chart-node"),
    ];
    expect(nodes).toHaveLength(6);
    expect(nodes.every((node) => node.dataset.selected === "false")).toBe(true);
    expect(nodes.some((node) => node.tabIndex === 0)).toBe(true);
    const november =
      presentation === "embedded"
        ? graphNode("নভেম্বর ২০২৬", 16200)
        : screen.getByRole("button", {
            name: "নভেম্বর ২০২৬ · মিস্ত্রির টাকা · ৳\u202f১৬২",
          });
    await userEvent.click(november);
    expect(november.dataset.selected).toBe("true");
    expect(
      nodes.filter((node) => node.dataset.selected === "true"),
    ).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "জুন ২০২৬" }));
    expect(november.dataset.selected).toBe("false");
    expect(
      nodes.filter((node) => node.dataset.selected === "true"),
    ).toHaveLength(1);
  },
);
