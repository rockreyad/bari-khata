// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { LedgerSchema, type Ledger } from "../domain/model";
import { setEntityRemoved } from "../domain/entityDeletion";
import { WorkPage, WorksPage } from "../features/works/WorksPages";
import { PersonPage } from "../features/people/PersonPage";
import { JobPage, JobsPage } from "../features/jobs/JobPages";
import { RemovedItemsPage } from "../features/settings/RemovedItemsPage";

const state = vi.hoisted(() => ({
  context: {} as Record<string, unknown>,
  go: vi.fn(),
  add: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("../app/NotebookProvider", () => ({
  useNotebook: () => state.context,
}));
vi.mock("../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string, values: Record<string, string | number> = {}) =>
      text.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
        String(values[key] ?? ""),
      ),
    formatDigits: String,
    number: String,
    money: (value: number) => `৳${value / 100}`,
    date: (value: string | null) => value ?? "",
    language: "bn",
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function fixture() {
  return LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
    people: [{ id: "worker", name: "শাহ আলম", kind: "worker" }],
    contracts: [
      {
        id: "job",
        personId: "worker",
        workId: "door",
        title: "দরজা লাগানো",
        total: 200000,
      },
    ],
    entries: [
      {
        id: "paid",
        kind: "payment",
        personId: "worker",
        contractId: "job",
        account: "labour",
        allocations: [{ workId: "door", amount: 100000 }],
        paymentParts: [{ amount: 100000 }],
      },
    ],
  });
}
function mount(initial: Ledger, path: string, child: ReactNode) {
  function Harness() {
    const [ledger, setLedger] = useState(initial);
    state.context = {
      ledger,
      go: state.go,
      add: state.add,
      notify: state.notify,
      detail: vi.fn(),
      entity: vi.fn(),
      base: "",
      mode: "demo",
      save: async (change: Ledger | ((current: Ledger) => Ledger)) =>
        setLedger((current) =>
          typeof change === "function" ? change(current) : change,
        ),
    };
    return (
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/sectors/:workId" element={child} />
          <Route path="/parties/:personId" element={child} />
          <Route path="/works/:jobId" element={child} />
          <Route path="/sectors" element={child} />
          <Route path="/works" element={child} />
          <Route path="/settings/removed" element={child} />
        </Routes>
      </MemoryRouter>
    );
  }
  return render(<Harness />);
}

it("requires DELETE for a notebook, keeps the subject visible, and restores without changing payments", async () => {
  const user = userEvent.setup(),
    initial = fixture();
  mount(initial, "/sectors/door", <WorkPage />);
  await user.click(screen.getByRole("button", { name: "খাতার আরও কাজ" }));
  await user.click(screen.getByRole("menuitem", { name: "মুছুন" }));
  const input = screen.getByRole("textbox"),
    confirm = screen.getByRole("button", { name: "মুছুন" });
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  expect(
    screen.getByText("দরজা", { selector: ".confirmation-subject" }),
  ).toBeTruthy();
  expect(screen.getByText("DELETE", { selector: "strong" })).toBeTruthy();
  await user.type(input, "দরজা");
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  await user.clear(input);
  await user.type(input, "DELETE");
  await user.click(confirm);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const saved = state.context.ledger as Ledger;
  expect(saved.entries).toEqual(initial.entries);
  expect(saved.works[0].archivedAt).not.toBeNull();
  expect(screen.getByText("তালিকা থেকে সরানো আছে")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "খরচ লিখি" })).toBeNull();
  expect(screen.queryByRole("button", { name: "টাকা দিলাম" })).toBeNull();
  expect(state.go).toHaveBeenLastCalledWith("/sectors");
  await user.click(screen.getByRole("button", { name: "ফিরিয়ে আনুন" }));
  await waitFor(() =>
    expect(screen.queryByText("তালিকা থেকে সরানো আছে")).toBeNull(),
  );
  expect(
    (state.context.ledger as Ledger).works[0].removalHistory.map(
      (event) => event.archived,
    ),
  ).toEqual([true, false]);
  expect((state.context.ledger as Ledger).entries).toEqual(initial.entries);
});

