// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { LanguageProvider } from "../../context/LanguageProvider";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { saveContractChange } from "../../domain/contracts";
import { savePreferences } from "../../lib/preferences";
import { PersonPage } from "./PersonPage";
import { WorkPage } from "../works/WorksPages";
import { JobPage } from "../jobs/JobPages";

const state = vi.hoisted(() => ({
  ledger: null as unknown,
  add: vi.fn(),
  entity: vi.fn(),
  go: vi.fn(),
  detail: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    ledger: state.ledger as Ledger,
    add: state.add,
    entity: state.entity,
    go: state.go,
    detail: state.detail,
    base: "",
  }),
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});
function mount(ledger: Ledger, path: string, language: "bn" | "en" = "bn") {
  state.ledger = ledger;
  savePreferences({ language });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LanguageProvider>
        <Routes>
          <Route path="/people/:personId" element={<PersonPage />} />
          <Route path="/works/:workId" element={<WorkPage />} />
          <Route path="/jobs/:jobId" element={<JobPage />} />
        </Routes>
      </LanguageProvider>
    </MemoryRouter>,
  );
}
function fixture() {
  let ledger = LedgerSchema.parse({
    works: [
      { id: "door", name: "দরজা" },
      { id: "roof", name: "ছাদ" },
    ],
    people: [
      { id: "worker", name: "শাহ আলম", kind: "worker" },
      { id: "shop", name: "দরজার দোকান", kind: "shop" },
    ],
    contracts: [
      {
        id: "house",
        scope: "house",
        workId: null,
        personId: "worker",
        title: "রাজমিস্ত্রির চুক্তি",
        total: 50000000,
        rate: 50000000,
        agreedOn: "2026-08-01",
        history: [
          { at: "2026-07-01T03:00:00Z", total: 45000000, note: "আগের দর" },
        ],
      },
      {
        id: "roof-only",
        workId: "roof",
        personId: "worker",
        title: "ছাদের বাড়তি কাজ",
        total: 1000000,
      },
    ],
    entries: [
      {
        id: "door-cash",
        kind: "payment",
        personId: "worker",
        account: "labour",
        contractId: "house",
        date: "2026-09-01",
        allocations: [{ workId: "door", amount: 3000000 }],
        paymentParts: [{ amount: 3000000 }],
      },
      {
        id: "roof-cash",
        kind: "payment",
        personId: "worker",
        account: "labour",
        contractId: "house",
        date: "2026-09-02",
        allocations: [{ workId: "roof", amount: 2000000 }],
        paymentParts: [{ amount: 2000000 }],
      },
      {
        id: "shop-bill",
        kind: "expense",
        personId: "shop",
        date: "2026-09-01",
        lines: [
          { id: "doors", workId: "door", amount: 9300000, label: "দরজা" },
        ],
      },
      {
        id: "shop-cash",
        kind: "payment",
        personId: "shop",
        date: "2026-09-01",
        relatedEntryId: "shop-bill",
        allocations: [{ workId: "door", amount: 3000000 }],
        paymentParts: [{ amount: 3000000 }],
      },
    ],
  });
  ledger = saveContractChange(
    ledger,
    { ...ledger.contracts[0], total: 60000000, rate: 60000000 },
    "বারান্দার কাজ যোগ হয়েছে",
    "2026-09-12T03:30:00Z",
  );
  return ledger;
}
it("opens a work's compact house-job preview and retains its legacy and dated changes on the job history route", () => {
  const ledger = fixture();
  const work = mount(ledger, "/works/door?tab=labour");
  const tile = work.container.querySelector<HTMLElement>(".job-snap-card")!;
  expect(tile.textContent).toContain("শাহ আলম");
  expect(tile.textContent).not.toContain("পুরো বাড়ি");
  expect(tile.textContent).toContain("৳\u202f৬,০০,০০০");
  expect(work.container.querySelectorAll(".job-snap-card")).toHaveLength(1);
  expect(work.container.querySelector(".contract-history")).toBeNull();
  expect(within(tile).queryByRole("progressbar")).toBeNull();
  fireEvent.click(tile);
  expect(state.go).toHaveBeenLastCalledWith(
    "/jobs/house?back=%2Fworks%2Fdoor%3Ftab%3Dlabour",
  );
  work.unmount();
  const detail = mount(ledger, "/jobs/house?tab=history");
  const history =
    detail.container.querySelector<HTMLElement>(".contract-history")!;
  expect(within(history).getByText("বারান্দার কাজ যোগ হয়েছে")).toBeTruthy();
  expect(within(history).getByText("আগের দর")).toBeTruthy();
  expect(
    history.querySelector(".contract-history-amount")?.textContent,
  ).toContain("৳\u202f৫,০০,০০০");
  expect(
    history.querySelector(".contract-history-amount")?.textContent,
  ).toContain("৳\u202f৬,০০,০০০");
  expect(
    history.querySelector("time[datetime='2026-09-12T03:30:00Z']")?.textContent,
  ).toContain("২০২৬");
  expect(
    ledger.contracts.find((contract) => contract.id === "house")!.history,
  ).toHaveLength(1);
  expect(
    ledger.contracts.find((contract) => contract.id === "house")!.activity,
  ).toHaveLength(1);
});

it("loads older job changes only on the dedicated history page and hides the button at the end", async () => {
  const ledger = fixture();
  const contract = ledger.contracts.find((row) => row.id === "house")!;
  contract.history = Array.from({ length: 14 }, (_, i) => ({
    at: `2026-07-${String(i + 1).padStart(2, "0")}T03:00:00Z`,
    total: 45000000 + i * 100000,
    note: `আগের পরিবর্তন ${i + 1}`,
  }));
  const { container } = mount(ledger, "/jobs/house?tab=history");
  const history = container.querySelector<HTMLElement>(".contract-history")!;
  await waitFor(() =>
    expect(
      history.querySelectorAll(".contract-history-list > li"),
    ).toHaveLength(12),
  );
  fireEvent.click(within(history).getByRole("button", { name: "আরও দেখুন" }));
  expect(history.querySelectorAll(".contract-history-list > li")).toHaveLength(
    15,
  );
  expect(
    within(history).queryByRole("button", { name: "আরও দেখুন" }),
  ).toBeNull();
  expect(contract.history).toHaveLength(14);
});
