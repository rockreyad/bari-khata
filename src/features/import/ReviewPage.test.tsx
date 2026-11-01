// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { ReviewPage } from "./ReviewPage";

const state = vi.hoisted(() => ({ ledger: null as Ledger | null }));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    ledger: state.ledger,
    save: vi.fn(),
    detail: vi.fn(),
  }),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    formatDigits: String,
    t: (text: string, values: Record<string, string | number> = {}) =>
      text.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
        String(values[key] ?? ""),
      ),
    money: (value: number) => `৳${value / 100}`,
    number: String,
    date: String,
    language: "bn",
  }),
}));
afterEach(cleanup);

function fixture(count = 65) {
  return LedgerSchema.parse({
    works: [{ id: "old", name: "পুরোনো" }],
    entries: Array.from({ length: count }, (_, index) => ({
      id: `old-${index}`,
      kind: "expense",
      balanceImpact: "historical",
      reviewStatus: "needs_review",
      date: "2026-01-01",
      note: `মূল নোট ${index}`,
      source: {
        file: "original.xlsx",
        sheet: "cost",
        cell: `A${index + 1}`,
        checksum: String(index).padStart(64, "0"),
        ledger: "Cost",
        note: `মূল লেখা ${index}`,
      },
      lines: [
        {
          id: `line-${index}`,
          workId: "old",
          label: `বালু ${index}`,
          amount: 10000,
        },
      ],
    })),
  });
}
function openReview() {
  return render(
    <MemoryRouter>
      <ReviewPage />
    </MemoryRouter>,
  );
}

describe("review queue load more", () => {
  it("appends only the next batch and hides the control after the final records", async () => {
    state.ledger = fixture();
    const user = userEvent.setup();
    const { container } = openReview();
    expect(container.querySelectorAll(".history-row")).toHaveLength(30);
    const first = container.querySelector(".history-row")?.textContent;
    await user.click(screen.getByRole("button", { name: "আরও দেখুন" }));
    expect(container.querySelectorAll(".history-row")).toHaveLength(60);
    expect(container.querySelector(".history-row")?.textContent).toBe(first);
    await user.click(screen.getByRole("button", { name: "আরও দেখুন" }));
    expect(container.querySelectorAll(".history-row")).toHaveLength(65);
    expect(screen.queryByRole("button", { name: "আরও দেখুন" })).toBeNull();
    expect(container.querySelector(".history-pagination-v4")).toBeNull();
    expect(state.ledger.entries).toHaveLength(65);
  });

  it.each([0, 2, 30])(
    "does not render a load control for %i records",
    (count) => {
      state.ledger = fixture(count);
      const { container } = openReview();
      expect(container.querySelectorAll(".history-row")).toHaveLength(count);
      expect(screen.queryByRole("button", { name: "আরও দেখুন" })).toBeNull();
    },
  );

  it("resets the visible batch when a search is applied and cleared or status changes", async () => {
    state.ledger = fixture();
    const user = userEvent.setup();
    const { container } = openReview();
    await user.click(screen.getByRole("button", { name: "আরও দেখুন" }));
    expect(container.querySelectorAll(".history-row")).toHaveLength(60);
    await user.type(
      screen.getByRole("textbox", { name: "নোট বা মূল ঘর দিয়ে খুঁজুন" }),
      "বালু 64",
    );
    expect(container.querySelectorAll(".history-row")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "আরও দেখুন" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "খোঁজা মুছুন" }));
    expect(container.querySelectorAll(".history-row")).toHaveLength(30);
    await user.click(screen.getByRole("button", { name: "আরও দেখুন" }));
    await user.click(screen.getByRole("button", { name: "তথ্য দেওয়া আছে" }));
    expect(container.querySelectorAll(".history-row")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "সব হিসাব" }));
    expect(container.querySelectorAll(".history-row")).toHaveLength(30);
  });

  it("keeps bulk selection capped at 100 when more than 100 records are displayed", async () => {
    state.ledger = fixture(125);
    const user = userEvent.setup();
    const { container } = openReview();
    for (let batch = 0; batch < 4; batch++) {
      await user.click(screen.getByRole("button", { name: "আরও দেখুন" }));
    }
    expect(container.querySelectorAll(".history-row")).toHaveLength(125);
    await user.click(screen.getByRole("button", { name: "একসঙ্গে ঠিক করি" }));
    await user.click(screen.getByRole("checkbox", { name: "দেখানো সব বাছি" }));
    expect(
      screen.getByRole("button", { name: "100টির তথ্য ঠিক করি" }),
    ).toBeTruthy();
    expect(
      container.querySelectorAll(".review-bulk-choice input:checked"),
    ).toHaveLength(100);
    expect(
      (
        screen.getByRole("checkbox", {
          name: "দেখানো সব বাছি",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: "দেখানো সব বাছি" }));
    expect(
      container.querySelectorAll(".review-bulk-choice input:checked"),
    ).toHaveLength(0);
    await user.click(screen.getByRole("checkbox", { name: /^বাছুন: বালু 0$/ }));
    const selectAll = screen.getByRole("checkbox", {
      name: "দেখানো সব বাছি",
    }) as HTMLInputElement;
    expect(selectAll.indeterminate).toBe(true);
    expect(selectAll.getAttribute("aria-checked")).toBe("mixed");
  });
});
