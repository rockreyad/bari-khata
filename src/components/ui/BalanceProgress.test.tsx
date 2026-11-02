// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  LanguageProvider,
  useLanguageContext,
} from "../../context/LanguageProvider";
import { savePreferences } from "../../lib/preferences";
import { BalanceProgress, type BalanceProgressProps } from "./BalanceProgress";

afterEach(() => {
  cleanup();
  localStorage.clear();
});
function Example(props: BalanceProgressProps) {
  const { t } = useLanguageContext();
  return <BalanceProgress {...props} label={t("চুক্তি")} />;
}
function mount(
  total: number,
  paid: number,
  language: "bn" | "en" = "bn",
  props: Partial<BalanceProgressProps> = {},
) {
  savePreferences({ language });
  return render(
    <LanguageProvider>
      <Example total={total} paid={paid} {...props} />
    </LanguageProvider>,
  );
}

describe.each(["bn", "en"] as const)("balance progress in %s", (language) => {
  it("announces exact paid and remaining amounts with a canonical accessible percent", () => {
    const { container } = mount(60000000, 12345678, language);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(bar.getAttribute("aria-valuenow")).toBe("20.57");
    expect(bar.getAttribute("aria-label")).toBe(
      language === "bn" ? "চুক্তি" : "Agreement",
    );
    expect(bar.getAttribute("aria-valuetext")).toContain(
      language === "bn" ? "৳\u202f১,২৩,৪৫৬.৭৮" : "৳\u202f123,456.78",
    );
    expect(bar.getAttribute("aria-valuetext")).toContain(
      language === "bn" ? "৳\u202f৪,৭৬,৫৪৩.২২" : "৳\u202f476,543.22",
    );
    expect(
      container.querySelector(".balance-progress-heading strong")?.textContent,
    ).toBe(language === "bn" ? "২০.৫৭%" : "20.57%");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("20.57%");
  });

  it("clamps overpayment to a full bar without losing the exact advance", () => {
    const { container } = mount(9300000, 10000000, language);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("100");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("100%");
    expect(
      container.querySelector(".balance-progress-credit")?.textContent,
    ).toContain(language === "bn" ? "৳\u202f৭,০০০" : "৳\u202f7,000");
    expect(bar.getAttribute("aria-valuetext")).toContain(
      language === "bn" ? "৳\u202f১,০০,০০০" : "৳\u202f100,000",
    );
    expect(container.querySelector(".balance-progress-settled")).toBeNull();
  });

  it("marks a fully settled goal and keeps compact bars free of repeated amount rows", () => {
    const { container } = mount(9300000, 9300000, language, {
      compact: true,
      showAmounts: false,
    });
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "100",
    );
    expect(
      container.querySelector(".balance-progress-settled")?.textContent,
    ).toBe(language === "bn" ? "বাকি নেই" : "No balance due");
    expect(container.querySelector(".balance-progress-amounts")).toBeNull();
    expect(container.querySelector(".balance-progress-credit")).toBeNull();
    expect(
      container.querySelector(".balance-progress.is-compact"),
    ).not.toBeNull();
  });
});

it("retains the last paisa and computes the percent safely near the integer limit", () => {
  const { container } = mount(
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER - 1,
    "en",
  );
  const bar = screen.getByRole("progressbar");
  expect(bar.getAttribute("aria-valuenow")).toBe("99.99");
  expect(
    container.querySelector(".balance-progress-amounts")?.textContent,
  ).toContain("৳\u202f90,071,992,547,409.91");
  expect(bar.getAttribute("aria-valuetext")).toContain("৳\u202f0.01");
  expect(container.querySelector(".balance-progress-settled")).toBeNull();
});

it("clamps a net refund to zero progress while retaining its signed cash and increased due", () => {
  mount(10000, -10000, "en");
  const bar = screen.getByRole("progressbar");
  expect(bar.getAttribute("aria-valuenow")).toBe("0");
  expect(bar.getAttribute("aria-valuetext")).toContain("৳\u202f-100");
  expect(bar.getAttribute("aria-valuetext")).toContain("৳\u202f200");
});

it("keeps an empty goal finite and avoids announcing it as settled", () => {
  const { container } = mount(0, 0);
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
    "0",
  );
  expect(container.querySelector(".balance-progress-settled")).toBeNull();
  expect(container.textContent).not.toContain("NaN");
});

it("lets the entry preview own the balance text without repeating status below the bar", () => {
  const { container, rerender } = mount(10000, 15000, "bn", {
    showAmounts: false,
    showStatus: false,
  });
  expect(container.querySelector(".balance-progress-credit")).toBeNull();
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
    "100",
  );
  rerender(
    <LanguageProvider>
      <BalanceProgress
        total={10000}
        paid={10000}
        showAmounts={false}
        showStatus={false}
      />
    </LanguageProvider>,
  );
  expect(container.querySelector(".balance-progress-settled")).toBeNull();
});
