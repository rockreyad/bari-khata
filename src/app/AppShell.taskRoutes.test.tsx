// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { LedgerSchema } from "../domain/model";
import { AppShell } from "./AppShell";
const api = vi.hoisted(() => ({
  base: "",
  go: vi.fn(),
  canReload: (() => true) as () => boolean,
}));
vi.mock("./NotebookProvider", () => ({
  useNotebook: () => ({
    ledger: LedgerSchema.parse({}),
    base: api.base,
    mode: api.base ? "demo" : "real",
    state: {},
    go: api.go,
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
vi.mock("../features/write/HouseWritePage", () => ({
  HouseWriteChooser: () => <h1>Choose a house task</h1>,
  HouseWritePage: () => <h1>Record a house task</h1>,
}));
vi.mock("../features/import/MigrationReviewPage", () => ({
  MigrationReviewPage: () => <h1>Review earlier records</h1>,
}));
beforeEach(() => {
  api.base = "";
  api.go.mockClear();
  api.canReload = () => true;
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount(path: string, base = "") {
  api.base = base;
  return render(
    <MemoryRouter initialEntries={[`${base}${path}`]}>
      <Routes>
        <Route path={`${base}/*`} element={<AppShell />} />
      </Routes>
    </MemoryRouter>,
  );
}
it.each(["", "/sample"])(
  "keeps the five primary destinations and task chooser reachable under %s",
  async (base) => {
    mount("/write?person=karim&work=roof", base);
    expect(
      await screen.findByRole("heading", { name: "Choose a house task" }),
    ).toBeTruthy();
    const nav = within(screen.getByRole("navigation", { name: "প্রধান মেনু" }));
    expect(nav.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "বাড়ি",
      "কাজ",
      "লিখি",
      "মানুষ",
      "আরও",
    ]);
    expect(nav.getByRole("link", { name: "লিখি" }).getAttribute("href")).toBe(
      `${base}/write`,
    );
    expect(
      nav.getByRole("link", { name: "লিখি" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(api.canReload()).toBe(true);
  },
);
it.each(["purchase", "charge", "payment"])(
  "opens %s as a focused form and blocks update reload while it is open",
  async (action) => {
    const { container } = mount(`/write/${action}?person=karim&work=roof`);
    expect(
      await screen.findByRole("heading", { name: "Record a house task" }),
    ).toBeTruthy();
    expect(container.querySelector(".app-frame.is-entry-page")).toBeTruthy();
    expect(api.canReload()).toBe(false);
  },
);
it("places history, reports, review and settings behind More without opening bookkeeping forms", async () => {
  mount("/more");
  const heading = await screen.findByRole("heading", { name: "আরও" });
  expect(heading).toBeTruthy();
  for (const [name, path] of [
    ["আগের সব হিসাব", "/history"],
    ["খরচের রিপোর্ট", "/reports"],
    ["পুরোনো হিসাব যাচাই", "/migration"],
    ["খাতার সেটিংস", "/settings"],
  ]) {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
    expect(api.go).toHaveBeenLastCalledWith(path);
  }
});
it.each(["/ledger", "/history"])(
  "keeps the history deep link %s working with More selected",
  async (path) => {
    mount(path);
    expect(
      await screen.findByRole("heading", { name: "House history" }),
    ).toBeTruthy();
    const nav = within(screen.getByRole("navigation", { name: "প্রধান মেনু" }));
    expect(
      nav.getByRole("link", { name: "আরও" }).getAttribute("aria-current"),
    ).toBe("page");
  },
);
