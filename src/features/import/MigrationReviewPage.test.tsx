// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContractSchema, type Ledger } from "../../domain/model";
import { legacyArchitectureFixture } from "../../domain/testing/legacyArchitecture";
import { createMigrationReview } from "../../domain/migrationReview";
import { MigrationReviewPage } from "./MigrationReviewPage";

const state = vi.hoisted(() => ({
  ledger: null as Ledger | null,
  detail: vi.fn(),
  go: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    ledger: state.ledger,
    mode: "demo",
    detail: state.detail,
    go: state.go,
  }),
}));
vi.mock("../../data/repository", () => ({
  getScopedRepository: () => ({
    migrationReview: async () => ({
      sources: [createMigrationReview(state.ledger!)],
    }),
  }),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string) => text,
    money: (value: number) => `৳${value / 100}`,
    number: String,
    formatDigits: String,
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("explains old contract figures beside earned-only dues and links ambiguous source records without generating adjustments", async () => {
  const ledger = legacyArchitectureFixture();
  ledger.entries = ledger.entries.slice(0, 2);
  ledger.entries[0].lines[0].amount = 30000;
  ledger.entries[1].paymentParts[0].amount = 10000;
  ledger.entries[1].allocations[0].amount = 10000;
  ledger.entries[1].note = "নমুনা পুরোনো টাকা";
  ledger.contracts = [
    ContractSchema.parse({
      id: "c",
      workId: "w",
      personId: "p",
      title: "নমুনা চুক্তি",
      total: 100000,
    }),
  ];
  ledger.entries.forEach((entry) => {
    entry.contractId = "c";
  });
  state.ledger = ledger;
  const original = structuredClone(ledger);
  render(<MigrationReviewPage />);
  expect(
    screen.getByRole("heading", { name: "পুরোনো হিসাব যাচাই" }),
  ).toBeTruthy();
  expect(screen.getAllByText("৳900").length).toBeGreaterThan(0);
  expect(screen.getAllByText("৳200").length).toBeGreaterThan(0);
  expect(screen.getByText("৳700")).toBeTruthy();
  expect(
    screen.getByText(
      "অঙ্ক মেলানোর জন্য নতুন বিল, পরিশোধ বা অগ্রিম বানানো হয়নি। পুরোনো অস্পষ্ট তথ্য দেখে নেওয়ার জন্য রাখা আছে।",
    ),
  ).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "লেখাটি দেখি" }));
  expect(state.detail).toHaveBeenCalledWith("paid");
  await waitFor(() =>
    expect(screen.getByText(/তথ্য আনার সময়ের সংরক্ষিত প্রতিবেদন/)).toBeTruthy(),
  );
  expect(state.ledger).toEqual(original);
});
