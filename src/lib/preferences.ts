import { z } from "zod";
import { paletteIds } from "./themes";

const PreferencesSchema = z.object({
  language: z.enum(["bn", "en"]).default("bn"),
  theme: z.enum(["light", "dark", "system"]).default("light"),
  palette: z.enum(paletteIds).default("ocean"),
});
export type Preferences = z.infer<typeof PreferencesSchema>;
const key = "bari-khata-preferences";

export function readPreferences(): Preferences {
  try {
    return PreferencesSchema.parse(
      JSON.parse(localStorage.getItem(key) ?? "{}"),
    );
  } catch {
    return PreferencesSchema.parse({});
  }
}
export function savePreferences(change: Partial<Preferences>) {
  const value = PreferencesSchema.parse({ ...readPreferences(), ...change });
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* appearance still works when storage is unavailable */
  }
}
function updateStatusBar() {
  const color = getComputedStyle(document.documentElement)
    .getPropertyValue("--bg")
    .trim();
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", color);
}
let systemScheme: MediaQueryList | undefined;
function observeSystemScheme() {
  if (systemScheme || typeof window.matchMedia !== "function") return;
  systemScheme = window.matchMedia("(prefers-color-scheme: dark)");
  systemScheme.addEventListener("change", () => {
    if (!document.documentElement.dataset.theme) updateStatusBar();
  });
}
export function applyTheme(theme: Preferences["theme"]) {
  observeSystemScheme();
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  updateStatusBar();
}
export function applyPalette(palette: Preferences["palette"]) {
  document.documentElement.dataset.palette = palette;
  updateStatusBar();
}
