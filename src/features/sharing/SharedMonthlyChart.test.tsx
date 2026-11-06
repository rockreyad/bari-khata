// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SharedMonthlyChart } from "./SharedMonthlyChart";
import type { SharedMonthlyData } from "./sharedMonthly";

vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string, values?: Record<string, string | number>) =>
      Object.entries(values ?? {}).reduce(
        (result, [key, value]) =>
          result.replaceAll(`{{${key}}}`, String(value)),
        text,
      ),
    money: (value: number) => `৳${value / 100}`,
    formatDigits: (value: string | number) => String(value),
    date: (value: string, options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en", { timeZone: "UTC", ...options }).format(
        new Date(`${value}T12:00:00Z`),
      ),
  }),
}));

afterEach(cleanup);
const data = (): SharedMonthlyData => ({
  revision: 3,
  months: [
    { month: "2026-09", received: 25000, refunded: 0, net: 25000 },
    { month: "2026-11", received: 40000, refunded: 10000, net: 30000 },
  ],
  undated: { received: 0, refunded: 0, net: 0 },
  totals: { received: 65000, refunded: 10000, net: 55000 },
});
function mount(
  source: SharedMonthlyData | null = data(),
  extra: Partial<Parameters<typeof SharedMonthlyChart>[0]> = {},
) {
  return render(
    <SharedMonthlyChart
      data={source}
      busy={false}
      error=""
      onRetry={vi.fn()}
      {...extra}
    />,
  );
}

const monthButtons = () =>
  within(screen.getByRole("group", { name: "চার্টের মাস বেছে নিন" }));