it.each(["worker", "shop", "driver", "other"] as const)(
  "uses the same DELETE confirmation for a %s contact",
  async (kind) => {
    const user = userEvent.setup();
    const initial = LedgerSchema.parse({
      people: [{ id: "person", name: "করিম ১২", kind }],
    });
    mount(initial, "/parties/person", <PersonPage />);
    await user.click(screen.getByRole("button", { name: "আরও" }));
    await user.click(screen.getByRole("menuitem", { name: "মুছুন" }));
    const input = screen.getByLabelText("নিশ্চিত করতে DELETE লিখুন");
    expect(
      screen.getByText("করিম ১২", { selector: ".confirmation-subject" }),
    ).toBeTruthy();
    await user.type(input, "DELETE");
    await user.click(screen.getByRole("button", { name: "মুছুন" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      (state.context.ledger as Ledger).people[0].archivedAt,
    ).not.toBeNull();
    expect((state.context.ledger as Ledger).people[0].kind).toBe(kind);
    expect((state.context.ledger as Ledger).entries).toEqual(initial.entries);
  },
);

it("uses DELETE for a job without changing its bill or payment history", async () => {
  const user = userEvent.setup(),
    initial = fixture();
  mount(initial, "/works/job", <JobPage />);
  await user.click(screen.getByRole("button", { name: "কাজের আরও কাজ" }));
  await user.click(screen.getByRole("menuitem", { name: "মুছুন" }));
  expect(
    screen.getByText("দরজা লাগানো", { selector: ".confirmation-subject" }),
  ).toBeTruthy();
  await user.type(screen.getByLabelText("নিশ্চিত করতে DELETE লিখুন"), "DELETE");
  await user.click(screen.getByRole("button", { name: "মুছুন" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const saved = state.context.ledger as Ledger;
  expect(saved.contracts[0].archivedAt).not.toBeNull();
  expect(saved.contracts[0].total).toBe(initial.contracts[0].total);
  expect(saved.contracts[0].activity).toEqual(initial.contracts[0].activity);
  expect(saved.entries).toEqual(initial.entries);
});

it("requires a fresh DELETE when a subject is renamed while its confirmation is open", async () => {
  const user = userEvent.setup();
  mount(fixture(), "/sectors/door", <WorkPage />);
  await user.click(screen.getByRole("button", { name: "খাতার আরও কাজ" }));
  await user.click(screen.getByRole("menuitem", { name: "মুছুন" }));
  await user.type(screen.getByLabelText("নিশ্চিত করতে DELETE লিখুন"), "DELETE");
  const save = state.context.save as (
    change: (current: Ledger) => Ledger,
  ) => Promise<void>;
  await act(async () => {
    await save((current) => ({
      ...current,
      works: current.works.map((work) => ({
        ...work,
        name: "দরজার নতুন খাতা",
      })),
    }));
  });
  expect(
    screen.getByText("দরজার নতুন খাতা", { selector: ".confirmation-subject" }),
  ).toBeTruthy();
  expect(
    (screen.getByLabelText("নিশ্চিত করতে DELETE লিখুন") as HTMLInputElement)
      .value,
  ).toBe("");
  expect(
    (screen.getByRole("button", { name: "মুছুন" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect((state.context.ledger as Ledger).works[0].archivedAt).toBeNull();
});

it("hides removed notebooks and jobs from lists while keeping their identity in history", () => {
  let ledger = setEntityRemoved(fixture(), "work", "door", true);
  ledger = setEntityRemoved(ledger, "contract", "job", true);
  const works = mount(ledger, "/sectors", <WorksPage />);
  expect(works.container.querySelector(".work-notebook-card")).toBeNull();
  works.unmount();
  const jobs = mount(ledger, "/works", <JobsPage />);
  expect(jobs.container.querySelector(".job-snap-card")).toBeNull();
  expect(ledger.entries[0].contractId).toBe("job");
});

it("blocks entry actions on an archived person and an archived job but keeps their amounts readable", () => {
  let ledger = setEntityRemoved(fixture(), "person", "worker", true);
  const person = mount(ledger, "/parties/worker", <PersonPage />);
  expect(screen.getByText("তালিকা থেকে সরানো আছে")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "টাকা দিই" })).toBeNull();
  expect(screen.queryByRole("button", { name: "কাজ যোগ করি" })).toBeNull();
  person.unmount();
  ledger = setEntityRemoved(ledger, "contract", "job", true);
  const job = mount(ledger, "/works/job", <JobPage />);
  expect(
    (screen.getByRole("button", { name: "টাকা দিই" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(job.container.textContent).toContain("৳2000");
  expect(job.container.textContent).toContain("৳1000");
});

it("restores an archived item from the removed list without losing its transaction", async () => {
  const user = userEvent.setup(),
    initial = fixture();
  const ledger = setEntityRemoved(initial, "person", "worker", true);
  mount(ledger, "/settings/removed", <RemovedItemsPage />);
  await user.click(screen.getByRole("button", { name: "শাহ আলম ফিরিয়ে আনুন" }));
  await waitFor(() => expect(screen.getByText("সরানো কিছু নেই")).toBeTruthy());
  expect((state.context.ledger as Ledger).people[0].archivedAt).toBeNull();
  expect((state.context.ledger as Ledger).entries).toEqual(initial.entries);
});
