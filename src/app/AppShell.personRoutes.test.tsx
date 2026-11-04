// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { LedgerSchema } from "../domain/model";
import { NotebookProvider } from "./NotebookProvider";
import { AppShell } from "./AppShell";

const state = vi.hoisted(() => ({
  ledger: null as unknown,
  forms: [] as Array<{
    kind: string;
    presentation?: string;
    editId?: string;
    defaultWorkId?: string;
    defaultPersonId?: string;
    mode: string;
  }>,
}));
vi.mock("../data/useLedger", () => ({
  useLedger: () => ({ ledger: state.ledger, error: null, save: vi.fn() }),
}));
vi.mock("../data/database", () => ({ getActiveOwner: () => "test-owner" }));
vi.mock("../context/LanguageProvider", () => ({
  useLanguageContext: () => ({ t: String, formatDigits: String }),
}));
vi.mock("../lib/usePwa", () => ({
  usePwa: () => ({
    needRefresh: [true, vi.fn()],
    updateServiceWorker: vi.fn(),
  }),
}));
vi.mock("../features/home/HomePage", () => ({ HomePage: () => <p>Home</p> }));
vi.mock("../features/works/WorksPages", () => ({
  WorksPage: () => <p>Notebooks</p>,
  WorkPage: () => <p>Notebook</p>,
}));
vi.mock("../features/ledger/LedgerPage", () => ({
  LedgerPage: () => <p>Ledger</p>,
}));
vi.mock("../features/people/PeoplePages", () => ({
  PeoplePage: () => <p>People</p>,
  PersonPage: () => <p>Person</p>,
}));
vi.mock("../features/entries/QuickActionsSheet", () => ({
  QuickActionsSheet: () => <div data-testid="quick-overlay" />,
}));
vi.mock("../features/entries/EntryDetail", () => ({
  EntryDetail: () => <div data-testid="entry-overlay" />,
}));
vi.mock("../components/EntitySheet", () => ({
  EntitySheet: ({
    onClose,
    ...props
  }: {
    kind: string;
    presentation?: string;
    editId?: string;
    defaultWorkId?: string;
    defaultPersonId?: string;
    mode: string;
    onClose: () => void;
  }) => {
    const { kind, presentation, editId, defaultWorkId, defaultPersonId, mode } =
      props;
    const context = {
      kind,
      presentation,
      editId,
      defaultWorkId,
      defaultPersonId,
      mode,
    };
    state.forms.push(context);
    return (
      <section data-testid="person-form">
        <output>{JSON.stringify(context)}</output>
        <button onClick={onClose}>Close person</button>
      </section>
    );
  },
}));

beforeEach(() => {
  state.forms = [];
  state.ledger = LedgerSchema.parse({
    works: [{ id: "door", name: "নমুনা খাতা" }],
    people: [{ id: "shop", name: "নমুনা দোকান", kind: "shop" }],
  });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});
function CurrentRoute() {
  const location = useLocation();
  return (
    <output data-testid="route">
      {location.pathname}
      {location.search}
    </output>
  );
}
function mount(path: string) {
  window.history.replaceState({}, "", path);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/sample/*"
          element={
            <NotebookProvider mode="demo">
              <AppShell />
              <CurrentRoute />
            </NotebookProvider>
          }
        />
        <Route
          path="/*"
          element={
            <NotebookProvider mode="real">
              <AppShell />
              <CurrentRoute />
            </NotebookProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}
const current = () =>
  new URL(
    screen.getByTestId("route").textContent ?? "/",
    "https://bari.invalid",
  );

it.each([
  ["", undefined],
  ["/sample", undefined],
  ["", "shop"],
  ["/sample", "shop"],
] as const)(
  "opens a single standalone person form under %s for %s with reloadable draft context",
  async (base, id) => {
    const back = `${base}/people?kind=shop&q=cement`;
    const path = `${base}/people/${id ? `${id}/edit` : "new"}?${new URLSearchParams({ work: "door", person: "legacy-default", back })}`;
    const { container } = mount(path);
    await screen.findByTestId("person-form");
    expect(screen.getAllByTestId("person-form")).toHaveLength(1);
    expect(state.forms.at(-1)).toEqual({
      kind: "person",
      presentation: "page",
      editId: id,
      defaultWorkId: "door",
      defaultPersonId: "legacy-default",
      mode: base ? "demo" : "real",
    });
    expect(
      container
        .querySelector(".app-frame")
        ?.classList.contains("is-entry-page"),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "আপডেট" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close person" }));
    await waitFor(() =>
      expect(`${current().pathname}${current().search}`).toBe(back),
    );
    expect(
      container
        .querySelector(".app-frame")
        ?.classList.contains("is-entry-page"),
    ).toBe(false);
    expect(screen.getByRole("button", { name: "আপডেট" })).toBeTruthy();
  },
);

it.each(["", "/sample"])(
  "redirects legacy person edits under %s without mounting a second modal or losing filters",
  async (base) => {
    const cleanBack = `${base}/ledger?work=door&account=materials&order=oldest`;
    mount(
      `${cleanBack}&_entity=person&_edit=shop&_work=door&_person=legacy-default&_entry=old&_quick=1`,
    );
    await screen.findByTestId("person-form");
    expect(current().pathname).toBe(`${base}/people/shop/edit`);
    expect(Object.fromEntries(current().searchParams)).toEqual({
      back: cleanBack,
      work: "door",
      person: "legacy-default",
    });
    expect(state.forms.every((form) => form.presentation === "page")).toBe(
      true,
    );
    expect(screen.getAllByTestId("person-form")).toHaveLength(1);
    expect(screen.queryByTestId("entry-overlay")).toBeNull();
    expect(screen.queryByTestId("quick-overlay")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close person" }));
    await waitFor(() =>
      expect(`${current().pathname}${current().search}`).toBe(cleanBack),
    );
  },
);

it("cleans a legacy person request already on a form while retaining its original return", async () => {
  const back = "/sample/works/door?tab=labour";
  mount(
    `/sample/people/new?${new URLSearchParams({ back, _entity: "person", _edit: "shop", _work: "door" })}`,
  );
  await screen.findByTestId("person-form");
  expect(current().pathname).toBe("/sample/people/shop/edit");
  expect(current().searchParams.get("back")).toBe(back);
  expect(current().searchParams.has("_entity")).toBe(false);
  expect(state.forms.every((form) => form.presentation === "page")).toBe(true);
});
