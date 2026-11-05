// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { LedgerSchema } from "../domain/model";
import { NotebookProvider, useNotebook } from "./NotebookProvider";

const state = vi.hoisted(() => ({
  owner: "owner-one",
  ledger: null as unknown,
}));
vi.mock("../data/useLedger", () => ({
  useLedger: () => ({ ledger: state.ledger, error: null, save: vi.fn() }),
}));
vi.mock("../data/database", () => ({ getActiveOwner: () => state.owner }));
vi.mock("../context/LanguageProvider", () => ({
  useLanguageContext: () => ({ t: (text: string) => text }),
}));

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  state.owner = "owner-one";
  vi.clearAllMocks();
});
function Commands() {
  const notebook = useNotebook();
  const location = useLocation();
  return (
    <>
      <output data-testid="route">
        {location.pathname}
        {location.search}
      </output>
      <button
        onClick={() =>
          notebook.add({
            kind: "payment",
            personId: "shop",
            workId: "door",
            account: "materials",
            purpose: "advance",
          })
        }
      >
        Add payment
      </button>
      <button
        onClick={() => notebook.entity("contract", undefined, "door", "worker")}
      >
        Create contract
      </button>
      <button
        onClick={() =>
          notebook.entity("contract", "agreement/one", "door", "worker")
        }
      >
        Edit contract
      </button>
      <button onClick={() => notebook.detail("bill-one")}>Open details</button>
      <button
        onClick={() =>
          notebook.add({
            kind: "expense",
            editId: "bill-one",
            personId: "shop",
            workId: "door",
          })
        }
      >
        Edit entry
      </button>
      <button onClick={notebook.close}>Close</button>
      <button onClick={() => notebook.entity("person", undefined, "door")}>
        Create person
      </button>
      <button onClick={() => notebook.entity("person", "shop/one", "door")}>
        Edit person
      </button>
    </>
  );
}
function mount(path: string, mode: "demo" | "real" = "demo") {
  state.ledger = LedgerSchema.parse({});
  window.history.replaceState({}, "", path);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotebookProvider mode={mode}>
        <Commands />
      </NotebookProvider>
    </MemoryRouter>,
  );
}
const current = () =>
  new URL(
    screen.getByTestId("route").textContent ?? "/",
    "https://bari.invalid",
  );

