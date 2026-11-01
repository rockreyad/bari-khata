// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SharedStatementPage } from "./SharedStatementPage";
import { SharedStatementSchema } from "./shareModel";
const mocked = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./shareClient", () => ({ readShare: mocked.read }));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string) => text,
    money: (value: number) => `৳${value / 100}`,
    date: (value: string | null) => value ?? "তারিখ জানা নেই",
  }),
}));
const page = () =>
  SharedStatementSchema.parse({
    person: { name: "রহিম", role: "মিস্ত্রি" },
    projectName: "বাড়ি",
    account: "labour",
    workName: "",
    updatedAt: "2026-11-01T12:00:00Z",
    revision: 1,
    total: 2,
    nextOffset: 1,
    totals: {
      cost: 30000,
      paid: 10000,
      payable: 20000,
      advance: 0,
      historicalCost: 0,
    },
    rows: [
      {
        key: "one",
        date: "2026-11-01",
        kind: "expense",
        historical: false,
        charge: 30000,
        paid: 0,
        description: "মজুরির বিল",
        works: "টাইলস",
      },
    ],
  });
beforeEach(() => {
  mocked.read.mockReset();
  window.location.hash = "a".repeat(64);
});
afterEach(cleanup);
describe("public live statements", () => {
  it("loads another bounded page on request and refreshes without stale rows", async () => {
    const first = page();
    mocked.read
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({
        ...first,
        nextOffset: null,
        rows: [
          {
            ...first.rows[0],
            key: "two",
            description: "টাকা দিয়েছি",
            kind: "payment",
            charge: 0,
            paid: 10000,
          },
        ],
      })
      .mockResolvedValueOnce({
        ...first,
        revision: 2,
        total: 1,
        nextOffset: null,
        rows: [{ ...first.rows[0], key: "new", description: "সংশোধিত বিল" }],
      });
    const user = userEvent.setup();
    render(<SharedStatementPage />);
    await screen.findByText("মজুরির বিল");
    expect(mocked.read).toHaveBeenCalledWith("a".repeat(64));
    await user.click(screen.getByRole("button", { name: "আরও হিসাব দেখি" }));
    await waitFor(() =>
      expect(screen.getAllByText("টাকা দিয়েছি").length).toBeGreaterThan(1),
    );
    expect(mocked.read).toHaveBeenLastCalledWith("a".repeat(64), 1, 1);
    expect(screen.queryByRole("button", { name: "আরও হিসাব দেখি" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "হালনাগাদ দেখি" }));
    await screen.findByText("সংশোধিত বিল");
    expect(screen.queryByText("মজুরির বিল")).toBeNull();
    expect(screen.queryByRole("button", { name: "সংশোধন করুন" })).toBeNull();
  });
  it("clears a previously visible statement after its link is revoked", async () => {
    mocked.read.mockResolvedValueOnce(page()).mockResolvedValueOnce(null);
    const user = userEvent.setup();
    render(<SharedStatementPage />);
    await screen.findByText("মজুরির বিল");
    await user.click(screen.getByRole("button", { name: "হালনাগাদ দেখি" }));
    await screen.findByText("লিংকটি এখন কাজ করছে না");
    expect(screen.queryByText("রহিম")).toBeNull();
    expect(screen.queryByText("মজুরির বিল")).toBeNull();
  });
  it("asks for refresh when entries change between pages", async () => {
    mocked.read
      .mockResolvedValueOnce(page())
      .mockRejectedValueOnce(new Error("share_changed"));
    const user = userEvent.setup();
    render(<SharedStatementPage />);
    await screen.findByText("মজুরির বিল");
    await user.click(screen.getByRole("button", { name: "আরও হিসাব দেখি" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toBe(
      "নতুন হিসাব এসেছে। হালনাগাদ করে আবার দেখুন।",
    );
  });
  it("switches links on hash navigation and removes the previous person's data", async () => {
    mocked.read.mockResolvedValueOnce(page()).mockResolvedValueOnce(null);
    render(<SharedStatementPage />);
    await screen.findByText("মজুরির বিল");
    await act(async () => {
      window.history.replaceState(null, "", `#${"b".repeat(64)}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await screen.findByText("লিংকটি এখন কাজ করছে না");
    expect(mocked.read).toHaveBeenLastCalledWith("b".repeat(64));
    expect(screen.queryByText("রহিম")).toBeNull();
  });
  it("validates bounded financial responses and strips unexpected private fields", () => {
    const clean = page();
    expect(
      SharedStatementSchema.parse({
        ...clean,
        source: "private",
        owner_id: "secret",
      }),
    ).not.toHaveProperty("source");
    expect(() =>
      SharedStatementSchema.parse({
        ...clean,
        rows: Array.from({ length: 61 }, () => clean.rows[0]),
      }),
    ).toThrow();
    expect(() =>
      SharedStatementSchema.parse({
        ...clean,
        totals: { ...clean.totals, cost: Number.MAX_SAFE_INTEGER + 1 },
      }),
    ).toThrow();
  });
});
