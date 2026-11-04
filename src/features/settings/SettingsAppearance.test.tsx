// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageProvider } from "../../context/LanguageProvider";
import type { Preferences } from "../../lib/preferences";
import { SettingsAppearance } from "./SettingsAppearance";

const onChange = vi.fn();
function Appearance({ initial }: { initial?: Partial<Preferences> }) {
  const [preferences, setPreferences] = useState<Preferences>({
    language: "bn",
    theme: "light",
    palette: "ocean",
    ...initial,
  });
  return (
    <SettingsAppearance
      preferences={preferences}
      onChange={(change) => {
        onChange(change);
        setPreferences((current) => ({ ...current, ...change }));
      }}
    />
  );
}
function mount(initial?: Partial<Preferences>) {
  return render(
    <LanguageProvider>
      <Appearance initial={initial} />
    </LanguageProvider>,
  );
}
afterEach(() => {
  cleanup();
  localStorage.clear();
  onChange.mockClear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.palette;
});

it("lets the keyboard choose the appearance before colours and keeps the mode when choosing a new colour", async () => {
  const user = userEvent.setup();
  mount();
  await user.tab();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "দিনের আলো" }),
  );
  await user.tab();
  await user.keyboard("{Enter}");
  expect(onChange).toHaveBeenLastCalledWith({ theme: "dark" });
  const winter = screen.getByRole("button", { name: /হিমেল/ });
  winter.focus();
  await user.keyboard(" ");
  expect(onChange).toHaveBeenLastCalledWith({ palette: "winter" });
  expect(winter.getAttribute("aria-pressed")).toBe("true");
  expect(
    screen
      .getByRole("button", { name: "গভীর রাত" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.getByRole("status").textContent).toBe("এখন বেছে নেওয়া: হিমেল");
});

it("keeps just one selected palette through all six choices without changing device mode", async () => {
  const user = userEvent.setup();
  mount({ theme: "system" });
  const colours = screen.getByRole("group", { name: "খাতার রং" });
  const choices = within(colours).getAllByRole("button");
  expect(choices).toHaveLength(6);
  for (const choice of choices) {
    await user.click(choice);
    expect(within(colours).getAllByRole("button", { pressed: true })).toEqual([
      choice,
    ]);
    expect(
      screen
        .getByRole("button", { name: "ফোনের সঙ্গে" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  }
});

it("translates the palette names, descriptions and selection in English", async () => {
  localStorage.setItem(
    "bari-khata-preferences",
    JSON.stringify({ language: "en" }),
  );
  const user = userEvent.setup();
  mount({ language: "en" });
  await user.click(screen.getByRole("button", { name: "Himel" }));
  expect(screen.getByText("Frosted teal, a calm morning")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("Selected: Himel");
  await user.click(screen.getByRole("button", { name: "Kali" }));
  expect(screen.getByRole("status").textContent).toBe("Selected: Kali");
});
