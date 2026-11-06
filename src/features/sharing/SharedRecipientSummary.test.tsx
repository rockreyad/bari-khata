// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SharedStatementPage } from "./SharedStatementPage";
import { SharedStatementSchema, type SharedStatement } from "./shareModel";

const mocked = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./SharedMonthlySection", () => ({ SharedMonthlySection: () => null }));
vi.mock("./shareClient", () => ({ readShare: mocked.read }));
vi.mock("./SharedEntryDetail", () => ({ SharedEntryDetail: () => null }));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string, values?: Record<string, string | number>) =>
      Object.entries(values ?? {}).reduce(
        (result, [key, value]) =>
          result.replaceAll(`{{${key}}}`, String(value)),
        text,
      ),
    money: (value: number) => `৳${value / 100}`,
    date: (value: string | null) => value ?? "তারিখ জানা নেই",
    formatDigits: (value: string | number) => String(value),
  }),
}));

function statement(overrides: Partial<SharedStatement> = {}) {
  return SharedStatementSchema.parse({
    person: { name: "নমুনা মিস্ত্রি", role: "মিস্ত্রি", kind: "worker" },
    projectName: "নমুনা বাড়ি",
    account: "labour",
    workName: "",
    updatedAt: "2026-11-06T12:00:00Z",
    revision: 1,
    total: 0,
    nextOffset: null,
    totals: {
      cost: 30000,
      paid: 10000,
      payable: 20000,
      advance: 0,
      historicalCost: 0,
    },
    rows: [],
    ...overrides,
  });
}

async function renderStatement(source: SharedStatement) {
  mocked.read.mockResolvedValue(source);
  const result = render(<SharedStatementPage />);
  const summary = await screen.findByRole("region", { name: "হিসাবের সারাংশ" });
  return { ...result, summary };
}

function metricText(scope: HTMLElement, label: string) {
  return within(scope).getByText(label, { exact: true }).parentElement
    ?.textContent;
}

beforeEach(() => {
  mocked.read.mockReset();
  window.location.hash = "b".repeat(64);
});
afterEach(cleanup);