describe("shared monthly chart", () => {
  it("plots actual received money with zero gaps and shows refund details on selection", async () => {
    const source = data();
    const before = JSON.stringify(source);
    mount(source);
    expect(monthButtons().getAllByRole("button")).toHaveLength(3);
    expect(screen.getByRole("img").getAttribute("aria-description")).toContain(
      "October 2026 · ৳0",
    );
    expect(screen.queryByRole("button", { name: /December 2026/ })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    await userEvent.click(
      monthButtons().getByRole("button", { name: "November 2026" }),
    );
    expect(screen.getByRole("status", { name: "পেয়েছেন" }).textContent).toBe(
      "November 2026৳400",
    );
    expect(
      screen.getByText("ফেরত দিয়েছেন").nextElementSibling?.textContent,
    ).toBe("৳100");
    expect(
      screen.getByText("ফেরত বাদে পেয়েছেন").nextElementSibling?.textContent,
    ).toBe("৳300");
    expect(JSON.stringify(source)).toBe(before);
  });

  it("selects or clears a month by touch and follows keyboard navigation", async () => {
    mount();
    const september = screen.getByRole("button", {
      name: "September 2026 · ৳250",
    });
    await userEvent.click(september);
    expect(september.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("status", { name: "পেয়েছেন" }).textContent).toBe(
      "September 2026৳250",
    );
    expect(screen.queryByText("ফেরত দিয়েছেন")).toBeNull();
    await userEvent.keyboard("{ArrowRight}");
    const october = screen.getByRole("button", {
      name: "October 2026 · ৳0",
    });
    expect(document.activeElement).toBe(october);
    expect(october.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("status", { name: "পেয়েছেন" }).textContent).toBe(
      "October 2026৳0",
    );
    await userEvent.click(october);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps selected amounts outside the scrolling plot for early and late months in a full year", async () => {
    const source = data();
    source.months = [1, 3, 9, 12].map((month) => ({
      month: `2025-${String(month).padStart(2, "0")}`,
      received: month * 10000,
      refunded: 0,
      net: month * 10000,
    }));
    source.totals = { received: 250000, refunded: 0, net: 250000 };
    mount(source);
    expect(screen.queryByRole("status", { name: "পেয়েছেন" })).toBeNull();
    for (const [month, amount] of [
      ["March 2025", "৳300"],
      ["September 2025", "৳900"],
    ]) {
      await userEvent.click(
        monthButtons().getByRole("button", { name: month }),
      );
      const selected = screen.getByRole("status", { name: "পেয়েছেন" });
      expect(selected.textContent).toBe(`${month}${amount}`);
      expect(selected.closest(".shared-chart-scroll")).toBeNull();
      expect(selected.closest(".shared-chart-plot-container")).not.toBeNull();
    }
  });

  it("makes older years available through a compact selector without pagination arrows", async () => {
    const source = data();
    source.months.unshift({
      month: "2025-12",
      received: 10000,
      refunded: 0,
      net: 10000,
    });
    source.totals.received += 10000;
    source.totals.net += 10000;
    mount(source);
    const year = screen.getByRole("combobox", { name: "বছর বেছে দেখুন" });
    await userEvent.selectOptions(year, "2025");
    expect(monthButtons().getAllByRole("button")).toHaveLength(1);
    await userEvent.click(
      monthButtons().getByRole("button", { name: "December 2025" }),
    );
    expect(screen.getByRole("status", { name: "পেয়েছেন" }).textContent).toBe(
      "December 2025৳100",
    );
    await userEvent.selectOptions(year, "2026");
    expect(screen.queryByRole("status")).toBeNull();
    expect(monthButtons().getAllByRole("button")).toHaveLength(11);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("button", { name: /আগের|পরের/ })).toBeNull();
  });

  it("keeps undated cash outside the chart and exposes refunds without assigning a false month", async () => {
    const source = data();
    source.months = [];
    source.undated = { received: 30000, refunded: 5000, net: 25000 };
    source.totals = { ...source.undated };
    const { container } = mount(source);
    expect(
      screen.getByText("তারিখ লেখা হলে মাসের হিসাবে দেখা যাবে।"),
    ).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    const undated = container.querySelector<HTMLDetailsElement>(
      ".shared-chart-undated",
    )!;
    expect(undated.open).toBe(false);
    await userEvent.click(undated.querySelector("summary")!);
    expect(undated.open).toBe(true);
    expect(within(undated).getByText("৳300")).toBeTruthy();
    expect(within(undated).getByText("৳50")).toBeTruthy();
    expect(within(undated).getByText("৳250")).toBeTruthy();
  });

  it("does not show partial or old amounts during loading and retries a failed load", async () => {
    const retry = vi.fn();
    const view = mount(data(), { busy: true });
    expect(screen.getByRole("status").textContent).toContain(
      "মাসের হিসাব আসছে…",
    );
    expect(screen.queryByRole("img")).toBeNull();
    view.rerender(
      <SharedMonthlyChart
        data={data()}
        busy={false}
        error="share_request_failed"
        onRetry={retry}
      />,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "আবার চেষ্টা করুন" }),
    );
    expect(retry).toHaveBeenCalledOnce();
  });

  it("handles a refund-only month without plotting the refund as a receipt", async () => {
    const source = data();
    source.months = [
      { month: "2026-11", received: 0, refunded: 10000, net: -10000 },
    ];
    source.totals = { received: 0, refunded: 10000, net: -10000 };
    mount(source);
    expect(screen.getByRole("img").getAttribute("aria-description")).toBe(
      "November 2026 · ৳0",
    );
    await userEvent.click(
      monthButtons().getByRole("button", { name: "November 2026" }),
    );
    expect(screen.getByRole("status", { name: "পেয়েছেন" }).textContent).toBe(
      "November 2026৳0",
    );
    expect(
      screen.getByText("ফেরত বাদে পেয়েছেন").nextElementSibling?.textContent,
    ).toBe("৳-100");
  });

  it("lets a recipient inspect all zero months in a year between recorded payments", async () => {
    const source = data();
    source.months.unshift({
      month: "2024-12",
      received: 10000,
      refunded: 0,
      net: 10000,
    });
    source.totals.received += 10000;
    source.totals.net += 10000;
    mount(source);
    const year = screen.getByRole("combobox", { name: "বছর বেছে দেখুন" });
    await userEvent.selectOptions(year, "2025");
    expect(monthButtons().getAllByRole("button")).toHaveLength(12);
    expect(screen.getAllByRole("button", { name: /2025 · ৳0/ })).toHaveLength(
      12,
    );
    await userEvent.click(
      monthButtons().getByRole("button", { name: "December 2025" }),
    );
    expect(screen.getByRole("status", { name: "পেয়েছেন" }).textContent).toBe(
      "December 2025৳0",
    );
    await userEvent.selectOptions(year, "2024");
    expect(
      monthButtons().getByRole("button", { name: "December 2024" }),
    ).toBeTruthy();
  });

  it("keeps the initial chart minimal even when account totals contain corrections", () => {
    mount(data(), { hasPaidCorrection: true });
    expect(screen.getByRole("heading", { name: "মাসের হিসাব" })).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("কোন মাসে কত পেয়েছেন")).toBeNull();
    expect(screen.queryByText("মাসে চাপ দিলে টাকার অঙ্ক দেখবেন")).toBeNull();
    expect(
      screen.queryByText("হিসাব মেলানোর পরিবর্তন এখানে ধরা হয়নি।"),
    ).toBeNull();
  });
});
