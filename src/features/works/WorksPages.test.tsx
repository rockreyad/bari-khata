// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router";
import { LedgerSchema } from "../../domain/model";
import { WorkPage } from "./WorksPages";
const context = vi.hoisted(() => ({ go: vi.fn(), ledger: {} as unknown }));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    ...context,
    add: vi.fn(),
    entity: vi.fn(),
    detail: vi.fn(),
  }),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string) => text,
    money: (value: number) => `৳${value / 100}`,
    number: String,
    date: String,
    language: "bn",
  }),
}));
afterEach(cleanup);
it("shows only a recent preview while keeping the complete work total and a scoped history route", async () => {
  context.ledger = LedgerSchema.parse({
    works: [{ id: "cement", name: "সিমেন্ট" }],
    entries: Array.from({ length: 65 }, (_, index) => ({
      id: `bill-${index}`,
      kind: "expense",
      date: "2026-11-01",
      createdAt: `2026-11-01T00:${String(index % 60).padStart(2, "0")}:00Z`,
      lines: [
        {
          id: `line-${index}`,
          workId: "cement",
          label: `সিমেন্ট ${index}`,
          amount: 100000,
        },
      ],
    })),
  });
  const { container } = render(
    <MemoryRouter initialEntries={["/works/cement"]}>
      <Routes>
        <Route path="/works/:workId" element={<WorkPage />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(container.querySelectorAll(".history-row")).toHaveLength(10);
  expect(container.querySelector(".work-scope-summary")?.textContent).toContain(
    "৳65000",
  );
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "সব লেনদেন" }));
  expect(context.go).toHaveBeenCalledWith(
    "/ledger?work=cement&account=materials",
  );
});
