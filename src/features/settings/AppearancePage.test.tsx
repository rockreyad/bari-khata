// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageProvider } from "../../context/LanguageProvider";
import { readPreferences } from "../../lib/preferences";
import { AppearancePage } from "./AppearancePage";

const api = vi.hoisted(() => ({ go: vi.fn() }));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({ go: api.go }),
}));
const storageKey = "bari-khata-preferences";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      media: "(prefers-color-scheme: dark)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.palette;
});
function mount() {
  return render(
    <LanguageProvider>
      <AppearancePage />
    </LanguageProvider>,
  );
}

it("retains every palette and appearance after reopening without changing the chosen language", async () => {
  const user = userEvent.setup();
  localStorage.setItem(
    storageKey,
    JSON.stringify({ language: "en", theme: "dark", palette: "ocean" }),
  );
  let view = mount();
  const choices = [
    ["ocean", "Nilima"],
    ["forest", "Bonolota"],
    ["violet", "Aparajita"],
    ["sunset", "Sunset"],
    ["winter", "Himel"],
    ["rose", "Kali"],
  ] as const;
  expect(
    within(
      screen.getByRole("group", { name: "Notebook colours" }),
    ).getAllByRole("button"),
  ).toHaveLength(6);
  for (const [palette, label] of choices) {
    await user.click(screen.getByRole("button", { name: label }));
    view.unmount();
    view = mount();
    expect(readPreferences()).toEqual({
      language: "en",
      theme: "dark",
      palette,
    });
    expect(
      screen.getByRole("button", { name: label }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(document.documentElement.dataset.palette).toBe(palette);
  }
  for (const [theme, label] of [
    ["light", "Daylight"],
    ["system", "Device setting"],
    ["dark", "Deep night"],
  ] as const) {
    await user.click(screen.getByRole("button", { name: label }));
    view.unmount();
    view = mount();
    expect(readPreferences()).toEqual({
      language: "en",
      theme,
      palette: "rose",
    });
    expect(
      screen.getByRole("button", { name: label }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(document.documentElement.dataset.theme).toBe(
      theme === "system" ? undefined : theme,
    );
  }
});

it("returns to settings using the notebook's own navigation", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "সেটিংসে ফিরুন" }));
  expect(api.go).toHaveBeenCalledExactlyOnceWith("/settings");
});

it("keeps the page focused on palette and appearance choices without a custom editor or sample panel", () => {
  const view = mount();
  expect(
    screen.queryByRole("heading", { name: "প্রতিটি অংশের রং" }),
  ).toBeNull();
  expect(
    screen.queryByRole("heading", { name: "প্রথম দেখায় হিসাব পরিষ্কার" }),
  ).toBeNull();
  expect(
    screen.queryByRole("heading", { name: "ছুঁয়ে, লিখে, বেছে দেখুন" }),
  ).toBeNull();
  expect(
    screen.queryByRole("navigation", { name: "সাজের পাতার অংশ" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "নিজের সাজ রাখুন" })).toBeNull();
  expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  expect(view.container.querySelector('input[type="color"]')).toBeNull();
});
