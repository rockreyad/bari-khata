// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { SharedMonthlySection } from "./SharedMonthlySection";
import { SharedStatementSchema } from "./shareModel";

const mocked = vi.hoisted(() => ({ monthly: vi.fn() }));
vi.mock("./useSharedMonthly", () => ({ useSharedMonthly: mocked.monthly }));
vi.mock("./SharedMonthlyChart", () => ({
  SharedMonthlyChart: ({ error }: { error: string }) => (
    <p role="status">{error || "নমুনা মাসের হিসাব"}</p>
  ),
}));
const statement = SharedStatementSchema.parse({
  person: { name: "নমুনা দোকান", role: "" },
  projectName: "নমুনা খাতা",
  account: "materials",
  workName: "",
  updatedAt: "2026-11-06T12:00:00Z",
  revision: 1,
  total: 0,
  nextOffset: null,
  totals: { cost: 0, paid: 0, payable: 0, advance: 0, historicalCost: 0 },
  rows: [],
});
beforeEach(() => mocked.monthly.mockReset());
afterEach(cleanup);

it.each([
  ["share_unavailable", true, false],
  ["share_changed", false, true],
  ["share_request_failed", false, false],
] as const)(
  "handles %s without retaining a revoked or changed statement",
  async (error, unavailable, stale) => {
    const onUnavailable = vi.fn();
    const onStale = vi.fn();
    mocked.monthly.mockReturnValue({
      data: null,
      busy: false,
      error,
      retry: vi.fn(),
    });
    render(
      <SharedMonthlySection
        token={"c".repeat(64)}
        statement={statement}
        onUnavailable={onUnavailable}
        onStale={onStale}
      />,
    );
    await screen.findByRole("status");
    await waitFor(() => {
      expect(onUnavailable).toHaveBeenCalledTimes(unavailable ? 1 : 0);
      expect(onStale).toHaveBeenCalledTimes(stale ? 1 : 0);
    });
  },
);