describe("recipient-first shared summaries", () => {
  it.each(["labour", "materials"] as const)(
    "keeps received and due prominent for %s while bill details stay folded",
    async (account) => {
      const { summary } = await renderStatement(statement({ account }));
      expect(metricText(summary, "মোট পেয়েছেন")).toContain("৳100");
      expect(metricText(summary, "আর পাবেন")).toContain("৳200");
      const details = summary.querySelector<HTMLDetailsElement>(
        ".shared-summary-details",
      );
      expect(details).not.toBeNull();
      expect(details?.open).toBe(false);
      expect(details?.textContent).toContain("৳300");
    },
  );

  it("uses reconciled totals and keeps the cash correction discoverable", async () => {
    const source = statement();
    const { summary } = await renderStatement(
      statement({
        totals: {
          ...source.totals,
          reconciledNetPaid: 15000,
          reconciledPayable: 17000,
          paidCorrection: 5000,
          balanceCorrection: 2000,
          actualNetPaid: 10000,
        },
      }),
    );
    expect(metricText(summary, "মোট পেয়েছেন")).toContain("৳150");
    expect(metricText(summary, "আর পাবেন")).toContain("৳170");
    expect(summary.querySelector(".shared-total-main")?.textContent).toContain(
      "সমন্বয়",
    );
    const details = summary.querySelector<HTMLDetailsElement>(
      ".shared-summary-details",
    )!;
    await userEvent.click(details.querySelector("summary")!);
    expect(details.open).toBe(true);
    expect(summary.querySelector(".shared-total-main")?.textContent).toContain(
      "+৳50",
    );
    expect(details.textContent).toContain("৳100");
  });

  it("does not subtract a loaded refund again from the server's net received total", async () => {
    const source = statement();
    const { summary } = await renderStatement(
      statement({
        account: "materials",
        total: 1,
        counts: { ...source.counts, refund: 1 },
        totals: {
          ...source.totals,
          paid: 15000,
          payable: 15000,
          actualPaid: 20000,
          actualRefunds: 5000,
          actualNetPaid: 15000,
        },
        rows: [
          {
            key: "sample-refund",
            kind: "refund",
            date: "2026-11-06",
            historical: false,
            charge: 0,
            paid: -5000,
            description: "নমুনা ফেরত",
            works: "",
          },
        ],
      }),
    );
    expect(metricText(summary, "মোট পেয়েছেন")).toContain("৳150");
    expect(metricText(summary, "আর পাবেন")).toContain("৳150");
  });

  it("keeps money due and credit from separate jobs distinct", async () => {
    const source = statement();
    const { summary } = await renderStatement(
      statement({ totals: { ...source.totals, advance: 5000 } }),
    );
    expect(metricText(summary, "আর পাবেন")).toContain("৳200");
    expect(metricText(summary, "আপনার কাছে জমা")).toContain("৳50");
  });

  it.each(["labour", "materials"] as const)(
    "shows a credit instead of implying another payment is due for %s",
    async (account) => {
      const source = statement();
      const { summary } = await renderStatement(
        statement({
          account,
          totals: { ...source.totals, paid: 35000, payable: 0, advance: 5000 },
        }),
      );
      expect(metricText(summary, "মোট পেয়েছেন")).toContain("৳350");
      expect(metricText(summary, "আপনার কাছে জমা")).toContain("৳50");
      expect(
        within(summary).queryByText("আর পাবেন", { exact: true }),
      ).toBeNull();
      expect(within(summary).queryByText("পুরো বিল মেটানো")).toBeNull();
    },
  );

  it("keeps zero remaining visible after the bill has been paid", async () => {
    const source = statement();
    const { summary } = await renderStatement(
      statement({ totals: { ...source.totals, paid: 30000, payable: 0 } }),
    );
    expect(metricText(summary, "মোট পেয়েছেন")).toContain("৳300");
    expect(metricText(summary, "আর পাবেন")).toContain("৳0");
  });

  it("does not publish numeric due or credit when the balance needs review", async () => {
    const source = statement();
    const { summary, container } = await renderStatement(
      statement({
        totals: {
          ...source.totals,
          advance: 5000,
          balanceCorrection: 7000,
          balanceAmbiguous: true,
          earnedPayable: null,
        },
        contracts: [
          {
            title: "নমুনা অসম্পূর্ণ হিসাব",
            workName: "নমুনা ছাদ",
            total: 30000,
            netPaid: 10000,
            remaining: 20000,
          },
        ],
      }),
    );
    expect(metricText(summary, "মোট পেয়েছেন")).toContain("৳100");
    expect(summary.textContent).not.toContain("৳200");
    expect(summary.textContent).not.toContain("৳50");
    expect(summary.textContent).not.toContain("৳70");
    expect(within(summary).queryByText("বাকি নেই")).toBeNull();
    expect(within(summary).queryByText("পুরো বিল মেটানো")).toBeNull();
    const contracts = container.querySelector<HTMLElement>(
      ".shared-contract-carousel",
    )!;
    const balances = contracts.querySelector<HTMLElement>(
      ".shared-contract-balances",
    )!;
    expect(metricText(balances, "আর পাবেন")).toContain("বাকি মেলানো বাকি");
    expect(balances.textContent).not.toContain("৳200");
  });

  it("shows the contract total directly without treating unearned work as due", async () => {
    const { container } = await renderStatement(
      statement({
        contracts: [
          {
            title: "নমুনা ছাদের কাজ",
            workName: "নমুনা ছাদ",
            total: 100000,
            netPaid: 20000,
            remaining: 10000,
            remainingCommitment: 80000,
            unearnedCommitment: 70000,
          },
        ],
      }),
    );
    const contracts = container.querySelector<HTMLElement>(
      ".shared-contract-carousel",
    )!;
    const balances = contracts.querySelector<HTMLElement>(
      ".shared-contract-balances",
    )!;
    expect(metricText(balances, "পেয়েছেন")).toContain("৳200");
    expect(metricText(balances, "আর পাবেন")).toContain("৳100");
    expect(balances.textContent).not.toContain("৳800");
    expect(balances.textContent).not.toContain("৳700");
    expect(metricText(balances, "চুক্তির মোট")).toContain("৳1000");
    expect(contracts.querySelector("article details")).toBeNull();
  });
});
