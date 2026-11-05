// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { LedgerSchema } from "../domain/model";
import { AppShell } from "./AppShell";

const api = vi.hoisted(() => ({
  ledger: null as unknown,
  base: "",
  go: vi.fn(),
  canReload: (() => true) as () => boolean,
}));
vi.mock("./NotebookProvider", () => ({
  useNotebook: () => ({
    ledger: api.ledger,
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
    return {
      needRefresh: [false, vi.fn()],
      updateServiceWorker: vi.fn(),
    };
  },
}));
vi.mock("../features/settings/AppearancePage", () => ({
  AppearancePage: () => <h1>Appearance page</h1>,
}));

beforeEach(() => {
  api.ledger = LedgerSchema.parse({});
  api.base = "";
  api.canReload = () => true;
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each(["", "/sample"])(
  "opens appearance as a full page and keeps settings active under %s",
  async (base) => {
    api.base = base;
    render(
      <MemoryRouter initialEntries={[`${base}/settings/appearance`]}>
        <Routes>
          <Route path={`${base || ""}/*`} element={<AppShell />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("heading", { name: "Appearance page" }),
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    const settings = screen.getByRole("link", { name: "সেটিংস" });
    expect(settings.getAttribute("aria-current")).toBe("page");
    expect(settings.getAttribute("href")).toBe(`${base}/settings`);
    expect(api.canReload()).toBe(true);
    expect(
      screen
        .getAllByRole("link", { name: "এক নজরে" })
        .every((link) => !link.hasAttribute("aria-current")),
    ).toBe(true);
  },
);
