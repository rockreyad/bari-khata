// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { LedgerPage } from "./LedgerPage";

const state = vi.hoisted(() => ({ ledger: null as unknown, detail: vi.fn() }));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    ledger: state.ledger as Ledger,
    add: vi.fn(),
    go: vi.fn(),
    detail: state.detail,
  }),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    language: "bn",
    t: (text: string) => text,
    money: (value: number) => `৳${value / 100}`,
    number: String,
    date: (value: string | null) => value ?? "—",
  }),
}));

afterEach(() => {
  cleanup();
  state.detail.mockClear();
});

function fixture(count = 65) {
  return LedgerSchema.parse({
    works: [{ id: "w", name: "কাজ" }],
    entries: Array.from({ length: count }, (_, index) => ({
      id: `e${String(index).padStart(3, "0")}`,
      kind: "expense",
      date: "2026-11-01",
      lines: [
        {
          id: `l${index}`,
          workId: "w",
          label: `${index < 35 ? "সিমেন্ট" : "বালি"} ${index + 1}`,
          amount: 10000,
        },
      ],
    })),
  });
}

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function open(path = "/ledger?order=oldest") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LedgerPage />
      <Location />
    </MemoryRouter>,
  );
}

describe("history load more", () => {
  it.each([0, 2, 30])(
    "hides pagination and load more for %i entries",
    (count) => {
      state.ledger = fixture(count);
      const { container } = open();
      expect(container.querySelectorAll(".history-row")).toHaveLength(count);
      expect(screen.queryByRole("button", { name: "আরও দেখুন" })).toBeNull();
      expect(container.querySelector(".list-load-more")).toBeNull();
      expect(screen.queryByRole("navigation")).toBeNull();
    },
  );

  it("appends without replacing previous rows or scrolling to the top, then hides the button", async () => {
    state.ledger = fixture();
    const scroll = vi.spyOn(window, "scrollTo");
    const user = userEvent.setup();
    const { container } = open();
    expect(container.querySelectorAll(".history-row")).toHaveLength(30);
    const first = container.querySelector(".history-row");
    await user.click(screen.getByRole("button", { name: "আরও দেখুন" }));
    expect(container.querySelectorAll(".history-row")).toHaveLength(60);
    expect(container.querySelector(".history-row")).toBe(first);
    expect(screen.getByTestId("location").textContent).toContain("page=2");
    await user.click(screen.getByRole("button", { name: "আরও দেখুন" }));
    expect(container.querySelectorAll(".history-row")).toHaveLength(65);
    expect(screen.queryByRole("button", { name: "আরও দেখুন" })).toBeNull();
    expect(container.querySelector(".list-load-more")).toBeNull();
    expect(scroll).not.toHaveBeenCalled();
    scroll.mockRestore();
    await user.click(first!);
    expect(state.detail).toHaveBeenCalledWith("e000");
  });

  it("resets appended rows when searching or changing chronology", async () => {
    state.ledger = fixture();
    const user = userEvent.setup();
    const { container } = open("/ledger?order=oldest&page=2");
    expect(container.querySelectorAll(".history-row")).toHaveLength(60);
    await user.type(
      screen.getByRole("textbox", { name: "হিসাব খুঁজুন" }),
      "সিমেন্ট",
    );
    expect(container.querySelectorAll(".history-row")).toHaveLength(30);
    expect(screen.getByTestId("location").textContent).not.toContain("page=");
    await user.click(screen.getByRole("button", { name: "আরও দেখুন" }));
    expect(container.querySelectorAll(".history-row")).toHaveLength(35);
    await user.click(screen.getByRole("button", { name: "শুরু থেকে" }));
    expect(container.querySelectorAll(".history-row")).toHaveLength(30);
    await user.type(
      screen.getByRole("textbox", { name: "হিসাব খুঁজুন" }),
      "নেই",
    );
    expect(container.querySelectorAll(".history-row")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "আরও দেখুন" })).toBeNull();
  });
});
