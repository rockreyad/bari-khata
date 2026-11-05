// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router";
import { LedgerSchema } from "../domain/model";
import { AppShell } from "./AppShell";
const api = vi.hoisted(() => ({
  base: "",
  go: vi.fn(),
  quick: vi.fn(),
  canReload: (() => true) as () => boolean,
}));
vi.mock("./NotebookProvider", () => ({
  useNotebook: () => ({
    ledger: LedgerSchema.parse({
      works: [{ id: "sector", name: "নমুনা সেক্টর" }],
      people: [{ id: "party", name: "নমুনা পক্ষ" }],
      contracts: [
        { id: "job", workId: "sector", personId: "party", total: 10000 },
      ],
    }),
    base: api.base,
    mode: api.base ? "demo" : "real",
    state: {},
    go: api.go,
    quick: api.quick,
  }),
}));
vi.mock("../context/LanguageProvider", () => ({
  useLanguageContext: () => ({ t: String, formatDigits: String }),
}));
vi.mock("../lib/usePwa", () => ({
  usePwa: (canReload: () => boolean) => {
    api.canReload = canReload;
    return { needRefresh: [false, vi.fn()], updateServiceWorker: vi.fn() };
  },
}));
vi.mock("../features/home/HomePage", () => ({
  HomePage: () => <h1>House home</h1>,
}));
vi.mock("../features/ledger/LedgerPage", () => ({
  LedgerPage: () => <h1>House history</h1>,
}));
vi.mock("../features/works/WorksPages", () => ({
  WorksPage: () => <h1>Sector list</h1>,
  WorkPage: () => <h1>Sector detail {useParams().workId}</h1>,
}));
vi.mock("../features/jobs/JobPages", () => ({
  JobsPage: () => <h1>Work list</h1>,
  JobPage: () => <h1>Work detail {useParams().jobId}</h1>,
}));
vi.mock("../features/people/PeoplePages", () => ({
  PeoplePage: () => <h1>Party list</h1>,
  PersonPage: () => <h1>Party detail {useParams().personId}</h1>,
}));
vi.mock("../components/EntitySheet", () => ({
  EntitySheet: ({ kind, editId }: { kind: string; editId?: string }) => (
    <h1>
      Form {kind} {editId ?? "new"}
    </h1>
  ),
}));
vi.mock("../features/analytics/AnalyticsPage", () => ({
  AnalyticsPage: () => <h1>Reports</h1>,
}));
vi.mock("../features/write/HouseWritePage", () => ({
  HouseWriteChooser: () => <h1>Choose a house task</h1>,
  HouseWritePage: () => <h1>Record a house task</h1>,
}));
beforeEach(() => {
  api.base = "";
  api.go.mockClear();
  api.quick.mockClear();
  api.canReload = () => true;
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function Probe() {
  const location = useLocation();
  return (
    <output data-testid="route">
      {location.pathname}
      {location.search}
      {location.hash}
    </output>
  );
}
function mount(path: string, base = "") {
  api.base = base;
  return render(
    <MemoryRouter initialEntries={[`${base}${path}`]}>
      <Probe />
      <Routes>
        <Route path={`${base}/*`} element={<AppShell />} />
      </Routes>
    </MemoryRouter>,
  );
}

it.each(["", "/sample"])(
  "restores the original mobile layout with a central quick-sheet button under %s",
  async (base) => {
    mount("/", base);
    await screen.findByRole("heading", { name: "House home" });
    const nav = within(screen.getByRole("navigation", { name: "প্রধান মেনু" }));
    expect(nav.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "এক নজরে",
      "সেক্টর",
      "ইতিহাস",
      "পক্ষ",
    ]);
    expect(nav.getByRole("link", { name: "সেক্টর" }).getAttribute("href")).toBe(
      `${base}/sectors`,
    );
    expect(nav.getByRole("link", { name: "পক্ষ" }).getAttribute("href")).toBe(
      `${base}/parties`,
    );
    fireEvent.click(nav.getByRole("button", { name: "হিসাব লিখি" }));
    expect(api.quick).toHaveBeenCalledOnce();
    expect(nav.queryByRole("link", { name: "লিখি" })).toBeNull();
    expect(screen.queryByRole("link", { name: "আরও" })).toBeNull();
    expect(screen.getByRole("link", { name: "কাজ" }).getAttribute("href")).toBe(
      `${base}/works`,
    );
    expect(
      screen.getByRole("link", { name: "রিপোর্ট" }).getAttribute("href"),
    ).toBe(`${base}/reports`);
  },
);
it.each(["purchase", "charge", "payment"])(
  "keeps direct compatibility %s forms focused without adding them to navigation",
  async (action) => {
    const { container } = mount(`/write/${action}?person=party&work=sector`);
    await screen.findByRole("heading", { name: "Record a house task" });
    expect(container.querySelector(".app-frame.is-entry-page")).toBeTruthy();
    expect(api.canReload()).toBe(false);
  },
);
it.each(["", "/sample"])(
  "uses distinct sector, party and work list/detail/create routes under %s",
  async (base) => {
    for (const [path, heading] of [
      ["/sectors", "Sector list"],
      ["/sectors/sector", "Sector detail sector"],
      ["/sectors/new", "Form work new"],
      ["/sectors/sector/edit", "Form work sector"],
      ["/parties", "Party list"],
      ["/parties/party", "Party detail party"],
      ["/parties/new", "Form person new"],
      ["/parties/party/edit", "Form person party"],
      ["/works", "Work list"],
      ["/works/job", "Work detail job"],
      ["/works/new", "Form contract new"],
      ["/works/job/edit", "Form contract job"],
    ]) {
      const view = mount(path, base);
      await screen.findByRole("heading", { name: heading });
      view.unmount();
    }
  },
);
it.each(["", "/sample"])(
  "preserves legacy people/jobs links, query/back context and old sector detail IDs under %s",
  async (base) => {
    for (const [path, target] of [
      ["/people/party", "/parties/party"],
      ["/people/party/edit", "/parties/party/edit"],
      ["/jobs/job", "/works/job"],
      ["/contracts/job/edit", "/works/job/edit"],
      ["/works/sector", "/sectors/sector"],
    ]) {
      const query = "?work=sector&back=%2Fsectors%3Fstatus%3Ddone#source";
      const view = mount(`${path}${query}`, base);
      await waitFor(() =>
        expect(screen.getByTestId("route").textContent).toBe(
          `${base}${target}${query}`,
        ),
      );
      view.unmount();
    }
  },
);
it.each(["/ledger", "/history"])(
  "keeps %s in the original history navigation",
  async (path) => {
    mount(path);
    await screen.findByRole("heading", { name: "House history" });
    expect(
      within(screen.getByRole("navigation", { name: "প্রধান মেনু" }))
        .getByRole("link", { name: "ইতিহাস" })
        .getAttribute("aria-current"),
    ).toBe("page");
  },
);
it("keeps a safe legacy More redirect and removes the migration page", async () => {
  let view = mount("/more");
  await screen.findByRole("heading", { name: "Reports" });
  expect(screen.getByTestId("route").textContent).toBe("/reports");
  view.unmount();
  view = mount("/migration?person=party");
  await screen.findByRole("heading", { name: "House home" });
  expect(screen.getByTestId("route").textContent).toBe("/");
});
