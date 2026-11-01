// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router";
import { LedgerSchema } from "../../domain/model";
import { WorkPage } from "./WorksPages";
const context = vi.hoisted(() => ({
  go: vi.fn(),
  add: vi.fn(),
  ledger: {} as unknown,
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    ...context,
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
    <MemoryRouter initialEntries={["/works/cement?tab=material"]}>
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
    .click(screen.getByRole("button", { name: "পুরো হিসাব" }));
  expect(context.go).toHaveBeenCalledWith(
    "/ledger?work=cement&account=materials",
  );
});

it("opens a work with all payments visible, distinct cost/paid totals, and a whole-work history link", async () => {
  context.ledger = LedgerSchema.parse({
    works: [
      {
        id: "door",
        name: "দরজা",
        quickActions: ["expense", "payment", "labour"],
      },
    ],
    people: [{ id: "shah", name: "শাহ আলম", kind: "worker" }],
    entries: [
      {
        id: "weekly",
        kind: "payment",
        account: "labour",
        personId: "shah",
        allocations: [{ workId: "door", amount: 3000000 }],
        paymentParts: [{ amount: 3000000 }],
      },
    ],
  });
  const { container } = render(
    <MemoryRouter initialEntries={["/works/door"]}>
      <Routes>
        <Route path="/works/:workId" element={<WorkPage />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(
    screen.getByRole("button", { name: "সব লেনদেন", pressed: true }),
  ).toBeTruthy();
  expect(container.querySelectorAll(".history-payment")).toHaveLength(1);
  expect(
    container.querySelector(".work-overview-total")?.textContent,
  ).toContain("৳0");
  expect(
    container.querySelector(".work-overview-balances")?.textContent,
  ).toContain("৳30000");
  expect(screen.getByText("শাহ আলম")).toBeTruthy();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "টাকা দিলাম" }));
  expect(context.add).toHaveBeenCalledWith({
    kind: "payment",
    workId: "door",
    account: undefined,
  });
  await user.click(screen.getByRole("button", { name: "পুরো হিসাব" }));
  expect(context.go).toHaveBeenCalledWith("/ledger?work=door");
  await user.click(screen.getByRole("button", { name: "মজুরি" }));
  expect(container.querySelectorAll(".history-payment")).toHaveLength(1);
  expect(container.querySelector(".work-scope-summary")?.textContent).toContain(
    "৳0",
  );
});