it("navigates from a filtered demo profile to an entry URL and back without losing the profile filter", () => {
  const path = "/sample/people/shop?work=door&account=materials&order=oldest";
  mount(path);
  fireEvent.click(screen.getByRole("button", { name: "Add payment" }));
  expect(current().pathname).toBe("/sample/write/payment");
  expect(Object.fromEntries(current().searchParams)).toEqual({
    back: path,
    work: "door",
    person: "shop",
    account: "materials",
    purpose: "advance",
  });
  expect(
    [...current().searchParams.keys()].some((key) => key.startsWith("_")),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(`${current().pathname}${current().search}`).toBe(path);
});

it("uses real contract create/edit paths and restores the filtered worker profile", () => {
  const path = "/sample/people/worker?work=door&account=labour";
  mount(path);
  fireEvent.click(screen.getByRole("button", { name: "Create contract" }));
  expect(current().pathname).toBe("/sample/jobs/new");
  expect(current().searchParams.get("work")).toBe("door");
  expect(current().searchParams.get("person")).toBe("worker");
  expect(current().searchParams.get("back")).toBe(path);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit contract" }));
  expect(current().pathname).toBe("/sample/jobs/agreement%2Fone/edit");
  expect(current().searchParams.get("back")).toBe(path);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(`${current().pathname}${current().search}`).toBe(path);
});

it.each(["", "/sample"])(
  "opens person creation/edit pages and restores filtered context under %s",
  (base) => {
    const path = `${base}/people?kind=shop&q=cement&work=door`;
    mount(path, base ? "demo" : "real");
    fireEvent.click(screen.getByRole("button", { name: "Create person" }));
    expect(current().pathname).toBe(`${base}/people/new`);
    expect(Object.fromEntries(current().searchParams)).toEqual({
      back: path,
      work: "door",
    });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(`${current().pathname}${current().search}`).toBe(path);
    fireEvent.click(screen.getByRole("button", { name: "Edit person" }));
    expect(current().pathname).toBe(`${base}/people/shop%2Fone/edit`);
    expect(current().searchParams.get("back")).toBe(path);
    expect(current().searchParams.has("_entity")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(`${current().pathname}${current().search}`).toBe(path);
  },
);

it("keeps the original return when switching from a form to person editing", () => {
  const back = "/sample/works/door?tab=labour";
  mount(`/sample/entries/new?${new URLSearchParams({ back })}`);
  fireEvent.click(screen.getByRole("button", { name: "Edit person" }));
  expect(current().pathname).toBe("/sample/people/shop%2Fone/edit");
  expect(current().searchParams.get("back")).toBe(back);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(`${current().pathname}${current().search}`).toBe(back);
});

it("returns a direct person form to the people list and rejects unsafe or circular returns", () => {
  let view = mount("/sample/people/new");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(current().pathname).toBe("/sample/people");
  view.unmount();
  for (const back of [
    "/sample/people/new",
    "/sample/people/shop/edit",
    "/people/shop",
    "https://outside.test/people",
  ]) {
    view = mount(`/sample/people/shop/edit?${new URLSearchParams({ back })}`);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(current().pathname).toBe("/sample/");
    view.unmount();
  }
});

it("strips the transaction-details dialog from an edit return without discarding history filters", () => {
  const path =
    "/sample/ledger?work=door&person=shop&account=materials&order=oldest&from=2026-01-01&q=cement";
  mount(path);
  fireEvent.click(screen.getByRole("button", { name: "Open details" }));
  expect(current().searchParams.get("_entry")).toBe("bill-one");
  fireEvent.click(screen.getByRole("button", { name: "Edit entry" }));
  expect(current().pathname).toBe("/sample/entries/bill-one/edit");
  expect(current().searchParams.get("back")).toBe(path);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(`${current().pathname}${current().search}`).toBe(path);
  expect(current().searchParams.has("_entry")).toBe(false);
});

it("keeps the original return when an edit is opened from a new entry route", () => {
  const back = "/sample/works/door?tab=labour";
  const params = new URLSearchParams({ kind: "payment", back });
  mount(`/sample/entries/new?${params}`);
  fireEvent.click(screen.getByRole("button", { name: "Edit entry" }));
  expect(current().pathname).toBe("/sample/entries/bill-one/edit");
  expect(current().searchParams.get("back")).toBe(back);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(`${current().pathname}${current().search}`).toBe(back);
});

it.each([
  "https://outside.test/people/shop",
  "/people/shop",
  "/sample/entries/new",
  "/sample/login",
])("closes an entry with unsafe demo return %s at the demo home", (back) => {
  mount(`/sample/entries/new?${new URLSearchParams({ back })}`);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(current().pathname).toBe("/sample/");
});

it("uses root account routes outside the demo and blocks navigation after the active owner changes", () => {
  mount("/people/shop?work=door", "real");
  fireEvent.click(screen.getByRole("button", { name: "Add payment" }));
  expect(current().pathname).toBe("/write/payment");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(current().pathname).toBe("/people/shop");
  state.owner = "owner-two";
  fireEvent.click(screen.getByRole("button", { name: "Add payment" }));
  fireEvent.click(screen.getByRole("button", { name: "Create contract" }));
  fireEvent.click(screen.getByRole("button", { name: "Create person" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit person" }));
  expect(`${current().pathname}${current().search}`).toBe(
    "/people/shop?work=door",
  );
});

it("does not open an entry after leaving the demo surface", () => {
  mount("/sample/people/shop");
  window.history.replaceState({}, "", "/login");
  fireEvent.click(screen.getByRole("button", { name: "Add payment" }));
  expect(current().pathname).toBe("/sample/people/shop");
  fireEvent.click(screen.getByRole("button", { name: "Create person" }));
  expect(current().pathname).toBe("/sample/people/shop");
});

it("returns a job edit to its history tab instead of leaving the form frame active", () => {
  const path = "/sample/jobs/agreement%2Fone?tab=history";
  mount(path);
  fireEvent.click(screen.getByRole("button", { name: "Edit contract" }));
  expect(current().pathname).toBe("/sample/jobs/agreement%2Fone/edit");
  expect(current().searchParams.get("back")).toBe(path);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(`${current().pathname}${current().search}`).toBe(path);
});
