// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { themePalettes } from "./themes";

const storageKey = "bari-khata-preferences";
const paletteIds = ["ocean", "forest", "violet", "sunset"] as const;
let deviceDark = false;
let deviceListeners: Set<() => void>;

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.palette;
  document.head.innerHTML = '<meta name="theme-color" content="#ffffff">';
  deviceDark = false;
  deviceListeners = new Set();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      get matches() {
        return deviceDark;
      },
      media: "(prefers-color-scheme: dark)",
      addEventListener: (_event: string, listener: () => void) =>
        deviceListeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) =>
        deviceListeners.delete(listener),
    })),
  );
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    () =>
      ({
        getPropertyValue: (property: string) => {
          if (property !== "--bg") return "";
          const explicit = document.documentElement.dataset.theme;
          const dark = explicit === "dark" || (!explicit && deviceDark);
          if (dark) return " #101113 ";
          return document.documentElement.dataset.palette === "sunset"
            ? " #fff8ee "
            : " #f5f7fb ";
        },
      }) as CSSStyleDeclaration,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.palette;
});

const statusBar = () =>
  document.querySelector('meta[name="theme-color"]')?.getAttribute("content");
const changeDeviceTheme = (dark: boolean) => {
  deviceDark = dark;
  for (const listener of deviceListeners) listener();
};

describe("theme palette compatibility", () => {
  it("keeps every persisted palette ID available with a distinct Bengali name", () => {
    expect(themePalettes.map((palette) => palette.value)).toEqual(paletteIds);
    expect(new Set(themePalettes.map((palette) => palette.label)).size).toBe(4);
    for (const palette of themePalettes) {
      expect(palette.label).toMatch(/[\u0980-\u09ff]/);
      expect(palette.colors).toHaveLength(4);
      expect(new URL(palette.source).hostname).toBe("colorhunt.co");
      for (const color of palette.colors)
        expect(color).toMatch(/^#[\da-f]{6}$/i);
    }
  });

  it("opens missing and malformed stored preferences with safe defaults", async () => {
    const { readPreferences } = await import("./preferences");
    const defaults = { language: "bn", theme: "light", palette: "ocean" };
    expect(readPreferences()).toEqual(defaults);
    localStorage.setItem(storageKey, "not-json");
    expect(readPreferences()).toEqual(defaults);
    localStorage.setItem(
      storageKey,
      JSON.stringify({ theme: { unsafe: true } }),
    );
    expect(readPreferences()).toEqual(defaults);
  });

  it("supplies new appearance defaults without losing a stored language", async () => {
    localStorage.setItem(storageKey, JSON.stringify({ language: "en" }));
    const { readPreferences } = await import("./preferences");
    expect(readPreferences()).toEqual({
      language: "en",
      theme: "light",
      palette: "ocean",
    });
  });

  it.each(paletteIds)(
    "retains %s across palette changes and keeps language and mode",
    async (palette) => {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ language: "en", theme: "dark", palette }),
      );
      const { readPreferences, savePreferences } =
        await import("./preferences");
      expect(readPreferences()).toEqual({
        language: "en",
        theme: "dark",
        palette,
      });
      savePreferences({ palette: "sunset" });
      expect(readPreferences()).toEqual({
        language: "en",
        theme: "dark",
        palette: "sunset",
      });
    },
  );
});

describe("theme appearance and browser status bar", () => {
  it("changes the selected palette and updates the status bar from its resolved background", async () => {
    const { applyPalette, applyTheme } = await import("./preferences");
    applyTheme("light");
    applyPalette("sunset");
    expect(document.documentElement.dataset.palette).toBe("sunset");
    expect(statusBar()).toBe("#fff8ee");
    applyPalette("ocean");
    expect(statusBar()).toBe("#f5f7fb");
  });

  it("follows a device appearance change when system mode is selected", async () => {
    const { applyTheme } = await import("./preferences");
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(statusBar()).toBe("#f5f7fb");
    changeDeviceTheme(true);
    expect(statusBar()).toBe("#101113");
    changeDeviceTheme(false);
    expect(statusBar()).toBe("#f5f7fb");
  });

  it("keeps an explicit appearance when the device appearance changes", async () => {
    const { applyTheme } = await import("./preferences");
    applyTheme("system");
    applyTheme("light");
    changeDeviceTheme(true);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(statusBar()).toBe("#f5f7fb");
    applyTheme("dark");
    changeDeviceTheme(false);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(statusBar()).toBe("#101113");
  });

  it("does not accumulate system listeners as palettes and appearances change", async () => {
    const { applyPalette, applyTheme } = await import("./preferences");
    for (const palette of paletteIds) {
      applyTheme("system");
      applyPalette(palette);
      applyTheme("dark");
      applyTheme("light");
    }
    expect(deviceListeners.size).toBe(1);
  });
});
